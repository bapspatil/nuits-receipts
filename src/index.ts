import type { Env } from './env';
import { mergeDuplicates } from './dedupe';
import { hash, InputError, MAX_PDF_BYTES, MAX_CSV_BYTES, EXPENSE_TYPES, normalize, requireInput } from './domain';
import {
  changeKind,
  correctReceipt,
  getReceipt,
  markPaidOutside,
  processReceipt,
  readBounded,
  receiveEmail,
  upload,
} from './receipts';
import { FAVICON_SVG, errorId, errorPage, exportCsv, exportSalesCsv, month } from './ui';
import { ADD_CSP, ADD_JS, addPage, invoicesPage, MAX_UPLOAD_FILES } from './invoices';
import { home, importPage, payments, previewable, queueAround, receiptPage, reviewPage, settingsPage } from './views';
import { REVIEW_FILTERS, type ReviewFilter } from './flags';
import { FONT_FILES } from './fonts';
import { clearBankReview, creditFit, eligible, matchable, reconcile, type Transaction } from './banking';
import { signer, type Signer } from './signing';
import { createAccount, renameAccount, confirmTransfer, undoTransfer } from './accounts';
import { importPreview, confirmImport } from './imports';
import type { Receipt, Rule } from './domain';
import { config, ConfigError, isProduct, MIN_PASSWORD_LENGTH, WEAK_PASSWORDS } from './config';
import { verifyAccessJwt } from './access';
import { withSettings } from './settings';
import { approveSender, deleteHeld, ignoreSender, removeApproved, unignoreSender } from './inbound';
import { allReceiptsPage } from './all';
import { backPath, discardReason, discardReceipts, receiptIds, restoreBatch, restoreReceipts } from './discard';
import { resetSetting, saveSetup } from './setup';
import { markSent, options, packageZip, query } from './package';
import { withDone, type EventKey } from './events';
import { requestState, type FormFailure, type RequestState } from './request';
import { chooseFolder, connectCallback, connectStart, disconnect, oneDrive, uploadBatch } from './onedrive';

