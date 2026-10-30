// Server-rendered screens. Every form keeps the action, field names and values
// the POST handlers in src/index.ts expect; only labels and layout live here.
import { EXPENSE_TYPES, EXPONENTS, money, object, type Receipt, type Rule } from './domain';
import {
  creditFit,
  eligible,
  eurValue,
  monthEurValues,
  openSales,
  BANK_UPTO,
  bankPath,
  bankUpto,
  viewCounts,
  viewRows,
  type BankRow,
  type BankView,
  type EurValue,
} from './banking';
import { importForm } from './imports';
import { listAccounts, listTransfers } from './accounts';
import type { Env } from './env';
import { config, hasParts, MAX_ALLOWED_SENDERS } from './config';
import { FIELD, type SettingKey } from './settings';
import { saveBar, setupParts } from './setup';
import { setupChecklist, setupSteps } from './checklist';
import { helpBody } from './help';
import { droppedMail, hasRecentDropped, ignoredSenders, reasonAllows, reasonWords } from './inbound';
import { readableText } from './receipts';
import { discardControl, restoreForm } from './discard';
import {
  BULK_CAP,
  bulkBar,
  bulkCheck,
  bulkTools,
  KIND_LOSS,
  PAYMENT_ACTIONS,
  SENDER_ACTIONS,
  type BulkAction,
  type BulkList,
} from './bulk';
import { EXEMPT_LABELS } from './exempt';
import { feedback } from './events';
import { arrivalMonth } from './arrival';
import { DISCARD_REASONS } from './domain';
import { aboutBody } from './about';
import {
  MAX_PACKAGE_FILES,
  options,
  planPackage,
  query,
  sendStatus,
  undatedDocuments,
  type PackageOptions,
} from './package';
import { overdueInvoices, paymentBox, salesRows, salesStamp, salesStatus } from './invoices';
import { TREATMENT_LABELS } from './sales';
import { VAT_TREATMENTS } from './domain';
import { connection, progress, redirectUri, type Connection } from './onedrive';
import {
  LIST_DEFS,
  listFields,
  listParams,
  listUrl,
  nextOpen,
  openPlace,
  openRows,
  RECEIPTS_TODO,
  receiptFields,
  receiptState,
  receiptUrl,
  standing,
  type ListState,
  type Params,
} from './worklist';
import {
  bodyOf,
  flagCards,
  isRequired,
  isReady,
  needsReview,
  needsReviewSql,
  optionalReasons,
  reasonCodes,
  type Flag,
  type FlagField,
} from './flags';
import {
  amount,
  day,
  escape,
  EXPORT_LINE,
  input,
  MISSING_PAYMENTS,
  monthName,
  monthHead,
  monthRows,
  more,
  page,
  pageHead,
  emptyState,
  plural,
  productLabel,
  productOptions,
  productSelect,
  select,
  shiftMonth,
  signOutLink,
  stamp,
  stepWord,
  tag,
  viewSwitch,
  uploadForm,
  ariaFor,
  chosenReceipt,
  errorId,
  VIEW_TRANSITION_CSS,
  errorLine,
  fieldId,
  matchError,
} from './ui';
import { failureFor, kept, requestState } from './request';
import { row, rowList } from './row';
import { STATUS } from './status';
import { ACTIONS, button, buttonLink, buttonSummary, statusMark, type ActionKey, type Tone } from './actions';
import {
  likelyPairs,
  matchableReceipts,
  matchAllLabel,
  pairFacts,
  pickLabels,
  pickMatches,
  receiptName,
  whyLikely,
  type Cell,
} from './match';

type Payment = BankRow;
const INLINE_IMAGES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];
export function previewable(r: Pick<Receipt, 'media_type'>): boolean {
  return INLINE_IMAGES.includes(r.media_type);
}

export function reviewQueue(env: Env, state: ListState = RECEIPTS_TODO): Promise<Receipt[]> {
  return openRows<Receipt>(env, LIST_DEFS.receipts!, state, BULK_CAP);
}
function receiptOption(r: Receipt, selected = false): string {
  return `<option value="${r.id}"${selected ? ' selected' : ''}>${escape(receiptName(r))} · ${escape(day(r.issue_date)) || 'no date'} · ${amount(r.total_minor, r.currency)}</option>`;
}

type MonthState = Awaited<ReturnType<typeof monthState>>;
async function monthState(env: Env, selected: string) {
  // Everything below depends only on the month, so it loads at once. The EUR
  // values and the send status follow the documents as soon as they arrive.
  const rowsQuery = monthRows(env, selected);
  // Sales invoices issued in the month. One that needs a look blocks the
  // month like a receipt does; an unpaid one does not.
  const salesQuery = salesRows(env, 'substr(r.issue_date,1,7)=?', selected);
  const documents = Promise.all([rowsQuery, salesQuery]).then(([r, s]) => [...r, ...s]);
  const [rows, sales, all, send, payments, imported, undated] = await Promise.all([
    rowsQuery,
    salesQuery,
    Promise.all([documents, monthEurValues(env, selected)]).then(([d, value]) => value(d)),
    sendStatus(env, selected, documents),
    env.DB.prepare(
      "SELECT t.*,a.label AS account_name,a.bank_name FROM bank_transactions t JOIN imports i ON i.id=t.import_id JOIN accounts a ON a.id=t.account_key WHERE i.status='complete' AND substr(t.booking_date,1,7)=? ORDER BY t.booking_date,t.account_key,t.id",
    )
      .bind(selected)
      .all<Payment>()
      .then((r) => r.results),
    env.DB.prepare(
      "SELECT max(i.imported_at) d FROM imports i WHERE i.status='complete' AND EXISTS (SELECT 1 FROM bank_transactions t WHERE t.import_id=i.id AND substr(t.booking_date,1,7)=?)",
    )
      .bind(selected)
      .first<string | null>('d'),
    // Undated receipts belong to no month yet but wait in the same Review, so Check is not done
    // while any is left (a month already sent stays closed).
    env.DB.prepare(
      `SELECT count(*) n FROM receipts WHERE issue_date IS NULL AND duplicate_of IS NULL AND discarded_at IS NULL AND ${needsReviewSql()}`,
    )
      .first<number>('n')
      .then((n) => n ?? 0),
  ]);
  const eurs: EurValue[] = all.slice(0, rows.length);
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
    if (!isReady(r)) unchecked += BigInt(eur.minor);
    const key = r.product + '\u0000' + r.expense_type;
    matrix.set(key, (matrix.get(key) ?? 0n) + BigInt(eur.minor));
  });
  const out = payments.filter((t) => t.amount_minor < 0);
  const missing = out.filter((t) => t.receipt_required && !t.receipt_id);
  let invoiced = 0n;
  for (const eur of all.slice(rows.length)) invoiced += BigInt(eur.minor ?? 0);
  const isReading = (r: Receipt) => r.status === 'pending' || r.status === 'processing';
  const flagged = [...rows, ...sales].filter(needsReview);
  const reading = [...rows, ...sales].filter(isReading);
  const docs = rows.length + sales.length;
  const sent = !!send.last && !send.changed && docs > 0;
  return {
    send,
    // Marked as sent, and nothing added or corrected since.
    sent,
    docs,
    undated,
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
    ready: rows.filter((r) => !needsReview(r) && !isReading(r)).length,
    out,
    missing,
    matched: out.filter((t) => t.receipt_id),
    imported,
    done: { review: flagged.length === 0 && (undated === 0 || sent), match: !!imported && missing.length === 0 },
  };
}

// What to do once the last receipt is checked: the month it belonged to (this month when it had no
// date) and the first step it still lacks, for the approvedLast banner.
export async function afterLastReview(env: Env, issueDate: string | null): Promise<{ month: string; step: string }> {
  const month = issueDate?.slice(0, 7) ?? new Date().toISOString().slice(0, 7);
  const s = await monthState(env, month);
  return { month, step: !s.imported ? 'import' : s.missing.length ? 'match' : 'send' };
}

// ---------- Receipt ----------
const FIELD_LABELS: Record<FlagField | 'due_date', string> = {
  vendor: 'Seller',
  invoice_number: 'Number',
  issue_date: 'Date',
  due_date: 'Due date',
  currency: 'Currency',
  net: 'Before VAT',
  vat: 'VAT',
  total: 'Total',
  vat_rate: 'VAT %',
  product: 'Part',
  expense_type: 'Kind',
  eur_override: 'In euros',
  duplicate_of: 'Duplicate of',
  client: 'Client',
  client_vat_id: 'Client VAT number',
  client_country: 'Client country',
  vat_treatment: 'VAT handling',
  reference_number: 'Reference',
};
// Placeholders that don't look like a value; guidance lives in a hint line under the field.
const FIELD_HINTS: Partial<Record<FlagField | 'due_date', string>> = {
  eur_override: 'Only if your bank differs',
};
// Which way the document writes decimals, from its text: true for 30,00, false for 30.00, null if it
// doesn't say. Dates such as 18.09.2026 are not amounts.
function decimalComma(text: string | null): boolean | null {
  if (!text) return null;
  const commas = (text.match(/\d,\d{2}(?![\d,])/g) ?? []).length;
  const dots = (text.match(/\d\.\d{2}(?![\d]|\.\d)/g) ?? []).length;
  return commas === dots ? null : commas > dots;
}
const EUR_SOURCE: Record<string, string> = {
  manual: 'yours',
  bank: 'from your bank',
  native: 'in euros',
  ecb: 'ECB rate',
  missing: 'none yet',
};
function eurLine(eur: EurValue): string {
  if (eur.minor === null) return 'No euro amount yet.';
  return `EUR ${money(eur.minor)}, ${EUR_SOURCE[eur.source] ?? escape(eur.source)}${eur.rateDate ? ` ${day(eur.rateDate)}` : ''}.`;
}

