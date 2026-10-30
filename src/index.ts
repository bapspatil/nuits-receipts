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
import { FAVICON_SVG, errorId, errorPage, exportCsv, exportSalesCsv, month, navCounts, SPECULATION_RULES } from './ui';
import { BULK_CAP, BULK_JS } from './bulk';
import { paymentsBulk, receiptsBulk, sendersBulk, type Caller } from './batch';
import { ADD_JS, addPage, invoicesPage, MAX_UPLOAD_FILES } from './invoices';
import {
  afterLastReview,
  home,
  importPage,
  payments,
  previewable,
  helpPage,
  NEW_ACCOUNT,
  receiptPage,
  settingsPage,
} from './views';
import { FONT_FILES } from './fonts';
import { isReady, needsReview } from './flags';
import { clearBankReview, matchable, reconcile, SET_REQUIRED_SQL, type Transaction } from './banking';
import { candidatesFor, fits, linkMatch, matchLikely, receiptName, resolvePick, unlinkMatches } from './match';
import { signer, type Signer } from './signing';
import { createAccount, renameAccount, confirmTransfer, undoTransfer } from './accounts';
import { importPreview, confirmImport } from './imports';
import { anywayPage, importAnyway, importOneStep } from './one-step';
import type { Rule } from './domain';
import { config, ConfigError, isProduct, MIN_PASSWORD_LENGTH, WEAK_PASSWORDS } from './config';
import { verifyAccessJwt } from './access';
import { cachedSettings, FIELD, freshSettings, withDatabase, withSettings, type SettingKey } from './settings';
import { approveSender, ignoreSender, removeApproved, senderAddress, unignoreSender } from './inbound';
import { allReceiptsPage, todoPage } from './all';
import { discardReceipts, receiptIds, restoreReceipts } from './discard';
import { parseUndo, undo, undoAt, withUndo, type UndoAt, type UndoOp } from './undo';
import { resetSetting, saveSetup, SETTINGS_JS } from './setup';
import { arrivalMonth } from './arrival';
import { markSent, options, packageZip, query, unmarkSent } from './package';
import { withDone, type EventKey } from './events';
import {
  cursorFor,
  cursorOf,
  landing,
  LIST_DEFS,
  listFrom,
  listState,
  listUrl,
  nextOpen,
  parseReturn,
  RECEIPTS_TODO,
  receiptState,
  receiptReturn,
  receiptUrl,
  type ListState,
} from './worklist';
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
// Allow, Ignore and the Settings > Email senders list. Each form says
// where to go back to: Settings, or the list the held mail is on (Receipts To do by default).
async function senderAction(request: Request, env: Env, path: string, who: string, ctx: Waiter): Promise<Response> {
  const form = await formData(request, 4096);
  const settings = ['settings', 'mail'].includes(String(form.get('back')));
  const address = form.get('address');
  let event: EventKey, n: number | undefined, at: UndoAt | undefined;
  if (path === '/senders/approve') [event, n] = ['mailAllowed', await approveSender(env, address, who, ctx)];
  else if (path === '/senders/ignore') [event, n] = ['mailIgnored', await ignoreSender(env, address, who)];
  else if (path === '/senders/remove') {
    at = undoAt();
    await removeApproved(env, address, who, at);
    event = 'senderRemoved';
  } else if (path === '/senders/unignore') {
    await unignoreSender(env, address);
    event = 'senderUnignored';
  } else return new Response('Not found', { status: 404 });
  // Allow this sender, from the mail log: the banner names them and offers Undo.
  if (path === '/senders/approve' && form.get('back') === 'mail')
    return redirect(withDone('senderAllowed', '/settings#mail', { sender: senderAddress(address), n }));
  const undone = at ? { at, op: 'settings' } : {};
  if (settings) return redirect(withDone(event, '/settings#senders', { n, from: 'settings', ...undone }));
  return redirect(withDone(event, parseReturn(form.get('back')) ?? listUrl(RECEIPTS_TODO), { n, ...undone }));
}
// Where each Undo lands: the receipt lists (or the receipt page it was taken on), Bank, or Settings.
const UNDO_PLACE: Record<UndoOp, 'receipts' | 'bank' | 'settings'> = {
  approve: 'receipts',
  discard: 'receipts',
  paid: 'receipts',
  exempt: 'bank',
  require: 'bank',
  match: 'bank',
  unmatch: 'bank',
  deleteRule: 'settings',
  settings: 'settings',
  import: 'bank',
};
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
// The Bank list a form came from, in the month of the row it acted on unless it names one.
function bankList(form: FormData, row: { booking_date: string }): ListState {
  return listState(form, { ...RECEIPTS_TODO, key: 'bank', month: row.booking_date.slice(0, 7) });
}
// The payment money left from, read before a transfer is made or undone: the list the form came
// from (the month it left in unless the form names one), who was paid, and where it stands in
// Bank's order. Making the pair moves on past it; undoing it lands on it, as it needs a receipt again.
async function transferFrom(env: Env, form: FormData, debitId: string, o: { at: boolean }) {
  const [row, cursor] = await Promise.all([
    env.DB.prepare('SELECT booking_date,merchant FROM bank_transactions WHERE id=?')
      .bind(debitId)
      .first<{ booking_date: string; merchant: string }>(),
    cursorOf(env, LIST_DEFS.bank!, [debitId], o),
  ]);
  // A payment that isn't there is refused by the write itself, with its own message.
  return { state: row && bankList(form, row), cursor, name: row?.merchant ?? '' };
}
type Waiter = Pick<ExecutionContext, 'waitUntil'>;
// Where this browser's last request left the database (see fetch).
const BOOKMARK = '__Host-d1';
const BOOKMARK_SHAPE = /^[0-9a-f-]{1,200}$/i;
function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}
// Pages that always render the tab bar, so their counts can start early.
const RECEIPT_PAGE = /^\/receipts\/[a-f0-9]{64}$/;
const TAB_PAGES = new Set(['/', '/add', '/help', '/import', '/payments', '/receipts', '/settings']);
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
  // Start the tab counts now, so they load alongside the page's own queries. A receipt page shows
  // the tabs too; its counts join the getReceipt wave, which stays first because the page's own
  // queries need the receipt's facts (kind, vendor, amount, status).
  if (request.method === 'GET' && (TAB_PAGES.has(path) || RECEIPT_PAGE.test(path))) void navCounts(env);
  if (!['GET', 'HEAD'].includes(request.method)) {
    requireInput(request.method === 'POST', 'Method not allowed', 405);
    requireInput(request.headers.get('Origin') === url.origin, 'Origin does not match', 403);
  }
  if (request.method === 'POST' && path === '/upload') return uploadFiles(request, env);
  if (request.method === 'GET' && path === '/')
    return home(env, url.searchParams.has('month') ? month(url.searchParams.get('month')) : null, url.searchParams);
  // Old addresses: the month close is Home now, and the phone's More menu is gone.
  const read = request.method === 'GET' || request.method === 'HEAD';
  if (read && path === '/month') return moved('/', url.search);
  if (read && path === '/more') return moved('/settings');
  // Review is Receipts To do now, and Invoices is the Invoices tab of Receipts All.
  if (read && (path === '/review' || path === '/review/merge'))
    return moved(listUrl(listState(url.searchParams, { ...RECEIPTS_TODO, view: 'todo' })));
  if (read && path === '/invoices')
    return moved(listUrl(listState(url.searchParams, { ...RECEIPTS_TODO, key: 'invoices', view: 'all' })));
  if (request.method === 'GET' && path === '/receipts') {
    const params = url.searchParams;
    // An old Receipts link with a filter or a search, from before To do, still opens All.
    const all = params.get('view') === 'all' || (!params.has('view') && (params.has('show') || params.has('q')));
    if (!all) return todoPage(env, listState(params, { ...RECEIPTS_TODO, view: 'todo' }));
    if (params.get('kind') === 'sales') return invoicesPage(env, month(params.get('month')), params);
    return allReceiptsPage(env, params);
  }
  if (request.method === 'POST' && path === '/discard') {
    const form = await formData(request, 16 * 1024);
    const ids = receiptIds(form.getAll('id'));
    const revision = form.get('revision');
    // From a receipt page opened from To do (it posts from): move on like Approve. Otherwise back
    // to the list it came from.
    const page = form.has('from') && ids.length === 1;
    const state = page ? receiptState(form, true) : listState(form, RECEIPTS_TODO);
    const cursor = await cursorFor(env, state, ids);
    const { at } = await discardReceipts(env, ids, { revision: revision === null ? null : Number(revision) });
    const done = { event: 'discarded', params: { n: ids.length, at, op: 'discard' } } as const;
    const next =
      page && state.view === 'todo' ? await nextOpen(env, LIST_DEFS.receipts!, state, cursor, { wrap: true }) : null;
    return redirect(
      next ? withDone(done.event, receiptUrl(next, state), done.params) : await landing(env, state, cursor, done),
    );
  }
  if (request.method === 'POST' && path === '/restore') {
    const form = await formData(request, 16 * 1024);
    // Back to the receipt page it was restored on, or to the list it was discarded from, landing on
    // what it brought back.
    const back = parseReturn(form.get('back'));
    const state = (back ? listFrom(back) : null) ?? RECEIPTS_TODO;
    const ids = receiptIds(form.getAll('id'));
    const cursor = await cursorFor(env, state, ids, { at: true });
    const n = await restoreReceipts(env, ids);
    if (n) await reconcile(env);
    if (back?.startsWith('/receipts/'))
      return redirect(withDone('restored', receiptReturn(back.slice('/receipts/'.length), form), { n }));
    return redirect(await landing(env, state, cursor, { event: 'restored', params: { n } }));
  }
  // The banner's Undo of any action in the undo log. It lands where the action was taken: the
  // receipt page (for the receipt it brought back) or the list, at the first row it brought back.
  if (request.method === 'POST' && path === '/undo') {
    const form = await formData(request, 4096);
    const { at, op } = parseUndo(form.get('at'), form.get('op'));
    const { ids, refused } = await undo(env, at, op, who);
    const done = { event: 'undone', params: { op, n: ids.length, ...(refused ? { changed: refused } : {}) } } as const;
    if (op === 'import') return redirect(withDone(done.event, '/payments', done.params));
    const place = UNDO_PLACE[op];
    if (place === 'settings') {
      const section = String(form.get('section') ?? '');
      const anchor = /^[a-z][a-z-]{0,39}$/.test(section) ? section : 'senders';
      return redirect(withDone(done.event, `/settings#${anchor}`, { ...done.params, section: anchor }));
    }
    // On a receipt page: the receipt it brought back, or the page a match was made or removed on.
    const page = /^\/receipts\/([a-f0-9]{64})$/.exec(String(form.get('back') ?? ''))?.[1];
    const opened = place === 'receipts' ? (form.has('from') ? (ids[0] ?? page) : null) : page;
    if (opened || (place === 'receipts' && form.has('from'))) {
      const state = receiptState(form, true);
      return redirect(opened ? withDone(done.event, receiptUrl(opened, state), done.params) : listUrl(state, { done }));
    }
    const state =
      place === 'bank'
        ? listState(form, { ...RECEIPTS_TODO, key: 'bank' })
        : form.get('kind') === 'sales'
          ? listState(form, { ...RECEIPTS_TODO, key: 'invoices', view: 'all' })
          : listState(form, RECEIPTS_TODO);
    // Read after the restore, as it lands on the row brought back, wherever that now stands.
    const cursor = await cursorFor(env, state, ids, { at: true });
    return redirect(await landing(env, state, cursor, done));
  }
  // The old Review form still merges, so a page left open does not post into a redirect.
  if (request.method === 'POST' && (path === '/receipts/merge' || path === '/review/merge')) {
    // Back to the To do it was offered on, under its month; the merged rows leave it, so no anchor.
    const state = listState(await formData(request, 4096), RECEIPTS_TODO);
    return redirect(listUrl(state, { done: { event: 'merged', params: { n: await mergeDuplicates(env) } } }));
  }
  if (request.method === 'GET' && path === '/month/package.zip')
    return packageZip(env, month(url.searchParams.get('month')), options(url.searchParams), url.origin + base);
  if (request.method === 'POST' && path === '/month/sent') {
    const form = await formData(request, 4096),
      selected = month(String(form.get('month') ?? ''));
    const at = await markSent(env, selected, String(form.get('receipts_hash') ?? ''), 'download');
    return redirect(withDone('sent', `/?month=${selected}#send`, { at }));
  }
  if (request.method === 'POST' && path === '/month/sent/undo') {
    const form = await formData(request, 4096),
      selected = month(String(form.get('month') ?? ''));
    await unmarkSent(env, selected, String(form.get('at') ?? ''));
    return redirect(withDone('sentUndone', `/?month=${selected}#send`));
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
  const bulk = request.method === 'POST' ? BULK_ROUTES[path] : undefined;
  if (bulk) return bulkAction(request, env, bulk, { who, ctx });
  if (request.method === 'POST' && path.startsWith('/senders/')) return senderAction(request, env, path, who, ctx);
  if (request.method === 'GET' && path === '/help') return helpPage(env);
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
  if (request.method === 'GET' && path === '/add') return addPage(env, url.searchParams);
  if (request.method === 'GET' && path === '/assets/speculation-rules.json')
    return new Response(SPECULATION_RULES, {
      headers: { 'Content-Type': 'application/speculationrules+json', 'Cache-Control': 'private, max-age=300' },
    });
  if (request.method === 'GET' && path === '/assets/add.js')
    return new Response(ADD_JS, {
      headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'private, max-age=300' },
    });
  if (request.method === 'GET' && path === '/assets/bulk.js')
    return new Response(BULK_JS, {
      headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'private, max-age=300' },
    });
  if (request.method === 'GET' && path === '/assets/settings.js')
    return new Response(SETTINGS_JS, {
      headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'private, max-age=300' },
    });
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
    return payments(
      env,
      url.searchParams.has('month') ? month(url.searchParams.get('month')) : arrivalMonth(env).then((a) => a.month),
      url.searchParams,
    );
  if (request.method === 'POST' && path === '/import')
    return importOneStep(env, await formData(request, Math.ceil((MAX_CSV_BYTES * 4) / 3) + 64 * 1024));
  if (request.method === 'GET' && path === '/import/anyway') return anywayPage(env, url.searchParams);
  if (request.method === 'POST' && path === '/import/anyway') return importAnyway(env, await formData(request, 4096));
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
    const from = await transferFrom(env, form, debit, { at: false });
    await confirmTransfer(env.DB, {
      debit_id: debit,
      credit_id: String(form.get('credit_id') ?? ''),
      reason: String(form.get('reason') ?? ''),
    });
    requireInput(from.state, 'Payment not found', 404);
    return redirect(
      await landing(env, from.state, from.cursor, { event: 'transferMade', params: { tx: debit, name: from.name } }),
    );
  }
  const transfer = path.match(/^\/transfers\/([a-f0-9]{64})\/undo$/);
  if (request.method === 'POST' && transfer?.[1]) {
    const form = await formData(request, 4096);
    const from = await transferFrom(env, form, transfer[1], { at: true });
    await undoTransfer(env.DB, transfer[1]);
    await reconcile(env);
    requireInput(from.state, 'Payment not found', 404);
    return redirect(await landing(env, from.state, from.cursor, { event: 'transferUndone' }));
  }
  const retry = path.match(/^\/receipts\/([a-f0-9]{64})\/retry$/);
  if (request.method === 'POST' && retry?.[1]) {
    // Read again also posts from inside the fields form, so it may carry all of them.
    const form = await formData(request, 64 * 1024);
    await processReceipt(env, retry[1], { retry: true });
    return redirect(withDone('readAgain', receiptReturn(retry[1], form)));
  }
  const kind = path.match(/^\/receipts\/([a-f0-9]{64})\/kind$/);
  if (request.method === 'POST' && kind?.[1]) {
    const form = await formData(request, 64 * 1024);
    const to = String(form.get('kind') ?? '');
    await changeKind(env, kind[1], to, Number(form.get('revision')));
    return redirect(withDone('kindMoved', receiptReturn(kind[1], form), { to }));
  }
  const paid = path.match(/^\/receipts\/([a-f0-9]{64})\/paid$/);
  if (request.method === 'POST' && paid?.[1]) {
    const form = await formData(request, 4096);
    // From To do (the row posts its list): the invoice leaves the list, which moves on from its place.
    const list = form.has('view') ? listState(form, RECEIPTS_TODO) : null;
    const cursor = list ? await cursorFor(env, list, [paid[1]]) : null;
    const at = await markPaidOutside(env, paid[1], form);
    const on = String(form.get('paid_outside_on') ?? '').trim();
    const undone = { at, op: 'paid' };
    if (on && list) return redirect(await landing(env, list, cursor, { event: 'paid', params: { on, ...undone } }));
    // Clearing the date is "Not paid".
    return redirect(
      on
        ? withDone('paid', receiptReturn(paid[1], form), { on, ...undone })
        : withDone('notPaid', receiptReturn(paid[1], form), undone),
    );
  }
  const receipt = path.match(/^\/receipts\/([a-f0-9]{64})$/);
  if (request.method === 'GET' && receipt?.[1])
    return receiptPage(env, await getReceipt(env, receipt[1]), url.searchParams);
  if (request.method === 'POST' && receipt?.[1]) {
    const id = receipt[1];
    const form = await formData(request, 64 * 1024);
    const action = String(form.get('action') ?? '');
    // Where it stood in To do before the save, which may give it a date and move it.
    const [before, cursor] = await Promise.all([getReceipt(env, id), cursorOf(env, LIST_DEFS.receipts!, [id])]);
    const state = receiptState(form, needsReview(before));
    const at = await correctReceipt(env, id, form);
    // Approve and Skip move on through To do under the page's filter, from where it stood: Approve
    // wraps to the first open one, Skip doesn't. With none left they land on the list.
    const moving = needsReview(before) && (action === 'approve' || action === 'skip');
    const [after, next] = await Promise.all([
      getReceipt(env, id),
      moving
        ? nextOpen(env, LIST_DEFS.receipts!, { ...state, view: 'todo' }, cursor, { wrap: action === 'approve' })
        : null,
    ]);
    if (moving) {
      const event = action === 'approve' ? 'approved' : 'skipped';
      const undone = at ? { at, op: 'approve', name: receiptName(after) } : {};
      if (next) return redirect(withDone(event, receiptUrl(next, state), undone));
      if (action === 'skip') return redirect(await landing(env, state, cursor, { event }));
      const last = await afterLastReview(env, state.month ?? after.issue_date);
      return redirect(listUrl(state, { done: { event: 'approvedLast', params: { ...last, ...undone } } }));
    }
    // Saving a ready receipt checks it again; new flags send it back to To do.
    if (isReady(before) && needsReview(after)) return redirect(withDone('movedBack', receiptUrl(id, state)));
    return redirect(withDone('saved', receiptUrl(id, state)));
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
    const [transaction, cursor] = await Promise.all([
      env.DB.prepare(
        "SELECT t.* FROM bank_transactions t JOIN imports i ON i.id=t.import_id WHERE t.id=? AND i.status='complete'",
      )
        .bind(payment[1])
        .first<Transaction>(),
      cursorOf(env, LIST_DEFS.bank!, [payment[1]]),
    ]);
    requireInput(transaction, 'Payment not found', 404);
    const op = required === '0' ? 'exempt' : 'require',
      at = undoAt();
    const [changed] = await withUndo(env, { at, op, ids: [transaction.id] }, [
      env.DB.prepare(`${SET_REQUIRED_SQL} AND id=?`).bind(Number(required), transaction.id),
    ]);
    requireInput(
      changed?.meta.changes === 1,
      'Payment changed or belongs to an own-account transfer. Undo the pair first.',
      409,
    );
    await reconcile(env);
    return redirect(
      await landing(env, bankList(form, transaction), cursor, {
        event: required === '0' ? 'notPurchase' : 'needsReceipt',
        params: { name: transaction.merchant, at, op },
      }),
    );
  }
  if (request.method === 'POST' && path === '/matches') {
    const form = await formData(request, 4096),
      id = String(form.get('transaction_id'));
    // A receipt or invoice page sends its own address back; nothing else is followed.
    const page = /^\/receipts\/([a-f0-9]{64})$/.exec(String(form.get('return_to') ?? ''))?.[1];
    // Where the payment, or the page's receipt, stood before the write.
    const [transaction, cursor, opened] = await Promise.all([
      env.DB.prepare(
        "SELECT t.* FROM bank_transactions t JOIN imports i ON i.id=t.import_id WHERE t.id=? AND i.status='complete'",
      )
        .bind(id)
        .first<Transaction>(),
      page ? null : cursorOf(env, LIST_DEFS.bank!, [id]),
      page ? Promise.all([getReceipt(env, page), cursorOf(env, LIST_DEFS.receipts!, [page])]) : null,
    ]);
    requireInput(transaction, 'Payment not found', 404);
    const unlink = form.get('action') === 'unlink',
      at = undoAt();
    if (unlink) await unlinkMatches(env, [id], at);
    else {
      // Money out pairs with a receipt, money in with a sales invoice.
      const credit = transaction.amount_minor > 0;
      requireInput(
        form.get('action') === 'link' &&
          !transaction.receipt_id &&
          transaction.amount_minor !== 0 &&
          transaction.receipt_required,
        'Payment cannot be linked',
      );
      // An id from a button, or the label the person picked or typed in the search box.
      const raw = String(form.get('receipt_id') ?? '').trim();
      const row = await getReceipt(
        env,
        /^[a-f0-9]{64}$/.test(raw)
          ? raw
          : resolvePick(raw, await candidatesFor(env, transaction), transaction.booking_date.slice(0, 4)),
      );
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
        fits(row, transaction, rules, config(env).tuning) || form.get('confirm_exception') === 'yes',
        'Confirm match exceptions',
        422,
        'confirm_exception',
      );
      try {
        requireInput(await linkMatch(env, transaction, row, at), 'Match changed. Reload.', 409);
        await env.DB.prepare('DELETE FROM match_rejections WHERE transaction_id=? AND receipt_id=?')
          .bind(transaction.id, row.id)
          .run();
      } catch (error) {
        if (error instanceof Error && error.message.includes('UNIQUE constraint'))
          throw new InputError('Receipt is already matched', 409);
        throw error;
      }
    }
    await clearBankReview(env);
    const done = {
      event: unlink ? 'unmatched' : 'matched',
      params: {
        name: transaction.merchant,
        kind: transaction.amount_minor > 0 ? 'invoice' : 'receipt',
        at,
        op: unlink ? 'unmatch' : 'match',
        back: page ? `/receipts/${page}` : null,
      },
    } as const;
    if (!opened) return redirect(await landing(env, bankList(form, transaction), cursor, done));
    // From a receipt page, the same rule as Approve: a match that settles a receipt waiting in To do
    // moves on to the next open one (or the list when none is left); otherwise back to the page.
    const [pageBefore, pageCursor] = opened;
    const state = receiptState(form, needsReview(pageBefore));
    if (needsReview(pageBefore)) {
      const [after, next] = await Promise.all([
        getReceipt(env, pageBefore.id),
        nextOpen(env, LIST_DEFS.receipts!, { ...state, view: 'todo' }, pageCursor, { wrap: true }),
      ]);
      if (!needsReview(after))
        return redirect(next ? withDone(done.event, receiptUrl(next, state), done.params) : listUrl(state, { done }));
    }
    return redirect(withDone(done.event, receiptReturn(pageBefore.id, form), done.params));
  }
  // Match all likely: each pair is checked again here and skipped if it changed or is no longer an exact fit.
  if (request.method === 'POST' && path === '/matches/bulk') {
    const form = await formData(request, 32768);
    const payments = form.getAll('transaction_id').map(String),
      receipts = form.getAll('receipt_id').map(String);
    requireInput(payments.length > 0 && payments.length === receipts.length, 'Nothing to match');
    const selected = month(String(form.get('month') ?? '') || null),
      at = undoAt();
    const [rules, cursor] = await Promise.all([
      env.DB.prepare('SELECT * FROM vendor_rules')
        .all<Rule>()
        .then((r) => r.results),
      cursorOf(env, LIST_DEFS.bank!, payments),
    ]);
    const { matched, skipped } = await matchLikely(
      env,
      payments.map((id, i) => [id, receipts[i]!] as const),
      rules,
      config(env).tuning,
      at,
    );
    await clearBankReview(env);
    return redirect(
      await landing(env, bankList(form, { booking_date: selected }), cursor, {
        event: 'matchedMany',
        params: { n: matched, skipped, at, op: 'match' },
      }),
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
    const page = /^\/receipts\/([a-f0-9]{64})$/.exec(String(form.get('return_to') ?? ''))?.[1];
    return redirect(withDone('ruleSaved', page ? receiptReturn(page, form) : '/settings#rules'));
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
      const at = undoAt();
      await withUndo(env, { at, op: 'deleteRule', ids: [id] }, [
        env.DB.prepare('DELETE FROM vendor_rules WHERE id=?').bind(id),
      ]);
      return redirect(withDone('ruleDeleted', '/settings#rules', { at, op: 'deleteRule' }));
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
const BULK_ROUTES: Record<string, typeof receiptsBulk | undefined> = {
  '/receipts/bulk': receiptsBulk,
  '/payments/bulk': paymentsBulk,
  '/senders/bulk': sendersBulk,
};
// The bulk bar's script asks for JSON: the signed banner link to go to, or the refusal.
async function bulkAction(request: Request, env: Env, run: typeof receiptsBulk, caller: Caller): Promise<Response> {
  const json = (request.headers.get('Accept') ?? '').includes('application/json');
  try {
    // Room for BULK_CAP ids as multipart parts, plus the fields.
    const result = await run(env, await formData(request, BULK_CAP * 256), caller);
    if (!json) return redirect(result.location);
    const location = withBase(await signedLocation(signer(env), result.location), config(env).basePath);
    return Response.json({ location, n: result.n, skipped: result.skipped });
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
// self-hosted fonts, inline receipt images and their scripts from this origin.
// Scripts are files, never inline.
const BASE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const HTML_CSP =
  "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
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
      shown = requestState.run(refused('receipt'), async () =>
        receiptPage(env, await getReceipt(env, receipt[1]!), form),
      );
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
              ? receiptPage(env, await getReceipt(env, onReceipt[1]!), form)
              : payments(
                  env,
                  month(row.booking_date.slice(0, 7)),
                  new URLSearchParams({ month: row.booking_date.slice(0, 7), view: 'all' }),
                ),
        );
    } else if (['/imports/csv', '/import'].includes(url.pathname) && form.get('file') instanceof File)
      shown = requestState.run(refused('import'), () => importPage(env));
    else if (url.pathname === '/settings/setup' && error.status === 422)
      shown = requestState.run(
        refused(`setup:${String(form.get('group') ?? '')}`, error.field === 'product_new' ? 'part-new' : undefined),
        () => settingsPage(env, new URLSearchParams(), url.origin + base),
      );
    else if (url.pathname === '/accounts')
      shown = requestState.run(refused(NEW_ACCOUNT, 'f-label'), () =>
        settingsPage(env, new URLSearchParams(), url.origin + base),
      );
    else if (url.pathname === '/settings/setup/reset') {
      const group = FIELD.get(String(form.get('reset') ?? '') as SettingKey)?.group;
      if (group)
        shown = requestState.run(refused(`setup:${group}`), () =>
          settingsPage(env, new URLSearchParams(), url.origin + base),
        );
    }
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
// One request with its settings in place, before the shared headers.
async function serve(request: Request, env: Env, ctx?: Waiter): Promise<Response> {
  let response: Response,
    inner: Request | null = null,
    state: RequestState | undefined;
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
    response = (inner && state && (await redisplay(inner, env, state, error))) || (await failure(request, env, error));
  }
  return response;
}

export default {
  // In-app settings are layered over env once per message and per request.
  async email(message: Parameters<typeof receiveEmail>[0], env: Env, ctx: ExecutionContext): Promise<void> {
    return receiveEmail(message, await withSettings(env), ctx);
  },
  // ctx is optional so tests can call fetch(request, env); work handed to
  // waitUntil then finishes before the response is returned.
  async fetch(request: Request, deploy: Env, ctx?: Waiter): Promise<Response> {
    // A read starts on the settings this isolate read last while they are read
    // again alongside; if they changed, the read is served again with the new
    // ones. Writes, and the OneDrive steps (which are not plain reads), always
    // wait for the fresh read.
    const read = request.method === 'GET' || request.method === 'HEAD';
    // D1 read replication: a read may start on the nearest replica, a write
    // starts on the primary, and the bookmark cookie carries on from the last
    // response so a page always shows what the request before it saved. With
    // replication off, every query goes to the primary as before.
    const bookmark = cookie(request, BOOKMARK);
    const session = deploy.DB.withSession(
      bookmark && BOOKMARK_SHAPE.test(bookmark) ? bookmark : read ? 'first-unconstrained' : 'first-primary',
    );
    const own = withDatabase(deploy, session as unknown as D1Database);
    const quick = read && !new URL(request.url).pathname.includes('/onedrive/') ? cachedSettings(own) : null;
    const fresh = quick ? freshSettings(own) : null;
    let response = await serve(request, quick?.env ?? (await withSettings(own)), ctx);
    const current = await fresh;
    // The first response is dropped unread; a stream that is never read never runs.
    if (quick && current && current.signature !== quick.signature) response = await serve(request, current.env, ctx);
    const mark = session.getBookmark();
    if (mark && mark !== bookmark)
      response.headers.append('Set-Cookie', `${BOOKMARK}=${mark}; Path=/; Secure; HttpOnly; SameSite=Lax`);
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
