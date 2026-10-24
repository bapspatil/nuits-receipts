// Server-rendered screens. Every form keeps the action, field names and values
// the POST handlers in src/index.ts expect; only labels and layout live here.
import { EXPENSE_TYPES, EXPONENTS, money, type Receipt, type Rule, type Tuning } from './domain';
import { creditFit, eligible, eurValue, openSales, type EurValue, type Transaction } from './banking';
import { importForm, wizard } from './imports';
import { listAccounts, listTransfers } from './accounts';
import type { Env } from './env';
import { config, MAX_ALLOWED_SENDERS, parseSenders } from './config';
import { setupParts } from './setup';
import { heldMail, ignoredSenders } from './inbound';
import { heldSection, senderBanner } from './all';
import { deployValue } from './settings';
import { MAX_PACKAGE_FILES, options, planPackage, query, sendStatus, type PackageOptions } from './package';
import { invoiceName, overdueInvoices, paymentBox, salesRows, salesStamp, salesStatus } from './invoices';
import { TREATMENT_LABELS } from './sales';
import { VAT_TREATMENTS } from './domain';
import { connection, progress, redirectUri, type Connection } from './onedrive';
import {
  bodyOf,
  flagCards,
  flagFor,
  matchesFilter,
  reasonCodes,
  REVIEW_FILTERS,
  type FlagField,
  type ReviewFilter,
} from './flags';
import {
  amount,
  day,
  escape,
  EXPORT_NOTICE,
  input,
  MISSING_PAYMENTS,
  monthName,
  monthRows,
  monthSwitcher,
  page,
  pageHead,
  emptyState,
  plural,
  productLabel,
  productOptions,
  productSelect,
  receiptTable,
  select,
  shiftMonth,
  signOutLink,
  stamp,
  today,
  uploadForm,
} from './ui';

type Payment = Transaction & { account_name: string; bank_name: string };
const INLINE_IMAGES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];
export function previewable(r: Pick<Receipt, 'media_type'>): boolean {
  return INLINE_IMAGES.includes(r.media_type);
}

const QUEUE_ORDER = 'ORDER BY issue_date IS NOT NULL, issue_date, received_at, id';
async function reviewQueue(env: Env): Promise<Receipt[]> {
  return (
    await env.DB.prepare(
      `SELECT * FROM receipts WHERE status='needs_review' AND duplicate_of IS NULL ${QUEUE_ORDER} LIMIT 500`,
    ).all<Receipt>()
  ).results;
}
function firstFlag(r: Receipt): string {
  const code = reasonCodes(r.review_reasons_json)[0];
  return code ? flagFor(code).title.replace(/\.$/, '') : 'Needs a look';
}
function receiptName(r: Receipt): string {
  return r.kind === 'sales' ? invoiceName(r) : (r.vendor ?? r.filename);
}
// Receipts that can be matched to a bank row, the same set the /matches handler accepts.
async function matchableReceipts(env: Env): Promise<Receipt[]> {
  return (
    await env.DB.prepare(
      `SELECT * FROM receipts WHERE kind='expense' AND duplicate_of IS NULL AND (status='ready' OR (status='needs_review' AND review_reasons_json='["missing_eur"]')) AND id NOT IN (SELECT receipt_id FROM bank_transactions t JOIN imports i ON i.id=t.import_id WHERE receipt_id IS NOT NULL AND i.status='complete') ORDER BY issue_date DESC,id`,
    ).all<Receipt>()
  ).results;
}
function suggestionsFor(t: Transaction, receipts: Receipt[], rules: Rule[], tuning: Tuning): Receipt[] {
  return receipts
    .filter((r) => eligible(r, t, rules, true, tuning))
    .sort(
      (a, b) =>
        Math.abs(Date.parse(a.issue_date ?? '') - Date.parse(t.booking_date)) -
          Math.abs(Date.parse(b.issue_date ?? '') - Date.parse(t.booking_date)) ||
        (a.issue_date ?? '').localeCompare(b.issue_date ?? '') ||
        a.id.localeCompare(b.id),
    );
}
function receiptOption(r: Receipt, selected = false): string {
  return `<option value="${r.id}"${selected ? ' selected' : ''}>${escape(receiptName(r))} · ${escape(day(r.issue_date)) || 'no date'} · ${amount(r.total_minor, r.currency)}</option>`;
}

type MonthState = Awaited<ReturnType<typeof monthState>>;
async function monthState(env: Env, selected: string) {
  const rows = await monthRows(env, selected);
  const eurs: EurValue[] = [];
  for (const r of rows) eurs.push(await eurValue(env, r));
  const matrix = new Map<string, bigint>();
  let total = 0n,
    estimated = 0n,
    unchecked = 0n,
    noEur = 0;
  rows.forEach((r, i) => {
    const eur = eurs[i]!;
    if (eur.minor === null) {
      noEur++;
      return;
    }
    total += BigInt(eur.minor);
    if (eur.source === 'ecb') estimated += BigInt(eur.minor);
    if (r.status !== 'ready') unchecked += BigInt(eur.minor);
    const key = r.product + '\u0000' + r.expense_type;
    matrix.set(key, (matrix.get(key) ?? 0n) + BigInt(eur.minor));
  });
  const payments = (
    await env.DB.prepare(
      "SELECT t.*,a.label AS account_name,a.bank_name FROM bank_transactions t JOIN imports i ON i.id=t.import_id JOIN accounts a ON a.id=t.account_key WHERE i.status='complete' AND substr(t.booking_date,1,7)=? ORDER BY t.booking_date,t.account_key,t.id",
    )
      .bind(selected)
      .all<Payment>()
  ).results;
  const out = payments.filter((t) => t.amount_minor < 0);
  const missing = out.filter((t) => t.receipt_required && !t.receipt_id);
  const imported = await env.DB.prepare(
    "SELECT max(i.imported_at) d FROM imports i WHERE i.status='complete' AND EXISTS (SELECT 1 FROM bank_transactions t WHERE t.import_id=i.id AND substr(t.booking_date,1,7)=?)",
  )
    .bind(selected)
    .first<string | null>('d');
  // Sales invoices issued in the month. One that needs a look blocks the
  // month like a receipt does; an unpaid one does not.
  const sales = await salesRows(env, 'substr(r.issue_date,1,7)=?', selected);
  let invoiced = 0n;
  for (const r of sales) invoiced += BigInt((await eurValue(env, r)).minor ?? 0);
  const isReading = (r: Receipt) => r.status === 'pending' || r.status === 'processing';
  const flagged = [...rows, ...sales].filter((r) => r.status === 'needs_review');
  const reading = [...rows, ...sales].filter(isReading);
  const send = await sendStatus(env, selected, [...rows, ...sales]);
  const docs = rows.length + sales.length;
  return {
    send,
    // Marked as sent, and nothing added or corrected since.
    sent: !!send.last && !send.changed && docs > 0,
    docs,
    sales,
    invoiced,
    unpaid: sales.filter((r) => ['unpaid', 'overdue'].includes(salesStatus(r, config(env).tuning.paymentTermsDays))),
    rows,
    eurs,
    matrix,
    total,
    estimated,
    unchecked,
    noEur,
    flagged,
    reading,
    ready: rows.filter((r) => r.status !== 'needs_review' && !isReading(r)).length,
    out,
    missing,
    matched: out.filter((t) => t.receipt_id),
    imported,
    done: { review: flagged.length === 0, match: !!imported && missing.length === 0 },
  };
}

// ---------- Review queue ----------
export async function reviewPage(
  env: Env,
  filter: ReviewFilter | null,
  params = new URLSearchParams(),
): Promise<Response> {
  const all = await reviewQueue(env);
  const held = await heldMail(env);
  const rows = filter ? all.filter((r) => matchesFilter(reasonCodes(r.review_reasons_json), filter)) : all;
  const reading = await env.DB.prepare(
    "SELECT count(*) n FROM receipts WHERE status IN ('pending','processing') AND duplicate_of IS NULL",
  ).first<number>('n');
  const chip = (key: ReviewFilter | null, label: string) =>
    `<li><a href="/review${key ? `?reason=${key}` : ''}"${key === filter ? ' aria-current="page"' : ''}>${escape(label)}</a></li>`;
  const chips = `<ul class="chips" aria-label="Filter">${chip(null, `All (${all.length})`)}${(Object.keys(REVIEW_FILTERS) as ReviewFilter[]).map((k) => chip(k, REVIEW_FILTERS[k].label)).join('')}</ul>`;
  const now = Date.now();
  const age = (r: Receipt) => {
    const days = Math.floor((now - Date.parse(r.received_at)) / 86400000);
    return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  };
  const list = rows.length
    ? `<p><a class="btn primary" href="/receipts/${rows[0]!.id}">Start reviewing</a></p><ul class="list">${rows
        .map(
          (r) =>
            `<li><a href="/receipts/${r.id}">${escape(receiptName(r))}</a><span class="amt">${amount(r.total_minor, r.currency)}</span><span class="why">${escape(firstFlag(r))}</span><span class="ok">${escape(day(r.issue_date)) || 'No date'} · arrived ${age(r)}</span></li>`,
        )
        .join('')}</ul>`
    : all.length
      ? emptyState(
          'Nothing in this filter.',
          `${plural(all.length, 'other receipt')} still ${all.length === 1 ? 'needs' : 'need'} a look.`,
          `<a class="btn primary" href="/review">Show all ${all.length}</a>`,
        )
      : held.length
        ? ''
        : emptyState(
            'Every receipt is ready.',
            "Receipts land here when the reader isn't sure.",
            `${uploadForm(config(env).receiptAddress, true)}<p class="small"><a href="/receipts">See all receipts</a></p>`,
            '<span class="stamp ready">Nothing to check</span>',
          );
  return page(
    'Review',
    `${senderBanner(params)}${heldSection(held)}${all.length || !held.length ? chips : ''}${reading ? `<p class="banner" role="status">${plural(reading, 'receipt is', 'receipts are')} still being read. Refresh in a minute.</p>` : ''}${list}`,
    200,
    env,
    {
      nav: 'review',
      head: pageHead(
        all.length
          ? `${plural(all.length, 'receipt')} to check`
          : held.length
            ? `${plural(held.length, 'email')} from unknown senders`
            : 'Nothing to check',
        {
          kicker: 'Review',
          sub: all.length ? 'Undated first, then oldest.' : '',
        },
      ),
    },
  );
}

