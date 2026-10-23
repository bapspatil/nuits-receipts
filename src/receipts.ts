import PostalMime from 'postal-mime';
import { extractText, getDocumentProxy } from 'unpdf';
import type { Env } from './env';
import { previousInvoicesAddress } from './settings';
import { extract, ExtractionFailure, FORWARDED_CONTEXT } from './ai';
import { cacheFx, reconcile } from './banking';
import { senderVerdict } from './sender';
import { config, isProduct, parseForwardCopyTo } from './config';
import {
  date,
  minor,
  EXPENSE_TYPES,
  EXPONENTS,
  emptyFacts,
  hash,
  InputError,
  MAX_ATTACHMENTS,
  MAX_EMAIL_BYTES,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  MAX_STATE_CHARS,
  normalize,
  object,
  PROCESSING_LEASE_SECONDS,
  requireInput,
  review,
  emptySales,
  KINDS,
  VAT_TREATMENTS,
  type Kind,
  type Receipt,
  type Facts,
  type SalesFacts,
} from './domain';
import { SALES_DERIVED, salesReview } from './sales';

export async function readBounded(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array> {
  requireInput(stream, 'Empty request', 400);
  const reader = stream.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new InputError('Input too large', 413);
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export function detect(bytes: Uint8Array): string {
  const prefix = new TextDecoder('latin1').decode(bytes.slice(0, 16));
  if (prefix.startsWith('%PDF-')) return 'application/pdf';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (prefix.startsWith('RIFF') && prefix.slice(8, 12) === 'WEBP') return 'image/webp';
  throw new InputError('Expected PDF, PNG, JPEG, or WebP');
}
export async function visibleText(html: string): Promise<string> {
  let text = '';
  const cleaned = await new HTMLRewriter()
    .on('script,style,head', {
      element(e) {
        e.remove();
      },
    })
    .transform(new Response(html))
    .text();
  await new HTMLRewriter()
    .on('p,div,br,tr,li,h1,h2,h3', {
      element() {
        text += '\n';
      },
    })
    .on('*', {
      text(t) {
        text += t.text;
      },
    })
    .transform(new Response(cleaned))
    .text();
  return text;
}
// PDF text layers without a usable ToUnicode map (seen on Stripe receipts) turn
// hyphens and dashes into U+0000: "2937\u00006899", "Oct 22\u0000Nov 22". Map NUL
// to "-" and turn any other control character except tab and newline into a space.
export function cleanText(text: string): string {
  return text
    .replace(/\u0000/g, '-')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0001-\u0008\u000b-\u001f\u007f]/g, ' ');
}
export async function documentText(bytes: Uint8Array, media: string): Promise<string> {
  if (media === 'application/pdf') {
    requireInput(bytes.byteLength <= MAX_PDF_BYTES, 'pdf_too_large');
    const proxy = await getDocumentProxy(bytes.slice(), {
      useSystemFonts: false,
      disableFontFace: true,
    });
    try {
      requireInput(proxy.numPages <= MAX_PDF_PAGES, 'pdf_too_many_pages');
      const { text } = await extractText(proxy, { mergePages: true });
      const clean = cleanText(text);
      requireInput(clean.trim().length > 10, 'pdf_no_text');
      return clean;
    } finally {
      if ('destroy' in proxy && typeof proxy.destroy === 'function') await proxy.destroy();
    }
  }
  if (media === 'text/html') return cleanText(await visibleText(new TextDecoder().decode(bytes)));
  if (media === 'text/plain') return cleanText(new TextDecoder().decode(bytes));
  requireInput(media.startsWith('image/'), 'unsupported_document');
  return '';
}
export async function getReceipt(env: Env, id: string): Promise<Receipt> {
  const row = await env.DB.prepare('SELECT * FROM receipts WHERE id=?').bind(id).first<Receipt>();
  requireInput(row, 'Receipt not found', 404);
  return row;
}
export async function preserve(
  env: Env,
  input: {
    bytes: Uint8Array;
    filename: string;
    media: string;
    source: 'email' | 'upload';
    emailKey?: string;
    kind?: Kind;
  },
): Promise<Receipt> {
  requireInput(
    input.bytes.length <=
      (input.media === 'message/rfc822'
        ? MAX_EMAIL_BYTES
        : input.media === 'application/pdf'
          ? MAX_PDF_BYTES
          : MAX_IMAGE_BYTES),
    'Document too large',
    413,
  );
  const id = await hash(input.bytes),
    key = `receipts/${id}`;
  await env.ORIGINALS.put(key, input.bytes, {
    httpMetadata: { contentType: input.media },
  });
  await env.DB.prepare(
    `INSERT INTO receipts (id,original_key,filename,media_type,source,email_key,received_at,status,product,kind)
    VALUES (?,?,?,?,?,?,?,'pending',?,?) ON CONFLICT(id) DO NOTHING`,
  )
    .bind(
      id,
      key,
      input.filename.slice(0, 200),
      input.media,
      input.source,
      input.emailKey ?? null,
      new Date().toISOString(),
      config(env).defaultProduct,
      input.kind ?? 'expense',
    )
    .run();
  return getReceipt(env, id);
}
export async function processReceipt(
  env: Env,
  id: string,
  options: { retry?: boolean; context?: string } = {},
): Promise<Receipt> {
  const attempt = crypto.randomUUID(),
    now = new Date().toISOString();
  const claim = await env.DB.prepare(
    `UPDATE receipts SET status='processing', attempt_id=?, lease_until=?
    WHERE id=? AND (status='pending' OR (status='processing' AND lease_until < ?) OR (?=1 AND status IN ('ready','needs_review')))
    RETURNING *`,
  )
    .bind(attempt, new Date(Date.now() + PROCESSING_LEASE_SECONDS * 1000).toISOString(), id, now, options.retry ? 1 : 0)
    .first<Receipt>();
  if (!claim) return getReceipt(env, id);
  try {
    const original = await env.ORIGINALS.get(claim.original_key);
    requireInput(original, 'original_missing');
    const bytes = new Uint8Array(await original.arrayBuffer());
    const text = await documentText(bytes, claim.media_type);
    let context = options.context;
    if (!context && claim.email_key && !claim.media_type.startsWith('text/')) {
      const email = await env.ORIGINALS.get(claim.email_key);
      if (email) {
        const parsed = await PostalMime.parse(await email.arrayBuffer());
        context = parsed.text || (await visibleText(parsed.html || ''));
      }
    }
    const state = text + (context ? `${FORWARDED_CONTEXT}${cleanText(context)}` : '');
    const images = claim.media_type.startsWith('image/')
      ? [
          {
            content_type: claim.media_type,
            base64: btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')),
          },
        ]
      : undefined;
    const extracted = await extract(env, {
      state: state.slice(0, MAX_STATE_CHARS),
      receivedAt: claim.received_at,
      images,
      kind: claim.kind,
    });
    const overrides = object(JSON.parse(claim.manual_fields_json));
    const facts: Facts = { ...extracted.facts };
    for (const key of Object.keys(facts) as (keyof Facts)[])
      if (key in overrides) Object.assign(facts, { [key]: overrides[key] });
    const sales: SalesFacts = claim.kind === 'sales' ? { ...extracted.sales } : { ...emptySales };
    if (claim.kind === 'sales')
      for (const key of Object.keys(sales) as (keyof SalesFacts)[])
        if (key in overrides) Object.assign(sales, { [key]: overrides[key] });
    const acknowledged = Array.isArray(overrides.acknowledged_reasons) ? overrides.acknowledged_reasons : [];
    const reasons = [
      ...extracted.reasons.filter(
        (reason) =>
          (!overrides.approval_reason || !reason.startsWith('uncertain_')) &&
          !(reason === 'seller_mismatch' && 'vendor' in overrides),
      ),
      ...[
        ...review(facts),
        ...(claim.kind === 'sales'
          ? [...salesReview(facts, sales), ...('vendor' in overrides ? sellerReview(env, facts.vendor) : [])]
          : []),
      ].filter((reason) => !acknowledged.includes(reason) && !extracted.suppress.includes(reason)),
    ];
    if (state.length > MAX_STATE_CHARS) reasons.push('input_truncated');
    const peers = (
      await env.DB.prepare(
        'SELECT * FROM receipts WHERE id<>? AND kind=? AND invoice_number=? AND issue_date=? AND currency=? AND total_minor=? AND duplicate_of IS NULL',
      )
        .bind(id, claim.kind, facts.invoice_number, facts.issue_date, facts.currency, facts.total_minor)
        .all<Receipt>()
    ).results;
    if (facts.invoice_number && peers.some((p) => normalize(p.vendor ?? '') === normalize(facts.vendor ?? '')))
      reasons.push('probable_duplicate');
    const product = overrides.product ?? extracted.product,
      expenseType = overrides.expense_type ?? extracted.expense_type;
    const entries = [...Object.entries(facts), ...Object.entries(sales)];
    const changed = ['vendor', 'issue_date', 'currency', 'total_minor'].some(
      (key) => facts[key as keyof Facts] !== claim[key as keyof Facts],
    );
    const update = env.DB.prepare(
      `UPDATE receipts SET ${entries.map(([k]) => `${k}=?`).join(',')}, product=?,expense_type=?,status=?,ai_json=?,classification_json=?,review_reasons_json=?,lease_until=NULL,
      fx_eur_minor=CASE WHEN ? THEN NULL ELSE fx_eur_minor END,fx_requested_date=CASE WHEN ? THEN NULL ELSE fx_requested_date END
      WHERE id=? AND attempt_id=? AND revision=?`,
    ).bind(
      ...entries.map(([, v]) => v),
      product,
      expenseType,
      reasons.length ? 'needs_review' : 'ready',
      JSON.stringify(extracted.raw),
      JSON.stringify(extracted.classification),
      JSON.stringify([...new Set(reasons)]),
      changed ? 1 : 0,
      changed ? 1 : 0,
      id,
      attempt,
      claim.revision,
    );
    const writes = changed
      ? [
          env.DB.prepare(
            'UPDATE bank_transactions SET receipt_id=NULL,match_method=NULL,matched_at=NULL WHERE receipt_id=? AND EXISTS(SELECT 1 FROM receipts WHERE id=? AND attempt_id=? AND revision=?)',
          ).bind(id, id, attempt, claim.revision),
          update,
        ]
      : [update];
    await env.DB.batch(writes);
  } catch (error) {
    const reason =
      error instanceof ExtractionFailure
        ? 'invalid_model_output'
        : error instanceof InputError && /^[a-z_]+$/.test(error.message)
          ? error.message
          : 'extraction_failed';
    await env.DB.prepare(
      `UPDATE receipts SET status='needs_review',review_reasons_json=?,ai_json=COALESCE(?,ai_json),lease_until=NULL WHERE id=? AND attempt_id=? AND revision=?`,
    )
      .bind(
        JSON.stringify([reason]),
        error instanceof ExtractionFailure ? JSON.stringify({ schema_version: 1, extraction: error.raw }) : null,
        id,
        attempt,
        claim.revision,
      )
      .run();
  }
  const completed = await getReceipt(env, id);
  await reconcile(env);
  await cacheFx(env, completed);
  return getReceipt(env, id);
}
export async function upload(
  env: Env,
  bytes: Uint8Array,
  filename: string,
  declaredMedia: string,
  kind: Kind = 'expense',
): Promise<Receipt> {
  const media = detect(bytes);
  requireInput(media === declaredMedia, 'File signature and media type differ');
  const row = await preserve(env, { bytes, filename, media, source: 'upload', kind });
  return processReceipt(env, row.id);
}

