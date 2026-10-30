// Sales invoices you sent: the Invoices list, payment status, the receipt
// page's money-in matching, and the Add page (several files, either kind).
import { DEFAULT_TUNING, money, type Receipt } from './domain';
import { creditFit, monthEurValues, type Transaction } from './banking';
import type { Env } from './env';
import { config } from './config';
import { flagFor, isReady, needsReview, needsReviewSql, reasonCodes } from './flags';
import { bulkBar, bulkCheck, bulkTools, RECEIPT_ACTIONS, type BulkList } from './bulk';
import { listParams, listUrl, RECEIPTS_TODO, receiptUrl, type ListState } from './worklist';
import { receiptsSwitch } from './all';
import {
  amount,
  day,
  emptyState,
  EXPORT_LINE,
  escape,
  input,
  chipRow,
  monthHead,
  monthName,
  tabCounts,
  addButton,
  page,
  pageHead,
  plural,
  receiptsTabs,
  shortDay,
  matchError,
  errorLine,
  ariaFor,
} from './ui';
import { button, buttonLink, statusMark } from './actions';
import { row, rowList } from './row';

export type SalesRow = Receipt & { paid_bank_on: string | null };
export type SalesStatus = 'reading' | 'review' | 'paid' | 'overdue' | 'unpaid';
const PAID_BANK =
  "(SELECT t.booking_date FROM bank_transactions t JOIN imports i ON i.id=t.import_id WHERE t.receipt_id=r.id AND i.status='complete' LIMIT 1) AS paid_bank_on";

