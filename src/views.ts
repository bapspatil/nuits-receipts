// Server-rendered screens. Every form keeps the action, field names and values
// the POST handlers in src/index.ts expect; only labels and layout live here.
import { EXPENSE_TYPES, EXPONENTS, money, object, type Receipt, type Rule, type Tuning } from './domain';
import {
  creditFit,
  eligible,
  eurValue,
  lookalike,
  monthEurValues,
  openSales,
  type EurValue,
  type Transaction,
} from './banking';
import { importForm, wizard } from './imports';
import { listAccounts, listTransfers } from './accounts';
import type { Env } from './env';
import { config, MAX_ALLOWED_SENDERS } from './config';
import { setupParts, SETTINGS_CSP } from './setup';
import { setupChecklist, setupSteps } from './checklist';
import { helpBody } from './help';
import { droppedMail, hasRecentDropped, heldMail, ignoredSenders, reasonAllows, reasonWords } from './inbound';
import { heldSection } from './all';
import { matchedIds, mergePlan } from './dedupe';
import { readableText } from './receipts';
import { discardControl, restoreForm } from './discard';
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
  bodyOf,
  flagCards,
  flagFor,
  isRequired,
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
  chipRow,
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
  uploadForm,
  ariaFor,
  chosenReceipt,
  errorId,
  errorLine,
  matchError,
} from './ui';
import { failureFor, kept } from './request';
import { STATUS, matchStatus } from './status';
import {
  matchableReceipts,
  matchAllLabel,
  pairFacts,
  pickLabels,
  pickMatches,
  receiptName,
  whyLikely,
  type Cell,
  type PairFacts,
} from './match';

type Payment = Transaction & { account_name: string; bank_name: string };
const INLINE_IMAGES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];
export function previewable(r: Pick<Receipt, 'media_type'>): boolean {
  return INLINE_IMAGES.includes(r.media_type);
}

const QUEUE_ORDER = 'ORDER BY issue_date IS NOT NULL, issue_date, received_at, id';
async function reviewQueue(env: Env): Promise<Receipt[]> {
  return (
    await env.DB.prepare(
      `SELECT * FROM receipts WHERE status='needs_review' AND duplicate_of IS NULL AND discarded_at IS NULL ${QUEUE_ORDER} LIMIT 500`,
    ).all<Receipt>()
  ).results;
}
function firstFlag(r: Receipt): string {
  const code = reasonCodes(r.review_reasons_json)[0];
  return code ? flagFor(code).title.replace(/\.$/, '') : 'Needs a look';
}
// The first problem as one word, for lists. The full question is its tooltip.
const REASON_WORDS: Record<string, string> = {
  Seller: 'Seller',
  Date: 'Date',
  Amounts: 'Amount',
  Details: 'Details',
  'Euro amount': 'Euros',
  Filing: 'Filing',
  Duplicate: 'Duplicate',
  Source: 'File',
  Other: 'Check',
};
function reasonWord(r: Receipt): string {
  const cards = flagCards(reasonCodes(r.review_reasons_json));
  const word = REASON_WORDS[cards[0]?.flag.group ?? 'Other'] ?? 'Check';
  return cards.length > 1 ? `${word} +${cards.length - 1}` : word;
}
// Receipts that look like this payment: a fit by name, amount and date first, then ones with
// the same amount and date under another name (the person decides those).
function suggestionsFor(t: Transaction, receipts: Receipt[], rules: Rule[], tuning: Tuning): Receipt[] {
  const near = (r: Receipt) => Math.abs(Date.parse(r.issue_date ?? '') - Date.parse(t.booking_date));
  const rank = (r: Receipt) => (eligible(r, t, rules, tuning) ? 0 : lookalike(r, t, tuning) ? 1 : 2);
  return receipts
    .filter((r) => rank(r) < 2)
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        near(a) - near(b) ||
        (a.issue_date ?? '').localeCompare(b.issue_date ?? '') ||
        a.id.localeCompare(b.id),
    );
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
      "SELECT count(*) n FROM receipts WHERE issue_date IS NULL AND duplicate_of IS NULL AND discarded_at IS NULL AND status='needs_review'",
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
    if (r.status !== 'ready') unchecked += BigInt(eur.minor);
    const key = r.product + '\u0000' + r.expense_type;
    matrix.set(key, (matrix.get(key) ?? 0n) + BigInt(eur.minor));
  });
  const out = payments.filter((t) => t.amount_minor < 0);
  const missing = out.filter((t) => t.receipt_required && !t.receipt_id);
  let invoiced = 0n;
  for (const eur of all.slice(rows.length)) invoiced += BigInt(eur.minor ?? 0);
  const isReading = (r: Receipt) => r.status === 'pending' || r.status === 'processing';
  const flagged = [...rows, ...sales].filter((r) => r.status === 'needs_review');
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
    ready: rows.filter((r) => r.status !== 'needs_review' && !isReading(r)).length,
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