// Only addresses in ALLOWED_SENDER_EMAILS are read. An empty list disables mail ingestion.
type IncomingEmail = Pick<ForwardableEmailMessage, 'from' | 'raw'> &
  Partial<Pick<ForwardableEmailMessage, 'to' | 'forward'>>;

// FORWARD_COPY_TO: a copy of every message that reaches the Worker, from any
// sender, so one-time codes and other non-receipt mail still reach a person.
// Runs alongside ingestion; neither can stop the other. Errors are logged.
export async function forwardCopy(message: IncomingEmail, env: Env): Promise<void> {
  let target: string;
  try {
    target = parseForwardCopyTo(env.FORWARD_COPY_TO);
  } catch {
    console.warn(JSON.stringify({ reason: 'forward_copy_invalid' }));
    return;
  }
  if (!target || !message.forward) return;
  const receiving = [message.to, env.RECEIPT_ADDRESS, env.INVOICES_ADDRESS].map((a) => (a ?? '').trim().toLowerCase());
  if (receiving.includes(target)) {
    console.warn(JSON.stringify({ reason: 'forward_copy_loop' }));
    return;
  }
  try {
    await message.forward(target);
  } catch (error) {
    console.error(
      JSON.stringify({ reason: 'forward_copy_failed', error: error instanceof Error ? error.message : String(error) }),
    );
  }
}