// ---------- Receipt ----------
const FIELD_LABELS: Record<FlagField | 'due_date', string> = {
  vendor: 'Who you paid',
  invoice_number: 'Receipt or invoice number',
  issue_date: 'Date on the receipt',
  due_date: 'Due date (if any)',
  currency: 'Currency',
  net: 'Before VAT',
  vat: 'VAT amount',
  total: 'Total paid',
  vat_rate: 'VAT %',
  product: 'Which part of the business',
  expense_type: 'Kind of cost',
  eur_override: 'Amount in euros',
  duplicate_of: 'Same receipt as',
  client: 'Client',
  client_vat_id: "Client's VAT number",
  client_country: "Client's country",
  vat_treatment: 'VAT',
  reference_number: 'Payment reference',
};
const FIELD_HINTS: Partial<Record<FlagField | 'due_date', string>> = {
  vat: "0 if there's no VAT",
  vat_rate: 'For example 25.5',
  client_country: 'Two letters, like DE',
  eur_override: 'Only if your bank shows a different euro amount',
};
// The same fields, worded for an invoice you sent.
const SALES_LABELS: Partial<Record<FlagField | 'due_date', string>> = {
  vendor: 'Seller (you)',
  invoice_number: 'Invoice number',
  issue_date: 'Invoice date',
  due_date: 'Due date',
  total: 'Total invoiced',
  duplicate_of: 'Same invoice as',
};
const EUR_SOURCE: Record<string, string> = {
  manual: 'your own euro amount',
  bank: 'from your bank',
  native: 'the receipt is in euros',
  ecb: 'converted at the ECB rate',
  missing: 'no euro amount yet',
};
function eurLine(eur: EurValue): string {
  if (eur.minor === null) return 'No euro amount yet.';
  return `EUR ${money(eur.minor)}, ${EUR_SOURCE[eur.source] ?? escape(eur.source)}${eur.rateDate ? ` on ${day(eur.rateDate)}` : ''}.`;
}