// The failure scope of the receipt form.
const RECEIPT = 'receipt';
// params: the list it was opened from (?from=todo&month=M), so its count, Next and Skip use that filter.
// The fragment an Approve lands on for the receipt it moves to: the first field its required flags
// leave empty, else the page's own start, so focus is never lost to the body.
const FIELD_COLUMN: Record<string, string> = {
  net: 'net_minor',
  vat: 'vat_minor',
  total: 'total_minor',
  vat_rate: 'vat_rate_bps',
};
export function firstToFill(r: Receipt): string {
  const row = r as unknown as Record<string, unknown>;
  for (const { flag } of flagCards(reasonCodes(r.review_reasons_json)))
    if (isRequired(flag))
      for (const f of flag.fields) {
        const v = row[FIELD_COLUMN[f] ?? f];
        if (f !== 'product' && (v === null || v === undefined || v === '')) return `#f-${f}`;
      }
  return '#main';
}
export async function receiptPage(env: Env, r: Receipt, params: Params): Promise<Response> {
  const sales = r.kind === 'sales';
  const list = receiptState(params, needsReview(r) && !r.discarded_at);
  const todo = { ...list, view: 'todo' } as const;
  // Every form on the page posts the list it was opened from, so its return keeps it.
  const own = receiptFields(list);
  // Every query the page needs, in one round. The sales payment box waits only on the euro value.
  const eurQuery = eurValue(env, r);
  const [eur, rules, candidateRows, place, next, duplicates, files, linked, shown, salesBox] = await Promise.all([
    eurQuery,
    env.DB.prepare('SELECT * FROM vendor_rules ORDER BY priority DESC,id LIMIT 100')
      .all<Rule>()
      .then((q) => q.results),
    env.DB.prepare(
      "SELECT t.*,a.label AS account_name,a.bank_name FROM bank_transactions t JOIN imports i ON i.id=t.import_id JOIN accounts a ON a.id=t.account_key WHERE i.status='complete' AND t.receipt_id IS NULL AND t.receipt_required=1 AND t.amount_minor<0",
    )
      .all<Payment>()
      .then((q) => q.results),
    openPlace(env, LIST_DEFS.receipts!, todo, r.id),
    nextOpen(env, LIST_DEFS.receipts!, todo, standing(LIST_DEFS.receipts!, r.id), { wrap: true }),
    env.DB.prepare(
      'SELECT * FROM receipts WHERE id<>? AND duplicate_of IS NULL AND discarded_at IS NULL AND (lower(vendor)=lower(?) OR total_minor=? OR id=?) ORDER BY issue_date DESC,id LIMIT 50',
    )
      .bind(r.id, r.vendor ?? '', r.total_minor ?? -1, r.duplicate_of ?? '')
      .all<Receipt>()
      .then((q) => q.results),
    // Other files of the same charge (the receipt PDF next to the invoice PDF).
    env.DB.prepare('SELECT id,filename FROM receipts WHERE duplicate_of=? ORDER BY received_at,id LIMIT 20')
      .bind(r.id)
      .all<{ id: string; filename: string }>()
      .then((q) => q.results),
    env.DB.prepare('SELECT 1 FROM bank_transactions WHERE receipt_id=? LIMIT 1')
      .bind(r.id)
      .first()
      .then((row) => !!row),
    // The original as text when it isn't an image; its number format is echoed in the hints.
    previewable(r) ? null : readableText(env, r),
    sales ? eurQuery.then((e) => paymentBox(env, { ...r, paid_bank_on: e.transaction ? 'linked' : null }, own)) : '',
  ]);
  const { position, total } = place;
  const suggestions =
    eur.transaction || sales
      ? []
      : candidateRows
          .filter((t) => eligible(r, t, rules, config(env).tuning))
          .sort(
            (a, b) =>
              Math.abs(Date.parse(a.booking_date) - Date.parse(r.issue_date ?? '')) -
                Math.abs(Date.parse(b.booking_date) - Date.parse(r.issue_date ?? '')) ||
              a.booking_date.localeCompare(b.booking_date) ||
              a.account_key.localeCompare(b.account_key) ||
              a.id.localeCompare(b.id),
          );
  const codes = reasonCodes(r.review_reasons_json);
  const gone = !!r.discarded_at;
  const needs = needsReview(r),
    reading = r.status === 'pending' || r.status === 'processing';
  const parts = hasParts(env);
  const aboutPartOnly = (flag: Flag) => flag.fields.length > 0 && flag.fields.every((f) => f === 'product');
  const cards = needs ? flagCards(codes).filter(({ flag }) => parts || !aboutPartOnly(flag)) : [];
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
  const comma = decimalComma(shown);
  const eg = (n: string) => (comma ? n.replace('.', ',') : n);
  // A value is the reader's while the person hasn't saved the form: a save keeps every field as typed.
  const typed = (() => {
    try {
      return object(JSON.parse(r.manual_fields_json));
    } catch {
      return {};
    }
  })();
  const MANUAL_KEY: Record<string, string> = {
    net: 'net_minor',
    vat: 'vat_minor',
    total: 'total_minor',
    vat_rate: 'vat_rate_bps',
  };
  const current: Record<string, unknown> = { ...values, currency: r.currency, vat_treatment: r.vat_treatment };
  const blank = (name: string) => current[name] === null || current[name] === undefined || current[name] === '';
  const readByReader = (name: string) => !blank(name) && (typed[MANUAL_KEY[name] ?? name] ?? null) === null;
  // One line under an empty field, in place of a placeholder that would look like a value.
  const noteFor = (name: FlagField | 'due_date'): string => {
    if (!blank(name)) return '';
    switch (name) {
      case 'issue_date':
        return 'Which month does this belong to? Your accountant needs a date.';
      case 'vat':
        return 'Enter 0 if the receipt has no VAT.';
      case 'vat_rate':
        return `As printed on the receipt, for example ${eg('25.5')}.`;
      case 'total':
      case 'net':
        return comma === null ? '' : `Type it as on the receipt, for example ${eg('30.00')}.`;
      case 'client_country':
        return 'Two letters, for example DE.';
      default:
        return '';
    }
  };
  // Every control has an id, so its row label (or a flag's question) names it.
  type Control = { id: string; label: string; html: string; note?: string };
  type Tier = 'req' | 'opt';
  const controls = (name: FlagField | 'due_date', tier?: Tier): Control[] => {
    placed.add(name);
    const id = `f-${name}`;
    const label = sales && name === 'total' ? 'Total invoiced' : FIELD_LABELS[name];
    const hint = FIELD_HINTS[name];
    // After a refusal only the field that failed is marked. Before one, a required flag marks its empty
    // field; an optional flag never does.
    const refused = ariaFor(RECEIPT, name);
    const marked = refused || (tier === 'req' && !failureFor(RECEIPT) && blank(name) ? ' aria-invalid="true"' : '');
    const note = noteFor(name);
    const attrs = ` id="${id}"${hint ? ` placeholder="${escape(hint)}"` : ''}${marked}${note && !refused ? ` aria-describedby="h-${name}"` : ''}`;
    const text = (type: string, extra = '', value = values[name]) =>
      `<input name="${name}" value="${escape(kept(RECEIPT, name, value))}" type="${type}"${extra}${attrs}>`;
    const choose = (list: { v: string; l: string }[], current: string) =>
      `<select name="${name}" id="${id}"${marked}>${list.map((o) => `<option value="${escape(o.v)}"${o.v === kept(RECEIPT, name, current) ? ' selected' : ''}>${escape(o.l)}</option>`).join('')}</select>`;
    const one = (html: string): Control[] => [{ id, label, html, note }];
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
          { id, label, html: text('text', ' inputmode="decimal"', money(r.eur_override_minor)) },
          {
            id: 'f-eur_override_reason',
            label: 'Why',
            html: `<input name="eur_override_reason" value="${escape(kept(RECEIPT, 'eur_override_reason', r.eur_override_reason))}" type="text" id="f-eur_override_reason" placeholder="Needed with a euro amount"${ariaFor(RECEIPT, 'eur_override_reason')}>`,
          },
        ];
      case 'duplicate_of':
        return one(
          `<select name="duplicate_of" id="${id}"${refused}><option value="">Not a duplicate</option>${duplicates.map((d) => receiptOption(d, d.id === kept(RECEIPT, 'duplicate_of', r.duplicate_of))).join('')}</select>`,
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
  // One row: the label on the left, the control on the right.
  const row = (c: Control, label = escape(c.label), title = '', meta = '') =>
    `<div class="frow"><div class="sl"><label class="flabel" for="${c.id}"${title ? ` title="${escape(title)}"` : ''}>${label}</label>${meta ? `<span class="meta">${meta}</span>` : ''}</div><div class="sc">${c.html}${c.note ? `<p class="meta" id="h-${c.id.slice(2)}">${escape(c.note)}</p>` : ''}${errorLine(RECEIPT, c.id.slice(2))}</div></div>`;
  const rows = (name: FlagField | 'due_date') =>
    controls(name)
      .map((c) => row(c))
      .join('');
  const retryButton = (key: 'reread' | 'read', tone: Tone, outside = false) =>
    button(key, { tone, attrs: `${outside ? ' form="fix"' : ''} formaction="/receipts/${r.id}/retry"` });
  // The flag's own badge: what the person must do about it.
  const badge = (tier: Tier, names: readonly string[]) =>
    tier === 'req' ? (names.some(blank) ? '<span class="warning">Required</span>' : 'Check it') : 'Optional';
  // Each flag holds only its field, labelled by the flag's question; the longer
  // sentence is a tooltip, shown in full only when the flag has no field to fix.
  // Required flags come first, red; optional ones are neutral and never block Approve.
  const items = [...cards]
    .sort((a, b) => Number(isRequired(b.flag)) - Number(isRequired(a.flag)))
    .map(({ flag }, i) => {
      const id = `flag-${i + 1}`;
      const names = flag.fields.filter((f) => !placed.has(f) && (parts || f !== 'product'));
      const tier: Tier = isRequired(flag) ? 'req' : 'opt';
      const body = bodyOf(flag, r);
      const extra =
        flag.action === 'retry' && !unverified
          ? `<div class="fx">${retryButton('reread', 'secondary')}</div>`
          : flag.action === 'upload'
            ? `<div class="fx"><a href="/add${sales ? '?kind=sales' : ''}">Upload a copy</a></div>`
            : flag.action === 'move'
              ? `<details class="fx">${buttonSummary('moveBack')}<div class="body"><p class="ask">${KIND_LOSS}</p>${button('moveBack', { attrs: ` formaction="/receipts/${r.id}/kind" name="kind" value="expense"` })}</div></details>`
              : '';
      if (names.length === 1) {
        const [first, ...more] = controls(names[0]!, tier);
        return `<li class="flag ${tier}">${row(first!, escape(flag.title), body, badge(tier, names))}${more.map((c) => row(c)).join('')}${extra}</li>`;
      }
      if (!names.length)
        return `<li class="flag info"><p class="fh"><strong id="${id}-t">${escape(flag.title)}</strong> <span class="meta">${escape(body)}</span></p>${extra}</li>`;
      return `<li class="flag ${tier}" role="group" aria-labelledby="${id}-t"><p class="fh"><strong id="${id}-t" title="${escape(body)}">${escape(flag.title)}</strong> <span class="meta">${badge(tier, names)}</span></p>${names
        .flatMap((n) => controls(n, tier))
        .map((c) => row(c))
        .join('')}${extra}</li>`;
    });
  const fieldOrder = sales
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
    : (['vendor', 'invoice_number', 'issue_date', 'total', 'currency', 'net', 'vat', 'vat_rate'] as const);
  // VAT % is part of the money work, so it is not left in the fold when an amount is flagged.
  if (needs && ['net', 'vat', 'total'].some((n) => placed.has(n)) && !placed.has('vat_rate') && blank('vat_rate'))
    items.push(`<li class="flag opt">${row(controls('vat_rate', 'opt')[0]!, undefined, '', 'Optional')}</li>`);
  const flagList = items.length ? `<ol class="flags">${items.join('')}</ol>` : '';
  // What the reader already filled in stays in view, marked, so it is checked against the original.
  const readRows = needs
    ? fieldOrder
        .filter((f) => !placed.has(f) && !blank(f))
        .map(
          (f) =>
            `<li class="flag read">${row(controls(f)[0]!, undefined, '', readByReader(f) ? 'Read from the document, check it' : '')}</li>`,
        )
    : [];
  const readList = readRows.length
    ? `<h2 class="grph">Already filled in</h2><ol class="flags">${readRows.join('')}</ol>`
    : '';
  const rest = fieldOrder.filter((f) => !placed.has(f)).map(rows);
  const filing = (sales ? (['product'] as const) : (['product', 'expense_type'] as const))
    .filter((f) => !placed.has(f) && (parts || f !== 'product'))
    .map(rows);
  const keptPart = parts
    ? ''
    : hidden('product', config(env).products.some((p) => p.id === r.product) ? r.product : config(env).defaultProduct);
  const due = rows('due_date');
  const fx = placed.has('eur_override') ? '' : rows('eur_override');
  const dup = placed.has('duplicate_of') ? '' : rows('duplicate_of');
  const heading = reading ? STATUS.reading.word : needs ? `${cards.length} to check` : '';
  const note = `<details class="note"${failureFor(RECEIPT)?.field === 'approval_reason' ? ' open' : ''}><summary>Note</summary><div class="body rowlist">${row(
    {
      id: 'f-approval_reason',
      label: 'For your accountant',
      html: `<input name="approval_reason" value="${escape(kept(RECEIPT, 'approval_reason', 'Checked against the original'))}" type="text" id="f-approval_reason"${ariaFor(RECEIPT, 'approval_reason')}>`,
    },
  )}</div></details>`;
  const ready = isReady(r);
  const status = gone
    ? `<span class="stamp muted">Discarded${r.discard_reason ? ` · ${DISCARD_REASONS[r.discard_reason]}` : ''}</span>`
    : sales
      ? salesStamp({ ...r, paid_bank_on: eur.transaction ? 'linked' : null }, config(env).tuning.paymentTermsDays)
      : stamp(r, linked);
  // A ready receipt opens as its summary; Edit opens every field.
  const summary = ready
    ? `<dl class="kv sum"><div><dt>${sales ? 'Client' : 'Seller'}</dt><dd>${escape(receiptName(r))}</dd></div><div><dt>Date</dt><dd>${r.issue_date ? day(r.issue_date) : 'None'}</dd></div><div><dt>Total</dt><dd>${r.total_minor === null ? 'None' : amount(r.total_minor, r.currency)}</dd></div><div><dt>Payment</dt><dd>${sales ? status : linked ? statusMark('matched') : 'Not matched yet'}</dd></div></dl>`
    : '';
  const quiet = needs
    ? ''
    : flagCards(optionalReasons(codes))
        .filter(({ flag }) => parts || !aboutPartOnly(flag))
        .map(({ flag }) => flag.title)
        .join(' ');
  const quietNote = quiet ? `<p class="meta quiet">Not needed to approve: ${escape(quiet)}</p>` : '';
  const fold = ready ? 'Edit' : needs ? 'Other fields' : 'All fields';
  const verb = needs || reading ? 'approve' : 'save';
  // Enter in a field submits the form's first submit button: the same as the bar's, never Skip or Read again.
  const enter = button(verb, { quiet: true, attrs: ` name="action" value="${verb}" tabindex="-1" aria-hidden="true"` });
  const form = `<form action="/receipts/${r.id}" method="post" class="fix" id="fix">${enter}${hidden('revision', r.revision)}${own}${keptPart}${errorLine(RECEIPT, '')}${heading ? `<h2 id="fix-h">${heading}</h2>` : ''}${flagList}${readList}${summary}${quietNote}
    <details class="all"${failureFor(RECEIPT) || (!needs && !ready) ? ' open' : ''}><summary>${fold}</summary><div class="body rowlist">${rest.join('')}${filing.join('')}${due}${dup}${fx}${eur.source === 'native' ? '' : `<p class="small">${escape(eurLine(eur))}</p>`}</div></details>
    ${note}</form>`;
  const matches = sales
    ? salesBox
    : suggestions.length
      ? `<section aria-labelledby="match-h" class="matchs"><h2 id="match-h">Payment?</h2>${suggestions
          .map((t) => {
            // Only a pair that isn't an exact fit asks for the exception, and says why.
            const facts = pairFacts(r, t, rules, config(env).tuning);
            return `<form action="/matches" method="post" class="match"><p><strong>${amount(-t.amount_minor, t.currency)}</strong> to ${escape(t.merchant)}, ${day(t.booking_date, false)} <span class="hint">${escape(t.account_name)}</span></p><input type="hidden" name="transaction_id" value="${t.id}"><input type="hidden" name="receipt_id" value="${r.id}"><input type="hidden" name="on_error" value="/receipts/${r.id}"><input type="hidden" name="return_to" value="/receipts/${r.id}">${own}${facts.exact ? '' : `<input type="hidden" name="confirm_exception" value="yes"><p class="likely__why" id="e-why-${t.id}">${escape(facts.reason)}</p>`}${button('match', { attrs: ` id="f-confirm-${t.id}" name="action" value="link"` })}</form>${matchError(t.id)}`;
          })
          .join('')}</section>`
      : '';
  const move =
    sales || config(env).invoicesAddress
      ? `<details>${buttonSummary(sales ? 'moveBack' : 'move')}<div class="body"><form action="/receipts/${r.id}/kind" method="post">${own}${hidden('revision', r.revision)}<p class="ask">${KIND_LOSS}</p>${button(sales ? 'moveBack' : 'move', { attrs: ` name="kind" value="${sales ? 'expense' : 'sales'}"` })}</form></div></details>`
      : '';
  const always = sales
    ? ''
    : `<details${failureFor(RECEIPT_RULE) ? ' open' : ''}><summary>Always file as</summary><div class="body"><form action="/rules" method="post"><input type="hidden" name="return_to" value="/receipts/${r.id}">${own}${ruleFields(env, { vendor_contains: r.vendor ?? '', product: config(env).products.some((p) => p.id === r.product) ? r.product : config(env).defaultProduct, expense_type: r.expense_type }, failureFor(RECEIPT_RULE) ? RECEIPT_RULE : '')}${button('save', { label: 'Save rule' })}</form></div></details>`;
  const extras = `<details class="more">${buttonSummary('more')}<div class="body"><form action="/receipts/${r.id}/retry" method="post">${own}${button('reread')}</form>${move}<p><a href="/originals/${r.id}">Download original</a>${r.email_key ? ` · <a href="/originals/${r.id}?variant=email">Source email</a>` : ''}</p>${files.length ? `<p>Files: ${files.map((f) => `<a href="/originals/${f.id}">${escape(f.filename)}</a>`).join(' · ')}</p>` : ''}<details><summary>Upload a copy</summary><div class="body">${uploadForm('', false, r.kind)}</div></details>${always}</div></details>`;
  const pdf = r.media_type === 'application/pdf';
  // A PDF is not embedded: the page's CSP allows no frames or objects. Its text is shown instead.
  const open = `<p>${buttonLink('original', `/originals/${r.id}${!pdf && r.email_key && r.media_type === 'message/rfc822' ? '?variant=email' : ''}`)}</p>`;
  const docTitle = previewable(r)
    ? 'The original'
    : shown
      ? pdf
        ? 'The PDF, as text'
        : 'The text that was read'
      : 'The original';
  const doc = previewable(r)
    ? `<a class="frame" href="/originals/${r.id}?view=inline"><img src="/originals/${r.id}?view=inline" alt="The original ${escape(r.filename)}"></a>`
    : `${shown ? `<pre class="paper" tabindex="0">${escape(shown)}</pre>` : ''}${open}`;
  const back = gone
    ? `<a href="${escape(listUrl({ ...list, view: 'all', show: 'discarded' }))}">‹ Discarded</a>`
    : sales && !needs && list.view === 'all'
      ? `<a href="${escape(listUrl({ ...list, key: 'invoices', month: r.issue_date?.slice(0, 7) ?? list.month }))}">‹ Invoices</a>`
      : `<a href="${escape(listUrl(list))}">‹ ${list.view === 'todo' ? 'To do' : 'Receipts'}</a>`;
  const nextLink = !gone && !needs && next ? `<a href="${escape(receiptUrl(next, todo))}">Next to check ›</a>` : '';
  const skip =
    needs && next && next !== r.id ? button('skip', { attrs: ' form="fix" name="action" value="skip"' }) : '';
  const discard = discardControl(r.id, { list: own, revision: r.revision });
  const restore = `<section class="gone" aria-label="Discarded">${restoreForm(r.id, `/receipts/${r.id}`, true, own)}</section>`;
  const primary = reading || unverified ? 'secondary' : 'primary';
  const verbLabel = verb === 'save' ? 'Save' : sales ? 'Approve invoice' : 'Approve receipt';
  // One bar on every width: where you are, the quiet actions, and the one primary.
  const bar = `<div class="sbar" role="group" aria-label="Actions">${needs && position >= 0 ? `<span class="prog">${position + 1} of ${total} to check</span>` : ''}${skip}${discard}${extras}${unverified ? retryButton('read', 'primary', true) : ''}${reading ? buttonLink('refresh', receiptUrl(r.id, list), { tone: 'primary' }) : ''}${button(verb, { tone: primary, label: verbLabel, attrs: ` form="fix" name="action" value="${verb}"` })}</div>`;
  return page(
    needs && !gone ? 'reviewItem' : 'receipt',
    `<div class="work"><section class="doc" aria-label="Original">${gone ? '' : '<a class="skip" href="#fix">Skip to the fields</a>'}<h2 class="doch">${docTitle}</h2>${doc}</section><section class="fixes" aria-label="Fields">${gone ? `${restore}${extras}` : `${form}${matches}${bar}`}</section></div>`,
    200,
    env,
    {
      style: VIEW_TRANSITION_CSS,
      refresh: reading ? 10 : undefined,
      detail: receiptName(r),
      head: `<div class="crumbs">${back}${nextLink}</div><div class="head tight"><h1>${escape(receiptName(r))}</h1>${r.total_minor === null ? '' : `<span class="amt">${amount(r.total_minor, r.currency)}</span>`}${status}</div>`,
    },
  );
}

// ---------- Payments ----------
// A month's money out, as the Bank page sums it up: own-account transfers left
// out, each other payment matched, not a purchase, or missing a receipt.
async function monthCounts(env: Env, month: string) {
  const [sums, reviewing] = await env.DB.batch([
    env.DB.prepare(
      `SELECT count(*) "out",count(t.receipt_id) matched,total(t.receipt_id IS NULL AND t.receipt_required=0) exempt FROM bank_transactions t JOIN imports i ON i.id=t.import_id WHERE i.status='complete' AND t.amount_minor<0 AND substr(t.booking_date,1,7)=? AND NOT EXISTS(SELECT 1 FROM internal_transfers p WHERE p.debit_id=t.id)`,
    ).bind(month),
    env.DB.prepare(
      `SELECT r.id FROM receipts r JOIN bank_transactions t ON t.receipt_id=r.id WHERE ${needsReviewSql('r')} AND substr(t.booking_date,1,7)=?`,
    ).bind(month),
  ]);
  const n = (sums?.results[0] ?? {}) as Record<string, number>;
  return {
    out: n.out ?? 0,
    matched: n.matched ?? 0,
    exempt: n.exempt ?? 0,
    reviewing: new Set(((reviewing?.results ?? []) as { id: string }[]).map((r) => r.id)),
  };
}
// To do lists the month's open payments, the first upto of them; All lists the whole month.
// month: the month to show, or the lookup that picks it, so the queries that
// don't need it start right away.
export async function payments(
  env: Env,
  month: string | Promise<string>,
  params = new URLSearchParams(),
): Promise<Response> {
  const chosen = Promise.resolve(month);
  const view: BankView = params.get('view') === 'all' ? 'all' : 'todo';
  const upto = bankUpto(params.get('upto'), BULK_CAP);
  // One round for everything. The open invoices, the transfer credits, the
  // receipts still in Review and the month's state are needed only for some
  // months, but loading them every time is cheaper than waiting a second round.
  const [
    selected,
    rows,
    receipts,
    allInvoices,
    rules,
    transfers,
    allCredits,
    counts,
    views,
    elsewhere,
    droppedRecently,
    importButton,
    state,
  ] = await Promise.all([
    chosen,
    chosen.then((m) => viewRows(env, m, view, view === 'todo' ? BULK_CAP : undefined)),
    matchableReceipts(env),
    openSales(env),
    env.DB.prepare('SELECT * FROM vendor_rules')
      .all<Rule>()
      .then((r) => r.results),
    listTransfers(env.DB),
    // Unmatched money in that could be the other side of an own-account transfer.
    env.DB.prepare(
      "SELECT t.*,a.label AS account_name,a.bank_name FROM bank_transactions t JOIN imports i ON i.id=t.import_id JOIN accounts a ON a.id=t.account_key WHERE i.status='complete' AND t.receipt_id IS NULL AND t.receipt_required=1 AND t.amount_minor>0 ORDER BY t.booking_date DESC,t.id LIMIT 300",
    )
      .all<Payment>()
      .then((r) => r.results),
    // The whole month in numbers, however many rows are shown, and the
    // matched receipts that still need a look.
    chosen.then((m) => monthCounts(env, m)),
    chosen.then((m) => viewCounts(env, m)),
    chosen.then((m) =>
      env.DB.prepare(
        `SELECT substr(t.booking_date,1,7) m, count(*) n ${MISSING_PAYMENTS} AND substr(t.booking_date,1,7)<>? GROUP BY m ORDER BY m DESC LIMIT 12`,
      )
        .bind(m)
        .all<{ m: string; n: number }>()
        .then((r) => r.results),
    ),
    hasRecentDropped(env),
    importLink(env),
    chosen.then((m) => monthState(env, m)),
  ]);
  const invoices = rows.some((t) => t.amount_minor > 0 && !t.receipt_id) ? allInvoices : [];
  const paired = new Map(
    transfers.flatMap(
      (p) =>
        [
          [p.debit_id, p],
          [p.credit_id, p],
        ] as const,
    ),
  );
  const credits = rows.some((t) => t.amount_minor < 0 && !t.receipt_id && !paired.has(t.id))
    ? allCredits.filter((t) => !paired.has(t.id))
    : [];
  const unmatched = (t: Payment) => !paired.has(t.id) && t.amount_minor < 0 && !!t.receipt_required && !t.receipt_id;
  // The month's open payments (up to BULK_CAP in To do), so Match all never depends on upto.
  const open = rows.filter(unmatched);
  // Which account a payment came from matters only when there is more than one.
  const accounts = new Set(rows.map((t) => t.account_key));
  const tuning = config(env).tuning;
  const year = selected.slice(0, 4);
  const ID = /^[a-f0-9]{64}$/;
  // The receipt the person typed or picked before a refusal, when it names exactly one.
  const chosenOf = (t: Payment, pool: Receipt[]): Receipt | undefined => {
    const found = pickMatches(chosenReceipt(t.id), pool, year);
    return found.length === 1 ? found[0] : undefined;
  };
  const { likely: likelyOf, exact: bulk } = likelyPairs(open, receipts, rules, tuning);
  const shown = view === 'todo' ? rows.slice(0, upto) : rows;
  const here: ListState = { ...RECEIPTS_TODO, key: 'bank', view, month: selected, upto };
  const bar: BulkList = {
    form: 'bulk-payments',
    action: '/payments/bulk',
    noun: ['payment', 'payments'],
    total: views[view],
    scope: listParams(here),
    actions: [...PAYMENT_ACTIONS],
  };
  // Every row form posts the list it is on, so its return keeps the view and lands on the next row.
  const fields = listFields(here);
  const dayIn = (value: string | null, other: string) =>
    value ? day(value, value.slice(0, 4) !== other.slice(0, 4)) : 'None';
  // Name, Date and Amount side by side, each marked in words, with the one button under it.
  const likelyForm = (t: Payment, r: Receipt, noun: string) => {
    const facts = pairFacts(r, t, rules, tuning);
    const scope = `match:${t.id}`;
    const line = (label: string, bank: string, other: string, cell: Cell) =>
      `<tr><th scope="row">${label}</th><td${cell.same ? '' : ' data-l="Bank"'}>${bank}</td><td${cell.same ? ' class="dup"' : ` data-l="${noun}"`}>${other}</td><td class="${cell.same ? 'same' : 'diff'}">${escape(cell.text)}</td></tr>`;
    const why = facts.exact ? '' : `<p class="likely__why" id="e-why-${t.id}">${escape(facts.reason)}</p>`;
    const described = [
      facts.exact ? '' : `e-why-${t.id}`,
      failureFor(scope)?.field === 'confirm_exception' ? errorId(scope) : '',
    ]
      .filter(Boolean)
      .join(' ');
    return `<form action="/matches" method="post" class="likely" aria-labelledby="lk-${t.id}"><p class="likely__head"><strong id="lk-${t.id}">Likely: ${escape(receiptName(r))}, ${dayIn(r.issue_date, t.booking_date)}, ${amount(r.total_minor, r.currency)}</strong></p><table class="cmp"><thead><tr><th scope="col"><span class="vh">Field</span></th><th scope="col">Bank</th><th scope="col">${noun}</th><th scope="col">Compared</th></tr></thead><tbody>${line('Name', escape(t.merchant), escape(receiptName(r)), facts.name)}${line('Date', day(t.booking_date, false), dayIn(r.issue_date, t.booking_date), facts.date)}${line('Amount', amount(t.amount_minor, t.currency), amount(r.total_minor, r.currency), facts.amount)}</tbody></table>${why}${fields}<input type="hidden" name="transaction_id" value="${t.id}"><input type="hidden" name="receipt_id" value="${r.id}">${facts.exact ? '' : '<input type="hidden" name="confirm_exception" value="yes">'}${button('match', { attrs: ` id="f-confirm-${t.id}"${described ? ` aria-describedby="${described}"` : ''} name="action" value="link"` })}</form>`;
  };
  // The search box: type a seller, a date or an amount, or pick from the list.
  const picker = (t: Payment, listId: string, noun: string) => {
    const typed = chosenReceipt(t.id);
    return `<form action="/matches" method="post" class="pmatch">${fields}<input type="hidden" name="transaction_id" value="${t.id}"><input name="receipt_id" list="${listId}" autocomplete="off" aria-label="${noun}" placeholder="Seller, date or amount" value="${ID.test(typed) ? '' : escape(typed)}"${ariaFor(`match:${t.id}`, 'receipt_id')}>${button('match', { attrs: ' name="action" value="link"' })}</form>`;
  };
  // A likely pair first, with the search box left to More; no pair, the search box alone.
  const matchControls = (
    t: Payment,
    pool: Receipt[],
    listId: string,
    noun: string,
    likely: Receipt | undefined,
  ): { main: string; rest: string } => {
    const lower = noun.toLowerCase();
    const pair = chosenOf(t, pool) ?? likely;
    return pair
      ? {
          main: likelyForm(t, pair, noun),
          rest: `<p class="hint">Pick another ${lower}</p>${picker(t, listId, noun)}`,
        }
      : {
          main: `<p class="none">No ${lower === 'invoice' ? 'open invoice' : 'receipt'} fits.</p>${picker(t, listId, noun)}`,
          rest: '',
        };
  };
  const items = shown
    .map((t) => {
      const pair = paired.get(t.id);
      const extra: string[] = [];
      let status = '',
        meta = '',
        controls = '';
      if (pair) {
        meta = tag(
          t.id === pair.debit_id
            ? `Transfer to ${escape(pair.credit_account_name)}`
            : `Transfer from ${escape(pair.debit_account_name)}`,
        );
        extra.push(
          `<form action="/transfers/${pair.debit_id}/undo" method="post">${fields}${button('undo', { label: 'Undo transfer' })}</form>`,
        );
      } else if (t.receipt_id) {
        // One stamp per row: a matched receipt that still needs checking says so in its link.
        const doc = t.amount_minor > 0 ? 'Invoice' : 'Receipt';
        status = `${statusMark('matched')} <a class="tag" href="/receipts/${t.receipt_id}">${counts.reviewing.has(t.receipt_id) ? `Check the ${doc.toLowerCase()}` : doc}</a>`;
        extra.push(
          `<form action="/matches" method="post">${fields}<input type="hidden" name="transaction_id" value="${t.id}">${button('unmatch', { attrs: ' name="action" value="unlink"' })}</form>`,
        );
      } else if (t.amount_minor >= 0) {
        meta = tag('Money in');
        const likely = invoices.find((r) => creditFit(r, t, tuning) !== null);
        if (invoices.length && t.amount_minor > 0 && t.receipt_required) {
          const found = matchControls(t, invoices, 'pick-invoices', 'Invoice', likely);
          controls = `${found.main}${matchError(t.id)}`;
          if (found.rest) extra.push(found.rest);
        }
      } else if (!t.receipt_required) {
        const by = t.exempt_by && t.exempt_by !== 'owner' ? EXEMPT_LABELS[t.exempt_by] : '';
        status = statusMark('notPurchase');
        meta = by ? tag(by) : '';
        extra.push(
          `<form action="/payments/${t.id}" method="post">${fields}${button('needs', { attrs: ' name="receipt_required" value="1"' })}</form>`,
        );
      } else {
        const likely = likelyOf.get(t.id);
        status = statusMark('missing');
        const found = receipts.length
          ? matchControls(t, receipts, 'pick-receipts', 'Receipt', likely)
          : { main: '<p class="none">No receipt found yet.</p>', rest: '' };
        const dropped =
          droppedRecently && !likely
            ? `<p class="small"><a href="/settings?open=senders#mail">Check mail we didn't keep</a></p>`
            : '';
        controls = `<div class="fixrow">${found.main}<form action="/payments/${t.id}" method="post">${fields}${button('exempt', { attrs: ' name="receipt_required" value="0"' })}</form></div>${dropped}${matchError(t.id)}`;
        if (found.rest) extra.push(found.rest);
        extra.push('<p><a href="/add">Add a receipt</a></p>');
        const sides = credits.filter(
          (c) => c.account_key !== t.account_key && c.currency === t.currency && c.amount_minor === -t.amount_minor,
        );
        if (sides.length)
          extra.push(
            `<form action="/transfers" method="post" class="transfer">${fields}<input type="hidden" name="debit_id" value="${t.id}"><select name="credit_id" aria-label="Arrived in">${sides.map((c) => `<option value="${c.id}">${escape(c.account_name)} · ${escape(day(c.booking_date, false))}</option>`).join('')}</select><input name="reason" aria-label="Note" placeholder="Note" maxlength="500" required value="${escape(kept(transferScope(t.id), 'reason', ''))}"${ariaFor(transferScope(t.id), 'reason')}>${button('ownTransfer')}${errorLine(transferScope(t.id))}</form>`,
          );
      }
      // No bulk action applies to a transfer side.
      const account = accounts.size > 1 ? escape(t.account_name) : '';
      return row({
        key: t.id,
        pick: pair ? '' : bulkCheck(bar, t.id, `${t.merchant}, ${day(t.booking_date, false)}`),
        date: day(t.booking_date, false),
        title: escape(t.merchant),
        meta: [account, meta].filter(Boolean).join(' · '),
        status,
        amount: amount(t.amount_minor, t.currency),
        actions: extra.length
          ? more(extra.join(''), escape(t.merchant), failureFor(`match:${t.id}`)?.field === 'receipt_id')
          : '',
        below: controls,
      });
    })
    .join('');
  const datalistOptions = (pool: Receipt[]) =>
    [...pickLabels(pool, year).values()].map((label) => `<option value="${escape(label)}"></option>`).join('');
  const lists = `${items.includes('list="pick-receipts"') ? `<datalist id="pick-receipts">${datalistOptions(receipts)}</datalist>` : ''}${items.includes('list="pick-invoices"') ? `<datalist id="pick-invoices">${datalistOptions(invoices)}</datalist>` : ''}`;
  // What Match all will accept, pair by pair with its reason, before it is pressed.
  const matchAll = bulk.length
    ? `<form action="/matches/bulk" method="post" class="matchall">${fields}<details open><summary>Will match ${plural(bulk.length, 'payment')}</summary><ul>${bulk
        .map(
          ({ t, r, facts }) =>
            `<li>${escape(t.merchant)}, ${day(t.booking_date, false)}, ${amount(t.amount_minor, t.currency)} to ${escape(receiptName(r))}<span>${escape(whyLikely(facts))}</span></li>`,
        )
        .join(
          '',
        )}</ul></details>${bulk.map(({ t, r }) => `<input type="hidden" name="transaction_id" value="${t.id}"><input type="hidden" name="receipt_id" value="${r.id}">`).join('')}${button('matchAll', { label: matchAllLabel(bulk.length) })}</form>`
    : '';
  const picks = shown.filter((t) => !paired.has(t.id)).length;
  const table = rowList([items]);
  const others = elsewhere.length
    ? `<p class="small">Also missing: ${elsewhere.map((e) => `<a href="${bankPath(e.m, 'todo')}">${escape(monthName(e.m))} (${e.n})</a>`).join(', ')}</p>`
    : '';
  const switcher = viewSwitch((v) => bankPath(selected, v), views, view);
  const left = views.todo - shown.length;
  const head =
    view === 'todo'
      ? `<p class="listhead">${left > 0 ? `${shown.length} of ${views.todo}` : views.todo} to do</p>`
      : '';
  const showMore =
    view === 'todo' && left > 0 && upto < BULK_CAP
      ? `<p>${buttonLink('showMore', bankPath(selected, 'todo', Math.min(upto + BANK_UPTO, BULK_CAP)), { label: `Show ${Math.min(left, BANK_UPTO)} more` })}</p>`
      : '';
  const list = `<div data-list="bank-${view}" data-total="${views[view]}"${picks ? ` data-bulk-list="${bar.form}"` : ''}>${
    shown.length
      ? `${head}${picks ? bulkTools(bar, picks) : ''}${table}`
      : view === 'todo'
        ? settled(state, selected)
        : ''
  }</div>`;
  const body = views.all
    ? `<p class="summary"><span>${counts.out} out, ${counts.matched} matched, ${counts.exempt} ${STATUS.notPurchase.word.toLowerCase()}, <span${views.todo ? ' class="red"' : ''}>${views.todo} missing</span>${counts.reviewing.size ? `, ${counts.reviewing.size} ${STATUS.needs.word.toLowerCase()}` : ''}</span></p>${switcher}${matchAll}${list}${picks ? bulkBar(bar) : ''}${lists}${showMore}`
    : emptyState(
        `No statement for ${escape(monthName(selected))} yet.`,
        buttonLink('importStmt', '/import', { tone: 'primary' }),
      );
  return page('bank', `${others}${body}${importButton}`, 200, env, {
    style: VIEW_TRANSITION_CSS,
    detail: monthName(selected),
    // The one primary, as on Receipts To do: the first open payment, not a button on its row.
    head: monthHead(
      '/payments',
      selected,
      open[0]
        ? buttonLink('startMatching', `${bankPath(selected, 'todo')}#row-${open[0].id}`, {
            label: `Start matching (${views.todo})`,
          })
        : '',
    ),
  });
}

// Bank when every payment has a receipt: say so, and offer the month's next step as the one
// primary. Once the month is sent there is none, and a quiet link back to it.
function settled(s: MonthState, selected: string): string {
  const short = escape(monthName(selected, false));
  const step = nextStep(s, selected);
  const action = s.sent
    ? `<p>${statusMark('sent', { after: short })} <a href="/?month=${selected}#send">Open ${short}</a></p>`
    : step
      ? buttonLink(step.key, step.href, { tone: 'primary' })
      : s.docs
        ? buttonLink('zip', `/?month=${selected}#send`, {
            tone: 'primary',
            label: `Send ${monthName(selected, false)}`,
          })
        : '';
  return emptyState('Every payment has a receipt.', action);
}

// ---------- Home: close the month ----------
// What a month still lacks, in one phrase: "3 receipts need you". Undated receipts
// belong to no month yet but wait in the same Review, so they are counted alongside.
function lacks(s: MonthState, undated = 0): string {
  const also = undated ? `, plus ${plural(undated, 'undated receipt')}` : '';
  if (s.flagged.length)
    return `${plural(s.flagged.length, 'receipt')} ${s.flagged.length === 1 ? 'needs' : 'need'} you${also}.`;
  if (undated) return `${plural(undated, 'undated receipt')} ${undated === 1 ? 'needs' : 'need'} a date.`;
  if (s.missing.length)
    return `${plural(s.missing.length, 'payment')} ${s.missing.length === 1 ? 'needs' : 'need'} a receipt.`;
  if (!s.imported) return 'It needs its bank statement.';
  return 'It is ready to send.';
}
// The next step of a month and its place, shared by Home and Bank so both offer the same one primary action.
// Null when nothing is left to do (the month is sent) or nothing can be sent yet.
function nextStep(s: MonthState, selected: string): { key: ActionKey; href: string } | null {
  if (s.docs === 0) return { key: 'addReceipt', href: '/add' };
  if (!s.done.review) return { key: 'start', href: listUrl({ ...RECEIPTS_TODO, month: selected }) };
  if (!s.imported) return { key: 'importStmt', href: '/import' };
  if (!s.done.match) return { key: 'startMatching', href: bankPath(selected, 'todo') };
  return null;
}

// One status row per step (Check, Match, Send), and one panel for the current step.
export async function home(env: Env, requested: string | null, params = new URLSearchParams()): Promise<Response> {
  const settings = config(env);
  // Everything loads at once, the month's own queries as soon as the month is
  // known. A new install doesn't need most of it, but its tables are empty.
  // No month in the address: open on the oldest one that is not sent.
  const opening = requested ? null : arrivalMonth(env);
  const undatedDocs = undatedDocuments(env);
  const [ever, steps, arrival, s, queue, overdue] = await Promise.all([
    env.DB.prepare(
      "SELECT (SELECT count(*) FROM receipts) r, (SELECT count(*) FROM imports WHERE status='complete') i",
    ).first<{ r: number; i: number }>(),
    setupSteps(env),
    opening,
    opening ? opening.then((a) => monthState(env, a.month)) : monthState(env, requested!),
    reviewQueue(env),
    overdueInvoices(env),
    undatedDocs,
  ]);
  const checklist = setupChecklist(steps);
  if (!ever?.r && !ever?.i)
    return page(
      'home',
      `${checklist ?? ''}<div class="card active">${uploadForm(settings.receiptAddress, true)}</div>`,
      200,
      env,
      { head: pageHead('Welcome') },
    );
  const selected = requested ?? arrival!.month;
  const unverified = queue.filter((r) => reasonCodes(r.review_reasons_json).includes('sender_unverified')).length;
  const todo = escape(listUrl(RECEIPTS_TODO));
  const alert = overdue.length
    ? `<a href="${todo}">${plural(overdue.length, 'invoice')} overdue ›</a>`
    : unverified
      ? `<a href="${todo}">${plural(unverified, 'email')} not verified ›</a>`
      : '';
  const checkHref = escape(listUrl({ ...RECEIPTS_TODO, month: selected }));
  const undated = s.undated;
  const short = monthName(selected, false);
  const empty = s.docs === 0;
  // 4 means nothing is left: the month was sent and hasn't changed since.
  const current = empty ? 1 : !s.done.review ? 1 : !s.done.match ? 2 : s.sent ? 4 : 3;
  // A step's marker follows its own state: a later step can be done before an earlier one.
  const row = (n: number, label: string, status: string, href = '', red = false, done = false) => {
    const state = n === current ? 'now' : n < current || done ? 'done' : 'todo';
    const inner = `${stepWord(state)}<b>${label}</b><span${red ? ' class="red"' : ''}>${status}</span>`;
    return `<li class="step ${state}"${n === current ? ' aria-current="step"' : ''}>${href ? `<a href="${href}">${inner}</a>` : `<div>${inner}</div>`}</li>`;
  };
  const check = empty
    ? row(1, 'Check', 'Nothing yet', '/add')
    : s.flagged.length
      ? row(1, 'Check', `${s.flagged.length} to check${undated ? `, ${undated} undated` : ''}`, checkHref, true)
      : undated
        ? row(1, 'Check', `${undated} undated`, checkHref, true)
        : row(
            1,
            'Check',
            'All checked',
            escape(listUrl({ ...RECEIPTS_TODO, view: 'all', month: selected })),
            false,
            true,
          );
  const match = !s.imported
    ? row(2, 'Match', 'No statement', '/import', current === 2)
    : s.missing.length
      ? row(2, 'Match', `${s.missing.length} missing`, bankPath(selected, 'todo'), true)
      : row(2, 'Match', 'All matched', `/payments?month=${selected}`, false, true);
  const send = await sendStep(env, s, selected, current, params, undatedDocs);
  const step = nextStep(s, selected);
  const next = step && current < 3 ? buttonLink(step.key, step.href, { tone: 'primary' }) : '';
  // Why Home opened here, when it is not the current month.
  const why =
    arrival && arrival.month !== arrival.current
      ? `<p class="lede why"><strong>${escape(short)} ${s.send.last && s.send.changed ? 'changed since you sent it' : "isn't sent yet"}.</strong> ${s.send.last && s.send.changed ? '<a href="#send">See what changed.</a>' : lacks(s, undated)} · <a href="/?month=${arrival.current}">Go to ${escape(monthName(arrival.current, false))}</a></p>`
      : '';
  return page(
    'home',
    `${checklist ?? ''}${why}${alert ? `<p class="alert" role="note">${alert}</p>` : ''}${next ? `<div class="next">${next}</div>` : ''}<ol class="steps" aria-label="Close ${escape(monthName(selected))}">${check}${match}${row(3, 'Send', send.status, send.body ? '#send' : '')}</ol>${send.body ? `<div id="send">${send.body}</div>` : ''}`,
    200,
    env,
    { detail: monthName(selected), head: monthHead('/', selected) },
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

// Step 3: the month package. Its row status, and its panel: open when it is the
// current step, a closed "Download anyway" fold before that.
async function sendStep(
  env: Env,
  s: MonthState,
  selected: string,
  current: number,
  params: URLSearchParams,
  undatedDocs: Promise<Receipt[]>,
): Promise<{ status: string; body: string }> {
  const settings = config(env);
  const empty = s.docs === 0,
    ready = s.done.review && s.done.match && !empty,
    changed = !!s.send.last && s.send.changed && !empty;
  const sentOn = s.send.last ? day(s.send.last.sent_at, false) : '';
  const kind = current === 3 ? 'primary' : 'secondary';
  const defaults: PackageOptions = { anyway: !ready, undated: false, changes: changed };
  // While an upload runs, the URL carries its options so "Continue" repeats them.
  const uploading = ['driveDone', 'driveMore'].includes(params.get('done') ?? '');
  const chosen = uploading ? options(params) : defaults;
  const [plan, conn]: [Awaited<ReturnType<typeof planPackage>>, Connection | null] = await Promise.all([
    planPackage(
      env,
      selected,
      { ...chosen, changes: false },
      { sizes: s.docs <= 100, rows: [...s.rows, ...s.sales], send: s.send, undated: undatedDocs },
    ),
    settings.oneDrive ? connection(env) : null,
  ]);
  const drive = conn?.folder_item_id ? conn : null;
  const upload = drive && !empty ? await progress(env, drive, selected, chosen) : null;
  const folder = escape(drive?.folder_name ?? '');
  const csv = buttonLink('csv', `/export.csv?month=${selected}`);
  const zip = (o: Partial<PackageOptions>, text: string, tone: Tone = 'secondary') =>
    buttonLink('zip', `/month/package.zip?${query(selected, o)}`, { label: text, tone });
  const uploadForm = (o: Partial<PackageOptions>, text: string, tone: Tone = 'secondary') =>
    `<form action="/month/onedrive-upload" method="post">${optionFields(selected, o)}${button('oneDrive', { label: text, tone })}</form>`;
  const markSent = `<form action="/month/sent" method="post">${hidden('month', selected)}${hidden('receipts_hash', s.send.hash)}${button('sent', { label: `Mark ${monthName(selected, false)} as sent` })}</form>`;
  // A download can't redirect, so the question sits next to the button for as long as the month is ready to send.
  const didSend = `<div class="sentq"><h3>Did you send it?</h3>${markSent}</div>`;
  const line = `<p class="small">${escape(EXPORT_LINE)}</p>`;
  const destination = drive
    ? `<p class="small">OneDrive: <a href="${escape(drive.folder_web_url ?? '')}">${folder}</a> · <a href="/settings#onedrive">Change</a></p>`
    : '';

  if (empty) return { status: 'Nothing yet', body: '' };
  if (plan.files.length > MAX_PACKAGE_FILES)
    return {
      status: 'Too big',
      body: `<div class="card"><p class="alert" role="note">This month is too big for one package (${plan.files.length} files, ${MAX_PACKAGE_FILES} max).</p><div class="btns">${csv}</div>${line}</div>`,
    };
  const sized = plan.files.length > 0 && plan.files.every((f) => f.size !== null);
  const bytes = plan.files.reduce((n, f) => n + (f.size ?? 0), 0);
  const shown = plan.files.slice(0, 5);
  const manifest = plan.files.length
    ? `<details><summary>In the ZIP</summary><div class="body"><ul class="manifest" aria-label="Files in the package"><li>${escape(plan.folder)}/</li><li>00-index-${selected}.csv</li>${plan.files.some((f) => f.receipt.kind === 'sales') ? `<li>00-sales-index-${selected}.csv</li>` : ''}${s.missing.length ? `<li>00-missing-receipts-${selected}.csv</li>` : ''}${shown.map((f) => `<li>${escape(f.path)}</li>`).join('')}${plan.files.length > shown.length ? `<li class="more">… ${plan.files.length - shown.length} more</li>` : ''}</ul><p class="small">${plural(plan.files.length, 'file')}${sized ? `, ${size(bytes)}` : ''}</p></div></details>`
    : '';
  const rowsByKey = [...s.matrix].filter(([, v]) => v !== 0n);
  const byPart =
    rowsByKey.length && hasParts(env)
      ? `<details><summary>By part</summary><div class="body scroll"><table><caption class="vh">Costs by part of the business</caption><thead><tr><th scope="col"><a href="/help#part">Part</a></th><th scope="col"><a href="/help#kind">Kind</a></th><th scope="col" class="n">EUR</th></tr></thead><tbody>${rowsByKey
          .map(([key, v]) => {
            const [product = '', type = ''] = key.split('\u0000');
            return `<tr><th scope="row">${escape(productLabel(env, product))}</th><td>${escape(type)}</td><td class="n">${money(v)}</td></tr>`;
          })
          .join(
            '',
          )}</tbody><tfoot><tr><th scope="row" colspan="2">Total</th><td class="n">EUR ${money(s.total)}</td></tr></tfoot></table>${s.unchecked ? `<p class="small">${money(s.unchecked)} not checked yet.</p>` : ''}${s.estimated ? `<p class="small">${money(s.estimated)} at the ECB rate.</p>` : ''}</div></details>`
      : '';
  const spent = `<div class="total"><span>Spent</span><span>EUR ${money(s.total)}</span></div>${s.noEur ? `<p class="small">${plural(s.noEur, 'receipt')} without a euro amount, not counted.</p>` : ''}`;
  const hint = settings.sendHint ? `<p class="small">${escape(settings.sendHint)}</p>` : '';
  const panel = (buttons: string, before = '') =>
    `<div class="card active send">${spent}${before}<div class="btns">${buttons}${csv}</div>${hint}${line}${didSend}${manifest}${byPart}</div>`;

  if (changed) {
    const what = [
      s.send.added ? `${s.send.added} added` : '',
      s.send.corrected ? `${s.send.corrected} corrected` : '',
      s.send.removed ? `${s.send.removed} removed` : '',
    ].filter(Boolean);
    const n = plan.changedFiles;
    const buttons = n
      ? drive
        ? `${uploadForm({ ...defaults, changes: true }, `Upload ${plural(n, 'change')}`, kind)}${zip({ ...defaults, changes: true }, `Download changes (${plural(n, 'file')})`)}`
        : `${zip({ ...defaults, changes: true }, `Download changes (${plural(n, 'file')})`, kind)}${zip({ anyway: !ready }, 'Download all')}`
      : zip({ anyway: !ready }, 'Download all');
    return {
      status: 'Changed',
      body: panel(
        buttons,
        `<p class="alert" role="note">Changed since you sent it on ${escape(sentOn)}${what.length ? `: ${joinAnd(what)}` : ''}.</p>`,
      ),
    };
  }
  if (s.sent) {
    const next = shiftMonth(selected, 1);
    return {
      status: `${STATUS.sent.word} ${escape(sentOn)}`,
      body: `<div class="card">${s.send.last!.method === 'onedrive' ? '<p class="small">Via OneDrive</p>' : ''}<p><a href="/?month=${next}">On to ${escape(monthName(next, false))} ›</a></p><div class="btns">${zip({ anyway: !ready }, 'Download again')}${csv}</div></div>`,
    };
  }
  if (ready) {
    const download = `Download ZIP${sized ? ` (${size(bytes)})` : ''}`;
    const buttons =
      upload && upload.pending.length
        ? `${uploadForm(chosen, upload.plan.files.length - upload.pending.length ? 'Continue upload' : `Upload to ${folder}`, kind)}${zip(chosen, download)}`
        : zip(chosen, download, kind);
    return { status: STATUS.ready.word, body: panel(buttons, destination) };
  }
  // Not ready: download anyway, behind one fold.
  const undated = plan.undated
    ? `<label class="check"><input type="checkbox" name="undated" value="1">Add ${plural(plan.undated, 'undated receipt')}</label>`
    : '';
  const anyway = `<form action="/month/package.zip" method="get">${hidden('month', selected)}${hidden('anyway', 1)}${undated}${button('downloadAnyway')}</form>${
    upload && upload.pending.length ? uploadForm({ anyway: true }, 'Upload anyway') : ''
  }`;
  return {
    status: 'Not ready',
    body: `<details class="send"${uploading ? ' open' : ''}><summary>Download anyway</summary><div class="body">${spent}${plan.unchecked ? `<p class="small">Unchecked ones go in check-these/.</p>` : ''}${destination}<div class="btns">${anyway}${csv}</div>${line}${didSend}${manifest}${byPart}</div></details>`,
  };
}

// The fields of a vendor rule, for a new rule or an edit. Names match /rules.
function ruleFields(
  env: Env,
  rule: Partial<
    Pick<Rule, 'vendor_contains' | 'context_contains' | 'bank_alias' | 'product' | 'expense_type' | 'priority'>
  > = {},
  // The form's name when it was the one refused (rule:new, rule:<id>, rule:receipt), so what was
  // typed comes back and the message sits at the field. Forms that were not refused stay plain.
  scope = '',
): string {
  const own = (name: string) => (scope ? { scope, id: fieldId(scope, name) } : {});
  return `<div class="fields">${input('vendor_contains', rule.vendor_contains ?? '', 'text', 'Seller contains', { attrs: ' required maxlength="200"', ...own('vendor_contains') })}${hasParts(env) ? productSelect(env, 'product', kept(scope, 'product', rule.product ?? config(env).defaultProduct), 'Part') : `<input type="hidden" name="product" value="${escape(config(env).defaultProduct)}">`}${select('expense_type', EXPENSE_TYPES, rule.expense_type ?? EXPENSE_TYPES[0], 'Kind', scope, scope ? fieldId(scope, 'expense_type') : '')}${input('context_contains', rule.context_contains ?? '', 'text', 'Also mentions', { attrs: ' maxlength="200" placeholder="Optional"', ...own('context_contains') })}${input('bank_alias', rule.bank_alias ?? '', 'text', 'Bank name', { attrs: ' maxlength="200" placeholder="Optional"', ...own('bank_alias') })}${input('priority', rule.priority ?? 0, 'number', 'Priority', { attrs: ' title="Higher wins when rules overlap"', ...own('priority') })}</div>${scope ? errorLine(scope, '') : ''}`;
}

// ---------- Bank: import ----------
// Under the month's payments once any statement is in.
async function importLink(env: Env): Promise<string> {
  const any = await env.DB.prepare("SELECT EXISTS(SELECT 1 FROM imports WHERE status='complete') n").first<number>('n');
  return any ? `<div class="stmts" id="imports">${buttonLink('importStmt', '/import')}</div>` : '';
}

// ---------- Settings ----------
// One Settings section: a fold with its title and a one-line summary. The
// anchor id sits inside, so a link to #id opens the fold (fragment navigation
// expands details); open is for the section a save returns to.
function sect(id: string, title: string, summary: string, body: string, open = false): string {
  return `<details class="sect"${open ? ' open' : ''}><summary><h2>${title}</h2>${summary ? `<span class="sum">${summary}</span>` : ''}</summary><div class="body" id="${id}">${body}</div></details>`;
}
// A part of a section with its own heading and anchor. Links from banners and Undo still name it.
function sub(id: string, title: string, body: string): string {
  return `<div class="sectpart" id="${id}"><h3>${title}</h3>${body}</div>`;
}
// Which of the five sections holds a part, by the anchor it goes by.
const SECTION_OF: Record<string, string> = {
  'setup-business': 'business',
  rules: 'business',
  'setup-email': 'email',
  senders: 'email',
  mail: 'email',
  accounts: 'bank',
  'setup-accountant': 'sending',
  onedrive: 'sending',
  'setup-review': 'advanced',
  'setup-integrations': 'advanced',
  'setup-deploy': 'advanced',
  'setup-history': 'advanced',
  about: 'advanced',
};
// Settings > OneDrive. Nothing at all unless MS_CLIENT_ID is set; one line
// when a secret is missing; otherwise connect, folder and disconnect.
async function oneDrivePart(env: Env, origin: string): Promise<string> {
  const settings = config(env);
  const docs = settings.sourceRepository
    ? `<a href="${escape(settings.sourceRepository)}/blob/main/docs/ENVIRONMENT.md#onedrive-upload-optional">docs/ENVIRONMENT.md</a>`
    : '<code>docs/ENVIRONMENT.md</code>';
  if (!settings.oneDrive)
    return settings.oneDriveIncomplete
      ? sub(
          'onedrive',
          'OneDrive',
          `<p class="warning"><code>MS_CLIENT_SECRET</code> or <code>ONEDRIVE_TOKEN_KEY</code> is missing. See ${docs}.</p>`,
        )
      : '';
  const conn = await connection(env);
  const tech = `<details class="tech"><summary>Redirect URI for Microsoft Entra</summary><div class="body"><p>Microsoft sends you back to this app after you sign in. Add this address to your Microsoft Entra app, under Authentication, as a Web redirect URI.</p><pre tabindex="0">${escape(redirectUri(origin, ''))}</pre><p>Steps: ${docs}.</p></div></details>`;
  if (!conn)
    return sub(
      'onedrive',
      'OneDrive',
      `<p class="cta">${buttonLink('connect', '/settings/onedrive/connect')}</p>${tech}`,
    );
  const folderForm = `<form action="/settings/onedrive/folder" method="post"><div class="fields">${input('folder_link', '', 'url', 'Shared folder link', { attrs: ' required autocomplete="off" inputmode="url" placeholder="Share > Copy link"', wide: true, scope: FOLDER_SCOPE })}${input('folder_name', '', 'text', 'Folder name', { attrs: ' autocomplete="off" placeholder="Optional"', scope: FOLDER_SCOPE })}</div>${errorLine(FOLDER_SCOPE, '')}${button('save', { label: 'Use folder' })}</form>`;
  const folder = conn.folder_item_id
    ? `<a href="${escape(conn.folder_web_url ?? '')}"><strong>${escape(conn.folder_name)}</strong></a>`
    : '<span class="warning">Not chosen</span>';
  return sub(
    'onedrive',
    'OneDrive',
    `<dl class="kv"><div><dt>Account</dt><dd>${escape(conn.account_name)}${conn.account_email ? ` (${escape(conn.account_email)})` : ''}</dd></div><div><dt>Folder</dt><dd>${folder}</dd></div></dl>${
      conn.folder_item_id
        ? `<details class="why"${failureFor(FOLDER_SCOPE) ? ' open' : ''}><summary>Change folder</summary>${folderForm}</details>`
        : folderForm
    }<details class="cta">${buttonSummary('disconnect')}<div class="body"><form action="/settings/onedrive/disconnect" method="post"><p class="ask">Delete this app's sign-in to your Microsoft account? Uploads stop until you connect again.</p>${button('disconnect')}</form></div></details>${tech}`,
  );
}

// Settings > Email senders: who is read automatically, who is ignored, and the
// mail we didn't keep, as one list.
async function sendersPart(env: Env): Promise<string> {
  const allowed = [...config(env).allowedSenders].sort();
  const [ignored, log] = await Promise.all([ignoredSenders(env), mailLog(env)]);
  const list = (
    form: string,
    action: BulkAction,
    addresses: readonly string[],
    key: 'remove' | 'unignore',
    path: string,
  ) => {
    const bulk: BulkList = {
      form,
      action: '/senders/bulk',
      noun: ['sender', 'senders'],
      total: addresses.length,
      scope: { back: 'settings' },
      actions: [action],
    };
    return `<div data-bulk-list="${form}">${bulkTools(bulk, addresses.length)}${rowList(addresses.map((a) => sender(bulk, a, path, key)))}</div>${bulkBar(bulk)}`;
  };
  const sender = (bulk: BulkList, address: string, action: string, key: 'remove' | 'unignore') =>
    row({
      pick: bulkCheck(bulk, address, address),
      title: escape(address),
      actions: `<form action="${action}" method="post"><input type="hidden" name="address" value="${escape(address)}"><input type="hidden" name="back" value="settings">${button(key, { attrs: ` aria-label="${ACTIONS[key].label} ${escape(address)}"` })}</form>`,
    });
  const approved = allowed.length
    ? list('bulk-allowed', SENDER_ACTIONS.remove, allowed, 'remove', '/senders/remove')
    : '<p class="warning">None yet. All mail waits in To do.</p>';
  const ignoredList = ignored.length
    ? `<h3>Ignored</h3>${list(
        'bulk-ignored',
        SENDER_ACTIONS.unignore,
        ignored.map((i) => i.address),
        'unignore',
        '/senders/unignore',
      )}`
    : '';
  const full = allowed.length >= MAX_ALLOWED_SENDERS;
  const add = `<p class="meta">Add an address you want read, for example billing@example.com.</p><form action="/senders/approve" method="post" class="inline-edit add-row"><input type="hidden" name="back" value="settings"><input name="address" type="email" required maxlength="254" autocomplete="off" aria-label="Sender address" id="f-address" value="${escape(kept(NEW_SENDER, 'address', ''))}"${ariaFor(NEW_SENDER, 'address')}>${button('add', { attrs: full ? ' disabled' : '' })}${errorLine(NEW_SENDER)}</form>${full ? `<p class="warning">${MAX_ALLOWED_SENDERS} is the most. Remove one first.</p>` : ''}`;
  return sub('senders', 'Email senders', `${approved}${add}${ignoredList}${log}`);
}

// Mail we didn't keep: what reached the app and was not read, from the log that
// is already stored. Never the message itself.
async function mailLog(env: Env): Promise<string> {
  const rows = await droppedMail(env);
  const allowed = config(env).allowedSenders;
  const item = (m: (typeof rows)[number]) => {
    const when = day(m.received_at.slice(0, 10), m.received_at.slice(0, 4) !== String(new Date().getUTCFullYear()));
    const offer =
      reasonAllows(m.reason) && !allowed.has(m.sender) && m.sender.includes('@') && !/[\s<>]/.test(m.sender);
    const action = offer
      ? `<form action="/senders/approve" method="post"><input type="hidden" name="address" value="${escape(m.sender)}"><input type="hidden" name="back" value="mail">${button('allow', { attrs: ` aria-label="Allow ${escape(m.sender)}"` })}</form>`
      : '';
    return row({
      date: escape(when),
      title: escape(m.sender),
      meta: `${m.subject ? `${escape(m.subject)} · ` : ''}${escape(reasonWords(m.reason))}`,
      actions: action,
    });
  };
  const body = rows.length
    ? `<p class="meta">Emails that reached the app but were not read, newest first. Only the sender, subject and reason are kept.</p>${rowList(rows.map(item))}`
    : '<p>Every email that reached the app was kept.</p>';
  return `<h3 id="mail">Mail we didn't keep</h3>${body}`;
}

// The OneDrive folder form.
export const FOLDER_SCOPE = 'onedrive:folder';
// The form that adds an allowed sender in Settings.
export const NEW_SENDER = 'sender:new';
// An account's rename form.
export const renameScope = (id: string) => `rename:${id}`;
// The own-account transfer form on a payment, as a failure scope names it.
export const transferScope = (tx: string) => `transfer:${tx}`;
// The forms that add a vendor rule in Settings and on a receipt, as failure scopes name them.
export const NEW_RULE = 'rule:new';
export const RECEIPT_RULE = 'rule:receipt';
// The form that adds a bank account in Settings, as a failure scope names it.
export const NEW_ACCOUNT = 'account:new';
export async function settingsPage(env: Env, params = new URLSearchParams(), origin = ''): Promise<Response> {
  const settings = config(env);
  // The section the last action touched opens; the rest stay folded.
  const open = params.get('open');
  const anchor = feedback(params)?.section ?? (open === 'senders' ? open : '');
  // A refused form opens the section it is in, so the message is on screen.
  const refused = requestState.getStore()?.failure;
  const refusedIn = refused?.scope.startsWith('setup')
    ? SECTION_OF[`setup-${FIELD.get(refused.field as SettingKey)?.group ?? 'business'}`]
    : refused
      ? ({ rule: 'business', sender: 'email', account: 'bank', rename: 'bank', onedrive: 'sending' } as const)[
          refused.scope.split(':')[0] as 'rule'
        ]
      : undefined;
  const opened = new Set([SECTION_OF[anchor], params.has('routing') ? 'email' : '', refusedIn]);
  // The sections don't depend on each other, so they all load at once.
  const [oneDrive, setup, accounts, rules, senders] = await Promise.all([
    oneDrivePart(env, origin),
    setupParts(env, params),
    listAccounts(env.DB),
    env.DB.prepare('SELECT * FROM vendor_rules ORDER BY priority DESC,id LIMIT 200').all<Rule>(),
    sendersPart(env),
  ]);
  const accountsPart = sub(
    'accounts',
    'Bank accounts',
    `${
      accounts.length
        ? rowList(
            accounts.map((a) =>
              row({
                title: escape(a.label),
                meta: `${escape(a.bank_name) || 'No bank'} · ${escape(a.default_currency)}`,
                actions: `<form class="inline-edit" action="/accounts/${encodeURIComponent(a.id)}" method="post"><label class="vh" for="${fieldId(renameScope(a.id), 'label')}">New name for ${escape(a.label)}</label><input id="${fieldId(renameScope(a.id), 'label')}" name="label" value="${escape(kept(renameScope(a.id), 'label', a.label))}"${ariaFor(renameScope(a.id), 'label')}>${button('edit', { label: 'Rename', attrs: ` aria-label="Rename ${escape(a.label)}"` })}${errorLine(renameScope(a.id))}</form>${more(`<p class="hint">ID <code>${escape(a.id)}</code></p>`, escape(a.label))}`,
              }),
            ),
          )
        : '<p>No bank accounts yet. Importing a statement creates one.</p>'
    }<details class="add"${accounts.length && !failureFor(NEW_ACCOUNT) ? '' : ' open'}><summary>Add account</summary><div class="body">${errorLine(NEW_ACCOUNT, '')}<form action="/accounts" method="post"><div class="fields">${input('label', '', 'text', 'Name', { hint: 'For example Main account', scope: NEW_ACCOUNT })}${input('bank_name', '', 'text', 'Bank', { scope: NEW_ACCOUNT })}${select('default_currency', Object.keys(EXPONENTS), settings.defaultCurrency, 'Currency', NEW_ACCOUNT)}</div>${button('add')}</form></div></details><p class="small moved" id="imports">Importing a statement moved to <a href="/payments#imports">Bank</a>.</p><p class="small moved" id="transfers">Own-account transfers moved to <a href="/payments?view=all">Bank</a>.</p>`,
  );
  const rulesPart = sub(
    'rules',
    'Vendor rules',
    `${
      rules.results.length
        ? `<ul class="list rules">${rules.results
            .map((rule) => {
              const scope = `rule:${rule.id}`;
              return `<li><details${failureFor(scope) ? ' open' : ''}><summary>${escape(rule.vendor_contains)} → ${hasParts(env) ? `${escape(productLabel(env, rule.product))}, ` : ''}${escape(rule.expense_type)}${rule.priority ? ` · ${rule.priority}` : ''}</summary><div class="body"><form action="/rules/${rule.id}" method="post">${ruleFields(env, rule, failureFor(scope) ? scope : '')}<div class="btns">${button('save')}${button('remove', { attrs: ` formaction="/rules/${rule.id}/delete"` })}</div></form></div></details></li>`;
            })
            .join('')}</ul>`
        : '<p>No rules yet.</p>'
    }<details class="add"${rules.results.length && !failureFor(NEW_RULE) ? '' : ' open'}><summary>Add rule</summary><div class="body"><form action="/rules" method="post">${ruleFields(env, {}, failureFor(NEW_RULE) ? NEW_RULE : '')}${button('add')}</form></div></details>`,
  );
  const names = settings.sellerNames[0] ?? settings.appName;
  const section = (id: string, title: string, summary: string, inner: string) =>
    sect(id, title, summary, inner, opened.has(id));
  const body = [
    section(
      'business',
      'Business',
      `${escape(names)}${hasParts(env) ? `, ${plural(settings.products.length, 'part')}` : ''}`,
      `${setup.business}${rulesPart}`,
    ),
    section(
      'email',
      'Email',
      `${escape(settings.receiptAddress || 'Off')}, ${settings.allowedSenders.size} allowed`,
      `${setup.email}${senders}`,
    ),
    section('bank', 'Bank', plural(accounts.length, 'account'), accountsPart),
    section('sending', 'Sending', escape(settings.accountantLabel), `${setup.sending}${oneDrive}`),
    section('advanced', 'Advanced', '', `${setup.advanced}${sub('about', 'About', aboutBody(env))}`),
  ].join('');
  return page(
    'settings',
    `<div class="settings">${setup.form}${body}<p class="small"><a href="/help">What do these words mean? Open Help</a></p>${saveBar()}</div>`,
    200,
    env,
    { head: pageHead('Settings', signOutLink(env)) },
  );
}

// ---------- Help ----------
export async function helpPage(env: Env): Promise<Response> {
  return page('help', helpBody(), 200, env, { head: pageHead('Help') });
}

// ---------- Import, step 1 ----------
export async function importPage(env: Env): Promise<Response> {
  return page('import', `<div class="card">${await importForm()}</div>`, 200, env, {
    detail: 'Import a bank statement',
    head: pageHead('Import a bank statement'),
  });
}