export async function receiveEmail(
  message: IncomingEmail,
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
): Promise<void> {
  const copy = forwardCopy(message, env);
  try {
    await ingestEmail(message, env, ctx);
  } finally {
    await copy;
  }
}

// Mail to INVOICES_ADDRESS is a sales invoice; everything else is a receipt.
// After the address changes in Settings, the old one counts for 30 days.
export function kindFor(env: Env, to: string | undefined): Kind {
  const address = (to ?? '').trim().toLowerCase();
  if (!address) return 'expense';
  return [config(env).invoicesAddress, previousInvoicesAddress(env)].includes(address) &&
    address !== config(env).receiptAddress
    ? 'sales'
    : 'expense';
}
async function ingestEmail(message: IncomingEmail, env: Env, ctx: Pick<ExecutionContext, 'waitUntil'>): Promise<void> {
  if (!config(env).allowedSenders.has(message.from.trim().toLowerCase())) return;
  const kind = kindFor(env, message.to);
  let bytes: Uint8Array;
  try {
    bytes = await readBounded(message.raw, MAX_EMAIL_BYTES);
  } catch (error) {
    if (error instanceof InputError && error.status === 413) {
      console.warn(JSON.stringify({ reason: 'email_too_large' }));
      return;
    }
    throw error;
  }
  const verdict = senderVerdict(bytes, message.from);
  if (verdict === 'fail') {
    console.warn(JSON.stringify({ reason: 'sender_auth_failed' }));
    return;
  }
  const emailKey = `emails/${await hash(bytes)}.eml`;
  await env.ORIGINALS.put(emailKey, bytes, {
    httpMetadata: { contentType: 'message/rfc822' },
  });
  if (verdict === 'unknown') {
    // Kept for manual review, never extracted: no AI spend on unproven mail.
    await emailReview(env, bytes, emailKey, kind, 'sender_unverified');
    return;
  }
  const jobs: string[] = [];
  let context = '';
  try {
    const email = await PostalMime.parse(bytes);
    context = email.text || (await visibleText(email.html || ''));
    const supported = email.attachments.filter((a) =>
      ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(a.mimeType),
    );
    let skipped = supported.length > MAX_ATTACHMENTS;
    for (const attachment of supported.slice(0, MAX_ATTACHMENTS)) {
      const content =
        typeof attachment.content === 'string'
          ? new TextEncoder().encode(attachment.content)
          : new Uint8Array(attachment.content);
      try {
        const media = detect(content);
        requireInput(media === attachment.mimeType, 'Attachment signature mismatch');
        if (media === 'image/png' && content.length >= 24) {
          const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
          if (view.getUint32(16) <= 2 || view.getUint32(20) <= 2) continue;
        }
        jobs.push(
          (
            await preserve(env, {
              bytes: content,
              media,
              filename: attachment.filename || 'attachment',
              source: 'email',
              emailKey,
              kind,
            })
          ).id,
        );
      } catch (error) {
        if (!(error instanceof InputError)) throw error;
        skipped = true;
      }
    }
    if (supported.length === 0 && kind === 'sales') {
      // Sales invoices are PDFs the owner made; an email body is not one.
      await emailReview(env, bytes, emailKey, kind, 'invoice_no_attachment');
    } else if (supported.length === 0) {
      requireInput(email.html || email.text, 'Empty email');
      context = '';
      const media = email.html ? 'text/html' : 'text/plain';
      const body = new TextEncoder().encode(email.html || email.text);
      jobs.push(
        (
          await preserve(env, {
            bytes: body,
            media,
            filename: email.html ? 'body.html' : 'body.txt',
            source: 'email',
            emailKey,
          })
        ).id,
      );
    }
    if (skipped) await emailReview(env, bytes, emailKey, kind, 'email_skipped_parts');
  } catch {
    await emailReview(env, bytes, emailKey, kind, 'mime_failed');
  }
  ctx.waitUntil(
    (async () => {
      for (const id of jobs) await processReceipt(env, id, { context });
    })(),
  );
}
async function emailReview(env: Env, bytes: Uint8Array, emailKey: string, kind: Kind, reason: string) {
  const row = await preserve(env, {
    bytes,
    media: 'message/rfc822',
    filename: 'source.eml',
    source: 'email',
    emailKey,
    kind,
  });
  await env.DB.prepare(
    "UPDATE receipts SET status='needs_review',review_reasons_json=? WHERE id=? AND status='pending'",
  )
    .bind(JSON.stringify([reason]), row.id)
    .run();
}