export async function receiptPage(env: Env, r: Receipt): Promise<Response> {
  const sales = r.kind === 'sales';
  const eur = await eurValue(env, r);
  const rules = (await env.DB.prepare('SELECT * FROM vendor_rules ORDER BY priority DESC,id LIMIT 100').all<Rule>())
    .results;
  const candidateRows = (
    await env.DB.prepare(
      "SELECT t.*,a.label AS account_name,a.bank_name FROM bank_transactions t JOIN imports i ON i.id=t.import_id JOIN accounts a ON a.id=t.account_key WHERE i.status='complete' AND t.receipt_id IS NULL AND t.receipt_required=1 AND t.amount_minor<0",
    ).all<Payment>()
  ).results;
  const suggestions =
    eur.transaction || sales
      ? []
      : candidateRows
          .filter((t) => eligible(r, t, rules, true, config(env).tuning))
          .sort(
            (a, b) =>
              Math.abs(Date.parse(a.booking_date) - Date.parse(r.issue_date ?? '')) -
                Math.abs(Date.parse(b.booking_date) - Date.parse(r.issue_date ?? '')) ||
              a.booking_date.localeCompare(b.booking_date) ||
              a.account_key.localeCompare(b.account_key) ||
              a.id.localeCompare(b.id),
          );
  const queue = (await reviewQueue(env)).map((q) => q.id);
  const position = queue.indexOf(r.id);
  const next = position >= 0 ? queue[position + 1] : queue[0];
  const duplicates = (
    await env.DB.prepare(
      'SELECT * FROM receipts WHERE id<>? AND duplicate_of IS NULL AND (lower(vendor)=lower(?) OR total_minor=? OR id=?) ORDER BY issue_date DESC,id LIMIT 50',
    )
      .bind(r.id, r.vendor ?? '', r.total_minor ?? -1, r.duplicate_of ?? '')
      .all<Receipt>()
  ).results;

  const codes = reasonCodes(r.review_reasons_json);
  const needs = r.status === 'needs_review',
    reading = r.status === 'pending' || r.status === 'processing';
  const cards = needs ? flagCards(codes) : [];
  const unverified = codes.includes('sender_unverified');
  const placed = new Set<string>();
  const money_ = (k: 'net' | 'vat' | 'total') => money(r[`${k}_minor`], r.currency ?? 'EUR');
  const values: Record<string, unknown> = {
    vendor: r.vendor,
    invoice_number: r.invoice_number,
    issue_date: r.issue_date,
    due_date: r.due_date,
    net: money_('net'),
    vat: money_('vat'),
    total: money_('total'),
    vat_rate: r.vat_rate_bps === null ? '' : r.vat_rate_bps / 100,
    client: r.client,
    client_vat_id: r.client_vat_id,
    client_country: r.client_country,
    reference_number: r.reference_number,
  };
  // Every control has an id, so a row label (or a flag's question) can name it.
  type Control = { id: string; label: string; hint: string; html: string };
  const controls = (name: FlagField | 'due_date', flagId = '', withHint = true): Control[] => {
    placed.add(name);
    const id = `f-${name}`;
    const label = (sales && SALES_LABELS[name]) || FIELD_LABELS[name];
    const hint = withHint ? (FIELD_HINTS[name] ?? '') : '';
    const describedBy = [flagId, hint ? `${id}-h` : ''].filter(Boolean).join(' ');
    const attrs = ` id="${id}"${describedBy ? ` aria-describedby="${describedBy}"` : ''}${flagId && (values[name] === null || values[name] === '') ? ' aria-invalid="true"' : ''}`;
    const text = (type: string, extra = '', value = values[name]) =>
      `<input name="${name}" value="${escape(value)}" type="${type}"${extra}${attrs}>`;
    const choose = (list: { v: string; l: string }[], current: string) =>
      `<select name="${name}"${attrs}>${list.map((o) => `<option value="${escape(o.v)}"${o.v === current ? ' selected' : ''}>${escape(o.l)}</option>`).join('')}</select>`;
    const one = (html: string): Control[] => [{ id, label, hint, html }];
    switch (name) {
      case 'vat_treatment':
        return one(
          choose(
            [{ v: '', l: 'Not known yet' }, ...VAT_TREATMENTS.map((t) => ({ v: t, l: TREATMENT_LABELS[t] }))],
            r.vat_treatment ?? '',
          ),
        );
      case 'client_country':
        return one(text('text', ' maxlength="2" autocomplete="off" style="text-transform:uppercase"'));
      case 'currency': {
        const known = Object.keys(EXPONENTS);
        return one(
          choose(
            [
              ...(r.currency ? [] : [{ v: '', l: 'Not known yet' }]),
              ...(r.currency && !known.includes(r.currency)
                ? [{ v: r.currency, l: `${r.currency} (not supported)` }]
                : []),
              ...known.map((c) => ({ v: c, l: c })),
            ],
            r.currency ?? '',
          ),
        );
      }
      case 'product':
        return one(
          choose(
            productOptions(env, r.product).map((p) => ({ v: p.id, l: p.label })),
            r.product,
          ),
        );
      case 'expense_type':
        return one(
          choose(
            EXPENSE_TYPES.map((t) => ({ v: t, l: t })),
            r.expense_type,
          ),
        );
      case 'eur_override':
        placed.add('eur_override_reason');
        return [
          { id, label, hint, html: text('text', ' inputmode="decimal"', money(r.eur_override_minor)) },
          {
            id: 'f-eur_override_reason',
            label: 'Why this euro amount?',
            hint: 'Needed when you enter one',
            html: `<input name="eur_override_reason" value="${escape(r.eur_override_reason)}" type="text" id="f-eur_override_reason" aria-describedby="f-eur_override_reason-h">`,
          },
        ];
      case 'duplicate_of':
        return one(
          `<select name="duplicate_of"${attrs}><option value="">Not a duplicate</option>${duplicates.map((d) => receiptOption(d, d.id === r.duplicate_of)).join('')}</select>`,
        );
      case 'issue_date':
      case 'due_date':
        return one(text('date'));
      case 'net':
      case 'vat':
      case 'total':
      case 'vat_rate':
        return one(text('text', ' inputmode="decimal" autocomplete="off"'));
      default:
        return one(text('text', ' autocomplete="off"'));
    }
  };
  // A Settings-style row: label (and one hint) on the left, the control on the right.
  const row = (
    c: Control,
    label = escape(c.label),
    meta = c.hint ? `<span class="meta" id="${c.id}-h">${escape(c.hint)}</span>` : '',
  ) =>
    `<div class="srow"><div class="sl"><label class="flabel" for="${c.id}">${label}</label>${meta}</div><div class="sc">${c.html}</div></div>`;
  const rows = (name: FlagField | 'due_date') =>
    controls(name)
      .map((c) => row(c))
      .join('');
  const retryButton = (label: string, kind: 'primary' | 'secondary') =>
    `<button class="btn ${kind}" formaction="/receipts/${r.id}/retry">${label}</button>`;
  const flagList = cards.length
    ? `<ol class="flags">${cards
        .map(({ flag }, i) => {
          const id = `flag-${i + 1}`;
          const names = flag.fields.filter((f) => !placed.has(f));
          const body = `<span class="meta" id="${id}">${escape(bodyOf(flag, r))}</span>`;
          const extra =
            flag.action === 'retry' && !unverified
              ? `<div class="fx">${retryButton('Read it again', 'secondary')}</div>`
              : flag.action === 'upload'
                ? `<div class="fx small"><a href="#upload">Upload a photo or a better copy</a></div>`
                : flag.action === 'move'
                  ? `<div class="fx"><button class="btn secondary" formaction="/receipts/${r.id}/kind" name="kind" value="expense">Move to receipts</button></div>`
                  : '';
          // One field: the flag's question is its label and the sentence describes it.
          if (names.length === 1) {
            const [first, ...more] = controls(names[0]!, id, false);
            return `<li class="flag">${row(first!, escape(flag.title), body)}${more.map((c) => row(c)).join('')}${extra}</li>`;
          }
          const head = `<p class="fh"><strong id="${id}-t">${escape(flag.title)}</strong> ${body}</p>`;
          if (!names.length) return `<li class="flag info">${head}${extra}</li>`;
          return `<li class="flag" role="group" aria-labelledby="${id}-t">${head}${names
            .flatMap((n) => controls(n, id))
            .map((c) => row(c))
            .join('')}${extra}</li>`;
        })
        .join('')}</ol>`
    : '';
  const rest = (
    sales
      ? ([
          'client',
          'invoice_number',
          'issue_date',
          'total',
          'currency',
          'net',
          'vat',
          'vat_rate',
          'vat_treatment',
          'client_vat_id',
          'client_country',
          'reference_number',
          'vendor',
        ] as const)
      : (['vendor', 'invoice_number', 'issue_date', 'total', 'currency', 'net', 'vat', 'vat_rate'] as const)
  )
    .filter((f) => !placed.has(f))
    .map(rows);
  const filing = (sales ? (['product'] as const) : (['product', 'expense_type'] as const))
    .filter((f) => !placed.has(f))
    .map(rows);
  const due = rows('due_date');
  const fx = placed.has('eur_override') ? '' : rows('eur_override');
  const dup = placed.has('duplicate_of') ? '' : rows('duplicate_of');
  const heading = reading
    ? 'Still reading'
    : needs
      ? cards.length === 1
        ? '1 thing to check'
        : `${cards.length} things to check`
      : 'Everything looks fine';
  const lede = reading
    ? 'Refresh in a minute; what you type is kept.'
    : needs
      ? 'Compare with the original, fix what is off, then approve.'
      : 'You can still correct anything below.';
  const primary = reading || unverified ? 'secondary' : needs ? 'primary' : '';
  const note = row({
    id: 'f-approval_reason',
    label: 'Note for your accountant',
    hint: 'Saved with your approval',
    html: '<input name="approval_reason" value="Checked against the original" type="text" id="f-approval_reason" aria-describedby="f-approval_reason-h">',
  });
  const actions = `<div class="card rowlist note-card">${note}</div><div class="actions">${
    unverified ? retryButton("It's genuine, read it", 'primary') : ''
  }${reading ? `<a class="btn primary" href="/receipts/${r.id}">Refresh</a>` : ''}${
    needs || reading
      ? `<button class="btn ${primary}" name="action" value="approve">${sales ? 'Approve invoice' : 'Approve receipt'}</button><button class="linkbtn" name="action" value="save">Save, decide later</button>`
      : `<button class="btn primary" name="action" value="save">Save changes</button><button class="linkbtn" name="action" value="approve">Approve again</button>`
  }<div class="note">Files it under ${escape(productLabel(env, r.product))}${sales ? ' as money in' : ` · ${escape(r.expense_type)}`}. <details class="why"><summary>What approval needs</summary><p>The ${sales ? 'client' : 'seller'}, date, currency, total, before-VAT and VAT amounts. Leave unknown amounts empty.</p></details></div></div>`;
  const form = `<form action="/receipts/${r.id}" method="post" class="fix"><input type="hidden" name="revision" value="${r.revision}"><div class="fixh"><h2 id="fix-h">${heading}</h2><p class="hint">${lede}</p></div>${flagList}
    <details open><summary>${cards.length ? 'Everything else we read' : 'What we read'}</summary><div class="body rowlist">${rest.join('')}${filing.join('')}${due}</div></details>
    ${fx ? `<details${r.eur_override_minor !== null ? ' open' : ''}><summary>Paid in another currency?</summary><div class="body rowlist"><p class="hint">${escape(eurLine(eur))}</p>${fx}</div></details>` : ''}
    ${dup ? `<details${r.duplicate_of ? ' open' : ''}><summary>This is a duplicate</summary><div class="body rowlist"><p class="hint">Duplicates stay out of totals and the export.</p>${dup}</div></details>` : ''}
    ${actions}</form>`;
  const matches = sales
    ? await paymentBox(env, { ...r, paid_bank_on: eur.transaction ? 'linked' : null })
    : suggestions.length
      ? `<section aria-labelledby="match-h" style="margin-top:16px"><h2 id="match-h">Is this the payment?</h2>${suggestions
          .map(
            (t) =>
              `<form action="/matches" method="post" class="match"><p><strong>${escape(t.account_name)} paid ${amount(-t.amount_minor, t.currency)} to ${escape(t.merchant)} on ${day(t.booking_date)}.</strong>${t.bank_name ? ` <span class="hint">${escape(t.bank_name)}</span>` : ''}</p><input type="hidden" name="transaction_id" value="${t.id}"><input type="hidden" name="receipt_id" value="${r.id}"><label class="check"><input type="checkbox" name="confirm_exception" value="yes">The amount or date doesn't line up exactly, and that's fine</label><p style="margin:10px 0 0"><button class="btn secondary" name="action" value="link">Yes, match</button></p></form>`,
          )
          .join('')}</section>`
      : '';
  const uploadFlag = cards.some((c) => c.flag.action === 'upload');
  const move =
    sales || config(env).invoicesAddress
      ? `<details><summary>${sales ? 'This is a bill I paid, not an invoice I sent' : 'This is an invoice I sent'}</summary><div class="body"><form action="/receipts/${r.id}/kind" method="post"><input type="hidden" name="revision" value="${r.revision}"><p class="hint">Moves it to ${sales ? 'receipts' : 'invoices you sent'} and reads it again. Any payment match is removed.</p><button class="btn secondary" name="kind" value="${sales ? 'expense' : 'sales'}">${sales ? 'Move to receipts' : 'Move to invoices'}</button></form></div></details>`
      : '';
  const folds = `<div class="folds" style="margin-top:16px">
    <details><summary>Read it again</summary><div class="body"><form action="/receipts/${r.id}/retry" method="post"><p class="hint">Runs the reader again. Anything you typed in is kept.</p><button class="btn secondary">Read it again</button></form></div></details>
    <details id="upload"${uploadFlag ? ' open' : ''}><summary>Upload a better copy</summary><div class="body"><p class="hint">Adds it as a new ${sales ? 'invoice' : 'receipt'}. Mark this one as its duplicate afterwards.</p>${uploadForm('', false, r.kind)}</div></details>
    ${move}
    ${sales ? '' : `<details><summary>Always file ${escape(r.vendor ?? 'this seller')} as...</summary><div class="body"><form action="/rules" method="post"><input type="hidden" name="return_to" value="/receipts/${r.id}"><p class="hint">Future receipts from this seller are filed this way automatically. See all rules in <a href="/settings#rules">Settings</a>.</p>${ruleFields(env, { vendor_contains: r.vendor ?? '', product: config(env).products.some((p) => p.id === r.product) ? r.product : config(env).defaultProduct, expense_type: r.expense_type })}<button class="btn secondary">Save rule</button></form></div></details>`}
    <details class="tech"><summary>Technical details</summary><div class="body"><p class="hint">Status <code>${escape(r.status)}</code>. Reason codes:</p><pre tabindex="0">${escape(r.review_reasons_json)}</pre><p class="hint">Euro amount: ${escape(eur.source)}${eur.transaction ? `. Bank transaction <code>${escape(eur.transaction)}</code> · Account ${escape(eur.accountName)}` : '. No bank match.'}</p><p class="hint">Raw model facts and manual fields</p><pre tabindex="0">${escape(r.ai_json)}\n${escape(r.manual_fields_json)}</pre><p class="hint">Receipt ID <code>${r.id}</code></p></div></details></div>`;
  const download = `<a href="/originals/${r.id}">Download original</a>${r.email_key ? ` · <a href="/originals/${r.id}?variant=email">Download source email</a>` : ''}`;
  const slip = `<div class="paper" aria-label="What we read from it"><div class="v">${sales ? (r.client ? `To ${escape(r.client)}` : '<span class="gap">Client unknown</span>') : escape(r.vendor) || '<span class="gap">Seller unknown</span>'}</div><div>${r.invoice_number ? `No. ${escape(r.invoice_number)}` : '<span class="gap">No receipt number</span>'}</div><div>${r.issue_date ? escape(day(r.issue_date)) : '<span class="gap">No date</span>'}</div><table><tr><td>Before VAT</td><td class="n">${r.net_minor === null ? '<span class="gap">?</span>' : money_('net')}</td></tr><tr><td>VAT${r.vat_rate_bps === null ? '' : ` ${r.vat_rate_bps / 100}%`}</td><td class="n">${r.vat_minor === null ? '<span class="gap">?</span>' : money_('vat')}</td></tr><tr class="tot"><td>Total</td><td class="n">${r.total_minor === null ? '<span class="gap">?</span>' : `${escape(r.currency ?? '')} ${money_('total')}`}</td></tr></table></div>`;
  const pdf = r.media_type === 'application/pdf';
  const doc = previewable(r)
    ? `<div class="frame"><img src="/originals/${r.id}?view=inline" alt="The original receipt ${escape(r.filename)}"></div><div class="doclinks"><a href="/originals/${r.id}?view=inline">Open full size</a>${download}</div>`
    : `<div class="doclink"><p><strong>${pdf ? 'This receipt is a PDF.' : r.media_type === 'message/rfc822' ? 'This receipt is an email.' : 'This receipt came as email text.'}</strong> <span class="hint">${pdf ? 'Open it beside this page.' : 'Download it to compare.'}</span></p><p>${pdf ? `<a class="btn secondary" href="/originals/${r.id}">Open the PDF</a>` : `<a class="btn secondary" href="/originals/${r.id}${r.email_key && r.media_type === 'message/rfc822' ? '?variant=email' : ''}">Download the original</a>`}</p></div><h2 class="small" style="font-family:var(--ui);margin:16px 0 8px">What we read</h2>${slip}<div class="doclinks">${download}</div>`;
  const where = queue.length && needs ? `Receipt ${position + 1} of ${queue.length}` : '';
  const crumbs = `<div class="head tight" style="margin-bottom:12px;justify-content:space-between">${needs ? '<a href="/review">‹ Review</a>' : sales ? `<a href="/invoices${r.issue_date ? `?month=${r.issue_date.slice(0, 7)}` : ''}">‹ Invoices you sent</a>` : '<a href="/receipts">‹ All receipts</a>'}${where || next ? `<span class="small">${where}${next && next !== r.id ? `${where ? ' · ' : ''}<a href="/receipts/${next}">${needs ? 'Skip for now' : 'Next to check'} ›</a>` : ''}</span>` : ''}</div>`;
  return page(
    receiptName(r),
    `<div class="work"><section class="doc" aria-label="Original document">${doc}</section><section aria-labelledby="fix-h">${form}${matches}${folds}</section></div>`,
    200,
    env,
    {
      nav: needs ? 'review' : 'receipts',
      head: `${crumbs}<div class="head tight"><h1>${escape(receiptName(r))}</h1>${sales ? salesStamp({ ...r, paid_bank_on: eur.transaction ? 'linked' : null }, config(env).tuning.paymentTermsDays) : stamp(r, !!eur.transaction)}<p class="sub" style="width:100%;margin:0">${r.source === 'email' ? 'Email' : 'Upload'} · ${day(r.received_at)} · ${amount(r.total_minor, r.currency)}${eur.source === 'native' ? '' : ` · ${escape(eurLine(eur))}`}${eur.transaction ? ` Matched ${sales ? 'into' : 'from'} ${escape(eur.accountName)}.` : ''}</p></div>`,
    },
  );
}

