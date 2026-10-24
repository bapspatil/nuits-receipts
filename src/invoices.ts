// Sales invoices you sent: the Invoices list, payment status, the receipt
// page's money-in matching, and the Add page (several files, either kind).
import { DEFAULT_TUNING, money, type Receipt } from './domain';
import { creditFit, eurValue, type Transaction } from './banking';
import type { Env } from './env';
import { config } from './config';
import { flagFor, reasonCodes } from './flags';
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
  navCounts,
  page,
  pageHead,
  plural,
  receiptsSegment,
  shortDay,
  tag,
  exceptionBox,
  matchError,
} from './ui';

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
  if (r.status === 'needs_review' && r.review_reasons_json !== '["missing_eur"]') return 'review';
  if (paidOn(r)) return 'paid';
  const due = dueOn(r, terms);
  return due && due < now ? 'overdue' : 'unpaid';
}
export function salesStamp(r: SalesRow, terms = DEFAULT_TUNING.paymentTermsDays): string {
  switch (salesStatus(r, terms)) {
    case 'reading':
      return tag('Reading');
    case 'review':
      return '<span class="stamp needs">Needs a look</span>';
    case 'paid':
      return tag('Paid', true);
    case 'overdue':
      return '<span class="stamp missing">Overdue</span>';
    default:
      return tag('Unpaid');
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
  const open = await salesRows(env, "r.status<>'needs_review' AND r.paid_outside_on IS NULL");
  return open.filter((r) => salesStatus(r, config(env).tuning.paymentTermsDays) === 'overdue');
}

type Show = 'all' | 'review' | 'unpaid' | 'overdue' | 'paid';
const SHOWS: Record<Show, string> = {
  all: 'All',
  review: 'Check',
  unpaid: 'Unpaid',
  overdue: 'Overdue',
  paid: 'Paid',
};
export async function invoicesPage(env: Env, selected: string, params: URLSearchParams): Promise<Response> {
  const settings = config(env);
  const show = (Object.keys(SHOWS) as Show[]).find((k) => k === params.get('show')) ?? 'all';
  // Unpaid and overdue span every month: an old invoice is still owed.
  const across = show === 'unpaid' || show === 'overdue';
  const month = await salesRows(env, 'substr(r.issue_date,1,7)=?', selected);
  const open = across ? await salesRows(env, 'r.issue_date IS NOT NULL') : month;
  const undated = await salesRows(env, 'r.issue_date IS NULL');
  const base = across ? open : month;
  const shown =
    show === 'all' ? base : base.filter((r) => salesStatus(r, config(env).tuning.paymentTermsDays) === show);
  let invoiced = 0n,
    received = 0n,
    noEur = 0;
  for (const r of month) {
    const eur = await eurValue(env, r);
    if (eur.minor === null) {
      noEur++;
      continue;
    }
    invoiced += BigInt(eur.minor);
    if (salesStatus(r, config(env).tuning.paymentTermsDays) === 'paid') received += BigInt(eur.minor);
  }
  const count = (k: Show) =>
    k === 'all'
      ? base.length
      : (k === 'unpaid' || k === 'overdue' ? open : month).filter(
          (r) => salesStatus(r, config(env).tuning.paymentTermsDays) === k,
        ).length;
  const chips = chipRow(
    'Show',
    (Object.keys(SHOWS) as Show[]).map((k) => ({
      href: `/invoices?month=${selected}${k === 'all' ? '' : `&show=${k}`}`,
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
        return tag('Reading');
      case 'review':
        return `<span class="stamp needs" title="${escape(firstFlag(r))}">Check</span>`;
      case 'paid':
        return tag(`Paid ${escape(shortDay(paid!))}`, true);
      case 'overdue':
        return `<span class="stamp missing">Overdue</span> ${escape(shortDay(due!))}`;
      default:
        return due ? `Due ${escape(shortDay(due))}` : 'No date';
    }
  };
  const rows = shown.length
    ? `<ul class="list all">${shown
        .map(
          (r) =>
            `<li><a href="/receipts/${r.id}">${escape(r.client ?? r.invoice_number ?? 'Invoice')}</a><span class="amt">${r.total_minor === null ? '' : amount(r.total_minor, r.currency)}</span><span class="ok">${r.client && r.invoice_number ? `${escape(r.invoice_number)} · ` : ''}${status(r)}</span></li>`,
        )
        .join('')}</ul>`
    : emptyState(
        month.length || across
          ? 'Nothing here.'
          : `No invoices dated ${escape(monthName(selected, false))}. ${
              settings.invoicesAddress
                ? `Copy <code>${escape(settings.invoicesAddress)}</code> when you send one.`
                : 'Set an invoice address in <a href="/settings#setup-email">Settings</a>.'
            }`,
        '<a class="btn primary" href="/add?kind=sales">Add invoice</a>',
      );
  const overdue = across ? [] : (await overdueInvoices(env)).filter((r) => !month.includes(r));
  const body = `${receiptsSegment(await navCounts(env), 'invoices', selected)}${
    month.length
      ? `<p class="summary">Invoiced EUR ${money(invoiced)}, received EUR ${money(received)}${noEur ? `<span class="red">${noEur} without EUR</span>` : ''}</p>`
      : ''
  }${
    overdue.length
      ? `<p class="alert" role="note"><a href="/invoices?month=${selected}&show=overdue">${plural(overdue.length, 'older invoice')} overdue ›</a></p>`
      : ''
  }${chips}${rows}${
    undated.length && !across
      ? `<p class="small">Undated: ${undated
          .slice(0, 5)
          .map((r) => `<a href="/receipts/${r.id}">${escape(invoiceName(r))}</a>`)
          .join(', ')}</p>`
      : ''
  }${month.length ? `<div class="csv"><a class="btn secondary" href="/export-sales.csv?month=${selected}">CSV</a><p class="small">${EXPORT_LINE}</p></div>` : ''}`;
  const add = shown.length ? '<a class="btn primary" href="/add?kind=sales">Add invoice</a>' : '';
  return page('invoices', body, 200, env, {
    detail: `Invoices · ${monthName(selected)}`,
    head: across ? pageHead(SHOWS[show], add) : monthHead('/invoices', selected, add),
  });
}
function firstFlag(r: Receipt): string {
  const code = reasonCodes(r.review_reasons_json)[0];
  return code ? flagFor(code).title.replace(/\.$/, '') : 'Needs a look';
}

// ---------- On the invoice page ----------
type Credit = Transaction & { account_name: string; bank_name: string };
// The money-in box: the matched payment, or credits that may be this invoice.
export async function paymentBox(env: Env, r: SalesRow): Promise<string> {
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
        `<div class="match"><p><strong>${amount(t.amount_minor, t.currency)}</strong> from ${escape(t.merchant)}, ${day(t.booking_date, false)}</p><form action="/matches" method="post"><input type="hidden" name="transaction_id" value="${t.id}"><input type="hidden" name="return_to" value="/receipts/${r.id}"><button class="linkbtn" name="action" value="unlink">Remove match</button></form></div>`,
      );
  }
  const paidForm = `<form action="/receipts/${r.id}/paid" method="post"><div class="fields">${input('paid_outside_on', r.paid_outside_on, 'date', 'Paid on')}${input('paid_outside_note', r.paid_outside_note, 'text', 'How', { attrs: ' placeholder="Stripe payout"' })}</div><button class="btn secondary">${r.paid_outside_on ? 'Save' : 'Mark paid'}</button></form>${r.paid_outside_on ? `<form action="/receipts/${r.id}/paid" method="post"><button class="linkbtn">Not paid</button></form>` : ''}`;
  if (r.paid_outside_on)
    return box(
      'Paid',
      `<div class="match"><p><strong>${escape(day(r.paid_outside_on))}</strong> ${escape(r.paid_outside_note)}</p>${paidForm}</div>`,
    );
  if (r.status !== 'ready' && r.review_reasons_json !== '["missing_eur"]')
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
                `<form action="/matches" method="post" class="match"><p><strong>${amount(t.amount_minor, t.currency)}</strong> from ${escape(t.merchant)}, ${day(t.booking_date, false)}${t.reference ? ` <span class="hint">${escape(t.reference)}</span>` : ''}</p><input type="hidden" name="transaction_id" value="${t.id}"><input type="hidden" name="receipt_id" value="${r.id}"><input type="hidden" name="return_to" value="/receipts/${r.id}">${exceptionBox(t.id)}<button class="btn secondary" name="action" value="link">Match</button></form>${matchError(t.id)}`,
            )
            .join('')
        : due
          ? `<p class="small">Due ${escape(day(due))}</p>`
          : ''
    }<details><summary>Paid another way?</summary><div class="body">${paidForm}</div></details>`,
  );
}

// ---------- Add page ----------
export const ADD_CSP =
  "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
export const MAX_UPLOAD_FILES = 10;
export async function addPage(env: Env, params: URLSearchParams): Promise<Response> {
  const settings = config(env);
  const kind = params.get('kind') === 'sales' ? 'sales' : 'expense';
  const option = (value: 'expense' | 'sales', title: string, sub: string) =>
    `<label><input type="radio" name="kind" value="${value}"${kind === value ? ' checked' : ''}><span>${title}<span class="s">${sub}</span></span></label>`;
  const mail = [
    settings.receiptAddress ? `receipts to <code>${escape(settings.receiptAddress)}</code>` : '',
    settings.invoicesAddress ? `invoices you sent to <code>${escape(settings.invoicesAddress)}</code>` : '',
  ].filter(Boolean);
  const body = `<p class="banner" role="status" id="add-status"></p><form action="/upload" method="post" enctype="multipart/form-data" class="add"><fieldset><legend>What are these?</legend><div class="kinds">${option('expense', 'Receipts and bills', 'Things the business paid for')}${option('sales', 'Invoices you sent', 'Money clients owe or paid you')}</div></fieldset><div class="drop"><p style="margin:0"><strong>Drop files here</strong> or choose them</p><label><span class="vh">Files</span><input required name="file" type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp"></label><p class="small" style="margin:0">PDFs up to 10 MB, photos up to 4 MB, ${MAX_UPLOAD_FILES} at a time.</p></div><ul class="queue" aria-live="polite"></ul><p><button type="submit" class="btn primary">Add files</button></p></form>${
    mail.length ? `<p class="small">Or forward ${mail.join(', and ')} from an allowed address.</p>` : ''
  }<script src="/assets/add.js" defer></script>`;
  return page('add', body, 200, env, {
    detail: 'Add',
    head: pageHead('Add receipts or invoices'),
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