export async function correctReceipt(env: Env, id: string, form: FormData): Promise<void> {
  const current = await getReceipt(env, id),
    revision = Number(form.get('revision'));
  requireInput(
    Number.isSafeInteger(revision) && revision === current.revision,
    'Stale receipt. Reload before saving.',
    409,
  );
  const facts: Facts = { ...emptyFacts };
  for (const key of ['vendor', 'invoice_number', 'issue_date', 'due_date', 'currency'] as const) {
    const value = String(form.get(key) ?? '').trim();
    requireInput(value.length <= 1000, 'Field too long');
    facts[key] = value || null;
  }
  if (facts.issue_date) date(facts.issue_date);
  if (facts.due_date) date(facts.due_date);
  if (facts.currency) requireInput(/^[A-Z]{3}$/.test(facts.currency), 'Invalid currency');
  for (const key of ['total', 'net', 'vat'] as const) {
    const value = String(form.get(key) ?? '').trim();
    facts[`${key}_minor`] = value ? minor(value, facts.currency ?? '') : null;
  }
  const rate = String(form.get('vat_rate') ?? '').trim();
  facts.vat_rate_bps = rate ? minor(rate, 'EUR') : null;
  requireInput(
    facts.vat_rate_bps === null || (facts.vat_rate_bps >= 0 && facts.vat_rate_bps <= 10000),
    'Invalid VAT rate',
  );
  facts.line_items_json = current.line_items_json;
  const isSales = current.kind === 'sales';
  const sales: SalesFacts = isSales ? salesForm(form) : { ...emptySales };
  const product = String(form.get('product')),
    expense = isSales ? current.expense_type : String(form.get('expense_type'));
  requireInput(
    (isProduct(env, product) || product === current.product) && EXPENSE_TYPES.some((t) => t === expense),
    'Invalid category',
  );
  const eur = String(form.get('eur_override') ?? '').trim(),
    eurReason = String(form.get('eur_override_reason') ?? '').trim();
  requireInput(!eur || eurReason.length > 0, 'EUR override needs reason');
  const override = eur ? minor(eur, 'EUR') : null;
  const duplicate = String(form.get('duplicate_of') ?? '').trim() || null;
  if (duplicate) {
    requireInput(duplicate !== id, 'Cannot duplicate itself');
    const parent = await getReceipt(env, duplicate);
    requireInput(!parent.duplicate_of, 'Duplicate chains are not allowed');
    requireInput(
      !(await env.DB.prepare('SELECT id FROM receipts WHERE duplicate_of=?').bind(id).first()),
      'A duplicate parent cannot become a duplicate',
    );
  }
  const approval = String(form.get('approval_reason') ?? '').trim(),
    approved = form.get('action') === 'approve';
  const derived = new Set([
    ...review(emptyFacts),
    'unsupported_currency',
    'vat_mismatch',
    'credit_or_sign',
    'missing_vat_rate',
    'vat_rate_mismatch',
    'missing_eur',
    ...(isSales ? [...SALES_DERIVED, 'seller_mismatch'] : []),
  ]);
  const preserved: string[] = JSON.parse(current.review_reasons_json);
  const reasons = [
    ...new Set([
      ...preserved.filter((reason) => !derived.has(reason)),
      ...review(facts),
      ...(isSales ? [...salesReview(facts, sales), ...sellerReview(env, facts.vendor)] : []),
    ]),
  ];
  if (approved) {
    requireInput(approval.length > 0, 'Approval needs a reason');
    requireInput(
      facts.vendor &&
        facts.issue_date &&
        facts.currency &&
        EXPONENTS[facts.currency] !== undefined &&
        facts.total_minor !== null &&
        facts.net_minor !== null &&
        facts.vat_minor !== null &&
        (!isSales || sales.client),
      isSales
        ? 'Complete the client, date, currency and amounts before approval'
        : 'Complete required facts before approval',
    );
  }
  const manual = {
    ...facts,
    ...(isSales ? sales : {}),
    product,
    expense_type: expense,
    ...(approved ? { approval_reason: approval, acknowledged_reasons: reasons } : {}),
  };
  const entries = [...Object.entries(facts), ...Object.entries(sales)],
    now = new Date().toISOString();
  const invalidatesFx =
    facts.currency !== current.currency ||
    facts.issue_date !== current.issue_date ||
    facts.total_minor !== current.total_minor;
  const result = await env.DB.batch([
    env.DB.prepare(
      'UPDATE bank_transactions SET receipt_id=NULL,match_method=NULL,matched_at=NULL WHERE receipt_id=? AND EXISTS(SELECT 1 FROM receipts WHERE id=? AND revision=?)',
    ).bind(id, id, revision),
    env.DB.prepare(
      `UPDATE receipts SET ${entries.map(([k]) => `${k}=?`).join(',')},product=?,expense_type=?,eur_override_minor=?,eur_override_reason=?,duplicate_of=?,status=?,manual_fields_json=?,review_reasons_json=?,reviewed_at=?,revision=revision+1,attempt_id=NULL,lease_until=NULL,fx_eur_minor=CASE WHEN ? THEN NULL ELSE fx_eur_minor END
      WHERE id=? AND revision=?`,
    ).bind(
      ...entries.map(([, v]) => v),
      product,
      expense,
      override,
      override === null ? null : eurReason,
      duplicate,
      approved || !reasons.length ? 'ready' : 'needs_review',
      JSON.stringify(manual),
      JSON.stringify(approved ? [] : reasons),
      approved ? now : null,
      invalidatesFx ? 1 : 0,
      id,
      revision,
    ),
  ]);
  requireInput(result[1]?.meta.changes === 1, 'Stale receipt. Reload before saving.', 409);
  await reconcile(env);
  await cacheFx(env, await getReceipt(env, id));
}