export function iso(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
// The due date on the invoice, else the payment terms (30 days unless
// changed in Settings) after it was issued.
export function dueOn(
  r: Pick<Receipt, 'issue_date' | 'due_date'>,
  terms = DEFAULT_TUNING.paymentTermsDays,
): string | null {
  if (r.due_date) return r.due_date;
  if (!r.issue_date || Number.isNaN(Date.parse(r.issue_date))) return null;
  return iso(new Date(Date.parse(r.issue_date) + terms * 86400000));
}
export function paidOn(r: SalesRow): string | null {
  return r.paid_bank_on ?? r.paid_outside_on;
}
// Review blocks "month ready"; unpaid does not (it is shown, not required).
export function salesStatus(r: SalesRow, terms = DEFAULT_TUNING.paymentTermsDays, now = iso()): SalesStatus {
  if (r.status === 'pending' || r.status === 'processing') return 'reading';
  if (needsReview(r) && r.review_reasons_json !== '["missing_eur"]') return 'review';
  if (paidOn(r)) return 'paid';
  const due = dueOn(r, terms);
  return due && due < now ? 'overdue' : 'unpaid';
}
export function salesStamp(r: SalesRow, terms = DEFAULT_TUNING.paymentTermsDays): string {
  switch (salesStatus(r, terms)) {
    case 'reading':
      return statusMark('reading');
    case 'review':
      return statusMark('needs');
    case 'paid':
      return statusMark('paid');
    case 'overdue':
      return statusMark('overdue');
    default:
      return statusMark('unpaid');
  }
}
export function invoiceName(r: Pick<Receipt, 'client' | 'invoice_number'>): string {
  return r.client ? `Invoice to ${r.client}` : r.invoice_number ? `Invoice ${r.invoice_number}` : 'Sales invoice';
}

export async function salesRows(env: Env, where: string, ...binds: unknown[]): Promise<SalesRow[]> {
  return (
    await env.DB.prepare(
      `SELECT r.*,${PAID_BANK} FROM receipts r WHERE r.kind='sales' AND r.duplicate_of IS NULL AND r.discarded_at IS NULL AND ${where} ORDER BY r.issue_date,r.invoice_number,r.id LIMIT 500`,
    )
      .bind(...binds)
      .all<SalesRow>()
  ).results;
}
// Open invoices past their due date, across all months.
export async function overdueInvoices(env: Env): Promise<SalesRow[]> {
  const open = await salesRows(env, `NOT ${needsReviewSql('r')} AND r.paid_outside_on IS NULL`);
  return open.filter((r) => salesStatus(r, config(env).tuning.paymentTermsDays) === 'overdue');
}

export type Show = 'all' | 'review' | 'unpaid' | 'overdue' | 'paid';
const SHOWS: Record<Show, string> = {
  all: 'All',
  review: 'Check',
  unpaid: 'Unpaid',
  overdue: 'Overdue',
  paid: 'Paid',
};
export const invoiceShow = (value: unknown): Show => (Object.keys(SHOWS) as Show[]).find((k) => k === value) ?? 'all';
// The month's invoices and the ones the Show chip picks, shared by the page and its bulk actions.
export async function invoiceRows(env: Env, selected: string, show: Show) {
  // Unpaid and overdue span every month: an old invoice is still owed.
  const across = show === 'unpaid' || show === 'overdue';
  const [month, open] = await Promise.all([
    salesRows(env, 'substr(r.issue_date,1,7)=?', selected),
    across ? salesRows(env, 'r.issue_date IS NOT NULL') : null,
  ]);
  return { across, month, open: open ?? month, ...chosen(env, show, across, month, open ?? month) };
}
function chosen(env: Env, show: Show, across: boolean, month: SalesRow[], open: SalesRow[]) {
  const base = across ? open : month;
  const shown =
    show === 'all' ? base : base.filter((r) => salesStatus(r, config(env).tuning.paymentTermsDays) === show);
  return { base, shown };
}
export async function invoicesPage(env: Env, selected: string, params: URLSearchParams): Promise<Response> {
  const settings = config(env);
  const show = invoiceShow(params.get('show'));
  const across = show === 'unpaid' || show === 'overdue';
  // One round: every query the page needs starts together, so it waits on D1 once.
  const [month, acrossRows, undated, overdueAll, switcher, tabs, eurOf] = await Promise.all([
    salesRows(env, 'substr(r.issue_date,1,7)=?', selected),
    across ? salesRows(env, 'r.issue_date IS NOT NULL') : null,
    salesRows(env, 'r.issue_date IS NULL'),
    across ? [] : overdueInvoices(env),
    receiptsSwitch(env, selected, 'all'),
    tabCounts(env, selected),
    monthEurValues(env, selected),
  ]);
  const open = acrossRows ?? month;
  const { base, shown } = chosen(env, show, across, month, open);
  let invoiced = 0n,
    received = 0n,
    noEur = 0;
  const eurs = eurOf(month);
  for (const [i, r] of month.entries()) {
    const eur = eurs[i]!;
    if (eur.minor === null) {
      noEur++;
      continue;
    }
    invoiced += BigInt(eur.minor);
    if (salesStatus(r, config(env).tuning.paymentTermsDays) === 'paid') received += BigInt(eur.minor);
  }
  // Invoices is the Invoices tab of Receipts All.
  const here: ListState = {
    ...RECEIPTS_TODO,
    key: 'invoices',
    view: 'all',
    month: selected,
    show: show === 'all' ? null : show,
  };
  const count = (k: Show) =>
    k === 'all'
      ? base.length
      : (k === 'unpaid' || k === 'overdue' ? open : month).filter(
          (r) => salesStatus(r, config(env).tuning.paymentTermsDays) === k,
        ).length;
  const chips = chipRow(
    'Show',
    (Object.keys(SHOWS) as Show[]).map((k) => ({
      href: escape(listUrl({ ...here, show: k === 'all' ? null : k })),
      label: SHOWS[k],
      count: count(k),
      current: k === show,
    })),
  );
  // One row per invoice: client (or number), total, then status and the date that matters.
  const status = (r: SalesRow) => {
    const due = dueOn(r);
    const paid = paidOn(r);
    switch (salesStatus(r, config(env).tuning.paymentTermsDays)) {
      case 'reading':
        return statusMark('reading');
      case 'review':
        return statusMark('needs', { title: firstFlag(r) });
      case 'paid':
        return statusMark('paid', { after: escape(shortDay(paid!)) });
      case 'overdue':
        return statusMark('overdue', { after: escape(shortDay(due!)) });
      default:
        return due ? `Due ${escape(shortDay(due))}` : 'No date';
    }
  };
  const bulk: BulkList = {
    form: 'bulk-invoices',
    action: '/receipts/bulk',
    noun: ['invoice', 'invoices'],
    total: shown.length,
    scope: listParams(here),
    actions: [RECEIPT_ACTIONS.paid(iso()), RECEIPT_ACTIONS.discard, RECEIPT_ACTIONS.retry],
  };
  const rows = shown.length
    ? `<div data-bulk-list="${bulk.form}">${bulkTools(bulk, shown.length)}${rowList(
        shown.map((r) =>
          row({
            pick: bulkCheck(bulk, r.id, invoiceName(r)),
            date: r.issue_date ? escape(shortDay(r.issue_date)) : '',
            title: `<a href="${escape(receiptUrl(r.id, here))}">${escape(r.client ?? r.invoice_number ?? 'Invoice')}</a>`,
            meta: r.client && r.invoice_number ? escape(r.invoice_number) : '',
            status: status(r),
            amount: r.total_minor === null ? '' : amount(r.total_minor, r.currency),
          }),
        ),
      )}</div>${bulkBar(bulk)}`
    : emptyState(
        month.length || across
          ? 'Nothing here.'
          : `No invoices dated ${escape(monthName(selected, false))}. ${
              settings.invoicesAddress
                ? `Copy <code>${escape(settings.invoicesAddress)}</code> when you send one.`
                : 'Set an invoice address in <a href="/settings#setup-email">Settings</a>.'
            }`,
        addButton('invoices', true),
      );
  const overdue = overdueAll.filter((r) => !month.includes(r));
  const body = `${switcher}${receiptsTabs(tabs, 'invoices', selected)}${
    month.length
      ? `<p class="summary">Invoiced EUR ${money(invoiced)}, received EUR ${money(received)}${noEur ? `<span class="red">${noEur} without EUR</span>` : ''}</p>`
      : ''
  }${
    overdue.length
      ? `<p class="alert" role="note"><a href="${escape(listUrl({ ...here, show: 'overdue' }))}">${plural(overdue.length, 'older invoice')} overdue ›</a></p>`
      : ''
  }${chips}${rows}${
    undated.length && !across
      ? `<p class="small">Undated: ${undated
          .slice(0, 5)
          .map((r) => `<a href="${escape(receiptUrl(r.id, here))}">${escape(invoiceName(r))}</a>`)
          .join(', ')}</p>`
      : ''
  }${month.length ? `<div class="csv">${buttonLink('csv', `/export-sales.csv?month=${selected}`, { attrs: ' download' })}<p class="small">${EXPORT_LINE}</p></div>` : ''}`;
  const add = shown.length ? addButton('invoices', true) : '';
  return page('invoices', body, 200, env, {
    detail: `Invoices · ${monthName(selected)}`,
    head: across ? pageHead(SHOWS[show], add) : monthHead('/receipts?view=all&kind=sales', selected, add),
  });
}
function firstFlag(r: Receipt): string {
  const code = reasonCodes(r.review_reasons_json)[0];
  return code ? flagFor(code).title.replace(/\.$/, '') : 'Needs a look';
}

// ---------- On the invoice page ----------
type Credit = Transaction & { account_name: string; bank_name: string };
// The money-in box: the matched payment, or credits that may be this invoice. fields: the receipt
// page's list (receiptFields), which every form here posts so its return keeps it.
// The paid form on an invoice's page, as a failure scope names it.
export const PAID_SCOPE = 'paid';
export async function paymentBox(env: Env, r: SalesRow, fields: string): Promise<string> {
  const back = `<input type="hidden" name="return_to" value="/receipts/${r.id}">${fields}`;
  const box = (title: string, body: string) =>
    `<section aria-labelledby="pay-h" class="matchs"><h2 id="pay-h">${title}</h2>${body}</section>`;
  if (r.paid_bank_on) {
    const t = await env.DB.prepare(
      "SELECT t.*,a.label AS account_name,a.bank_name FROM bank_transactions t JOIN imports i ON i.id=t.import_id JOIN accounts a ON a.id=t.account_key WHERE t.receipt_id=? AND i.status='complete' LIMIT 1",
    )
      .bind(r.id)
      .first<Credit>();
    if (t)
      return box(
        'Paid',
        `<div class="match"><p><strong>${amount(t.amount_minor, t.currency)}</strong> from ${escape(t.merchant)}, ${day(t.booking_date, false)}</p><form action="/matches" method="post"><input type="hidden" name="transaction_id" value="${t.id}">${back}${button('unmatch', { attrs: ' name="action" value="unlink"' })}</form></div>`,
      );
  }
  const paidForm = `<form action="/receipts/${r.id}/paid" method="post">${fields}<div class="fields">${input('paid_outside_on', r.paid_outside_on, 'date', 'Paid on', { scope: PAID_SCOPE })}${input('paid_outside_note', r.paid_outside_note, 'text', 'How', { hint: 'For example Stripe payout', scope: PAID_SCOPE })}</div>${errorLine(PAID_SCOPE, '')}${r.paid_outside_on ? button('save') : button('paid')}</form>${r.paid_outside_on ? `<form action="/receipts/${r.id}/paid" method="post">${fields}${button('unpaid')}</form>` : ''}`;
  if (r.paid_outside_on)
    return box(
      'Paid',
      `<div class="match"><p><strong>${escape(day(r.paid_outside_on))}</strong> ${escape(r.paid_outside_note)}</p>${paidForm}</div>`,
    );
  if (!isReady(r) && r.review_reasons_json !== '["missing_eur"]')
    return box('Payment', '<p class="small">Approve it first.</p>');
  const credits = (
    await env.DB.prepare(
      "SELECT t.*,a.label AS account_name,a.bank_name FROM bank_transactions t JOIN imports i ON i.id=t.import_id JOIN accounts a ON a.id=t.account_key WHERE i.status='complete' AND t.receipt_id IS NULL AND t.receipt_required=1 AND t.amount_minor>0 AND NOT EXISTS (SELECT 1 FROM internal_transfers p WHERE p.credit_id=t.id OR p.debit_id=t.id) ORDER BY t.booking_date,t.id LIMIT 500",
    ).all<Credit>()
  ).results;
  const likely = credits.filter((t) => creditFit(r, t, config(env).tuning) !== null);
  const due = dueOn(r, config(env).tuning.paymentTermsDays);
  return box(
    likely.length ? 'Payment?' : 'Unpaid',
    `${
      likely.length
        ? likely
            .slice(0, 5)
            .map(
              (t) =>
                `<form action="/matches" method="post" class="match"><p><strong>${amount(t.amount_minor, t.currency)}</strong> from ${escape(t.merchant)}, ${day(t.booking_date, false)}${t.reference ? ` <span class="hint">${escape(t.reference)}</span>` : ''}</p><input type="hidden" name="transaction_id" value="${t.id}"><input type="hidden" name="receipt_id" value="${r.id}">${back}${button('match', { attrs: ' name="action" value="link"' })}</form>${matchError(t.id)}`,
            )
            .join('')
        : due
          ? `<p class="small">Due ${escape(day(due))}</p>`
          : ''
    }<details><summary>Paid another way?</summary><div class="body">${paidForm}</div></details>`,
  );
}

// ---------- Add page ----------
export const MAX_UPLOAD_FILES = 10;
// The Add form, as a failure scope names it.
export const ADD_SCOPE = 'add';
export async function addPage(env: Env, params: URLSearchParams): Promise<Response> {
  const settings = config(env);
  const kind = params.get('kind') === 'sales' ? 'sales' : 'expense';
  const option = (value: 'expense' | 'sales', title: string, sub: string) =>
    `<label><input type="radio" name="kind" value="${value}"${kind === value ? ' checked' : ''}><span>${title}<span class="s">${sub}</span></span></label>`;
  const mail = [
    settings.receiptAddress ? `receipts to <code>${escape(settings.receiptAddress)}</code>` : '',
    settings.invoicesAddress ? `invoices you sent to <code>${escape(settings.invoicesAddress)}</code>` : '',
  ].filter(Boolean);
  const body = `<p class="banner" role="status" id="add-status"></p><form action="/upload" method="post" enctype="multipart/form-data" class="add"><fieldset><legend>What are these?</legend><div class="kinds">${option('expense', 'Receipts and bills', 'Things the business paid for')}${option('sales', 'Invoices you sent', 'Money clients owe or paid you')}</div></fieldset><div class="drop"><p style="margin:0"><strong>Drop files here</strong> or choose them</p><label><span class="vh">Files</span><input required name="file" type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" id="f-file"${ariaFor(ADD_SCOPE, 'file')}></label>${errorLine(ADD_SCOPE)}<p class="small" style="margin:0">PDFs up to 10 MB, photos up to 4 MB, ${MAX_UPLOAD_FILES} at a time.</p></div><ul class="queue" aria-live="polite"></ul><p>${button('upload', { tone: 'primary', attrs: ' type="submit"' })}</p></form>${
    mail.length ? `<p class="small">Or forward ${mail.join(', and ')} from an allowed address.</p>` : ''
  }<script src="/assets/add.js" defer></script>`;
  return page('add', body, 200, env, {
    detail: 'Add',
    head: pageHead(
      'Add receipts or invoices',
      '',
      kind === 'sales'
        ? { href: '/receipts?view=all&kind=sales', label: 'Invoices' }
        : { href: '/receipts?view=todo', label: 'Receipts' },
    ),
  });
}
// Progressive enhancement for /add: drag and drop, one request per file and
// a live list. Without it the form posts every file in one request.
export const ADD_JS = `(() => {
  const form = document.querySelector('form.add');
  if (!form || !window.fetch || !window.FormData) return;
  const input = form.querySelector('input[type=file]');
  const drop = form.querySelector('.drop');
  const queue = form.querySelector('.queue');
  const button = form.querySelector('button[type=submit]');
  const status = document.getElementById('add-status');
  const base = form.getAttribute('action').replace(/\\/upload$/, '');
  const item = (name, text, bad, link) => {
    const li = document.createElement('li');
    const n = document.createElement('span');
    n.textContent = name;
    const s = document.createElement('span');
    s.className = 'st';
    li.append(n, s);
    set(li, text, bad, link);
    return li;
  };
  const set = (li, text, bad, link) => {
    const s = li.querySelector('.st');
    s.textContent = text;
    if (link) s.append(link);
    li.classList.toggle('bad', !!bad);
  };
  const list = () => {
    queue.textContent = '';
    for (const f of input.files) queue.append(item(f.name, 'Ready to add'));
  };
  ['dragenter', 'dragover'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (ev) => {
    if (ev.dataTransfer && ev.dataTransfer.files.length) { input.files = ev.dataTransfer.files; list(); }
  });
  input.addEventListener('change', list);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const files = Array.from(input.files);
    if (!files.length) { input.focus(); return; }
    if (files.length > ${MAX_UPLOAD_FILES}) { status.textContent = 'Up to ${MAX_UPLOAD_FILES} files at a time.'; return; }
    const checked = form.querySelector('input[name=kind]:checked');
    const kind = checked ? checked.value : 'expense';
    button.disabled = true;
    status.textContent = '';
    queue.textContent = '';
    const items = files.map((f) => { const li = item(f.name, 'Waiting'); queue.append(li); return li; });
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      set(items[i], 'Adding…');
      const body = new FormData();
      body.append('kind', kind);
      body.append('file', files[i]);
      try {
        const res = await fetch(form.getAttribute('action'), { method: 'POST', body, headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        const one = data.files && data.files[0];
        if (res.ok && one && one.id) {
          ok++;
          const a = document.createElement('a');
          a.href = base + '/receipts/' + one.id;
          a.textContent = 'Open';
          set(items[i], 'Added · ', false, a);
        } else set(items[i], (one && one.error) || data.error || "Couldn't add it", true);
      } catch {
        set(items[i], 'Upload failed. Check your connection and try again.', true);
      }
    }
    button.disabled = false;
    input.value = '';
    status.textContent = ok + ' of ' + files.length + ' added. They are being read now.';
  });
})();
`;