// Who is signed in: the Access email, "password" for HTTP Basic, or null.
async function authorized(request: Request, env: Env): Promise<string | null> {
  // Access mode: only a valid Access token for an allowed email gets in.
  // HTTP Basic is ignored, so NUITS_PASSWORD no longer opens the app.
  const access = config(env).access;
  if (access) return verifyAccessJwt(request.headers.get('Cf-Access-Jwt-Assertion'), access);
  return (await passwordOk(request, env)) ? 'password' : null;
}
async function passwordOk(request: Request, env: Env): Promise<boolean> {
  if (!env.NUITS_PASSWORD) return false;
  if (
    env.AI_MODE === 'live' &&
    (env.NUITS_PASSWORD.length < MIN_PASSWORD_LENGTH || WEAK_PASSWORDS.has(env.NUITS_PASSWORD))
  )
    return false;
  const url = new URL(request.url);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return false;
  try {
    const header = request.headers.get('Authorization');
    if (!header?.startsWith('Basic ')) return false;
    const actual = new TextEncoder().encode(await hash(atob(header.slice(6))));
    const expected = new TextEncoder().encode(await hash(`${config(env).username}:${env.NUITS_PASSWORD}`));
    return crypto.subtle.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
async function formData(request: Request, limit: number): Promise<FormData> {
  const bytes = await readBounded(request.body, limit);
  try {
    const form = await new Response(bytes, {
      headers: { 'Content-Type': request.headers.get('Content-Type') ?? '' },
    }).formData();
    // Kept so a refusal can show the same form again with what was typed.
    const state = requestState.getStore();
    if (state) state.form = form;
    return form;
  } catch {
    throw new InputError('Invalid form data', 400);
  }
}
// Approve, ignore, delete and the Settings > Senders list. Each form says
// where to go back to: Review (default), Settings or All receipts.
async function senderAction(request: Request, env: Env, path: string, who: string, ctx: Waiter): Promise<Response> {
  const form = await formData(request, 4096);
  const back = ({ settings: '/settings', receipts: '/receipts' } as Record<string, string>)[String(form.get('back'))];
  const address = form.get('address');
  let event: EventKey, n: number | undefined;
  if (path === '/senders/approve') [event, n] = ['mailAllowed', await approveSender(env, address, who, ctx)];
  else if (path === '/senders/ignore') [event, n] = ['mailIgnored', await ignoreSender(env, address, who)];
  else if (path === '/senders/delete') {
    const id = String(form.get('id') ?? '');
    requireInput(/^[0-9a-f-]{36}$/.test(id), 'Invalid email', 400);
    await deleteHeld(env, id);
    event = 'mailDeleted';
  } else if (path === '/senders/remove') {
    await removeApproved(env, address, who);
    event = 'senderRemoved';
  } else if (path === '/senders/unignore') {
    await unignoreSender(env, address);
    event = 'senderUnignored';
  } else return new Response('Not found', { status: 404 });
  const settings = back === '/settings';
  return redirect(
    withDone(event, settings ? '/settings#senders' : (back ?? '/review'), { n, from: settings ? 'settings' : null }),
  );
}
// The fields of a vendor rule, checked the same way for a new rule and an edit.
function ruleFrom(env: Env, form: FormData): [string, string | null, string | null, string, string, number] {
  const vendor = String(form.get('vendor_contains') ?? '').trim();
  const context = String(form.get('context_contains') ?? '').trim() || null,
    alias = String(form.get('bank_alias') ?? '').trim() || null;
  const product = String(form.get('product')),
    expense = String(form.get('expense_type')),
    priority = Number(form.get('priority'));
  requireInput(
    normalize(vendor) && vendor.length <= 200 && (!context || context.length <= 200) && (!alias || alias.length <= 200),
    'Invalid vendor rule',
  );
  requireInput(
    isProduct(env, product) && EXPENSE_TYPES.some((t) => t === expense) && Number.isSafeInteger(priority),
    'Invalid rule category or priority',
  );
  return [vendor, context, alias, product, expense, priority];
}
async function saveRule(statement: D1PreparedStatement): Promise<void> {
  try {
    await statement.run();
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint'))
      throw new InputError('A rule with the same seller text already exists', 409);
    throw error;
  }
}
// A failure to sign leaves the redirect without ?done= rather than with a link nobody can verify.
async function signedLocation(signs: Signer, location: string): Promise<string> {
  try {
    return await signs.sign(location);
  } catch (error) {
    console.warn(JSON.stringify({ reason: 'feedback_unsigned', error: String(error) }));
    return location.replace(/([?&])done=[^&#]*&?/, '$1').replace(/[?&]$/, '');
  }
}
function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}
// A page that moved. Temporary (302) while the new layout settles; the query
// string is carried over exactly as sent.
export function moved(location: string, search = ''): Response {
  return new Response(null, { status: 302, headers: { Location: location + search } });
}
// The first transfer row on Bank, in the month the money left, and who was paid.
async function transferRow(env: Env, debitId: string): Promise<{ to: string; name: string }> {
  const row = await env.DB.prepare('SELECT booking_date,merchant FROM bank_transactions WHERE id=?')
    .bind(debitId)
    .first<{ booking_date: string; merchant: string }>();
  return {
    to: `/payments?${row ? `month=${row.booking_date.slice(0, 7)}&` : ''}show=all#transfers`,
    name: row?.merchant ?? '',
  };
}
type Waiter = Pick<ExecutionContext, 'waitUntil'>;
async function route(request: Request, env: Env, base: string, ctx: Waiter): Promise<Response> {
  const who = await authorized(request, env);
  if (!who)
    // No Basic challenge in Access mode, so browsers never show a password prompt.
    return config(env).access
      ? new Response('Sign in through Cloudflare Access to use this app.', { status: 403 })
      : new Response('Authentication required', {
          status: 401,
          headers: {
            'WWW-Authenticate': `Basic realm="${config(env).appName.replace(/["\\]/g, '')}", charset="UTF-8"`,
          },
        });
  const url = new URL(request.url),
    path = url.pathname;
  if (!['GET', 'HEAD'].includes(request.method)) {
    requireInput(request.method === 'POST', 'Method not allowed', 405);
    requireInput(request.headers.get('Origin') === url.origin, 'Origin does not match', 403);
  }
  if (request.method === 'POST' && path === '/upload') return uploadFiles(request, env);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  requireInput(Number.isSafeInteger(offset) && offset >= 0, 'Invalid page');
  if (request.method === 'GET' && path === '/')
    return home(env, month(url.searchParams.get('month')), url.searchParams);
  // Old addresses: the month close is Home now, and the phone's More menu is gone.
  const read = request.method === 'GET' || request.method === 'HEAD';
  if (read && path === '/month') return moved('/', url.search);
  if (read && path === '/more') return moved('/settings');
  if (request.method === 'GET' && path === '/review') {
    const reason = url.searchParams.get('reason') ?? '';
    return reviewPage(env, reason in REVIEW_FILTERS ? (reason as ReviewFilter) : null, url.searchParams);
  }
  if (request.method === 'POST' && path === '/discard') {
    const form = await formData(request, 16 * 1024);
    const ids = receiptIds(form.getAll('id'));
    const revision = form.get('revision');
    // From the receipt page in the queue: land on the next one, like Skip.
    const queue = form.get('back') === 'queue' && ids.length === 1 ? (await queueAround(env, ids[0]!)).next : null;
    const at = await discardReceipts(env, ids, {
      reason: discardReason(form.get('reason')),
      unmatch: form.get('unmatch') === '1',
      revision: revision === null ? null : Number(revision),
    });
    const to =
      queue && queue !== ids[0]
        ? `/receipts/${queue}`
        : form.get('back') === 'queue'
          ? '/review'
          : backPath(form.get('back'));
    return redirect(withDone('discarded', to, { n: ids.length, at, back: to }));
  }
  if (request.method === 'POST' && path === '/restore') {
    const form = await formData(request, 16 * 1024);
    const at = form.get('at');
    const n = at ? await restoreBatch(env, String(at)) : await restoreReceipts(env, receiptIds(form.getAll('id')));
    return redirect(withDone('restored', backPath(form.get('back')), { n }));
  }
  if (request.method === 'POST' && path === '/review/merge')
    return redirect(withDone('merged', '/review', { n: await mergeDuplicates(env) }));
  if (request.method === 'GET' && path === '/month/package.zip')
    return packageZip(env, month(url.searchParams.get('month')), options(url.searchParams), url.origin + base);
  if (request.method === 'POST' && path === '/month/sent') {
    const form = await formData(request, 4096),
      selected = month(String(form.get('month') ?? ''));
    await markSent(env, selected, String(form.get('receipts_hash') ?? ''), 'download');
    return redirect(withDone('sent', `/?month=${selected}#send`));
  }
  if (request.method === 'POST' && path === '/month/onedrive-upload') {
    const form = await formData(request, 4096),
      selected = month(String(form.get('month') ?? '')),
      chosen = options(form);
    const result = await uploadBatch(env, selected, chosen, url.origin + base);
    return redirect(
      withDone(result.finished ? 'driveDone' : 'driveMore', `/?${query(selected, chosen)}#send`, {
        n: result.total - result.remaining,
        of: result.total,
        wait: result.wait || null,
      }),
    );
  }
  if (request.method === 'GET' && path === '/receipts') return allReceiptsPage(env, url.searchParams, offset);
  if (request.method === 'POST' && path.startsWith('/senders/')) return senderAction(request, env, path, who, ctx);
  if (request.method === 'GET' && path === '/settings') return settingsPage(env, url.searchParams, url.origin + base);
  if (request.method === 'POST' && path === '/settings/setup')
    return redirect(await saveSetup(env, await formData(request, 64 * 1024), who));
  if (request.method === 'POST' && path === '/settings/setup/reset')
    return redirect(await resetSetting(env, await formData(request, 64 * 1024), who));
  if (request.method === 'GET' && path === '/settings/onedrive/connect') return connectStart(env, url.origin, base);
  if (request.method === 'GET' && path === '/settings/onedrive/callback')
    return connectCallback(env, request, url, base);
  if (request.method === 'POST' && path === '/settings/onedrive/disconnect') {
    oneDrive(env);
    await disconnect(env);
    return redirect(withDone('oneDriveDisconnected', '/settings#onedrive'));
  }
  if (request.method === 'POST' && path === '/settings/onedrive/folder') {
    const form = await formData(request, 8192);
    await chooseFolder(env, String(form.get('folder_link') ?? ''), String(form.get('folder_name') ?? ''));
    return redirect(withDone('oneDriveFolder', '/settings#onedrive'));
  }
  if (request.method === 'GET' && path === '/import') return importPage(env);
  if (request.method === 'GET' && path === '/add') {
    const response = await addPage(env, url.searchParams);
    response.headers.set('Content-Security-Policy', ADD_CSP);
    return response;
  }
  if (request.method === 'GET' && path === '/assets/add.js')
    return new Response(ADD_JS, {
      headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'private, max-age=300' },
    });
  if (request.method === 'GET' && path === '/invoices')
    return invoicesPage(env, month(url.searchParams.get('month')), url.searchParams);
  if (request.method === 'GET' && path === '/export-sales.csv')
    return exportSalesCsv(env, month(url.searchParams.get('month')), url.origin + base);
  if (request.method === 'GET' && path === '/favicon.svg')
    return new Response(FAVICON_SVG, {
      headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, max-age=86400' },
    });
  const font = path.match(/^\/assets\/fonts\/([a-z-]+\.woff2)$/);
  if (request.method === 'GET' && font?.[1] && FONT_FILES[font[1]])
    return new Response(fontBytes(font[1]), {
      headers: { 'Content-Type': 'font/woff2', 'Cache-Control': 'private, max-age=31536000, immutable' },
    });
  if (request.method === 'GET' && path === '/payments')
    return payments(env, month(url.searchParams.get('month')), offset, url.searchParams);
  if (request.method === 'POST' && path === '/imports/csv')
    return importPreview(env, await formData(request, MAX_CSV_BYTES + 64 * 1024));
  if (request.method === 'POST' && path === '/imports/csv/preview')
    return importPreview(env, await formData(request, Math.ceil((MAX_CSV_BYTES * 4) / 3) + 64 * 1024));
  if (request.method === 'POST' && path === '/imports/csv/confirm')
    return confirmImport(env, await formData(request, Math.ceil((MAX_CSV_BYTES * 4) / 3) + 64 * 1024));
  if (request.method === 'GET' && path === '/export.csv')
    return exportCsv(env, month(url.searchParams.get('month')), url.origin + base);
  if (request.method === 'POST' && path === '/accounts') {
    const form = await formData(request, 4096);
    await createAccount(env.DB, {
      label: String(form.get('label') ?? ''),
      bank_name: String(form.get('bank_name') ?? ''),
      default_currency: String(form.get('default_currency') ?? ''),
    });
    return redirect(withDone('accountCreated', '/settings#accounts'));
  }
  const account = path.match(/^\/accounts\/([^/]+)$/);
  if (request.method === 'POST' && account?.[1]) {
    const form = await formData(request, 4096);
    let accountId: string;
    try {
      accountId = decodeURIComponent(account[1]);
    } catch {
      throw new InputError('Invalid account ID');
    }
    await renameAccount(env.DB, accountId, String(form.get('label') ?? ''));
    return redirect(withDone('accountRenamed', '/settings#accounts', { name: String(form.get('label') ?? '').trim() }));
  }
  if (request.method === 'POST' && path === '/transfers') {
    const form = await formData(request, 4096);
    const debit = String(form.get('debit_id') ?? '');
    await confirmTransfer(env.DB, {
      debit_id: debit,
      credit_id: String(form.get('credit_id') ?? ''),
      reason: String(form.get('reason') ?? ''),
    });
    const { to, name } = await transferRow(env, debit);
    return redirect(withDone('transferMade', to, { tx: debit, name }));
  }
  const transfer = path.match(/^\/transfers\/([a-f0-9]{64})\/undo$/);
  if (request.method === 'POST' && transfer?.[1]) {
    await undoTransfer(env.DB, transfer[1]);
    await reconcile(env);
    const { to } = await transferRow(env, transfer[1]);
    return redirect(withDone('transferUndone', to));
  }
  const retry = path.match(/^\/receipts\/([a-f0-9]{64})\/retry$/);
  if (request.method === 'POST' && retry?.[1]) {
    await processReceipt(env, retry[1], { retry: true });
    return redirect(withDone('readAgain', `/receipts/${retry[1]}`));
  }
  const kind = path.match(/^\/receipts\/([a-f0-9]{64})\/kind$/);
  if (request.method === 'POST' && kind?.[1]) {
    const form = await formData(request, 64 * 1024);
    const to = String(form.get('kind') ?? '');
    await changeKind(env, kind[1], to, Number(form.get('revision')));
    return redirect(withDone('kindMoved', `/receipts/${kind[1]}`, { to }));
  }
  const paid = path.match(/^\/receipts\/([a-f0-9]{64})\/paid$/);
  if (request.method === 'POST' && paid?.[1]) {
    const before = await getReceipt(env, paid[1]);
    const form = await formData(request, 4096);
    await markPaidOutside(env, paid[1], form);
    const on = String(form.get('paid_outside_on') ?? '').trim();
    // Clearing the date is "Not paid". Undo of "paid" clears it again, so it is offered only
    // when nothing was recorded before.
    return redirect(
      on
        ? withDone('paid', `/receipts/${paid[1]}`, { on, id: before.paid_outside_on ? null : paid[1] })
        : withDone('notPaid', `/receipts/${paid[1]}`),
    );
  }
  const receipt = path.match(/^\/receipts\/([a-f0-9]{64})$/);
  if (request.method === 'GET' && receipt?.[1]) return receiptPage(env, await getReceipt(env, receipt[1]));
  if (request.method === 'POST' && receipt?.[1]) {
    const id = receipt[1];
    const form = await formData(request, 64 * 1024);
    const action = String(form.get('action') ?? '');
    const before = await getReceipt(env, id);
    const { next } = await queueAround(env, id);
    await correctReceipt(env, id, form);
    const after = await getReceipt(env, id);
    // Approve and Skip move on through the queue; the last one lands on Review.
    if (before.status === 'needs_review' && (action === 'approve' || action === 'skip')) {
      const event = action === 'approve' ? (next ? 'approved' : 'approvedLast') : 'skipped';
      return redirect(withDone(event, next ? `/receipts/${next}` : '/review'));
    }
    // Saving a ready receipt checks it again; new flags send it back to Review.
    if (before.status === 'ready' && after.status === 'needs_review')
      return redirect(withDone('movedBack', `/receipts/${id}`));
    return redirect(withDone('saved', `/receipts/${id}`));
  }
  const original = path.match(/^\/originals\/([a-f0-9]{64})$/);
  if (request.method === 'GET' && original?.[1]) {
    const row = await getReceipt(env, original[1]);
    const email = url.searchParams.get('variant') === 'email';
    // Inline view for the receipt page preview: raster images only, never PDF,
    // SVG or email, with its own locked-down CSP.
    const inline = url.searchParams.get('view') === 'inline';
    requireInput(!inline || (!email && previewable(row)), 'No preview for this file type', 404);
    const key = email ? row.email_key : row.original_key;
    requireInput(key, 'Source email not found', 404);
    const stored = await env.ORIGINALS.get(key);
    requireInput(stored, 'Original not found', 404);
    if (inline)
      return new Response(stored.body, {
        headers: {
          'Content-Type': row.media_type,
          'Content-Disposition': `inline; filename="${row.id}.${row.media_type.slice(6)}"`,
          'Content-Security-Policy': INLINE_CSP,
        },
      });
    return new Response(stored.body, {
      headers: {
        'Content-Type': email ? 'message/rfc822' : row.media_type,
        'Content-Disposition': `attachment; filename="${row.id}.${row.media_type === 'application/pdf' ? 'pdf' : 'bin'}"`,
      },
    });
  }
  const payment = path.match(/^\/payments\/([a-f0-9]{64})$/);
  if (request.method === 'POST' && payment?.[1]) {
    const form = await formData(request, 4096),
      required = form.get('receipt_required');
    requireInput(required === '0' || required === '1', 'Invalid exemption');
    const transaction = await env.DB.prepare(
      "SELECT t.* FROM bank_transactions t JOIN imports i ON i.id=t.import_id WHERE t.id=? AND i.status='complete'",
    )
      .bind(payment[1])
      .first<Transaction>();
    requireInput(transaction, 'Payment not found', 404);
    const changed = await env.DB.prepare(
      "UPDATE bank_transactions SET receipt_required=?,receipt_id=NULL,match_method=NULL,matched_at=NULL WHERE id=? AND NOT EXISTS (SELECT 1 FROM internal_transfers WHERE debit_id=bank_transactions.id OR credit_id=bank_transactions.id) AND EXISTS (SELECT 1 FROM imports WHERE id=bank_transactions.import_id AND status='complete')",
    )
      .bind(Number(required), transaction.id)
      .run();
    requireInput(
      changed.meta.changes === 1,
      'Payment changed or belongs to an own-account transfer. Undo the pair first.',
      409,
    );
    await reconcile(env);
    return redirect(
      withDone(
        required === '0' ? 'notPurchase' : 'needsReceipt',
        `/payments?month=${transaction.booking_date.slice(0, 7)}`,
        {
          tx: transaction.id,
          name: transaction.merchant,
        },
      ),
    );
  }
  if (request.method === 'POST' && path === '/matches') {
    const form = await formData(request, 4096),
      id = String(form.get('transaction_id'));
    const transaction = await env.DB.prepare(
      "SELECT t.* FROM bank_transactions t JOIN imports i ON i.id=t.import_id WHERE t.id=? AND i.status='complete'",
    )
      .bind(id)
      .first<Transaction>();
    requireInput(transaction, 'Payment not found', 404);
    const unlink = form.get('action') === 'unlink';
    // Remembered for the banner's Undo and its message.
    let matchedTo = transaction.receipt_id,
      exception = false;
    if (unlink) {
      // Matching it again needs the exception box only if the pair wasn't a normal fit.
      const was = matchedTo
        ? await env.DB.prepare('SELECT * FROM receipts WHERE id=?').bind(matchedTo).first<Receipt>()
        : null;
      if (was) {
        const rules = (await env.DB.prepare('SELECT * FROM vendor_rules').all<Rule>()).results;
        exception = !(transaction.amount_minor > 0
          ? creditFit(was, transaction, config(env).tuning) !== null
          : eligible(was, transaction, rules, false, config(env).tuning));
      }
      await env.DB.prepare('UPDATE bank_transactions SET receipt_id=NULL,match_method=NULL,matched_at=NULL WHERE id=?')
        .bind(id)
        .run();
    } else {
      // Money out pairs with a receipt, money in with a sales invoice.
      const credit = transaction.amount_minor > 0;
      requireInput(
        form.get('action') === 'link' &&
          !transaction.receipt_id &&
          transaction.amount_minor !== 0 &&
          transaction.receipt_required,
        'Payment cannot be linked',
      );
      const row = await getReceipt(env, String(form.get('receipt_id_manual') || form.get('receipt_id')));
      requireInput(
        !row.duplicate_of && !row.discarded_at && matchable(row),
        'Approve receipt before matching',
        422,
        'receipt_id',
      );
      requireInput(
        row.kind === (credit ? 'sales' : 'expense'),
        credit
          ? 'Money in can only be matched to an invoice you sent'
          : 'A payment out needs a receipt, not a sales invoice',
        422,
        'receipt_id',
      );
      const rules = (await env.DB.prepare('SELECT * FROM vendor_rules').all<Rule>()).results;
      requireInput(
        (credit
          ? creditFit(row, transaction, config(env).tuning) !== null
          : eligible(row, transaction, rules, false, config(env).tuning)) || form.get('confirm_exception') === 'yes',
        'Confirm match exceptions',
        422,
        'confirm_exception',
      );
      try {
        const result = await env.DB.prepare(
          `UPDATE bank_transactions SET receipt_id=?,match_method='manual',matched_at=? WHERE id=? AND receipt_id IS NULL AND receipt_required=1 AND ${credit ? 'amount_minor>0' : 'amount_minor<0'} AND EXISTS(SELECT 1 FROM imports WHERE id=bank_transactions.import_id AND status='complete') AND EXISTS(SELECT 1 FROM receipts WHERE id=? AND kind=? AND revision=? AND duplicate_of IS NULL AND discarded_at IS NULL AND (status='ready' OR (status='needs_review' AND review_reasons_json='["missing_eur"]')))`,
        )
          .bind(row.id, new Date().toISOString(), id, row.id, row.kind, row.revision)
          .run();
        requireInput(result.meta.changes === 1, 'Match changed. Reload.', 409);
        matchedTo = row.id;
      } catch (error) {
        if (error instanceof Error && error.message.includes('UNIQUE constraint'))
          throw new InputError('Receipt is already matched', 409);
        throw error;
      }
    }
    await clearBankReview(env);
    // The invoice page sends its own address back; nothing else is followed.
    const back = String(form.get('return_to') ?? '');
    const onReceipt = /^\/receipts\/[a-f0-9]{64}$/.test(back);
    return redirect(
      withDone(
        unlink ? 'unmatched' : 'matched',
        onReceipt ? back : `/payments?month=${transaction.booking_date.slice(0, 7)}`,
        {
          tx: transaction.id,
          rid: matchedTo,
          name: transaction.merchant,
          kind: transaction.amount_minor > 0 ? 'invoice' : 'receipt',
          back: onReceipt ? back : null,
          exc: unlink && exception ? 1 : null,
        },
      ),
    );
  }
  if (request.method === 'POST' && path === '/rules') {
    const form = await formData(request, 4096);
    const rule = ruleFrom(env, form);
    await saveRule(
      env.DB.prepare(
        'INSERT INTO vendor_rules (vendor_contains,context_contains,bank_alias,product,expense_type,priority) VALUES (?,?,?,?,?,?)',
      ).bind(...rule),
    );
    // A rule made from a receipt goes back to that receipt; otherwise to Settings.
    const back = String(form.get('return_to') ?? '');
    return redirect(withDone('ruleSaved', /^\/receipts\/[a-f0-9]{64}$/.test(back) ? back : '/settings#rules'));
  }
  const rule = path.match(/^\/rules\/(\d{1,15})(\/delete)?$/);
  if (request.method === 'POST' && rule?.[1]) {
    const id = Number(rule[1]);
    requireInput(
      await env.DB.prepare('SELECT 1 FROM vendor_rules WHERE id=?').bind(id).first(),
      'Vendor rule not found',
      404,
    );
    if (rule[2]) {
      await env.DB.prepare('DELETE FROM vendor_rules WHERE id=?').bind(id).run();
      return redirect(withDone('ruleDeleted', '/settings#rules'));
    }
    await saveRule(
      env.DB.prepare(
        'UPDATE vendor_rules SET vendor_contains=?,context_contains=?,bank_alias=?,product=?,expense_type=?,priority=? WHERE id=?',
      ).bind(...ruleFrom(env, await formData(request, 4096)), id),
    );
    return redirect(withDone('ruleSaved', '/settings#rules'));
  }
  throw new InputError('Not found', 404);
}
// Up to MAX_UPLOAD_FILES documents in one form post, each read on its own.
// The Add page's script sends one file per request and asks for JSON.
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
async function uploadFiles(request: Request, env: Env): Promise<Response> {
  const json = (request.headers.get('Accept') ?? '').includes('application/json');
  try {
    const form = await formData(request, Math.max(MAX_UPLOAD_BYTES, MAX_PDF_BYTES) + 64 * 1024);
    const files = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
    requireInput(files.length > 0, 'Choose a file');
    requireInput(files.length <= MAX_UPLOAD_FILES, `Add up to ${MAX_UPLOAD_FILES} files at a time`);
    const kind = form.get('kind') === 'sales' ? 'sales' : 'expense';
    const results: { name: string; id?: string; error?: string }[] = [];
    for (const file of files)
      try {
        const row = await upload(env, new Uint8Array(await file.arrayBuffer()), file.name, file.type, kind);
        results.push({ name: file.name, id: row.id });
      } catch (error) {
        // One bad file doesn't stop the rest; a single upload keeps the old errors.
        if (!(error instanceof InputError) || files.length === 1) throw error;
        results.push({ name: file.name, error: error.message });
      }
    if (json) return Response.json({ files: results });
    const added = results.filter((r) => r.id);
    if (results.length === 1 && added[0]) return redirect(withDone('uploaded', `/receipts/${added[0].id}`));
    return redirect(
      withDone('filesAdded', `/add?kind=${kind}`, { added: added.length, failed: results.length - added.length }),
    );
  } catch (error) {
    if (json && error instanceof InputError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
const fonts = new Map<string, Uint8Array>();
function fontBytes(name: string): Uint8Array {
  let bytes = fonts.get(name);
  if (!bytes) {
    bytes = Uint8Array.from(atob(FONT_FILES[name]!), (c) => c.charCodeAt(0));
    fonts.set(name, bytes);
  }
  return bytes;
}
// Non-HTML responses keep the original policy. App pages may also load the
// self-hosted fonts and inline receipt images from this origin.
const BASE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const HTML_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const INLINE_CSP =
  "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
// Where an error page's back link goes: the same-origin page that sent the
// request, without the base path (the rewriter adds it back), else home.
function backLink(request: Request, base: string): string {
  try {
    const referer = new URL(request.headers.get('Referer') ?? '');
    if (referer.origin !== new URL(request.url).origin) return '/';
    const path =
      base && (referer.pathname === base || referer.pathname.startsWith(base + '/'))
        ? referer.pathname.slice(base.length) || '/'
        : referer.pathname;
    return path.startsWith('/') && !path.startsWith('//') ? path + referer.search : '/';
  } catch {
    return '/';
  }
}
// A refused form on a page that can show it again: that page, status 422, what was
// typed kept, and the message at the control that caused it. Null for anything else,
// which gets the plain error page.
async function redisplay(inner: Request, env: Env, state: RequestState, error: unknown): Promise<Response | null> {
  const form = state.form;
  if (!(error instanceof InputError) || inner.method !== 'POST' || !form || ![409, 422].includes(error.status))
    return null;
  const url = new URL(inner.url),
    base = config(env).basePath;
  const values: Record<string, string> = {};
  for (const [key, value] of form) if (typeof value === 'string' && value.length <= 2000) values[key] = value;
  const refused = (scope: string, target?: string): RequestState => ({
    ...state,
    failure: {
      message: error.message,
      status: error.status,
      field: error.field,
      scope,
      target,
      values,
    } satisfies FormFailure,
  });
  try {
    let shown: Promise<Response> | null = null;
    const receipt = url.pathname.match(/^\/receipts\/([a-f0-9]{64})$/);
    if (receipt?.[1] && error.status === 422)
      shown = requestState.run(refused('receipt'), async () => receiptPage(env, await getReceipt(env, receipt[1]!)));
    else if (url.pathname === '/matches') {
      const tx = String(form.get('transaction_id') ?? '');
      const row = await env.DB.prepare('SELECT booking_date FROM bank_transactions WHERE id=?')
        .bind(tx)
        .first<{ booking_date: string }>();
      const scope = `match:${tx}`;
      const back = String(form.get('on_error') || form.get('return_to') || '');
      const onReceipt = /^\/receipts\/([a-f0-9]{64})$/.exec(back);
      if (row)
        shown = requestState.run(
          refused(scope, error.field === 'confirm_exception' ? `f-confirm-${tx}` : errorId(scope)),
          async () =>
            onReceipt
              ? receiptPage(env, await getReceipt(env, onReceipt[1]!))
              : payments(
                  env,
                  month(row.booking_date.slice(0, 7)),
                  0,
                  new URLSearchParams({ month: row.booking_date.slice(0, 7), show: 'all' }),
                ),
        );
    } else if (url.pathname === '/imports/csv' && form.get('file') instanceof File)
      shown = requestState.run(refused('import'), () => importPage(env));
    else if (url.pathname === '/settings/setup' && error.status === 422)
      shown = requestState.run(
        refused(`setup:${String(form.get('group') ?? '')}`, error.field === 'product_new' ? 'part-new' : undefined),
        () => settingsPage(env, new URLSearchParams(), url.origin + base),
      );
    if (!shown) return null;
    const response = await shown;
    return base ? rebase(response, base) : response;
  } catch {
    return null;
  }
}
async function failure(request: Request, env: Env, error: unknown): Promise<Response> {
  const status = error instanceof InputError ? error.status : 500;
  const message = error instanceof InputError ? error.message : 'Request failed. Saved documents can be retried.';
  // Configuration errors can't render the layout, so they stay plain text.
  if (error instanceof ConfigError) return new Response(message, { status });
  try {
    const base = config(env).basePath;
    const response = await errorPage(env, status, message, backLink(request, base));
    return base ? rebase(response, base) : response;
  } catch {
    return new Response(message, { status });
  }
}
// With APP_BASE_PATH (for example '/app') the app shares a hostname with other
// content: requests outside the base path get 404, the base path is stripped
// before routing, and root-relative links, form actions and redirects in the
// response are prefixed again. Empty (the default) leaves everything at '/'.
function stripBase(request: Request, base: string): Request | null {
  const url = new URL(request.url);
  if (url.pathname !== base && !url.pathname.startsWith(base + '/')) return null;
  url.pathname = url.pathname.slice(base.length) || '/';
  return new Request(url, request);
}
export function withBase(value: string, base: string): string {
  // /cdn-cgi/ paths (such as the Access logout) belong to Cloudflare at the host root.
  return base && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/cdn-cgi/')
    ? base + value
    : value;
}
function rebase(response: Response, base: string): Response {
  const location = response.headers.get('Location');
  if (location) response.headers.set('Location', withBase(location, base));
  if (!(response.headers.get('Content-Type') ?? '').startsWith('text/html')) return response;
  const attribute = (name: string) => ({
    element(element: Element) {
      const value = element.getAttribute(name);
      if (value !== null) element.setAttribute(name, withBase(value, base));
    },
  });
  return new HTMLRewriter()
    .on('a[href]', attribute('href'))
    .on('link[href]', attribute('href'))
    .on('form[action]', attribute('action'))
    .on('[formaction]', attribute('formaction'))
    .on('[src]', attribute('src'))
    .transform(response);
}
export default {
  // In-app settings are layered over env once per message and per request.
  async email(message: Parameters<typeof receiveEmail>[0], env: Env, ctx: ExecutionContext): Promise<void> {
    return receiveEmail(message, await withSettings(env), ctx);
  },
  // ctx is optional so tests can call fetch(request, env); work handed to
  // waitUntil then finishes before the response is returned.
  async fetch(request: Request, deploy: Env, ctx?: Waiter): Promise<Response> {
    let response: Response,
      inner: Request | null = null,
      state: RequestState | undefined;
    const env = await withSettings(deploy);
    const pending: Promise<unknown>[] = [];
    const signs = signer(env);
    const waiter: Waiter = ctx ?? { waitUntil: (promise) => void pending.push(promise) };
    try {
      const base = config(env).basePath;
      const stripped = base ? stripBase(request, base) : request;
      // A ?done= link that isn't genuine and fresh is dropped before any page sees it.
      const checked = stripped ? await signs.verify(new URL(stripped.url)) : null;
      inner = stripped && checked && checked.href !== stripped.url ? new Request(checked, stripped) : stripped;
      // The query reaches the page shell (the feedback banner) through the request's own store.
      const own = inner;
      if (own) state = { params: new URL(own.url).searchParams };
      response =
        own && state
          ? await requestState.run(state, () => route(own, env, base, waiter))
          : new Response('Not found', { status: 404 });
      const location = response.headers.get('Location');
      if (location?.includes('done=')) {
        const headers = new Headers(response.headers);
        headers.set('Location', await signedLocation(signs, location));
        response = new Response(null, { status: response.status, headers });
      }
      await Promise.allSettled(pending);
      if (base) response = rebase(new Response(response.body, response), base);
    } catch (error) {
      response =
        (inner && state && (await redisplay(inner, env, state, error))) || (await failure(request, env, error));
    }
    if (!response.headers.has('Cache-Control')) response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    if (!response.headers.has('Content-Security-Policy'))
      response.headers.set(
        'Content-Security-Policy',
        (response.headers.get('Content-Type') ?? '').startsWith('text/html') ? HTML_CSP : BASE_CSP,
      );
    response.headers.set('Referrer-Policy', 'same-origin');
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    response.headers.set('X-Frame-Options', 'DENY');
    return response;
  },
};