// ---------- Payments ----------
export async function payments(
  env: Env,
  selected: string,
  offset: number,
  params = new URLSearchParams(),
): Promise<Response> {
  const result = ['inserted', 'skipped', 'replayed']
    .map((key) => {
      const value = params.get(key);
      return value !== null && /^\d{1,4}$/.test(value) ? `${Number(value)} ${key}` : null;
    })
    .filter(Boolean)
    .join(', ');
  const show = params.get('show') === 'missing' ? 'missing' : 'all';
  const rows = (
    await env.DB.prepare(
      "SELECT t.*,a.label AS account_name,a.bank_name FROM bank_transactions t JOIN imports i ON i.id=t.import_id JOIN accounts a ON a.id=t.account_key WHERE i.status='complete' AND substr(t.booking_date,1,7)=? ORDER BY t.booking_date,t.account_key,t.id LIMIT 100 OFFSET ?",
    )
      .bind(selected, offset)
      .all<Payment>()
  ).results;
  const receipts = await matchableReceipts(env);
  const invoices = rows.some((t) => t.amount_minor > 0 && !t.receipt_id) ? await openSales(env) : [];
  const rules = (await env.DB.prepare('SELECT * FROM vendor_rules').all<Rule>()).results;
  const transfers = await listTransfers(env.DB);
  const paired = new Map(
    transfers.flatMap(
      (p) =>
        [
          [p.debit_id, p],
          [p.credit_id, p],
        ] as const,
    ),
  );
  const elsewhere = (
    await env.DB.prepare(
      `SELECT substr(t.booking_date,1,7) m, count(*) n ${MISSING_PAYMENTS} AND substr(t.booking_date,1,7)<>? GROUP BY m ORDER BY m DESC LIMIT 12`,
    )
      .bind(selected)
      .all<{ m: string; n: number }>()
  ).results;
  const isMissing = (t: Payment) => !paired.has(t.id) && t.amount_minor < 0 && !!t.receipt_required && !t.receipt_id;
  const out = rows.filter((t) => t.amount_minor < 0 && !paired.has(t.id));
  const missing = rows.filter(isMissing);
  const matched = out.filter((t) => t.receipt_id);
  const firstMissing = missing[0]?.id;
  const shown = show === 'missing' ? missing : rows;
  const items = shown
    .map((t) => {
      const pair = paired.get(t.id);
      const tech = `<details class="tech"><summary>Technical details</summary><div class="body"><p class="hint">Payment ID <code>${t.id}</code></p></div></details>`;
      let status: string, controls: string;
      if (pair) {
        status = '<span class="stamp muted">Transfer</span>';
        controls = `<p class="small" style="margin:8px 0 0">Own-account transfer · ${escape(pair.debit_account_name)} → ${escape(pair.credit_account_name)} · ${escape(pair.reason)}</p><div class="inline"><form action="/transfers/${pair.debit_id}/undo" method="post"><button class="linkbtn">Undo transfer</button></form></div>`;
      } else if (t.receipt_id) {
        status = '<span class="stamp matched">Matched</span>';
        controls = `<div class="inline"><a href="/receipts/${t.receipt_id}">${t.amount_minor > 0 ? 'View invoice' : 'View receipt'}</a><form action="/matches" method="post"><input type="hidden" name="transaction_id" value="${t.id}"><button class="linkbtn" name="action" value="unlink">Remove match</button></form></div>`;
      } else if (t.amount_minor >= 0) {
        status = '<span class="stamp muted">Money in</span>';
        const likely = invoices.filter((r) => creditFit(r, t, config(env).tuning) !== null);
        const others = invoices.filter((r) => !likely.includes(r));
        controls =
          invoices.length && t.amount_minor > 0 && t.receipt_required
            ? `<details${likely.length ? ' open' : ''}><summary>${likely.length ? 'Looks like an invoice you sent' : 'Find the invoice'}</summary><div class="body"><form action="/matches" method="post"><input type="hidden" name="transaction_id" value="${t.id}"><div class="fields"><label class="wide">Which invoice was paid?<select name="receipt_id"><option value="">Choose an invoice</option>${likely.length ? `<optgroup label="Likely">${likely.map((r, i) => receiptOption(r, i === 0)).join('')}</optgroup>` : ''}${others.length ? `<optgroup label="Other open invoices">${others.map((r) => receiptOption(r)).join('')}</optgroup>` : ''}</select></label></div><label class="check"><input type="checkbox" name="confirm_exception" value="yes">The amount or date doesn't line up exactly, and that's fine</label><p style="margin:12px 0 0"><button class="btn secondary" name="action" value="link">Match</button></p></form></div></details>`
            : '';
      } else if (!t.receipt_required) {
        status = '<span class="stamp muted">Not a purchase</span>';
        controls = `<div class="inline"><form action="/payments/${t.id}" method="post"><button class="linkbtn" name="receipt_required" value="1">Needs a receipt after all</button></form></div>`;
      } else {
        status = '<span class="stamp missing">Missing receipt</span>';
        const likely = suggestionsFor(t, receipts, rules, config(env).tuning);
        const others = receipts.filter((r) => !likely.includes(r));
        const options = `<option value="">Choose a receipt</option>${likely.length ? `<optgroup label="Likely">${likely.map((r, i) => receiptOption(r, i === 0)).join('')}</optgroup>` : ''}${others.length ? `<optgroup label="Other ready receipts">${others.map((r) => receiptOption(r)).join('')}</optgroup>` : ''}`;
        controls = `<details${t.id === firstMissing ? ' open' : ''}><summary>Find the receipt</summary><div class="body"><form action="/matches" method="post"><input type="hidden" name="transaction_id" value="${t.id}">${
          receipts.length
            ? `<div class="fields"><label class="wide">Which receipt is it?${likely.length ? ` <span class="hint">${plural(likely.length, 'likely match', 'likely matches')} listed first</span>` : ''}<select name="receipt_id">${options}</select></label></div><label class="check"><input type="checkbox" name="confirm_exception" value="yes">The amount or date doesn't line up exactly, and that's fine</label><details class="tech"><summary>Paste a receipt ID instead</summary><div class="body">${input('receipt_id_manual', '', 'text', 'Receipt ID', { attrs: ' autocomplete="off"' })}</div></details><p style="margin:12px 0 0"><button class="btn ${t.id === firstMissing ? 'primary' : 'secondary'}" name="action" value="link">Match</button></p>`
            : `<p class="hint">No ready receipts to match yet. Check the ones waiting under <a href="/review">Review</a>, or add this one.</p><p><a class="btn ${t.id === firstMissing ? 'primary' : 'secondary'}" href="/add">Add the receipt</a></p>`
        }</form><form action="/payments/${t.id}" method="post" style="margin-top:8px"><button class="linkbtn" name="receipt_required" value="0">Not a purchase (no receipt needed)</button></form></div></details>`;
      }
      return `<li class="pay${isMissing(t) ? ' missing' : ''}"><div class="line"><span class="when">${day(t.booking_date)}</span><span class="who">${escape(t.merchant)}<span class="acct">${escape(t.account_name)}${t.bank_name ? ` · ${escape(t.bank_name)}` : ''}</span></span><span class="amt">${amount(t.amount_minor, t.currency)}</span>${status}</div>${controls}${tech}</li>`;
    })
    .join('');
  const name = monthName(selected);
  const others = elsewhere.length
    ? `<p class="small">Also missing receipts in: ${elsewhere.map((e) => `<a href="/payments?month=${e.m}&show=missing">${escape(monthName(e.m))} (${e.n})</a>`).join(', ')}.</p>`
    : '';
  const filter = `<ul class="chips" aria-label="Show">${[
    ['all', `All (${rows.length})`],
    ['missing', `Missing (${missing.length})`],
  ]
    .map(
      ([key, label]) =>
        `<li><a href="/payments?month=${selected}${key === 'missing' ? '&show=missing' : ''}"${key === show ? ' aria-current="page"' : ''}>${label}</a></li>`,
    )
    .join('')}</ul>`;
  const body = rows.length
    ? `<p class="summary"><span>${plural(out.length, 'payment')} out</span><span>${matched.length} with a receipt</span><span${missing.length ? ' class="red"' : ''}>${missing.length} missing</span></p>${filter}${
        missing.length
          ? ''
          : emptyState(
              'Every payment has a receipt.',
              `Or doesn't need one. Next: close ${escape(monthName(selected, false))}.`,
              `<a class="btn primary" href="/?month=${selected}">Close ${escape(monthName(selected, false))}</a>`,
              '<span class="stamp ready">All matched</span>',
            )
      }${shown.length ? `<ol class="pays">${items}</ol>` : ''}${
        offset > 0 || rows.length === 100
          ? `<p>${offset > 0 ? `<a href="/payments?month=${selected}&offset=${Math.max(0, offset - 100)}">Earlier payments</a>` : ''}${offset > 0 && rows.length === 100 ? ' · ' : ''}${rows.length === 100 ? `<a href="/payments?month=${selected}&offset=${offset + 100}">More payments</a>` : ''}</p>`
          : ''
      }<div class="small"><a href="/import">Import another statement</a> · <a href="#transfers">Own-account transfers</a> · <details class="why"><summary>What is a missing receipt?</summary><p>Money out that isn't matched to a receipt yet. It isn't counted in the month's costs.</p></details></div>`
    : emptyState(
        `No bank statement for ${escape(name)} yet.`,
        "Import your bank's CSV export. Each payment out is then checked for a receipt.",
        '<a class="btn primary" href="/import">Import bank statement</a>',
      );
  return page(
    `Payments for ${selected}`,
    `<p role="status" class="banner">${result ? `Import done: ${escape(result)}.` : ''}</p>${others}${body}${await bankParts(env)}`,
    200,
    env,
    {
      nav: 'bank',
      head: pageHead(escape(name), { kicker: 'Bank', aside: monthSwitcher('/payments', selected) }),
    },
  );
}