// The sales fields of the invoice form. Empty values are unknown.
function salesForm(form: FormData): SalesFacts {
  const value = (key: string, max = 200) => {
    const text = String(form.get(key) ?? '').trim();
    requireInput(text.length <= max, 'Field too long');
    return text || null;
  };
  const country = value('client_country', 2)?.toUpperCase() ?? null;
  requireInput(country === null || /^[A-Z]{2}$/.test(country), 'Country must be a two-letter code, like DE');
  const vatId =
    value('client_vat_id', 30)
      ?.toUpperCase()
      .replace(/[\s.-]/g, '') ?? null;
  requireInput(vatId === null || /^[A-Z]{2,3}[0-9A-Z+*]{2,14}$/.test(vatId), 'Invalid VAT number');
  const treatment = value('vat_treatment', 30);
  requireInput(treatment === null || VAT_TREATMENTS.some((t) => t === treatment), 'Invalid VAT treatment');
  return {
    client: value('client'),
    client_country: country,
    client_vat_id: vatId,
    vat_treatment: treatment as SalesFacts['vat_treatment'],
    reference_number: value('reference_number', 40),
  };
}
// The seller on a sales invoice must be one of SELLER_NAMES (when set).
function sellerReview(env: Env, vendor: string | null): string[] {
  const names = config(env).sellerNames;
  if (!names.length || !vendor) return [];
  const v = normalize(vendor);
  return names.some((n) => normalize(n) && v.includes(normalize(n))) ? [] : ['seller_mismatch'];
}