// ---------- Review queue ----------
export async function reviewPage(
  env: Env,
  filter: ReviewFilter | null,
  params = new URLSearchParams(),
): Promise<Response> {
  // Rows a bank line points at: Discard asks to remove the match too.
  const known = matchedIds(env);
  const [all, held, reading, merges, matched] = await Promise.all([
    reviewQueue(env),
    heldMail(env),
    env.DB.prepare(
      "SELECT count(*) n FROM receipts WHERE status IN ('pending','processing') AND duplicate_of IS NULL AND discarded_at IS NULL",
    ).first<number>('n'),
    mergePlan(env, known),
    known,
  ]);
  const rows = filter ? all.filter((r) => matchesFilter(reasonCodes(r.review_reasons_json), filter)) : all;
  const undated = all.filter((r) => r.issue_date === null).length;
  const mergeable = merges.length;
  const merge = mergeable
    ? `<form class="merge" action="/review/merge" method="post"><button class="btn secondary">Merge ${plural(mergeable, 'duplicate')}</button></form>`
    : '';
  const chips = chipRow('Filter', [
    { href: '/review', label: 'All', count: all.length, current: !filter },
    ...(Object.keys(REVIEW_FILTERS) as ReviewFilter[]).map((k) => ({
      href: `/review?reason=${k}`,
      label: REVIEW_FILTERS[k].label,
      count: all.filter((r) => matchesFilter(reasonCodes(r.review_reasons_json), k)).length,
      current: k === filter,
    })),
  ]);
  const selecting = params.get('select') === '1' && rows.length > 0;
  const here = filter ? `/review?reason=${filter}` : '/review';
  const select =
    rows.length > 1 && !selecting
      ? `<a class="linkbtn select" href="${here}${filter ? '&' : '?'}select=1">Select</a>`
      : '';
  // Row 1 is the next to check: its name is the screen's one primary.
  const items = rows
    .map((r, i) => {
      const name = escape(receiptName(r));
      const why = `<span class="why" title="${escape(firstFlag(r))}">${escape(reasonWord(r))}</span>`;
      const amt = `<span class="amt">${r.total_minor === null ? '' : amount(r.total_minor, r.currency)}</span>`;
      return selecting
        ? `<li><label class="pick"><input type="checkbox" name="id" value="${r.id}">${name}</label>${amt}${why}</li>`
        : `<li><a${i ? '' : ' class="btn primary"'} href="/receipts/${r.id}">${name}</a>${amt}${why}${discardControl(r.id, { back: '/review', matched: matched.has(r.id), name: receiptName(r) })}</li>`;
    })
    .join('');
  const list = rows.length
    ? selecting
      ? `<form class="bulk" method="post" action="/discard"><input type="hidden" name="back" value="/review"><ul class="list checks">${items}</ul><div class="bar">${discardControl(null, { back: '/review', matched: rows.some((r) => matched.has(r.id)), bare: true })}<a class="linkbtn" href="${here}">Cancel</a></div></form>`
      : `<ul class="list checks">${items}</ul>`
    : all.length
      ? emptyState('Nothing in this filter.', `<a class="btn primary" href="/review">Show all ${all.length}</a>`)
      : held.length
        ? ''
        : emptyState('Nothing to check.', '<a class="btn primary" href="/receipts">See receipts</a>');
  return page(
    'review',
    `${merge || select ? `<div class="tools">${merge}${select}</div>` : ''}${heldSection(held, 'review', !rows.length)}${all.length > 5 || filter ? chips : ''}${reading ? `<p class="banner" role="status">${reading} being read</p>` : ''}${list}`,
    200,
    env,
    {
      head: pageHead(
        all.length
          ? `${all.length} to check${undated ? `, ${undated} undated` : ''}`
          : held.length
            ? `${plural(held.length, 'email')} to allow`
            : 'All checked',
      ),
    },
  );
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

// The review queue around one receipt: its place, and the one to open after it.
export async function queueAround(
  env: Env,
  id: string,
): Promise<{ position: number; total: number; next: string | null }> {
  const queue = (await reviewQueue(env)).map((q) => q.id);
  const position = queue.indexOf(id);
  const next = (position >= 0 ? queue[position + 1] : undefined) ?? queue.find((q) => q !== id) ?? null;
  return { position, total: queue.length, next };
}

// The failure scope of the receipt form.
const RECEIPT = 'receipt';
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
          .filter((t) => eligible(r, t, rules, config(env).tuning))
          .sort(
            (a, b) =>
              Math.abs(Date.parse(a.booking_date) - Date.parse(r.issue_date ?? '')) -
                Math.abs(Date.parse(b.booking_date) - Date.parse(r.issue_date ?? '')) ||
              a.booking_date.localeCompare(b.booking_date) ||
              a.account_key.localeCompare(b.account_key) ||
              a.id.localeCompare(b.id),
          );
  const { position, total, next } = await queueAround(env, r.id);
  const duplicates = (
    await env.DB.prepare(
      'SELECT * FROM receipts WHERE id<>? AND duplicate_of IS NULL AND discarded_at IS NULL AND (lower(vendor)=lower(?) OR total_minor=? OR id=?) ORDER BY issue_date DESC,id LIMIT 50',
    )
      .bind(r.id, r.vendor ?? '', r.total_minor ?? -1, r.duplicate_of ?? '')
      .all<Receipt>()
  ).results;

  // Other files of the same charge (the receipt PDF next to the invoice PDF).
  const files = (
    await env.DB.prepare('SELECT id,filename FROM receipts WHERE duplicate_of=? ORDER BY received_at,id LIMIT 20')
      .bind(r.id)
      .all<{ id: string; filename: string }>()
  ).results;
  const codes = reasonCodes(r.review_reasons_json);
  const gone = !!r.discarded_at;
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
  // The original as text when it isn't an image; its number format is echoed in the hints.
  const shown = previewable(r) ? null : await readableText(env, r);
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
    `<div class="srow"><div class="sl"><label class="flabel" for="${c.id}"${title ? ` title="${escape(title)}"` : ''}>${label}</label>${meta ? `<span class="meta">${meta}</span>` : ''}</div><div class="sc">${c.html}${c.note ? `<p class="meta" id="h-${c.id.slice(2)}">${escape(c.note)}</p>` : ''}${errorLine(RECEIPT, c.id.slice(2))}</div></div>`;
  const rows = (name: FlagField | 'due_date') =>
    controls(name)
      .map((c) => row(c))
      .join('');
  const retryButton = (label: string, kind: 'primary' | 'secondary', outside = false) =>
    `<button class="btn ${kind}"${outside ? ' form="fix"' : ''} formaction="/receipts/${r.id}/retry">${label}</button>`;
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
      const names = flag.fields.filter((f) => !placed.has(f));
      const tier: Tier = isRequired(flag) ? 'req' : 'opt';
      const body = bodyOf(flag, r);
      const extra =
        flag.action === 'retry' && !unverified
          ? `<div class="fx">${retryButton('Read again', 'secondary')}</div>`
          : flag.action === 'upload'
            ? `<div class="fx"><a href="/add${sales ? '?kind=sales' : ''}">Upload a copy</a></div>`
            : flag.action === 'move'
              ? `<div class="fx"><button class="btn secondary" formaction="/receipts/${r.id}/kind" name="kind" value="expense">Move to receipts</button></div>`
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
    .filter((f) => !placed.has(f))
    .map(rows);
  const due = rows('due_date');
  const fx = placed.has('eur_override') ? '' : rows('eur_override');
  const dup = placed.has('duplicate_of') ? '' : rows('duplicate_of');
  const heading = reading ? STATUS.reading : needs ? `${cards.length} to check` : '';
  const note = `<details class="note"${failureFor(RECEIPT)?.field === 'approval_reason' ? ' open' : ''}><summary>Note</summary><div class="body rowlist">${row(
    {
      id: 'f-approval_reason',
      label: 'For your accountant',
      html: `<input name="approval_reason" value="${escape(kept(RECEIPT, 'approval_reason', 'Checked against the original'))}" type="text" id="f-approval_reason"${ariaFor(RECEIPT, 'approval_reason')}>`,
    },
  )}</div></details>`;
  const ready = r.status === 'ready';
  const linkedRow = await env.DB.prepare('SELECT match_method FROM bank_transactions WHERE receipt_id=? LIMIT 1')
    .bind(r.id)
    .first<{ match_method: 'automatic' | 'manual' | null }>();
  const linked = !!linkedRow;
  const status = gone
    ? `<span class="stamp muted">Discarded${r.discard_reason ? ` · ${DISCARD_REASONS[r.discard_reason]}` : ''}</span>`
    : sales
      ? salesStamp({ ...r, paid_bank_on: eur.transaction ? 'linked' : null }, config(env).tuning.paymentTermsDays)
      : stamp(r, linkedRow ? (linkedRow.match_method ?? 'manual') : null);
  // A ready receipt opens as its summary; Edit opens every field.
  const summary = ready
    ? `<dl class="kv sum"><div><dt>${sales ? 'Client' : 'Seller'}</dt><dd>${escape(receiptName(r))}</dd></div><div><dt>Date</dt><dd>${r.issue_date ? day(r.issue_date) : 'None'}</dd></div><div><dt>Total</dt><dd>${r.total_minor === null ? 'None' : amount(r.total_minor, r.currency)}</dd></div><div><dt>Payment</dt><dd>${sales ? status : linkedRow ? matchStatus(linkedRow.match_method) : 'Not matched yet'}</dd></div></dl>`
    : '';
  const fold = ready ? 'Edit' : needs ? 'Other fields' : 'All fields';
  const verb = needs || reading ? 'approve' : 'save';
  // Enter in a field submits the form's first submit button: the same as the bar's, never Skip or Read again.
  const enter = `<button class="vh" name="action" value="${verb}" tabindex="-1" aria-hidden="true">${verb === 'approve' ? 'Approve' : 'Save'}</button>`;
  const form = `<form action="/receipts/${r.id}" method="post" class="fix" id="fix">${enter}${hidden('revision', r.revision)}${errorLine(RECEIPT, '')}${heading ? `<h2 id="fix-h">${heading}</h2>` : ''}${flagList}${readList}${summary}
    <details class="all"${failureFor(RECEIPT) || (!needs && !ready) ? ' open' : ''}><summary>${fold}</summary><div class="body rowlist">${rest.join('')}${filing.join('')}${due}${dup}${fx}${eur.source === 'native' ? '' : `<p class="small">${escape(eurLine(eur))}</p>`}</div></details>
    ${note}</form>`;
  const matches = sales
    ? await paymentBox(env, { ...r, paid_bank_on: eur.transaction ? 'linked' : null })
    : suggestions.length
      ? `<section aria-labelledby="match-h" class="matchs"><h2 id="match-h">Payment?</h2>${suggestions
          .map((t) => {
            // Only a pair that isn't an exact fit asks for the exception, and says why.
            const facts = pairFacts(r, t, rules, config(env).tuning);
            return `<form action="/matches" method="post" class="match"><p><strong>${amount(-t.amount_minor, t.currency)}</strong> to ${escape(t.merchant)}, ${day(t.booking_date, false)} <span class="hint">${escape(t.account_name)}</span></p><input type="hidden" name="transaction_id" value="${t.id}"><input type="hidden" name="receipt_id" value="${r.id}"><input type="hidden" name="on_error" value="/receipts/${r.id}">${facts.exact ? '' : `<input type="hidden" name="confirm_exception" value="yes"><p class="likely__why" id="e-why-${t.id}">${escape(facts.reason)} <a href="/help#match-anyway">What is this?</a></p>`}<button class="btn secondary" id="f-confirm-${t.id}" name="action" value="link">${facts.exact ? 'Match' : 'Match anyway'}</button></form>${matchError(t.id)}`;
          })
          .join('')}</section>`
      : '';
  const move =
    sales || config(env).invoicesAddress
      ? `<form action="/receipts/${r.id}/kind" method="post">${hidden('revision', r.revision)}<button class="linkbtn" name="kind" value="${sales ? 'expense' : 'sales'}">${sales ? 'Move to receipts' : 'Move to invoices'}</button></form>`
      : '';
  const always = sales
    ? ''
    : `<details><summary>Always file as</summary><div class="body"><form action="/rules" method="post"><input type="hidden" name="return_to" value="/receipts/${r.id}">${ruleFields(env, { vendor_contains: r.vendor ?? '', product: config(env).products.some((p) => p.id === r.product) ? r.product : config(env).defaultProduct, expense_type: r.expense_type })}<button class="btn secondary">Save rule</button></form></div></details>`;
  const tech = `<details class="tech"><summary>Technical details</summary><div class="body"><p class="hint">Status <code>${escape(r.status)}</code>. Reason codes:</p><pre tabindex="0">${escape(r.review_reasons_json)}</pre><p class="hint">Euro amount: ${escape(eur.source)}${eur.transaction ? `. Bank transaction <code>${escape(eur.transaction)}</code> · Account ${escape(eur.accountName)}` : '. No bank match.'}</p><pre tabindex="0">${escape(r.ai_json)}\n${escape(r.manual_fields_json)}</pre><p class="hint">Receipt ID <code>${r.id}</code></p></div></details>`;
  const extras = `<details class="more"><summary>More</summary><div class="body"><form action="/receipts/${r.id}/retry" method="post"><button class="linkbtn">Read again</button></form>${move}<p><a href="/originals/${r.id}">Download original</a>${r.email_key ? ` · <a href="/originals/${r.id}?variant=email">Source email</a>` : ''}</p>${files.length ? `<p>Files: ${files.map((f) => `<a href="/originals/${f.id}">${escape(f.filename)}</a>`).join(' · ')}</p>` : ''}<details><summary>Upload a copy</summary><div class="body">${uploadForm('', false, r.kind)}</div></details>${always}${tech}</div></details>`;
  const pdf = r.media_type === 'application/pdf';
  // A PDF is not embedded: the page's CSP allows no frames or objects. Its text is shown instead.
  const open = `<p><a class="btn secondary" href="/originals/${r.id}${!pdf && r.email_key && r.media_type === 'message/rfc822' ? '?variant=email' : ''}">${pdf ? 'Open PDF' : 'Open original'}</a></p>`;
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
    ? '<a href="/receipts?show=discarded">‹ Discarded</a>'
    : needs
      ? '<a href="/review">‹ Review</a>'
      : sales
        ? `<a href="/invoices${r.issue_date ? `?month=${r.issue_date.slice(0, 7)}` : ''}">‹ Invoices</a>`
        : '<a href="/receipts">‹ Receipts</a>';
  const nextLink = !gone && !needs && next ? `<a href="/receipts/${next}">Next to check ›</a>` : '';
  const skip =
    needs && next && next !== r.id
      ? `<button class="linkbtn" form="fix" name="action" value="skip">Skip ›</button>`
      : '';
  const discard = discardControl(r.id, { back: needs ? 'queue' : '/receipts', matched: linked, revision: r.revision });
  const restore = `<section class="gone" aria-label="Discarded">${restoreForm(r.id, `/receipts/${r.id}`, true)}</section>`;
  const primary = reading || unverified ? 'secondary' : 'primary';
  const verbLabel = verb === 'save' ? 'Save' : sales ? 'Approve invoice' : 'Approve receipt';
  // One bar on every width: where you are, the quiet actions, and the one primary.
  const bar = `<div class="sbar" role="group" aria-label="Actions">${needs && position >= 0 ? `<span class="prog">${position + 1} of ${total} to check</span>` : ''}${skip}${discard}${extras}${unverified ? retryButton('Read it', 'primary', true) : ''}${reading ? `<a class="btn primary" href="/receipts/${r.id}">Refresh</a>` : ''}<button class="btn ${primary}" form="fix" name="action" value="${verb}">${verbLabel}</button></div>`;
  return page(
    needs && !gone ? 'reviewItem' : 'receipt',
    `<div class="work"><section class="doc" aria-label="Original">${gone ? '' : '<a class="skip" href="#fix">Skip to the fields</a>'}<h2 class="doch">${docTitle}</h2>${doc}</section><section class="fixes" aria-label="Fields">${gone ? `${restore}${extras}` : `${form}${matches}${bar}`}</section></div>`,
    200,
    env,
    {
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
      `SELECT count(*) "out",count(t.receipt_id) matched,total(t.receipt_id IS NULL AND t.receipt_required=0) exempt,total(t.receipt_id IS NULL AND t.receipt_required=1) missing FROM bank_transactions t JOIN imports i ON i.id=t.import_id WHERE i.status='complete' AND t.amount_minor<0 AND substr(t.booking_date,1,7)=? AND NOT EXISTS(SELECT 1 FROM internal_transfers p WHERE p.debit_id=t.id)`,
    ).bind(month),
    env.DB.prepare(
      "SELECT r.id FROM receipts r JOIN bank_transactions t ON t.receipt_id=r.id WHERE r.status='needs_review' AND substr(t.booking_date,1,7)=?",
    ).bind(month),
  ]);
  const n = (sums?.results[0] ?? {}) as Record<string, number>;
  return {
    out: n.out ?? 0,
    matched: n.matched ?? 0,
    exempt: n.exempt ?? 0,
    missing: n.missing ?? 0,
    reviewing: new Set(((reviewing?.results ?? []) as { id: string }[]).map((r) => r.id)),
  };
}
// month: the month to show, or the lookup that picks it, so the queries that
// don't need it start right away.
export async function payments(
  env: Env,
  month: string | Promise<string>,
  offset: number,
  params = new URLSearchParams(),
): Promise<Response> {
  const chosen = Promise.resolve(month);
  // One round for everything. The open invoices, the transfer credits and the
  // receipts still in Review are needed only for some months, but loading them
  // every time is cheaper than waiting a second round for them.
  const [
    selected,
    rows,
    receipts,
    allInvoices,
    rules,
    transfers,
    allCredits,
    counts,
    elsewhere,
    droppedRecently,
    history,
  ] = await Promise.all([
    chosen,
    chosen.then((m) =>
      env.DB.prepare(
        "SELECT t.*,a.label AS account_name,a.bank_name FROM bank_transactions t JOIN imports i ON i.id=t.import_id JOIN accounts a ON a.id=t.account_key WHERE i.status='complete' AND substr(t.booking_date,1,7)=? ORDER BY t.booking_date,t.account_key,t.id LIMIT 100 OFFSET ?",
      )
        .bind(m, offset)
        .all<Payment>()
        .then((r) => r.results),
    ),
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
    // The whole month in numbers, whichever page of it is shown, and the
    // matched receipts that still need a look.
    chosen.then((m) => monthCounts(env, m)),
    chosen.then((m) =>
      env.DB.prepare(
        `SELECT substr(t.booking_date,1,7) m, count(*) n ${MISSING_PAYMENTS} AND substr(t.booking_date,1,7)<>? GROUP BY m ORDER BY m DESC LIMIT 12`,
      )
        .bind(m)
        .all<{ m: string; n: number }>()
        .then((r) => r.results),
    ),
    hasRecentDropped(env),
    statements(env),
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
  // One likely receipt for each missing payment, no receipt twice. Only exact fits go in Match all.
  const taken = new Set<string>();
  const likelyOf = new Map<string, Receipt>();
  const bulk: { t: Payment; r: Receipt; facts: PairFacts }[] = [];
  for (const t of open) {
    const list = suggestionsFor(t, receipts, rules, tuning);
    const r = list.find((x) => !taken.has(x.id)) ?? list[0];
    if (!r) continue;
    likelyOf.set(t.id, r);
    if (taken.has(r.id)) continue;
    taken.add(r.id);
    const facts = pairFacts(r, t, rules, tuning);
    if (facts.exact) bulk.push({ t, r, facts });
  }
  const isMissing = unmatched;
  const missing = open;
  // Missing first: it is the only thing Bank asks of you.
  const automatic = rows.filter((t) => t.receipt_id && t.match_method === 'automatic');
  const show =
    params.get('show') === 'auto' && automatic.length
      ? 'auto'
      : params.get('show') === 'all' || (params.get('show') !== 'missing' && !missing.length)
        ? 'all'
        : 'missing';
  const firstMissing = missing[0]?.id;
  const firstTransfer = rows.find((t) => paired.has(t.id))?.id;
  const shown = show === 'missing' ? missing : show === 'auto' ? automatic : rows;
  const dayIn = (value: string | null, other: string) =>
    value ? day(value, value.slice(0, 4) !== other.slice(0, 4)) : 'None';
  // Name, Date and Amount side by side, each marked in words, with the one button under it.
  const likelyForm = (t: Payment, r: Receipt, noun: string, primary: boolean) => {
    const facts = pairFacts(r, t, rules, tuning);
    const scope = `match:${t.id}`;
    const line = (label: string, bank: string, other: string, cell: Cell) =>
      `<tr><th scope="row">${label}</th><td${cell.same ? '' : ' data-l="Bank"'}>${bank}</td><td${cell.same ? ' class="dup"' : ` data-l="${noun}"`}>${other}</td><td class="${cell.same ? 'same' : 'diff'}">${escape(cell.text)}</td></tr>`;
    const why = facts.exact
      ? ''
      : `<p class="likely__why" id="e-why-${t.id}">${escape(facts.reason)} <a href="/help#match-anyway">What is this?</a></p>`;
    const described = [
      facts.exact ? '' : `e-why-${t.id}`,
      failureFor(scope)?.field === 'confirm_exception' ? errorId(scope) : '',
    ]
      .filter(Boolean)
      .join(' ');
    return `<form action="/matches" method="post" class="likely" aria-labelledby="lk-${t.id}"><p class="likely__head"><strong id="lk-${t.id}">Likely: ${escape(receiptName(r))}, ${dayIn(r.issue_date, t.booking_date)}, ${amount(r.total_minor, r.currency)}</strong></p><table class="cmp"><thead><tr><th scope="col"><span class="vh">Field</span></th><th scope="col">Bank</th><th scope="col">${noun}</th><th scope="col">Compared</th></tr></thead><tbody>${line('Name', escape(t.merchant), escape(receiptName(r)), facts.name)}${line('Date', day(t.booking_date, false), dayIn(r.issue_date, t.booking_date), facts.date)}${line('Amount', amount(t.amount_minor, t.currency), amount(r.total_minor, r.currency), facts.amount)}</tbody></table>${why}<input type="hidden" name="transaction_id" value="${t.id}"><input type="hidden" name="receipt_id" value="${r.id}">${facts.exact ? '' : '<input type="hidden" name="confirm_exception" value="yes">'}<button class="btn ${primary ? 'primary' : 'secondary'}" id="f-confirm-${t.id}"${described ? ` aria-describedby="${described}"` : ''} name="action" value="link">${facts.exact ? 'Match' : 'Match anyway'}</button></form>`;
  };
  // The search box: type a seller, a date or an amount, or pick from the list.
  const picker = (t: Payment, listId: string, noun: string) => {
    const typed = chosenReceipt(t.id);
    return `<form action="/matches" method="post" class="pmatch"><input type="hidden" name="transaction_id" value="${t.id}"><input name="receipt_id" list="${listId}" autocomplete="off" aria-label="${noun}" placeholder="Seller, date or amount" value="${ID.test(typed) ? '' : escape(typed)}"${ariaFor(`match:${t.id}`, 'receipt_id')}><button class="btn secondary" name="action" value="link">Match</button></form>`;
  };
  // A likely pair first, the search box behind it; no pair, the search box alone.
  const matchControls = (
    t: Payment,
    pool: Receipt[],
    listId: string,
    noun: string,
    likely: Receipt | undefined,
    primary: boolean,
  ) => {
    const lower = noun.toLowerCase();
    const pair = chosenOf(t, pool) ?? likely;
    return pair
      ? `${likelyForm(t, pair, noun, primary)}<details${failureFor(`match:${t.id}`)?.field === 'receipt_id' ? ' open' : ''}><summary>Pick another ${lower}</summary><div class="body">${picker(t, listId, noun)}</div></details>`
      : `<p class="none">No ${lower === 'invoice' ? 'open invoice' : 'receipt'} fits.</p>${picker(t, listId, noun)}${lower === 'invoice' ? '' : `<a class="btn ${primary ? 'primary' : 'secondary'}" href="/add">Add receipt</a>`}`;
  };
  const items = shown
    .map((t) => {
      const pair = paired.get(t.id);
      const extra: string[] = [];
      let status: string,
        controls = '';
      if (pair) {
        status = tag(
          t.id === pair.debit_id
            ? `Transfer to ${escape(pair.credit_account_name)}`
            : `Transfer from ${escape(pair.debit_account_name)}`,
        );
        extra.push(
          `<form action="/transfers/${pair.debit_id}/undo" method="post"><button class="linkbtn">Undo transfer</button></form>`,
        );
      } else if (t.receipt_id) {
        status = `${tag(matchStatus(t.match_method), true, t.match_method === 'automatic')} <a class="tag" href="/receipts/${t.receipt_id}">${t.amount_minor > 0 ? 'Invoice' : 'Receipt'}</a>${counts.reviewing.has(t.receipt_id) ? ` <a class="stamp needs" href="/receipts/${t.receipt_id}">${STATUS.needs}</a>` : ''}`;
        extra.push(
          `<form action="/matches" method="post"><input type="hidden" name="transaction_id" value="${t.id}"><button class="linkbtn" name="action" value="unlink">Remove match</button></form>`,
        );
      } else if (t.amount_minor >= 0) {
        status = tag('Money in');
        const likely = invoices.find((r) => creditFit(r, t, tuning) !== null);
        if (invoices.length && t.amount_minor > 0 && t.receipt_required)
          controls = `${matchControls(t, invoices, 'pick-invoices', 'Invoice', likely, false)}${matchError(t.id)}`;
      } else if (!t.receipt_required) {
        const by = t.exempt_by && t.exempt_by !== 'owner' ? EXEMPT_LABELS[t.exempt_by] : '';
        status = `${tag(STATUS.notPurchase)}${by ? ` <span class="tag">${by}</span>` : ''}`;
        extra.push(
          `<form action="/payments/${t.id}" method="post"><button class="linkbtn" name="receipt_required" value="1">Needs a receipt</button></form>`,
        );
      } else {
        const first = t.id === firstMissing;
        const likely = likelyOf.get(t.id);
        status = `<span class="stamp missing">${STATUS.missing}</span>`;
        const find = receipts.length
          ? matchControls(t, receipts, 'pick-receipts', 'Receipt', likely, first)
          : `<p class="none">No receipt found yet.</p><a class="btn ${first ? 'primary' : 'secondary'}" href="/add">Add receipt</a>`;
        const dropped =
          droppedRecently && !likely
            ? `<p class="small"><a href="/settings?open=mail#mail">Check mail we didn't keep</a></p>`
            : '';
        controls = `<div class="fixrow">${find}<form action="/payments/${t.id}" method="post"><button class="linkbtn" name="receipt_required" value="0">${STATUS.notPurchase}</button></form></div>${dropped}${matchError(t.id)}`;
        if (receipts.length && likely) extra.push('<p><a href="/add">Add a receipt</a></p>');
        const sides = credits.filter(
          (c) => c.account_key !== t.account_key && c.currency === t.currency && c.amount_minor === -t.amount_minor,
        );
        if (sides.length)
          extra.push(
            `<form action="/transfers" method="post" class="transfer"><input type="hidden" name="debit_id" value="${t.id}"><select name="credit_id" aria-label="Arrived in">${sides.map((c) => `<option value="${c.id}">${escape(c.account_name)} · ${escape(day(c.booking_date, false))}</option>`).join('')}</select><input name="reason" aria-label="Note" placeholder="Note" maxlength="500" required><button class="btn secondary">Own transfer</button></form>`,
          );
      }
      return `<li class="pay${isMissing(t) ? ' missing' : ''}"${t.id === firstTransfer ? ' id="transfers"' : ''}><div class="line"><span class="who">${escape(t.merchant)}</span><span class="amt">${amount(t.amount_minor, t.currency)}</span><span class="meta"><span class="when">${day(t.booking_date, false)}${accounts.size > 1 ? ` <span class="hint">${escape(t.account_name)}</span>` : ''}</span> <span class="st">${status}</span></span>${extra.length ? more(extra.join(''), escape(t.merchant)) : ''}</div>${controls}</li>`;
    })
    .join('');
  const datalistOptions = (pool: Receipt[]) =>
    [...pickLabels(pool, year).values()].map((label) => `<option value="${escape(label)}"></option>`).join('');
  const lists = `${items.includes('list="pick-receipts"') ? `<datalist id="pick-receipts">${datalistOptions(receipts)}</datalist>` : ''}${items.includes('list="pick-invoices"') ? `<datalist id="pick-invoices">${datalistOptions(invoices)}</datalist>` : ''}`;
  // What Match all will accept, pair by pair with its reason, before it is pressed.
  const matchAll = bulk.length
    ? `<form action="/matches/bulk" method="post" class="matchall"><input type="hidden" name="month" value="${selected}"><details open><summary>Will match ${plural(bulk.length, 'payment')}</summary><ul>${bulk
        .map(
          ({ t, r, facts }) =>
            `<li>${escape(t.merchant)}, ${day(t.booking_date, false)}, ${amount(t.amount_minor, t.currency)} to ${escape(receiptName(r))}<span>${escape(whyLikely(facts))}</span></li>`,
        )
        .join(
          '',
        )}</ul></details>${bulk.map(({ t, r }) => `<input type="hidden" name="transaction_id" value="${t.id}"><input type="hidden" name="receipt_id" value="${r.id}">`).join('')}<button class="btn secondary">${matchAllLabel(bulk.length)}</button></form>`
    : '';
  const others = elsewhere.length
    ? `<p class="small">Also missing: ${elsewhere.map((e) => `<a href="/payments?month=${e.m}&show=missing">${escape(monthName(e.m))} (${e.n})</a>`).join(', ')}</p>`
    : '';
  const filter = chipRow('Show', [
    { href: `/payments?month=${selected}&show=all`, label: 'All', count: rows.length, current: show === 'all' },
    {
      href: `/payments?month=${selected}&show=missing`,
      label: STATUS.missing,
      count: counts.missing,
      current: show === 'missing',
    },
    {
      href: `/payments?month=${selected}&show=auto`,
      label: STATUS.matchedAuto,
      count: automatic.length,
      current: show === 'auto',
    },
  ]);
  const body = rows.length
    ? `<p class="summary"><span>${counts.out} out, ${counts.matched} matched, ${counts.exempt} ${STATUS.notPurchase.toLowerCase()}, <span${counts.missing ? ' class="red"' : ''}>${counts.missing} missing</span>${counts.reviewing.size ? `, ${counts.reviewing.size} ${STATUS.needs.toLowerCase()}` : ''}</span></p>${filter}${
        open.length ? '' : await settled(env, selected)
      }${matchAll}${shown.length ? `<div class="pays-h" aria-hidden="true"><span>Date</span><span>Paid to</span><span>Amount</span><span>State</span></div><ol class="pays">${items}</ol>${lists}` : ''}${
        offset > 0 || rows.length === 100
          ? `<p>${offset > 0 ? `<a href="/payments?month=${selected}&show=${show}&offset=${Math.max(0, offset - 100)}">Earlier</a>` : ''}${offset > 0 && rows.length === 100 ? ' · ' : ''}${rows.length === 100 ? `<a href="/payments?month=${selected}&show=${show}&offset=${offset + 100}">Later</a>` : ''}</p>`
          : ''
      }`
    : emptyState(
        `No statement for ${escape(monthName(selected))} yet.`,
        '<a class="btn primary" href="/import">Import statement</a>',
      );
  return page('bank', `${others}${body}${history}`, 200, env, {
    detail: monthName(selected),
    head: monthHead('/payments', selected),
  });
}

// Bank when every payment has a receipt: say so, and offer the month's next step as the one
// primary. Once the month is sent there is none, and a quiet link back to it.
async function settled(env: Env, selected: string): Promise<string> {
  const s = await monthState(env, selected);
  const short = escape(monthName(selected, false));
  const step = nextStep(s, selected);
  const action = s.sent
    ? `<p>${tag(`${short} is ${STATUS.sent.toLowerCase()}`, true)} <a href="/?month=${selected}#send">Open ${short}</a></p>`
    : step
      ? `<a class="btn primary" href="${step.href}">${step.label}</a>`
      : s.docs
        ? `<a class="btn primary" href="/?month=${selected}#send">Send ${short}</a>`
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
function nextStep(s: MonthState, selected: string): { label: string; href: string } | null {
  if (s.docs === 0) return { label: 'Add receipts', href: '/add' };
  if (!s.done.review) return { label: 'Check receipts', href: '/review' };
  if (!s.imported) return { label: 'Import statement', href: '/import' };
  if (!s.done.match) return { label: 'Find receipts', href: `/payments?month=${selected}&show=missing` };
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
  const alert = overdue.length
    ? `<a href="/invoices?month=${selected}&show=overdue">${plural(overdue.length, 'invoice')} overdue ›</a>`
    : unverified
      ? `<a href="/review?reason=sender">${plural(unverified, 'email')} not verified ›</a>`
      : '';
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
      ? row(1, 'Check', `${s.flagged.length} to check${undated ? `, ${undated} undated` : ''}`, '/review', true)
      : undated
        ? row(1, 'Check', `${undated} undated`, '/review', true)
        : row(1, 'Check', 'All checked', `/receipts?month=${selected}`, false, true);
  const match = !s.imported
    ? row(2, 'Match', 'No statement', '/import', current === 2)
    : s.missing.length
      ? row(2, 'Match', `${s.missing.length} missing`, `/payments?month=${selected}&show=missing`, true)
      : row(2, 'Match', 'All matched', `/payments?month=${selected}`, false, true);
  const send = await sendStep(env, s, selected, current, params, undatedDocs);
  const step = nextStep(s, selected);
  const next = step && current < 3 ? `<a class="btn primary" href="${step.href}">${step.label}</a>` : '';
  const dated = [
    s.rows.length ? plural(s.rows.length, 'receipt') : '',
    s.sales.length ? plural(s.sales.length, 'invoice') : '',
  ]
    .filter(Boolean)
    .join(', ');
  // Why Home opened here, when it is not the current month.
  const why =
    arrival && arrival.month !== arrival.current
      ? `<p class="lede why"><strong>${escape(short)} ${s.send.last && s.send.changed ? 'changed since you sent it' : "isn't sent yet"}.</strong> ${s.send.last && s.send.changed ? '<a href="#send">See what changed.</a>' : lacks(s, undated)} · <a href="/?month=${arrival.current}">Go to ${escape(monthName(arrival.current, false))}</a></p>`
      : '';
  return page(
    'home',
    `${checklist ?? ''}${why}${alert ? `<p class="alert" role="note">${alert}</p>` : ''}${next ? `<div class="next">${next}</div>` : ''}<ol class="steps" aria-label="Close ${escape(monthName(selected))}">${check}${match}${row(3, 'Send', send.status, send.body ? '#send' : '')}</ol>${send.body ? `<div id="send">${send.body}</div>` : ''}${dated ? `<p class="dated"><a href="/receipts?month=${selected}">${dated} dated ${escape(short)} ›</a></p>` : ''}`,
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
  const csv = `<a class="linkbtn" href="/export.csv?month=${selected}">CSV</a>`;
  const zip = (o: Partial<PackageOptions>, text: string, cls = 'secondary') =>
    `<a class="btn ${cls}" href="/month/package.zip?${query(selected, o)}">${text}</a>`;
  const uploadForm = (o: Partial<PackageOptions>, text: string, cls = 'secondary') =>
    `<form action="/month/onedrive-upload" method="post">${optionFields(selected, o)}<button class="btn ${cls}">${text}</button></form>`;
  const short = escape(monthName(selected, false));
  const markSent = `<form action="/month/sent" method="post">${hidden('month', selected)}${hidden('receipts_hash', s.send.hash)}<button class="btn secondary">Mark ${short} as sent</button></form>`;
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
  const parts = rowsByKey.length
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
    `<div class="card active send">${spent}${before}<div class="btns">${buttons}${csv}</div>${hint}${line}${didSend}${manifest}${parts}</div>`;

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
      status: `${STATUS.sent} ${escape(sentOn)}`,
      body: `<div class="card">${s.send.last!.method === 'onedrive' ? '<p class="small">Via OneDrive</p>' : ''}<p><a href="/?month=${next}">On to ${escape(monthName(next, false))} ›</a></p><div class="btns">${zip({ anyway: !ready }, 'Download again')}${csv}</div></div>`,
    };
  }
  if (ready) {
    const download = `Download ZIP${sized ? ` (${size(bytes)})` : ''}`;
    const buttons =
      upload && upload.pending.length
        ? `${uploadForm(chosen, upload.plan.files.length - upload.pending.length ? 'Continue upload' : `Upload to ${folder}`, kind)}${zip(chosen, download)}`
        : zip(chosen, download, kind);
    return { status: STATUS.ready, body: panel(buttons, destination) };
  }
  // Not ready: download anyway, behind one fold.
  const undated = plan.undated
    ? `<label class="check"><input type="checkbox" name="undated" value="1">Add ${plural(plan.undated, 'undated receipt')}</label>`
    : '';
  const anyway = `<form action="/month/package.zip" method="get">${hidden('month', selected)}${hidden('anyway', 1)}${undated}<button class="btn secondary">Download anyway</button></form>${
    upload && upload.pending.length ? uploadForm({ anyway: true }, 'Upload anyway') : ''
  }`;
  return {
    status: 'Not ready',
    body: `<details class="send"${uploading ? ' open' : ''}><summary>Download anyway</summary><div class="body">${spent}${plan.unchecked ? `<p class="small">Unchecked ones go in check-these/.</p>` : ''}${destination}<div class="btns">${anyway}${csv}</div>${line}${didSend}${manifest}${parts}</div></details>`,
  };
}

// The fields of a vendor rule, for a new rule or an edit. Names match /rules.
function ruleFields(
  env: Env,
  rule: Partial<
    Pick<Rule, 'vendor_contains' | 'context_contains' | 'bank_alias' | 'product' | 'expense_type' | 'priority'>
  > = {},
): string {
  return `<div class="fields">${input('vendor_contains', rule.vendor_contains ?? '', 'text', 'Seller contains', { attrs: ' required maxlength="200"' })}${productSelect(env, 'product', rule.product ?? config(env).defaultProduct, 'Part')}${select('expense_type', EXPENSE_TYPES, rule.expense_type ?? EXPENSE_TYPES[0], 'Kind')}${input('context_contains', rule.context_contains ?? '', 'text', 'Also mentions', { attrs: ' maxlength="200" placeholder="Optional"' })}${input('bank_alias', rule.bank_alias ?? '', 'text', 'Bank name', { attrs: ' maxlength="200" placeholder="Optional"' })}${input('priority', rule.priority ?? 0, 'number', 'Priority', { attrs: ' title="Higher wins when rules overlap"' })}</div>`;
}

// ---------- Bank: statements imported ----------
// Under the month's payments once any statement is in: a closed list and Import.
async function statements(env: Env): Promise<string> {
  const history = (
    await env.DB.prepare(
      "SELECT i.*,a.label AS account_name,a.bank_name FROM imports i JOIN accounts a ON a.id=i.account_key WHERE i.status='complete' ORDER BY i.imported_at DESC,i.id LIMIT 20",
    ).all<{ account_name: string; bank_name: string; imported_at: string; row_count: number }>()
  ).results;
  if (!history.length) return '';
  return `<div class="stmts" id="imports"><details><summary>Statements (${history.length})</summary><ul class="list">${history
    .map(
      (i) =>
        `<li><span class="who">${escape(i.account_name)}${i.bank_name ? ` · ${escape(i.bank_name)}` : ''}</span><span class="amt">${i.row_count}</span><span class="ok">${escape(day(i.imported_at))}</span></li>`,
    )
    .join('')}</ul></details><a class="btn secondary" href="/import">Import statement</a></div>`;
}

// ---------- Settings ----------
// One Settings section: a fold with its title and a one-line summary. The
// anchor id sits inside, so a link to #id opens the fold (fragment navigation
// expands details); open is for the section a save returns to.
function sect(id: string, title: string, summary: string, body: string, open = false): string {
  return `<details class="sect"${open ? ' open' : ''}><summary><h2>${title}</h2>${summary ? `<span class="sum">${summary}</span>` : ''}</summary><div class="body" id="${id}">${body}</div></details>`;
}
// Settings > OneDrive. Nothing at all unless MS_CLIENT_ID is set; one line
// when a secret is missing; otherwise connect, folder and disconnect.
async function oneDrivePart(env: Env, open: boolean, origin: string): Promise<string> {
  const settings = config(env);
  const docs = settings.sourceRepository
    ? `<a href="${escape(settings.sourceRepository)}/blob/main/docs/ENVIRONMENT.md#onedrive-upload-optional">docs/ENVIRONMENT.md</a>`
    : '<code>docs/ENVIRONMENT.md</code>';
  if (!settings.oneDrive)
    return settings.oneDriveIncomplete
      ? sect(
          'onedrive',
          'OneDrive',
          'Not set up',
          `<p class="warning"><code>MS_CLIENT_SECRET</code> or <code>ONEDRIVE_TOKEN_KEY</code> is missing. See ${docs}.</p>`,
          open,
        )
      : '';
  const conn = await connection(env);
  const tech = `<details class="tech"><summary>Redirect URI for Microsoft Entra</summary><div class="body"><p>Microsoft sends you back to this app after you sign in. Add this address to your Microsoft Entra app, under Authentication, as a Web redirect URI.</p><pre tabindex="0">${escape(redirectUri(origin, ''))}</pre><p>Steps: ${docs}.</p></div></details>`;
  if (!conn)
    return sect(
      'onedrive',
      'OneDrive',
      'Not connected',
      `<p class="cta"><a class="btn secondary" href="/settings/onedrive/connect">Connect</a></p>${tech}`,
      open,
    );
  const folderForm = `<form action="/settings/onedrive/folder" method="post"><div class="fields">${input('folder_link', '', 'url', 'Shared folder link', { attrs: ' required autocomplete="off" inputmode="url" placeholder="Share > Copy link"', wide: true })}${input('folder_name', '', 'text', 'Folder name', { attrs: ' autocomplete="off" placeholder="Optional"' })}</div><button class="btn secondary">Use folder</button></form>`;
  const folder = conn.folder_item_id
    ? `<a href="${escape(conn.folder_web_url ?? '')}"><strong>${escape(conn.folder_name)}</strong></a>`
    : '<span class="warning">Not chosen</span>';
  return sect(
    'onedrive',
    'OneDrive',
    escape(conn.account_email ?? conn.account_name),
    `<dl class="kv"><div><dt>Account</dt><dd>${escape(conn.account_name)}${conn.account_email ? ` (${escape(conn.account_email)})` : ''}</dd></div><div><dt>Folder</dt><dd>${folder}</dd></div></dl>${
      conn.folder_item_id ? `<details class="why"><summary>Change folder</summary>${folderForm}</details>` : folderForm
    }<form action="/settings/onedrive/disconnect" method="post" class="cta"><button class="linkbtn">Disconnect</button></form>${tech}`,
    open,
  );
}

// Settings > Senders: who is read automatically and who is ignored.
async function sendersPart(env: Env, open: boolean): Promise<string> {
  const allowed = [...config(env).allowedSenders].sort();
  const ignored = await ignoredSenders(env);
  const row = (address: string, action: string, button: string) =>
    `<li class="srow"><div class="sl"><span class="flabel">${escape(address)}</span></div><form class="sc" action="${action}" method="post"><input type="hidden" name="address" value="${escape(address)}"><input type="hidden" name="back" value="settings"><button class="linkbtn" aria-label="${button} ${escape(address)}">${button}</button></form></li>`;
  const approved = allowed.length
    ? `<ul class="plain rowlist">${allowed.map((a) => row(a, '/senders/remove', 'Remove')).join('')}</ul>`
    : '<p class="warning">None yet. All mail waits in Review.</p>';
  const ignoredList = ignored.length
    ? `<h3>Ignored</h3><ul class="plain rowlist">${ignored.map((i) => row(i.address, '/senders/unignore', 'Stop ignoring')).join('')}</ul>`
    : '';
  const full = allowed.length >= MAX_ALLOWED_SENDERS;
  const add = `<p class="meta">Add an address you want read, for example billing@example.com.</p><form action="/senders/approve" method="post" class="inline-edit add-row"><input type="hidden" name="back" value="settings"><input name="address" type="email" required maxlength="254" autocomplete="off" aria-label="Sender address"><button class="btn secondary"${full ? ' disabled' : ''}>Add</button></form>${full ? `<p class="warning">${MAX_ALLOWED_SENDERS} is the most. Remove one first.</p>` : ''}`;
  return sect('senders', 'Senders', `${allowed.length} allowed`, `${approved}${add}${ignoredList}`, open);
}

// Settings > Mail we didn't keep: what reached the app and was not read, from
// the log that is already stored. Never the message itself.
async function mailLogPart(env: Env, open: boolean): Promise<string> {
  const rows = await droppedMail(env);
  const allowed = config(env).allowedSenders;
  const item = (m: (typeof rows)[number]) => {
    const when = day(m.received_at.slice(0, 10), m.received_at.slice(0, 4) !== String(new Date().getUTCFullYear()));
    const offer =
      reasonAllows(m.reason) && !allowed.has(m.sender) && m.sender.includes('@') && !/[\s<>]/.test(m.sender);
    const action = offer
      ? `<form class="sc" action="/senders/approve" method="post"><input type="hidden" name="address" value="${escape(m.sender)}"><input type="hidden" name="back" value="mail"><button class="linkbtn" aria-label="Allow ${escape(m.sender)}">Allow this sender</button></form>`
      : '';
    return `<li class="srow"><div class="sl"><span class="flabel">${escape(m.sender)}</span><span class="meta">${escape(when)}${m.subject ? ` · ${escape(m.subject)}` : ''}</span><span class="meta">${escape(reasonWords(m.reason))}</span></div>${action}</li>`;
  };
  const body = rows.length
    ? `<p class="meta">Emails that reached the app but were not read, newest first. Only the sender, subject and reason are kept.</p><ul class="plain rowlist">${rows.map(item).join('')}</ul>`
    : '<p>Every email that reached the app was kept.</p>';
  return sect('mail', "Mail we didn't keep", rows.length ? String(rows.length) : 'None', body, open);
}

// The form that adds a bank account in Settings, as a failure scope names it.
export const NEW_ACCOUNT = 'account:new';
export async function settingsPage(env: Env, params = new URLSearchParams(), origin = ''): Promise<Response> {
  const settings = config(env);
  // The section the last action touched opens; the rest stay folded.
  const opened = feedback(params)?.section ?? (params.get('open') === 'mail' ? 'mail' : '');
  // The sections don't depend on each other, so they all load at once.
  const [oneDrive, setup, accounts, rules, senders, mailLog] = await Promise.all([
    oneDrivePart(env, opened === 'onedrive', origin),
    setupParts(env, params, opened),
    listAccounts(env.DB),
    env.DB.prepare('SELECT * FROM vendor_rules ORDER BY priority DESC,id LIMIT 200').all<Rule>(),
    sendersPart(env, opened === 'senders'),
    mailLogPart(env, opened === 'mail'),
  ]);
  const opens = (group: string) => opened === `setup-${group}` || (group === 'email' && params.has('routing'));
  const accountsPart = sect(
    'accounts',
    'Bank accounts',
    String(accounts.length),
    `${
      accounts.length
        ? `<ul class="plain rowlist">${accounts
            .map(
              (a, i) =>
                `<li class="srow"><div class="sl"><span class="flabel">${escape(a.label)}</span><span class="meta">${escape(a.bank_name) || 'No bank'} · ${escape(a.default_currency)}</span></div><form class="sc inline-edit" action="/accounts/${encodeURIComponent(a.id)}" method="post"><label class="vh" for="acct-${i}">New name for ${escape(a.label)}</label><input id="acct-${i}" name="label" value="${escape(a.label)}"><button class="btn secondary" aria-label="Rename ${escape(a.label)}">Rename</button></form>${more(`<p class="hint">ID <code>${escape(a.id)}</code></p>`, escape(a.label))}</li>`,
            )
            .join('')}</ul>`
        : '<p>No bank accounts yet. Importing a statement creates one.</p>'
    }<details class="add"${accounts.length && !failureFor(NEW_ACCOUNT) ? '' : ' open'}><summary>Add account</summary><div class="body">${errorLine(NEW_ACCOUNT, '')}<form action="/accounts" method="post"><div class="fields">${input('label', '', 'text', 'Name', { hint: 'For example Main account', scope: NEW_ACCOUNT })}${input('bank_name', '', 'text', 'Bank', { scope: NEW_ACCOUNT })}${select('default_currency', Object.keys(EXPONENTS), settings.defaultCurrency, 'Currency', NEW_ACCOUNT)}</div><button class="btn secondary">Create</button></form></div></details><p class="small moved" id="imports">Imported statements moved to <a href="/payments#imports">Bank</a>.</p><p class="small moved" id="transfers">Own-account transfers moved to <a href="/payments#transfers">Bank</a>.</p>`,
    opened === 'accounts' || !!failureFor(NEW_ACCOUNT),
  );
  const rulesPart = sect(
    'rules',
    'Vendor rules',
    String(rules.results.length),
    `${
      rules.results.length
        ? `<ul class="plain rowlist rules">${rules.results
            .map(
              (rule) =>
                `<li><details><summary>${escape(rule.vendor_contains)} → ${escape(productLabel(env, rule.product))}, ${escape(rule.expense_type)}${rule.priority ? ` · ${rule.priority}` : ''}</summary><div class="body"><form action="/rules/${rule.id}" method="post">${ruleFields(env, rule)}<div class="btns"><button class="btn secondary">Save</button><button class="linkbtn" formaction="/rules/${rule.id}/delete">Delete</button></div></form></div></details></li>`,
            )
            .join('')}</ul>`
        : '<p>No rules yet.</p>'
    }<details class="add"${rules.results.length ? '' : ' open'}><summary>Add rule</summary><div class="body"><form action="/rules" method="post">${ruleFields(env)}<button class="btn secondary">Add</button></form></div></details>`,
    opened === 'rules',
  );
  const parts = settings.products.length;
  const body = [
    sect(
      'setup-business',
      'Business',
      `${escape(settings.sellerNames[0] ?? settings.appName)}, ${plural(parts, 'part')}`,
      setup.business,
      opens('business'),
    ),
    sect('setup-email', 'Email', escape(settings.receiptAddress || 'Off'), setup.email, opens('email')),
    senders,
    mailLog,
    accountsPart,
    rulesPart,
    sect('setup-accountant', 'Export', escape(settings.accountantLabel), setup.accountant, opens('accountant')),
    oneDrive,
    sect('advanced', 'Advanced', '', setup.advanced, opened === 'setup-review' || opened === 'setup-integrations'),
    sect('about', 'About', '', aboutBody(env)),
  ].join('');
  const response = await page(
    'settings',
    `<div class="settings">${body}<p class="small"><a href="/help">What do these words mean? Open Help</a></p></div><script src="/assets/settings.js" defer></script>`,
    200,
    env,
    { head: pageHead('Settings', signOutLink(env)) },
  );
  response.headers.set('Content-Security-Policy', SETTINGS_CSP);
  return response;
}

// ---------- Help ----------
export async function helpPage(env: Env): Promise<Response> {
  return page('help', helpBody(), 200, env, { head: pageHead('Help') });
}

// ---------- Import, step 1 ----------
export async function importPage(env: Env): Promise<Response> {
  return page('import', `${wizard(1)}<div class="card">${await importForm(env)}</div>`, 200, env, {
    detail: 'Import a bank statement',
    head: pageHead('Import a bank statement'),
  });
}