// ---------- Home: close the month ----------
export async function home(env: Env, selected: string, offset = 0, params = new URLSearchParams()): Promise<Response> {
  const settings = config(env);
  const ever = await env.DB.prepare(
    "SELECT (SELECT count(*) FROM receipts) r, (SELECT count(*) FROM imports WHERE status='complete') i",
  ).first<{ r: number; i: number }>();
  if (!ever?.r && !ever?.i) {
    const address = settings.receiptAddress
      ? `Forward one to <code>${escape(settings.receiptAddress)}</code>, or upload it here.`
      : 'Upload one here. Email intake is set up in <a href="/settings#setup-email">Settings</a>.';
    return page(
      'Home',
      `<div class="slip welcome"><h2>Let's get your first receipt in</h2><p class="hint">${address}</p>${uploadForm('', true)}<p class="small">Then <a href="/import">import a bank statement</a>.</p></div>`,
      200,
      env,
      { nav: 'home', head: pageHead('Welcome', { kicker: today() }) },
    );
  }
  const s: MonthState = await monthState(env, selected);
  const [queue, overdue] = await Promise.all([reviewQueue(env), overdueInvoices(env)]);
  // Only worth the matching work when something is missing.
  const likely = s.missing.length
    ? await (async () => {
        const [receipts, rules] = await Promise.all([
          matchableReceipts(env),
          env.DB.prepare('SELECT * FROM vendor_rules').all<Rule>(),
        ]);
        return s.missing.filter((t) => suggestionsFor(t, receipts, rules.results, settings.tuning).length > 0).length;
      })()
    : 0;
  const unverified = queue.filter((r) => reasonCodes(r.review_reasons_json).includes('sender_unverified')).length;
  const alerts = [
    overdue.length
      ? `<p><strong>${plural(overdue.length, 'invoice is', 'invoices are')} overdue.</strong> <a href="/invoices?month=${selected}&show=overdue">See ${overdue.length === 1 ? 'it' : 'them'}</a></p>`
      : '',
    unverified
      ? `<p><strong>${plural(unverified, 'email', 'emails')} came from an address we couldn't verify.</strong> <a href="/review?reason=sender">Check ${unverified === 1 ? 'it' : 'them'}</a></p>`
      : '',
  ].join('');
  const undated = await env.DB.prepare(
    "SELECT count(*) n FROM receipts WHERE issue_date IS NULL AND duplicate_of IS NULL AND status='needs_review'",
  ).first<number>('n');
  const name = monthName(selected),
    short = monthName(selected, false);
  const empty = s.docs === 0;
  // 4 means nothing is left: the month was sent and hasn't changed since.
  const current = empty ? 1 : !s.done.review ? 1 : !s.done.match ? 2 : s.sent ? 4 : 3;
  const cls = (n: number, done: boolean) => (n === current ? 'step now' : done ? 'step done' : 'step');
  const btn = (n: number) => (n === current ? 'btn primary' : 'btn secondary');
  const step1 = `<li class="${cls(1, s.done.review && !empty)}"${current === 1 ? ' aria-current="step"' : ''}><div class="card${current === 1 ? ' active' : ''}"><div class="ch"><h2>Check receipts</h2>${empty ? '<span class="stamp muted">None yet</span>' : s.flagged.length ? `<span class="stamp needs">${s.flagged.length} need you</span>` : '<span class="stamp ready">Done</span>'}</div>${
    empty
      ? `<p class="hint">None dated ${escape(short)} yet.</p><a class="${btn(1)}" href="/add">Add receipts</a>`
      : s.flagged.length
        ? `<ul class="list">${s.flagged
            .slice(0, 3)
            .map(
              (r) =>
                `<li><a href="/receipts/${r.id}">${escape(receiptName(r))}</a><span class="amt">${amount(r.total_minor, r.currency)}</span><span class="why">${escape(firstFlag(r))}</span></li>`,
            )
            .join('')}</ul><a class="${btn(1)}" href="/review">Review ${plural(s.flagged.length, 'receipt')}</a>`
        : `<p class="hint" style="margin:0">All ${plural(s.rows.length, 'receipt')} checked.</p>`
  }${undated ? `<p class="small">Plus ${plural(undated, 'receipt')} with no date. <a href="/review">Add the date</a> to file ${undated === 1 ? 'it' : 'them'}.</p>` : ''}${
    empty
      ? ''
      : `<p class="small add">${settings.receiptAddress ? `Forward more to <code>${escape(settings.receiptAddress)}</code> or <a href="/add">add them here</a>.` : '<a href="/add">Add more receipts</a>'}</p>`
  }</div></li>`;
  const step2 = `<li class="${cls(2, s.done.match)}"${current === 2 ? ' aria-current="step"' : ''}><div class="card${current === 2 ? ' active' : current < 2 ? ' quiet' : ''}"><div class="ch"><h2>Match payments</h2>${!s.imported ? '<span class="stamp needs">No statement</span>' : s.missing.length ? `<span class="stamp needs">${s.missing.length} missing</span>` : '<span class="stamp ready">Done</span>'}</div>${
    !s.imported
      ? `<p class="hint">No statement covers ${escape(short)} yet.</p><a class="${btn(2)}" href="/import">Import bank statement</a>`
      : `<p class="hint">${s.matched.length} of ${plural(s.out.length, 'payment')} out have a receipt. Imported ${day(s.imported, false)} · <a href="/import">Import a newer one</a></p>${
          s.missing.length
            ? `<ul class="list">${s.missing
                .slice(0, 3)
                .map(
                  (t) =>
                    `<li><a href="/payments?month=${selected}&show=missing">${escape(t.merchant)}</a><span class="amt">${amount(-t.amount_minor, t.currency)}</span><span class="ok">${day(t.booking_date, false)} · no receipt yet</span></li>`,
                )
                .join(
                  '',
                )}</ul>${likely ? `<p class="small">${plural(likely, 'likely match', 'likely matches')} to confirm.</p>` : ''}<a class="${btn(2)}" href="/payments?month=${selected}&show=missing">Find receipts</a>`
            : ''
        }`
  }</div></li>`;
  const rowsByKey = [...s.matrix].filter(([, v]) => v !== 0n);
  const summary = rowsByKey.length
    ? `<div class="slip"><div class="scroll"><table><caption>What you're sending</caption><thead><tr><th scope="col">Part of the business</th><th scope="col">Kind of cost</th><th scope="col" class="n">EUR</th></tr></thead><tbody>${rowsByKey
        .map(([key, v]) => {
          const [product = '', kind = ''] = key.split('\u0000');
          return `<tr><th scope="row">${escape(productLabel(env, product))}</th><td>${escape(kind)}</td><td class="n">${money(v)}</td></tr>`;
        })
        .join(
          '',
        )}</tbody><tfoot><tr><th scope="row" colspan="2">Total</th><td class="n">EUR ${money(s.total)}</td></tr></tfoot></table></div>
        <p class="small" style="margin:12px 0 0">From your bank or checked ${money(s.total - s.unchecked)} · Not yet checked ${money(s.unchecked)} · Converted at the ECB rate ${money(s.estimated)}${s.noEur ? ` · ${plural(s.noEur, 'receipt has', 'receipts have')} no euro amount yet and ${s.noEur === 1 ? 'is' : 'are'} not in the total` : ''}.</p></div>`
    : `<p class="lede">No costs recorded for ${escape(short)}.${s.noEur ? ` ${plural(s.noEur, 'receipt has', 'receipts have')} no euro amount yet.` : ''}</p>`;
  const step3 = await sendStep(env, s, selected, current, params, summary);
  const moneyIn = s.sales.length
    ? `<section class="part" style="margin-top:40px" aria-labelledby="in-h"><h2 id="in-h">Money in: invoices dated ${escape(short)}</h2><p class="summary"><span>Invoiced EUR ${money(s.invoiced)}</span><span>${plural(s.unpaid.length, 'unpaid', 'unpaid')}</span></p><div class="scroll"><table class="stack"><caption class="vh">Invoices dated ${escape(name)}</caption><thead><tr><th scope="col">Client</th><th scope="col">Date</th><th scope="col">Invoice</th><th scope="col" class="n">Total</th><th scope="col">Status</th></tr></thead><tbody>${s.sales
        .map(
          (r) =>
            `<tr><td class="lead"><a href="/receipts/${r.id}">${escape(r.client ?? 'Client unknown')}</a></td><td data-label="Date">${escape(day(r.issue_date))}</td><td data-label="Invoice">${escape(r.invoice_number ?? '')}</td><td class="n" data-label="Total">${amount(r.total_minor, r.currency)}</td><td data-label="Status">${salesStamp(r, config(env).tuning.paymentTermsDays)}</td></tr>`,
        )
        .join(
          '',
        )}</tbody></table></div><p class="small">Unpaid ones don't hold the month back. <a href="/invoices?month=${selected}">All invoices</a></p></section>`
    : '';
  const list = s.rows.length
    ? `<section class="part" style="margin-top:40px" aria-labelledby="all-h"><h2 id="all-h">Receipts dated ${escape(short)}</h2>${receiptTable(env, s.rows.slice(offset, offset + 100), `Receipts dated ${name}`)}${
        offset > 0 || s.rows.length > offset + 100
          ? `<p>${offset > 0 ? `<a href="/?month=${selected}&offset=${Math.max(0, offset - 100)}">Previous</a>` : ''} ${s.rows.length > offset + 100 ? `<a href="/?month=${selected}&offset=${offset + 100}">Next</a>` : ''}</p>`
          : ''
      }</section>`
    : '';
  return page(
    'Home',
    `${alerts ? `<div class="alert" role="note">${alerts}</div>` : ''}<ol class="stepper" aria-label="Steps to close ${escape(name)}">${step1}${step2}${step3}</ol>${moneyIn}${list}`,
    200,
    env,
    {
      nav: 'home',
      head: pageHead(escape(name), { kicker: 'Close the month', aside: monthSwitcher('/', selected) }),
    },
  );
}