// Move a document between receipts and sales invoices, then read it again as
// the other kind. Any bank match is removed; typed-in corrections are kept.
export async function changeKind(env: Env, id: string, kind: string, revision: number): Promise<void> {
  requireInput(
    KINDS.some((k) => k === kind),
    'Invalid document kind',
  );
  const current = await getReceipt(env, id);
  requireInput(revision === current.revision, 'Stale receipt. Reload before saving.', 409);
  requireInput(current.kind !== kind, 'It is already filed that way.');
  const result = await env.DB.batch([
    env.DB.prepare(
      'UPDATE bank_transactions SET receipt_id=NULL,match_method=NULL,matched_at=NULL WHERE receipt_id=? AND EXISTS(SELECT 1 FROM receipts WHERE id=? AND revision=?)',
    ).bind(id, id, revision),
    env.DB.prepare(
      "UPDATE receipts SET kind=?,client=NULL,client_country=NULL,client_vat_id=NULL,vat_treatment=NULL,reference_number=NULL,paid_outside_on=NULL,paid_outside_note=NULL,manual_fields_json='{}',status=CASE WHEN status='processing' THEN status ELSE 'pending' END,revision=revision+1,attempt_id=NULL,lease_until=NULL WHERE id=? AND revision=?",
    ).bind(kind, id, revision),
  ]);
  requireInput(result[1]?.meta.changes === 1, 'Stale receipt. Reload before saving.', 409);
  await processReceipt(env, id);
}

// A sales invoice paid where no imported statement shows it (a Stripe payout,
// cash, another bank). Empty date clears it.
export async function markPaidOutside(env: Env, id: string, form: FormData): Promise<void> {
  const current = await getReceipt(env, id);
  requireInput(current.kind === 'sales', 'Only sales invoices can be marked paid');
  const on = String(form.get('paid_outside_on') ?? '').trim(),
    note = String(form.get('paid_outside_note') ?? '').trim();
  if (on) date(on);
  requireInput(note.length <= 300, 'Note too long');
  requireInput(!on || note.length > 0, 'Say how it was paid, for example "Stripe payout 14 Oct"');
  await env.DB.prepare('UPDATE receipts SET paid_outside_on=?,paid_outside_note=? WHERE id=?')
    .bind(on || null, on ? note : null, id)
    .run();
}
