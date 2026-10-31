import PostalMime from 'postal-mime';
import { extractText, getDocumentProxy } from 'unpdf';
import type { Env } from './env';
import { previousInvoicesAddress } from './settings';
import { extract, ExtractionFailure, FORWARDED_CONTEXT } from './ai';
import { settleEmailRows } from './dedupe';
import { forwardedSender, senderName } from './vendor';
import { cacheFx, reconcile } from './banking';
import { authenticatedSender, senderVerdict, type SenderVerdict } from './sender';
import { holdUnknown, logMail, mailFacts } from './inbound';
import { config, isProduct, parseForwardCopyTo } from './config';
import {
  date,
  decimalText,
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
  inField,
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
import { hasTodoReason, REQUIRED_FIELDS, REQUIRED_SALES_FIELDS } from './flags';
import { parseDocument } from './parse';
import { undoAt, withUndo, type UndoAt } from './undo';
import { SEARCH_TEXT_CHARS, searchText } from './search';

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
    // Table cells keep a gap so "Yhteensä" and "15,90 €" stay two words.
    .on('td,th', {
      element() {
        text += ' ';
      },
    })
    .on('*', {
      text(t) {
        text += t.text;
      },
    })
    .transform(new Response(cleaned))
    .text();
  return decodeEntities(text);
}
const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  euro: '€',
  pound: '£',
};
// HTMLRewriter hands over text as written, so "15,90&nbsp;&euro;" is decoded here.
function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code === 0xa0 ? 0x20 : code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
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
// The text of an original that can't be shown as an image (what the reader read), for the receipt
// page. Null when there is none, or it can't be read.
export async function readableText(
  env: Env,
  r: Pick<Receipt, 'original_key' | 'media_type'>,
  limit = 20000,
): Promise<string | null> {
  try {
    const stored = await env.ORIGINALS.get(r.original_key);
    if (!stored) return null;
    const bytes = new Uint8Array(await stored.arrayBuffer());
    let text: string;
    if (r.media_type === 'message/rfc822') {
      const mail = await PostalMime.parse(bytes);
      text = cleanText(mail.text || (await visibleText(mail.html || '')));
    } else text = await documentText(bytes, r.media_type);
    return text.trim().slice(0, limit) || null;
  } catch {
    return null;
  }
}
// Search reads a document's words from search_text, written when it is read. Rows from before
// the archive, and other documents, are indexed here a few at a time: Settings repeats it until
// none are left, and Home tops up a few per visit. A file without words is indexed as ''.
export const INDEX_BATCH = 25;
export async function indexOlder(env: Env, limit = INDEX_BATCH): Promise<number> {
  const [receipts, documents] = await Promise.all([
    env.DB.prepare(
      'SELECT id,original_key,media_type FROM receipts WHERE search_text IS NULL ORDER BY received_at DESC LIMIT ?',
    )
      .bind(limit)
      .all<Pick<Receipt, 'id' | 'original_key' | 'media_type'>>(),
    env.DB.prepare(
      'SELECT id,original_key,media_type FROM documents WHERE search_text IS NULL ORDER BY received_at DESC LIMIT ?',
    )
      .bind(limit)
      .all<Pick<Receipt, 'id' | 'original_key' | 'media_type'>>(),
  ]);
  const rows = [
    ...receipts.results.map((r) => ({ ...r, table: 'receipts' })),
    ...documents.results.map((r) => ({ ...r, table: 'documents' })),
  ].slice(0, limit);
  const texts = await Promise.all(rows.map((r) => readableText(env, r, SEARCH_TEXT_CHARS)));
  if (rows.length)
    await env.DB.batch(
      rows.map((r, i) =>
        env.DB.prepare(`UPDATE ${r.table} SET search_text=? WHERE id=? AND search_text IS NULL`).bind(
          searchText(texts[i] ?? ''),
          r.id,
        ),
      ),
    );
  return unindexedCount(env);
}
export async function unindexedCount(env: Env): Promise<number> {
  return (
    (await env.DB.prepare(
      'SELECT (SELECT count(*) FROM receipts WHERE search_text IS NULL)+(SELECT count(*) FROM documents WHERE search_text IS NULL) n',
    ).first<number>('n')) ?? 0
  );
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
// A document that is not a receipt or a sales invoice (src/files.ts): its file, title, date and
// words, and nothing to read with the model. The same bytes added twice are one document.
export async function preserveDocument(
  env: Env,
  input: { bytes: Uint8Array; media: string; filename: string; title: string; date: string | null; words: string },
): Promise<string> {
  requireInput(
    input.bytes.length <= (input.media === 'application/pdf' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES),
    'Document too large',
    413,
  );
  requireInput(input.media === 'application/pdf' || input.media.startsWith('image/'), 'Choose a PDF or a photo', 415);
  const id = await hash(input.bytes),
    key = `documents/${id}`;
  await env.ORIGINALS.put(key, input.bytes, { httpMetadata: { contentType: input.media } });
  await env.DB.prepare(
    'INSERT INTO documents (id,original_key,filename,media_type,title,doc_date,received_at,search_text) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
  )
    .bind(
      id,
      key,
      input.filename.slice(0, 200),
      input.media,
      input.title,
      input.date,
      new Date().toISOString(),
      input.words,
    )
    .run();
  return id;
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
    let context = options.context,
      sender: string | null = null;
    if (claim.email_key) {
      const email = await env.ORIGINALS.get(claim.email_key);
      if (email) {
        const parsed = await PostalMime.parse(await email.arrayBuffer());
        const bodyText = parsed.text || (await visibleText(parsed.html || ''));
        if (!context && !claim.media_type.startsWith('text/')) context = bodyText;
        // Who the receipt is from when nothing in it says: the forwarded
        // header, else the sender itself unless that is the owner forwarding.
        const from = parsed.from?.address?.toLowerCase() ?? '';
        sender =
          forwardedSender(bodyText) ?? (config(env).allowedSenders.has(from) ? null : senderName(parsed.from ?? null));
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
      senderName: sender,
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
        'SELECT * FROM receipts WHERE id<>? AND kind=? AND invoice_number=? AND issue_date=? AND currency=? AND total_minor=? AND duplicate_of IS NULL AND discarded_at IS NULL',
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
      `UPDATE receipts SET ${entries.map(([k]) => `${k}=?`).join(',')}, product=?,expense_type=?,status=?,ai_json=?,classification_json=?,review_reasons_json=?,search_text=?,lease_until=NULL,
      fx_eur_minor=CASE WHEN ? THEN NULL ELSE fx_eur_minor END,fx_requested_date=CASE WHEN ? THEN NULL ELSE fx_requested_date END
      WHERE id=? AND attempt_id=? AND revision=?`,
    ).bind(
      ...entries.map(([, v]) => v),
      product,
      expenseType,
      hasTodoReason(reasons) ? 'needs_review' : 'ready',
      JSON.stringify(extracted.raw),
      JSON.stringify(extracted.classification),
      JSON.stringify([...new Set(reasons)]),
      searchText(text),
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
  // The ECB estimate first: the matcher uses it for a foreign receipt paid in euros.
  await cacheFx(env, await getReceipt(env, id));
  await reconcile(env);
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

// Mail from ALLOWED_SENDER_EMAILS is read. Other authenticated senders wait in
// Review as Unknown sender (src/inbound.ts); everything else is logged only.
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
  const envelope = message.from.trim().toLowerCase();
  const kind = kindFor(env, message.to);
  let bytes: Uint8Array;
  try {
    bytes = await readBounded(message.raw, MAX_EMAIL_BYTES);
  } catch (error) {
    if (error instanceof InputError && error.status === 413) {
      console.warn(JSON.stringify({ reason: 'email_too_large' }));
      await logMail(env, await mailFacts(null, envelope, message.to), 'dropped', 'email_too_large');
      return;
    }
    throw error;
  }
  const allowed = config(env).allowedSenders;
  // Allowed by envelope (as before), or by a From address that passed DMARC.
  let verdict: SenderVerdict,
    identity = envelope;
  if (allowed.has(envelope)) verdict = senderVerdict(bytes, envelope);
  else {
    const sender = authenticatedSender(bytes, envelope);
    if (!sender || !allowed.has(sender)) {
      // Not on the list: held for the owner to approve, or logged only.
      await holdUnknown(env, bytes, envelope, message.to, sender);
      return;
    }
    verdict = 'pass';
    identity = sender;
  }
  const facts = await mailFacts(bytes, envelope, message.to, identity);
  if (verdict === 'fail') {
    console.warn(JSON.stringify({ reason: 'sender_auth_failed' }));
    await logMail(env, facts, 'dropped', 'sender_auth_failed');
    return;
  }
  const emailKey = `emails/${await hash(bytes)}.eml`;
  await env.ORIGINALS.put(emailKey, bytes, {
    httpMetadata: { contentType: 'message/rfc822' },
  });
  await logMail(env, { ...facts, emailKey }, 'imported', verdict === 'unknown' ? 'sender_unverified' : 'allowed');
  if (verdict === 'unknown') {
    // Kept for manual review, never extracted: no AI spend on unproven mail.
    await emailReview(env, bytes, emailKey, kind, 'sender_unverified');
    return;
  }
  await importEmail(env, bytes, emailKey, kind, ctx);
}

// Reads an authenticated email that is already stored in R2 at emailKey: one
// receipt per supported attachment, or the body when there is none.
export async function importEmail(
  env: Env,
  bytes: Uint8Array,
  emailKey: string,
  kind: Kind,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
): Promise<void> {
  const jobs: string[] = [];
  let context = '',
    body: Body = null;
  try {
    const email = await PostalMime.parse(bytes);
    context = email.text || (await visibleText(email.html || ''));
    if (email.html || email.text)
      body = {
        bytes: new TextEncoder().encode(email.html || email.text),
        media: email.html ? 'text/html' : 'text/plain',
        text: context,
      };
    const supported = email.attachments.filter((a) => {
      if (SUPPORTED_MEDIA.includes(a.mimeType)) return true;
      // Some senders label PDFs application/octet-stream; trust the bytes.
      if (!GENERIC_MEDIA.includes(a.mimeType.toLowerCase()) && !/\.(pdf|png|jpe?g|webp)$/i.test(a.filename ?? ''))
        return false;
      try {
        return SUPPORTED_MEDIA.includes(detect(bytesOf(a.content)));
      } catch {
        return false;
      }
    });
    let skipped = supported.length > MAX_ATTACHMENTS;
    for (const attachment of supported.slice(0, MAX_ATTACHMENTS)) {
      const content = bytesOf(attachment.content);
      try {
        const media = detect(content);
        requireInput(
          media === attachment.mimeType || !SUPPORTED_MEDIA.includes(attachment.mimeType),
          'Attachment signature mismatch',
        );
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
      await settleEmail(env, { jobs, emailKey, kind, body });
    })(),
  );
}
const SUPPORTED_MEDIA = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const GENERIC_MEDIA = ['application/octet-stream', 'binary/octet-stream', 'application/x-pdf', 'application/download'];
function bytesOf(content: string | ArrayBuffer | Uint8Array): Uint8Array {
  return typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);
}
type Body = { bytes: Uint8Array; media: 'text/html' | 'text/plain'; text: string } | null;
// One email, one receipt per charge. When no attachment read a total, the
// body (an order confirmation, a bill notice) is read as well.
async function settleEmail(env: Env, input: { jobs: string[]; emailKey: string; kind: Kind; body: Body }) {
  const ids = [...input.jobs];
  if (input.kind === 'expense' && input.body && ids.length) {
    const read = await env.DB.prepare(
      `SELECT count(*) n FROM receipts WHERE id IN (${ids.map(() => '?').join(',')}) AND total_minor IS NOT NULL`,
    )
      .bind(...ids)
      .first<number>('n');
    if (!read && parseDocument(cleanText(input.body.text)).total !== null) {
      const row = await preserve(env, {
        bytes: input.body.bytes,
        media: input.body.media,
        filename: input.body.media === 'text/html' ? 'body.html' : 'body.txt',
        source: 'email',
        emailKey: input.emailKey,
      });
      await processReceipt(env, row.id);
      ids.push(row.id);
    }
  }
  await settleEmailRows(env, input.emailKey, ids);
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

// Returns the action's time when it approved, which the banner's Undo names.
export async function correctReceipt(env: Env, id: string, form: FormData): Promise<UndoAt | null> {
  const current = await getReceipt(env, id),
    revision = Number(form.get('revision'));
  requireInput(!current.discarded_at, 'Restore it first.', 409);
  requireInput(
    Number.isSafeInteger(revision) && revision === current.revision,
    'Stale receipt. Reload before saving.',
    409,
  );
  const facts: Facts = { ...emptyFacts };
  for (const key of ['vendor', 'invoice_number', 'issue_date', 'due_date', 'currency'] as const) {
    const value = String(form.get(key) ?? '').trim();
    requireInput(value.length <= 1000, 'Field too long', 422, key);
    facts[key] = value || null;
  }
  if (facts.issue_date) inField('issue_date', () => date(facts.issue_date!));
  if (facts.due_date) inField('due_date', () => date(facts.due_date!));
  if (facts.currency) requireInput(/^[A-Z]{3}$/.test(facts.currency), 'Invalid currency', 422, 'currency');
  for (const key of ['total', 'net', 'vat'] as const) {
    const value = decimalText(String(form.get(key) ?? ''));
    facts[`${key}_minor`] = value ? inField(key, () => minor(value, facts.currency ?? '')) : null;
  }
  const rate = decimalText(String(form.get('vat_rate') ?? ''));
  facts.vat_rate_bps = rate ? inField('vat_rate', () => minor(rate, 'EUR')) : null;
  requireInput(
    facts.vat_rate_bps === null || (facts.vat_rate_bps >= 0 && facts.vat_rate_bps <= 10000),
    'Invalid VAT rate',
    422,
    'vat_rate',
  );
  facts.line_items_json = current.line_items_json;
  const isSales = current.kind === 'sales';
  const sales: SalesFacts = isSales ? salesForm(form) : { ...emptySales };
  const product = String(form.get('product')),
    expense = isSales ? current.expense_type : String(form.get('expense_type'));
  requireInput(
    (isProduct(env, product) || product === current.product) && EXPENSE_TYPES.some((t) => t === expense),
    'Invalid category',
    422,
    'product',
  );
  const eur = decimalText(String(form.get('eur_override') ?? '')),
    eurReason = String(form.get('eur_override_reason') ?? '').trim();
  requireInput(!eur || eurReason.length > 0, 'EUR override needs reason', 422, 'eur_override_reason');
  const override = eur ? inField('eur_override', () => minor(eur, 'EUR')) : null;
  const duplicate = String(form.get('duplicate_of') ?? '').trim() || null;
  if (duplicate) {
    requireInput(duplicate !== id, 'Cannot duplicate itself', 422, 'duplicate_of');
    const parent = await getReceipt(env, duplicate);
    requireInput(!parent.duplicate_of, 'Duplicate chains are not allowed', 422, 'duplicate_of');
    requireInput(
      !(await env.DB.prepare('SELECT id FROM receipts WHERE duplicate_of=?').bind(id).first()),
      'A duplicate parent cannot become a duplicate',
      422,
      'duplicate_of',
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
    const missing: Record<string, boolean> = {
      vendor: !facts.vendor,
      issue_date: !facts.issue_date,
      currency: !facts.currency || EXPONENTS[facts.currency] === undefined,
      total: facts.total_minor === null,
      net: facts.net_minor === null,
      vat: facts.vat_minor === null,
      client: isSales && !sales.client,
    };
    requireInput(approval.length > 0, 'Approval needs a reason', 422, 'approval_reason');
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
      422,
      // The first missing fact, in the order the form lists them.
      (isSales ? REQUIRED_SALES_FIELDS : REQUIRED_FIELDS).find((f) => missing[f]) ?? 'client',
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
    now = undoAt();
  const invalidatesFx =
    facts.currency !== current.currency ||
    facts.issue_date !== current.issue_date ||
    facts.total_minor !== current.total_minor;
  const status = approved || !hasTodoReason(reasons) ? 'ready' : 'needs_review';
  // A manual match stays unless the facts it was made on change or the receipt
  // becomes a duplicate (a receipt in Review can stay matched; a sales invoice
  // can't). Automatic matches are dropped and re-run by reconcile below.
  const unlinks =
    invalidatesFx ||
    duplicate !== null ||
    (isSales && status !== 'ready' && JSON.stringify(reasons) !== '["missing_eur"]');
  const writes = [
    env.DB.prepare(
      "UPDATE bank_transactions SET receipt_id=NULL,match_method=NULL,matched_at=NULL WHERE receipt_id=? AND (?=1 OR match_method IS NOT 'manual') AND EXISTS(SELECT 1 FROM receipts WHERE id=? AND revision=?)",
    ).bind(id, unlinks ? 1 : 0, id, revision),
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
      status,
      JSON.stringify(manual),
      JSON.stringify(approved ? [] : reasons),
      approved ? now : null,
      invalidatesFx ? 1 : 0,
      id,
      revision,
    ),
  ];
  const result = approved
    ? await withUndo(env, { at: now, op: 'approve', ids: [id] }, writes)
    : await env.DB.batch(writes);
  requireInput(result[1]?.meta.changes === 1, 'Stale receipt. Reload before saving.', 409);
  await cacheFx(env, await getReceipt(env, id));
  await reconcile(env);
  return approved ? now : null;
}

// The sales fields of the invoice form. Empty values are unknown.
function salesForm(form: FormData): SalesFacts {
  const value = (key: string, max = 200) => {
    const text = String(form.get(key) ?? '').trim();
    requireInput(text.length <= max, 'Field too long', 422, key);
    return text || null;
  };
  const country = value('client_country', 2)?.toUpperCase() ?? null;
  requireInput(
    country === null || /^[A-Z]{2}$/.test(country),
    'Country must be a two-letter code, like DE',
    422,
    'client_country',
  );
  const vatId =
    value('client_vat_id', 30)
      ?.toUpperCase()
      .replace(/[\s.-]/g, '') ?? null;
  requireInput(
    vatId === null || /^[A-Z]{2,3}[0-9A-Z+*]{2,14}$/.test(vatId),
    'Invalid VAT number',
    422,
    'client_vat_id',
  );
  const treatment = value('vat_treatment', 30);
  requireInput(
    treatment === null || VAT_TREATMENTS.some((t) => t === treatment),
    'Invalid VAT treatment',
    422,
    'vat_treatment',
  );
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
  const result = await env.DB.batch(kindWrites(env, id, kind as Kind, revision));
  requireInput(result[1]?.meta.changes === 1, 'Stale receipt. Reload before saving.', 409);
  await processReceipt(env, id);
}
// The move itself, guarded by the revision it was read at; the second
// statement's changes say whether it applied.
export function kindWrites(env: Env, id: string, kind: Kind, revision: number): D1PreparedStatement[] {
  return [
    env.DB.prepare(
      'UPDATE bank_transactions SET receipt_id=NULL,match_method=NULL,matched_at=NULL WHERE receipt_id=? AND EXISTS(SELECT 1 FROM receipts WHERE id=? AND revision=?)',
    ).bind(id, id, revision),
    env.DB.prepare(
      "UPDATE receipts SET kind=?,client=NULL,client_country=NULL,client_vat_id=NULL,vat_treatment=NULL,reference_number=NULL,paid_outside_on=NULL,paid_outside_note=NULL,manual_fields_json='{}',status=CASE WHEN status='processing' THEN status ELSE 'pending' END,revision=revision+1,attempt_id=NULL,lease_until=NULL WHERE id=? AND revision=?",
    ).bind(kind, id, revision),
  ];
}

// A sales invoice paid where no imported statement shows it (a Stripe payout,
// cash, another bank). Empty date clears it. Returns the action's time, for Undo.
export async function markPaidOutside(env: Env, id: string, form: FormData): Promise<UndoAt> {
  const current = await getReceipt(env, id);
  requireInput(current.kind === 'sales', 'Only sales invoices can be marked paid');
  const { on, note } = paidFields(form);
  const at = undoAt();
  await withUndo(env, { at, op: 'paid', ids: [id] }, [
    env.DB.prepare('UPDATE receipts SET paid_outside_on=?,paid_outside_note=? WHERE id=?').bind(
      on || null,
      on ? note : null,
      id,
    ),
  ]);
  return at;
}
// The paid date and how it was paid. No date means not paid.
export function paidFields(form: FormData): { on: string; note: string } {
  const on = String(form.get('paid_outside_on') ?? '').trim(),
    note = String(form.get('paid_outside_note') ?? '').trim();
  if (on) date(on);
  requireInput(note.length <= 300, 'Note too long', 422, 'paid_outside_note');
  requireInput(
    !on || note.length > 0,
    'Say how it was paid, for example "Stripe payout 14 Oct"',
    422,
    'paid_outside_note',
  );
  return { on, note };
}