function size(bytes: number): string {
  return bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
}
function hidden(name: string, value: string | number): string {
  return `<input type="hidden" name="${name}" value="${escape(value)}">`;
}
function optionFields(selected: string, o: Partial<PackageOptions>): string {
  return `${hidden('month', selected)}${o.anyway ? hidden('anyway', 1) : ''}${o.undated ? hidden('undated', 1) : ''}${o.changes ? hidden('changes', 1) : ''}`;
}
function joinAnd(parts: string[]): string {
  return parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

// Step 3: the month package. One primary button at most, and only when this
// is the current step; red only when something needs the owner.
async function sendStep(
  env: Env,
  s: MonthState,
  selected: string,
  current: number,
  params: URLSearchParams,
  summary: string,
): Promise<string> {
  const settings = config(env),
    label = escape(settings.accountantLabel),
    short = escape(monthName(selected, false));
  const empty = s.docs === 0,
    ready = s.done.review && s.done.match && !empty,
    changed = !!s.send.last && s.send.changed && !empty;
  const sentOn = s.send.last ? day(s.send.last.sent_at, false) : '';
  const kind = current === 3 ? 'primary' : 'secondary';
  const defaults: PackageOptions = { anyway: !ready, undated: false, changes: changed };
  // While an upload runs, the URL carries its options so "Continue" repeats them.
  const chosen = params.has('upload') ? options(params) : defaults;
  const plan = await planPackage(
    env,
    selected,
    { ...chosen, changes: false },
    { sizes: s.docs <= 100, rows: [...s.rows, ...s.sales] },
  );
  const conn: Connection | null = settings.oneDrive ? await connection(env) : null;
  const drive = conn?.folder_item_id ? conn : null;
  const upload = drive && !empty ? await progress(env, drive, selected, chosen) : null;
  const folder = escape(drive?.folder_name ?? '');
  const csv = `<a class="btn secondary" href="/export.csv?month=${selected}">Spreadsheet only (CSV)</a>`;
  const zip = (o: Partial<PackageOptions>, text: string, cls = 'secondary') =>
    `<a class="btn ${cls}" href="/month/package.zip?${query(selected, o)}">${text}</a>`;
  const uploadForm = (o: Partial<PackageOptions>, text: string, cls = 'secondary') =>
    `<form action="/month/onedrive-upload" method="post">${optionFields(selected, o)}<button class="btn ${cls}">${text}</button></form>`;

  let stamp: string, body: string;
  const tooBig = plan.files.length > MAX_PACKAGE_FILES;
  if (empty) {
    stamp = '<span class="stamp muted">Nothing yet</span>';
    body = `<p class="hint">The package fills itself as receipts arrive.</p><div class="btns">${csv}</div>`;
  } else if (tooBig) {
    stamp = '<span class="stamp needs">Too big</span>';
    body = `<div class="alert" role="note"><p><strong>This month is too big for one package.</strong> It has ${plan.files.length} files and one package holds up to ${MAX_PACKAGE_FILES}. Download the spreadsheet and fetch the originals from the app.</p></div><div class="btns">${csv}</div>`;
  } else {
    const sized = plan.files.length > 0 && plan.files.every((f) => f.size !== null);
    const bytes = plan.files.reduce((n, f) => n + (f.size ?? 0), 0);
    const pages = plan.files.filter((f) => f.receipt.media_type.startsWith('text/')).length;
    const shown = plan.files.slice(0, 5);
    const manifest = plan.files.length
      ? `<div class="pkg"><div><ul class="manifest" aria-label="Files in the package"><li>${escape(plan.folder)}/</li><li>00-index-${selected}.csv</li>${plan.files.some((f) => f.receipt.kind === 'sales') ? `<li>00-sales-index-${selected}.csv</li>` : ''}${s.missing.length ? `<li>00-missing-receipts-${selected}.csv</li>` : ''}${shown.map((f) => `<li>${escape(f.path)}</li>`).join('')}${plan.files.length > shown.length ? `<li class="more">… ${plan.files.length - shown.length} more</li>` : ''}</ul><p class="small">${plural(plan.files.length, 'file')}${sized ? ` · about ${size(bytes)}` : ''}${pages ? ` · ${plural(pages, 'email')} saved as a web page` : ''}.</p></div><dl class="rows"><dt>Receipts</dt><dd>${s.rows.length}</dd>${s.sales.length ? `<dt>Invoices you sent</dt><dd>${s.sales.length}</dd>` : ''}<dt>Payments without a receipt</dt><dd${s.missing.length ? ' class="red"' : ''}>${s.missing.length}</dd><dt>Last sent</dt><dd>${sentOn ? escape(sentOn) : 'Not yet'}</dd></dl></div>`
      : '';
    const reasons = [
      s.flagged.length || s.reading.length
        ? `${plural(s.flagged.length + s.reading.length, 'receipt still needs', 'receipts still need')} a check`
        : '',
      !s.imported ? 'no bank statement is imported' : '',
      s.missing.length ? `${plural(s.missing.length, 'payment has', 'payments have')} no receipt` : '',
    ].filter(Boolean);
    const unchecked = plan.unchecked;
    const anywayText = `Download anyway${unchecked ? ` (includes ${unchecked} unchecked)` : ''}`;
    let note: string, buttons: string;
    if (changed) {
      const what = [
        s.send.added ? `${s.send.added} added` : '',
        s.send.corrected ? `${s.send.corrected} corrected` : '',
        s.send.removed ? `${s.send.removed} removed` : '',
      ].filter(Boolean);
      stamp = '<span class="stamp needs">Changed</span>';
      note = `<div class="alert" role="note"><p><strong>Changed since you sent it on ${escape(sentOn)}${what.length ? `: ${joinAnd(what)}` : ''}.</strong> Send ${label} the new ones.${reasons.length ? ` ${joinAnd(reasons).replace(/^./, (c) => c.toUpperCase())}; unchecked ones go in a check-these folder.` : ''}</p></div>`;
      const n = plan.changedFiles;
      buttons = n
        ? drive
          ? `${uploadForm({ ...defaults, changes: true }, `Upload ${plural(n, 'changed file')} to ${folder}`, kind)}${zip({ ...defaults, changes: true }, `Download only what changed (${plural(n, 'file')})`)}`
          : `${zip({ ...defaults, changes: true }, `Download only what changed (${plural(n, 'file')})`, kind)}${zip({ anyway: !ready }, 'Download everything again')}`
        : zip({ anyway: !ready }, 'Download everything again');
    } else if (s.sent) {
      stamp = `<span class="stamp matched">Sent ${escape(sentOn)}</span>`;
      note = `<p class="hint">You sent ${short} to ${label} on ${escape(day(s.send.last!.sent_at))}${s.send.last!.method === 'onedrive' ? ' by uploading it to OneDrive' : ''}. Nothing has changed since. <a href="/?month=${shiftMonth(selected, 1)}">On to ${escape(monthName(shiftMonth(selected, 1), false))} ›</a></p>`;
      buttons = zip({ anyway: !ready }, `Download ${short} ZIP again`);
    } else if (ready) {
      stamp = '<span class="stamp ready">Ready</span>';
      note = `<p class="hint">Originals named by date and seller, plus a spreadsheet. Unzip it and send the folder to ${label}.</p>`;
      const download = `Download ${short} ZIP${sized ? ` (${size(bytes)})` : ''}`;
      if (upload && upload.pending.length) {
        const done = upload.plan.files.length - upload.pending.length;
        buttons = `${uploadForm(chosen, done ? `Continue uploading (${done} of ${upload.plan.files.length} done)` : `Upload ${plural(upload.pending.length, 'file')} to ${folder}`, kind)}${zip(chosen, download)}`;
      } else buttons = zip(chosen, download, kind);
    } else {
      stamp = '<span class="stamp muted">Not ready</span>';
      note = `<div class="alert" role="note"><p><strong>${joinAnd(reasons).replace(/^./, (c) => c.toUpperCase())}.</strong> ${unchecked ? 'Download anyway puts unchecked ones in a check-these folder.' : 'You can still download what is there.'}</p></div>`;
      const undated = plan.undated
        ? `<label class="check"><input type="checkbox" name="undated" value="1">Also include ${plural(plan.undated, 'receipt')} with no date</label>`
        : '';
      buttons = `<form action="/month/package.zip" method="get">${hidden('month', selected)}${hidden('anyway', 1)}${undated}<button class="btn secondary">${anywayText}</button></form>${
        upload && upload.pending.length ? uploadForm({ anyway: true }, `Upload anyway to ${folder}`) : ''
      }`;
    }
    const status =
      params.get('upload') === 'done'
        ? `<p class="banner" role="status">Everything is in ${folder}. ${short} is marked as sent.</p>`
        : params.get('upload') === 'more' && upload
          ? `<p class="banner" role="status">${upload.plan.files.length - upload.pending.length} of ${plural(upload.plan.files.length, 'file')} uploaded to ${folder}.${/^\d+$/.test(params.get('wait') ?? '') ? ` Microsoft asked us to wait; continue in ${Number(params.get('wait'))} seconds.` : ' Continue to upload the rest.'}</p>`
          : params.get('sent') === '1' && s.sent
            ? `<p class="banner" role="status">Marked ${short} as sent.</p>`
            : '';
    const destination = drive
      ? `<p class="small">Uploads go to <a href="${escape(drive.folder_web_url ?? '')}">${folder}</a>, in a folder called <code>${escape(plan.folder)}</code>. <a href="/settings#onedrive">Change</a></p>`
      : '';
    const hint = settings.sendHint ? `<p class="small">${escape(settings.sendHint)}</p>` : '';
    const how = s.sent
      ? ''
      : `<details${ready && !changed ? ' open' : ''}><summary>Then, send it to ${label}</summary><div class="body"><ol class="how"><li>Unzip it (Mac: double-click; Windows: <b>Extract all</b>). You get <code>${escape(plan.folder)}</code>.</li><li>Send that folder to ${label}. Shared folders need the folder itself (<b>Upload &gt; Folder</b>), not the ZIP.</li><li>Press the button below, so this page can flag later changes.</li></ol><form action="/month/sent" method="post">${hidden('month', selected)}${hidden('receipts_hash', s.send.hash)}<button class="btn secondary">I've sent ${short} to ${label}</button></form></div></details>`;
    body = `${status}<div class="total" style="margin:4px 0 10px"><span>Spent</span><span>EUR ${money(s.total)}</span></div>${note}${manifest}<div class="btns">${buttons}${csv}</div>${destination}${hint}${how}<details><summary>Costs by part of the business</summary><div class="body">${summary}</div></details>`;
  }
  return `<li id="send" class="${current === 3 ? 'step now' : current === 4 ? 'step done' : 'step'}"${current === 3 ? ' aria-current="step"' : ''}><div class="card${current === 3 ? ' active' : current < 3 ? ' quiet' : ''}"><div class="ch"><h2>Send to ${label}</h2>${stamp}</div>${body}<p class="small">${escape(EXPORT_NOTICE)}</p></div></li>`;
}

// The fields of a vendor rule, for a new rule or an edit. Names match /rules.
function ruleFields(
  env: Env,
  rule: Partial<
    Pick<Rule, 'vendor_contains' | 'context_contains' | 'bank_alias' | 'product' | 'expense_type' | 'priority'>
  > = {},
): string {
  return `<div class="fields">${input('vendor_contains', rule.vendor_contains ?? '', 'text', "When the seller's name contains", { attrs: ' required maxlength="200"' })}${productSelect(env, 'product', rule.product ?? config(env).defaultProduct, 'Part of the business')}${select('expense_type', EXPENSE_TYPES, rule.expense_type ?? EXPENSE_TYPES[0], 'Kind of cost')}${input('context_contains', rule.context_contains ?? '', 'text', 'Only if the receipt also mentions', { hint: 'Optional', attrs: ' maxlength="200"' })}${input('bank_alias', rule.bank_alias ?? '', 'text', 'Name on your bank statement', { hint: 'Optional', attrs: ' maxlength="200"' })}${input('priority', rule.priority ?? 0, 'number', 'Priority', { hint: 'Higher wins when rules overlap' })}</div>`;
}

// ---------- Bank: statements imported and own-account transfers ----------
// Shown under the month's payments once any statement is in.
async function bankParts(env: Env): Promise<string> {
  const history = (
    await env.DB.prepare(
      "SELECT i.*,a.label AS account_name,a.bank_name FROM imports i JOIN accounts a ON a.id=i.account_key WHERE i.status='complete' ORDER BY i.imported_at DESC,i.id LIMIT 20",
    ).all<{ account_name: string; bank_name: string; imported_at: string; row_count: number }>()
  ).results;
  if (!history.length) return '';
  // Unlinked rows that can still form an own-account transfer pair.
  const open = (
    await env.DB.prepare(
      "SELECT t.*,a.label AS account_name,a.bank_name FROM bank_transactions t JOIN imports i ON i.id=t.import_id JOIN accounts a ON a.id=t.account_key WHERE i.status='complete' AND t.receipt_id IS NULL AND t.receipt_required=1 ORDER BY t.booking_date DESC,t.id LIMIT 300",
    ).all<Payment>()
  ).results;
  const option = (t: Payment) =>
    `<option value="${t.id}">${escape(day(t.booking_date))} · ${escape(t.account_name)} · ${escape(t.merchant)} · ${amount(t.amount_minor, t.currency)}</option>`;
  const pick = (name: string, label: string, rows: Payment[]) =>
    `<label>${label}<select name="${name}"><option value="">Choose a payment</option>${rows.map(option).join('')}</select></label>`;
  const transfers = await listTransfers(env.DB);
  const importRows = (rows: typeof history) =>
    `<div class="scroll"><table><caption class="vh">Recent imports</caption><thead><tr><th scope="col">Imported</th><th scope="col">Account</th><th scope="col" class="n">Rows</th></tr></thead><tbody>${rows.map((i) => `<tr><td>${escape(day(i.imported_at))}</td><td>${escape(i.account_name)} · ${escape(i.bank_name)}</td><td class="n">${i.row_count}</td></tr>`).join('')}</tbody></table></div>`;
  const importsPart = sect(
    'imports',
    'Statements imported',
    `${importRows(history.slice(0, 3))}${history.length > 3 ? `<details class="add"><summary>Older imports (${history.length - 3})</summary>${importRows(history.slice(3))}</details>` : ''}`,
    '<a class="btn secondary" href="/import">Import bank statement</a>',
  );
  const transfersPart = sect(
    'transfers',
    'Transfers',
    `<p class="hint">Money moved between your own accounts needs no receipt. Pair both sides here.</p>${
      transfers.length
        ? `<ul class="plain card rowlist">${transfers.map((p) => `<li class="srow"><div class="sl"><span class="flabel">${escape(p.debit_account_name)} → ${escape(p.credit_account_name)}</span></div><div class="sc row"><span class="hint">${escape(p.reason)}</span><form action="/transfers/${p.debit_id}/undo" method="post"><button class="linkbtn">Undo transfer</button></form></div></li>`).join('')}</ul>`
        : '<p class="hint">No transfers paired yet.</p>'
    }<details class="add"${transfers.length ? '' : ' open'}><summary>Pair a transfer</summary><div class="body"><form action="/transfers" method="post"><div class="fields">${pick(
      'debit_id',
      'Money left this account',
      open.filter((t) => t.amount_minor < 0),
    )}${pick(
      'credit_id',
      'and arrived in this one',
      open.filter((t) => t.amount_minor > 0),
    )}${input('reason', '', 'text', 'Note', { hint: 'For example Savings top-up', wide: true })}</div><p class="hint">Different accounts, same amount and currency, both unmatched.</p><button class="btn secondary">Confirm transfer pair</button></form></div></details>`,
  );
  return `<div class="bank-more">${transfersPart}${importsPart}</div>`;
}

// ---------- Settings ----------
// One settings section: a heading row (with an optional action) over its body.
function sect(id: string, title: string, body: string, action = ''): string {
  return `<section class="sect" id="${id}" aria-labelledby="${id}-h"><div class="sh"><h2 id="${id}-h">${title}</h2>${action}</div>${body}</section>`;
}
// Settings > OneDrive. Nothing at all unless MS_CLIENT_ID is set; a short
// note when a secret is missing; otherwise connect, folder and disconnect.
async function oneDrivePart(env: Env, params: URLSearchParams, origin: string): Promise<string> {
  const settings = config(env);
  const docs = settings.sourceRepository
    ? `<a href="${escape(settings.sourceRepository)}/blob/main/docs/ENVIRONMENT.md#onedrive-upload-optional">docs/ENVIRONMENT.md</a>`
    : '<code>docs/ENVIRONMENT.md</code>';
  if (!settings.oneDrive)
    return settings.oneDriveIncomplete
      ? sect(
          'onedrive',
          'OneDrive',
          `<p class="hint">Not set up. <code>MS_CLIENT_ID</code> is set, but <code>MS_CLIENT_SECRET</code> or <code>ONEDRIVE_TOKEN_KEY</code> is missing. See ${docs}.</p>`,
        )
      : '';
  const conn = await connection(env);
  const done: Record<string, string> = {
    connected: 'Microsoft account connected.',
    folder: 'Destination folder saved.',
    disconnected: 'Microsoft account disconnected. Its sign-in was deleted from this app.',
  };
  const banner = `<p class="banner" role="status">${escape(done[params.get('onedrive') ?? ''] ?? '')}</p>`;
  const tech = `<details class="tech"><summary>Redirect URI for Microsoft Entra</summary><div class="body"><p class="hint">Add it under <b>Authentication &gt; Web &gt; Redirect URIs</b>. Steps: ${docs}.</p><pre tabindex="0">${escape(redirectUri(origin, ''))}</pre></div></details>`;
  if (!conn)
    return sect(
      'onedrive',
      'OneDrive',
      `${banner}<div class="card"><p class="hint">Upload each month to a OneDrive or SharePoint folder, such as one ${escape(settings.accountantLabel)} shared. Nothing goes to Microsoft until you connect.</p><p class="cta"><a class="btn secondary" href="/settings/onedrive/connect">Connect Microsoft account</a></p></div>${tech}`,
    );
  const folderForm = `<form action="/settings/onedrive/folder" method="post"><div class="fields">${input('folder_link', '', 'url', 'Link to the shared folder', { hint: 'From OneDrive: Share > Copy link', attrs: ' required autocomplete="off" inputmode="url"', wide: true })}${input('folder_name', '', 'text', "Folder's name", { hint: 'Optional, for links from another organisation', attrs: ' autocomplete="off"' })}</div><button class="btn secondary">${conn.folder_item_id ? 'Use this folder instead' : 'Use this folder'}</button></form>`;
  const folder = conn.folder_item_id
    ? `<a href="${escape(conn.folder_web_url ?? '')}"><strong>${escape(conn.folder_name)}</strong></a> <span class="hint">· one folder per month</span>`
    : '<span class="warning">Not chosen yet</span>';
  return sect(
    'onedrive',
    'OneDrive',
    `${banner}<div class="card"><dl class="kv"><div><dt>Account</dt><dd>Connected as <strong>${escape(conn.account_name)}</strong>${conn.account_email ? ` (${escape(conn.account_email)})` : ''}</dd></div><div><dt>Folder</dt><dd>${folder}</dd></div></dl>${
      conn.folder_item_id
        ? `<details class="why"><summary>Choose another folder</summary>${folderForm}</details>`
        : `<p class="hint">Paste the link to the folder. You need edit rights on it.</p>${folderForm}`
    }<form action="/settings/onedrive/disconnect" method="post" class="cta"><button class="linkbtn">Disconnect Microsoft account</button></form></div>${tech}`,
  );
}

// Settings > Senders: who is read automatically and who is ignored.
async function sendersPart(env: Env, params: URLSearchParams): Promise<string> {
  const allowed = [...config(env).allowedSenders].sort();
  let defaults: ReadonlySet<string> = new Set();
  try {
    defaults = parseSenders(deployValue(env, 'ALLOWED_SENDER_EMAILS'), 1000);
  } catch {
    // An invalid deploy value is reported by the Email section.
  }
  const ignored = await ignoredSenders(env);
  const row = (address: string, meta: string, action: string, button: string) =>
    `<li class="srow"><div class="sl"><span class="flabel">${escape(address)}</span>${meta ? `<span class="meta">${meta}</span>` : ''}</div><form class="sc" action="${action}" method="post"><input type="hidden" name="address" value="${escape(address)}"><input type="hidden" name="back" value="settings"><button class="linkbtn">${button}<span class="vh"> ${escape(address)}</span></button></form></li>`;
  const approved = allowed.length
    ? `<ul class="plain card rowlist">${allowed.map((a) => row(a, defaults.has(a) ? 'Default' : '', '/senders/remove', 'Remove')).join('')}</ul>`
    : '<p class="warning">No approved senders, so all mail waits in Review.</p>';
  const ignoredList = ignored.length
    ? `<h3>Ignored</h3><p class="hint">Mail from these addresses is not kept.</p><ul class="plain card rowlist">${ignored.map((i) => row(i.address, `Since ${escape(day(i.added_at))}`, '/senders/unignore', 'Stop ignoring')).join('')}</ul>`
    : '';
  const full = allowed.length >= MAX_ALLOWED_SENDERS;
  const add = `<details class="add"${allowed.length ? '' : ' open'}><summary>Add a sender</summary><div class="body"><form action="/senders/approve" method="post"><input type="hidden" name="back" value="settings"><div class="fields">${input('address', '', 'email', 'Email address', { hint: 'Exact address, like billing@example.com', attrs: ' required maxlength="254" autocomplete="off"', wide: true })}</div><button class="btn secondary"${full ? ' disabled' : ''}>Add sender</button>${full ? `<p class="warning">You have ${MAX_ALLOWED_SENDERS} approved senders, the most the app keeps. Remove one first.</p>` : ''}</form></div></details>`;
  return sect(
    'senders',
    'Senders',
    `${senderBanner(params)}<p class="hint">Mail from approved senders is read automatically. Mail from anyone else waits in Review as Unknown sender. ${allowed.length} of ${MAX_ALLOWED_SENDERS} used.</p>${approved}${add}${ignoredList}`,
  );
}

export async function settingsPage(env: Env, params = new URLSearchParams(), origin = ''): Promise<Response> {
  const settings = config(env);
  const oneDrive = await oneDrivePart(env, params, origin);
  const setup = await setupParts(env, params);
  const [accounts, rules] = await Promise.all([
    listAccounts(env.DB),
    env.DB.prepare('SELECT * FROM vendor_rules ORDER BY priority DESC,id LIMIT 200').all<Rule>(),
  ]);
  const sections = [
    ['setup-business', 'Business'],
    ['setup-email', 'Email'],
    ['senders', 'Senders'],
    ['accounts', 'Bank accounts'],
    ['rules', 'Vendor rules'],
    ['setup-accountant', 'Export'],
    ...(oneDrive ? [['onedrive', 'OneDrive']] : []),
    ['advanced', 'Advanced'],
  ];
  const mail = settings.receiptAddress
    ? `<p class="hint">Forward receipts to <code>${escape(settings.receiptAddress)}</code>${settings.invoicesAddress ? `, invoices you send to <code>${escape(settings.invoicesAddress)}</code>` : ''}. Approved senders are read automatically, others wait in Review. See <a href="#senders">Senders</a>.</p>`
    : '<p class="hint">Email intake is off until you set a receipt address. Upload from Home meanwhile.</p>';
  const accountsPart = sect(
    'accounts',
    'Bank accounts',
    `${
      accounts.length
        ? `<ul class="plain card rowlist">${accounts
            .map(
              (a, i) =>
                `<li class="srow"><div class="sl"><span class="flabel">${escape(a.label)}</span><span class="meta">${escape(a.bank_name) || 'No bank name'} · ${escape(a.default_currency)} · ID <code>${escape(a.id)}</code></span></div><form class="sc inline-edit" action="/accounts/${encodeURIComponent(a.id)}" method="post"><label class="vh" for="acct-${i}">New name for ${escape(a.label)}</label><input id="acct-${i}" name="label" value="${escape(a.label)}"><button class="btn secondary">Rename<span class="vh"> ${escape(a.label)}</span></button></form></li>`,
            )
            .join('')}</ul>`
        : '<p class="hint">No bank accounts yet. Importing a statement creates one.</p>'
    }<details class="add"${accounts.length ? '' : ' open'}><summary>Add a bank account</summary><div class="body"><form action="/accounts" method="post"><div class="fields">${input('label', '', 'text', 'Name', { hint: 'For example Main account' })}${input('bank_name', '', 'text', 'Bank')}${select('default_currency', Object.keys(EXPONENTS), settings.defaultCurrency, 'Currency')}</div><button class="btn secondary">Create account</button></form></div></details><p class="small moved" id="imports">Imported statements moved to <a href="/payments#imports">Bank</a>.</p><p class="small moved" id="transfers">Own-account transfers moved to <a href="/payments#transfers">Bank</a>.</p>`,
    '<a class="linkbtn" href="/payments">Open Bank</a>',
  );
  const rulesBanner = { saved: 'Rule saved.', deleted: 'Rule deleted.' }[params.get('rules') ?? ''];
  const rulesPart = sect(
    'rules',
    'Vendor rules',
    `${rulesBanner ? `<p class="banner" role="status">${rulesBanner}</p>` : ''}<p class="hint">Receipts whose seller matches a rule are filed this way automatically. Higher priority wins.</p>${
      rules.results.length
        ? `<ul class="plain card rowlist">${rules.results
            .map(
              (rule) =>
                `<li class="srow"><div class="sl"><span class="flabel"><code>${escape(rule.vendor_contains)}</code></span><span class="meta">${escape(productLabel(env, rule.product))} · ${escape(rule.expense_type)} · Priority ${rule.priority}${rule.context_contains ? ` · text mentions <code>${escape(rule.context_contains)}</code>` : ''}${rule.bank_alias ? ` · bank name <code>${escape(rule.bank_alias)}</code>` : ''}</span></div><details class="sc"><summary>Edit<span class="vh"> rule for ${escape(rule.vendor_contains)}</span></summary><div class="body"><form action="/rules/${rule.id}" method="post">${ruleFields(env, rule)}<div class="btns"><button class="btn secondary">Save rule</button><button class="linkbtn" formaction="/rules/${rule.id}/delete">Delete rule</button></div></form></div></details></li>`,
            )
            .join('')}</ul>`
        : '<p class="hint">No rules yet. Add one here or from any receipt with “Always file … as”.</p>'
    }<details class="add"${rules.results.length ? '' : ' open'}><summary>Add a rule</summary><div class="body"><form action="/rules" method="post">${ruleFields(env)}<button class="btn secondary">Add rule</button></form></div></details>`,
  );
  // Highlights the nav link of the section in the URL fragment (CSS only).
  const style = `${sections.map(([id]) => `.settings:has(#${id}:target,#${id} :target) .snav a[href="#${id}"]`).join(',')}{color:var(--ink);border-color:var(--ink)}`;
  return page(
    'Settings',
    `<div class="settings"><nav class="snav" aria-label="Settings sections"><ul>${sections.map(([id, label]) => `<li><a href="#${id}">${label}</a></li>`).join('')}</ul><ul class="key" aria-label="Where values come from"><li><span class="src app">App</span>set here</li><li><span class="src deploy">Deploy</span>Worker variable</li><li><span class="src default">Default</span>built in</li></ul></nav><div class="sbody">${sect('setup-business', 'Business', setup.business)}${sect('setup-email', 'Email', mail + setup.email)}${await sendersPart(env, params)}${accountsPart}${rulesPart}${sect('setup-accountant', 'Export', setup.accountant)}${oneDrive}${setup.advanced}</div></div>`,
    200,
    env,
    { nav: 'settings', style, head: pageHead('Settings', { aside: signOutLink(env) }) },
  );
}

// ---------- Import, step 1 ----------
export async function importPage(env: Env): Promise<Response> {
  return page('Import a bank statement', `${wizard(1)}<div class="card">${await importForm(env)}</div>`, 200, env, {
    nav: 'bank',
    head: pageHead('Import a bank statement', {
      kicker: 'Bank',
      sub: "Your bank's CSV export. Checked before anything is saved.",
    }),
  });
}
