// Which receipt belongs to which payment, worked out for every open payment at
// once. Pure: no database, so src/banking.ts runs it inside reconcile and a
// local dry run can run it over a copy of the data.
//
// A pair fits when the amounts agree (the bank's own amount, the original
// foreign amount on the statement, an ECB estimate, or a small tip on top),
// the dates are in the window, and the names look alike after card-processor
// prefixes and statement noise are taken off. Pairs are then taken best
// first, one level at a time. A level is linked only where one receipt and one
// payment want each other; two different answers at the same level leave both
// sides for the person to pick.
import { MONEY_TOLERANCE_MINOR, normalize, withinWindow, type Receipt, type Rule, type Tuning } from './domain';
import type { Transaction } from './banking';

export type Method = 'exact' | 'original' | 'fx' | 'tip';
// diff: minor units between the amounts compared; gap: days from issue to booking.
export type Fit = { method: Method; name: number; gap: number; diff: number };
export type Pair = { receipt: Receipt; transaction: Transaction; fit: Fit };

// Card processors and payment platforms that put their own name before the seller's.
const PROCESSOR =
  /^\s*(?:sumup|ptl|vfi|paypal|pp|zettle|izettle|iz|sq|paddle\.net|paddle|metapay|stripe|klarna|nets|ccv|mobilepay|vipps|bambora|worldline|adyen|payu|sp)\s*(?:\*\s*|\s+)/i;
const NOISE = /\bhelp\.uber\.c\w*|\bpending\b/gi;
const LEGAL = new Set([
  'oyj',
  'ky',
  'gmbh',
  'corp',
  'corporation',
  'co',
  'plc',
  'bv',
  'sa',
  'srl',
  'ag',
  'aps',
  'pty',
  'sarl',
]);
// Words that say nothing about who the seller is, so they never count as the brand.
const GENERIC = new Set([
  'the',
  'and',
  'of',
  'for',
  'account',
  'holder',
  'payment',
  'company',
  'services',
  'service',
  'group',
  'online',
  'store',
  'shop',
  'international',
  'technologies',
  'technology',
  'labs',
  'lab',
  'app',
  'apps',
  'digital',
  'software',
  'systems',
  'solutions',
  'global',
  'finland',
  'suomi',
  'helsinki',
  'europe',
  'ireland',
  'mutual',
  'insurance',
  'ravintola',
  'restaurant',
  'cafe',
  'kahvila',
  'bar',
  'hotel',
  'trip',
  'eats',
  'subscr',
  'sub',
]);
const PROCESSOR_ONLY = new Set(['stripe', 'paypal']);

function words(value: string): string[] {
  return normalize(value.replace(NOISE, ' '))
    .split(' ')
    .filter((w) => w && !LEGAL.has(w));
}
// The first word that names the seller: "ANTHROPIC* CLAUDE SUB" is anthropic.
const brand = (tokens: readonly string[]) => tokens.find((w) => w.length >= 3 && !GENERIC.has(w) && !/^\d+$/.test(w));
const contains = (outer: readonly string[], inner: readonly string[]) =>
  inner.length > 0 && inner.join(' ').length >= 4 && outer.some((_, i) => inner.every((w, j) => outer[i + j] === w));
function score(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0;
  if (PROCESSOR_ONLY.has(a.join(' ')) || PROCESSOR_ONLY.has(b.join(' '))) return 0;
  if (a.join(' ') === b.join(' ')) return 1;
  if (contains(a, b) || contains(b, a)) return 0.9;
  const ba = brand(a),
    bb = brand(b);
  if ((ba && b.includes(ba)) || (bb && a.includes(bb))) return 0.75;
  const aa = new Set(a),
    both = new Set([...a, ...b]);
  return [...new Set(b)].filter((w) => aa.has(w)).length / both.size;
}
// How alike a receipt's seller and a bank row's merchant are, 0 to 1. The
// merchant is tried as printed and with its card-processor prefix taken off.
export function nameScore(vendor: string, merchant: string): number {
  const a = words(vendor);
  const stripped = merchant.replace(PROCESSOR, '');
  return Math.max(score(a, words(merchant)), stripped === merchant ? 0 : score(a, words(stripped)));
}
export function aliased(vendor: string, merchant: string, rules: readonly Rule[]): boolean {
  return rules.some(
    (rule) =>
      normalize(rule.bank_alias ?? '') &&
      normalize(vendor).includes(normalize(rule.vendor_contains)) &&
      normalize(merchant) === normalize(rule.bank_alias ?? ''),
  );
}

// A card payment abroad converts at the network's rate plus a fee: the bank
// usually charges 1 to 3 % more than the ECB reference rate.
export const fxClose = (estimate: number, paid: number) =>
  Math.abs(paid - estimate) <= Math.max(100, Math.round(Math.abs(estimate) * 0.04));
// A tip added at the terminal: the charge is a little more than the receipt.
const tipClose = (total: number, paid: number) =>
  paid - total > MONEY_TOLERANCE_MINOR && paid - total <= Math.max(200, Math.round(total * 0.2));
const TIP_DAYS = 7;
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

// How the amounts of a receipt and a money-out row agree, if they do.
export function amountFit(r: Receipt, t: Transaction): Method | null {
  if (r.total_minor === null || !r.currency) return null;
  const total = r.total_minor;
  if (t.original_currency && t.original_amount_minor !== null) {
    if (r.currency !== t.original_currency)
      return r.currency === t.currency ? sameCurrency(total, -t.amount_minor, 'exact') : null;
    return sameCurrency(total, Math.abs(t.original_amount_minor), 'original');
  }
  if (r.currency === t.currency) return sameCurrency(total, -t.amount_minor, 'exact');
  if (t.currency === 'EUR' && r.fx_eur_minor !== null && fxClose(r.fx_eur_minor, -t.amount_minor)) return 'fx';
  return null;
}
function sameCurrency(total: number, paid: number, method: 'exact' | 'original'): Method | null {
  if (Math.abs(total - paid) <= MONEY_TOLERANCE_MINOR) return method;
  return tipClose(total, paid) ? 'tip' : null;
}

// Whether the matcher may link this pair on its own: open, money out, amounts,
// dates and names all fit. null when it may not.
export function pairFit(r: Receipt, t: Transaction, rules: readonly Rule[], tuning: Tuning): Fit | null {
  if (r.total_minor === null || !r.issue_date || !r.vendor || t.amount_minor >= 0) return null;
  if (!withinWindow(r.issue_date, t.booking_date, tuning)) return null;
  const method = amountFit(r, t);
  if (!method) return null;
  const gap = days(r.issue_date, t.booking_date);
  if (method === 'tip' && Math.abs(gap) > TIP_DAYS) return null;
  const name = aliased(r.vendor, t.merchant, rules) ? 1 : nameScore(r.vendor, t.merchant);
  if (name < tuning.minVendorSimilarity) return null;
  const paid =
    method === 'fx'
      ? r.fx_eur_minor!
      : t.original_currency === r.currency && t.original_amount_minor !== null
        ? Math.abs(t.original_amount_minor)
        : -t.amount_minor;
  return { method, name, gap, diff: Math.abs(method === 'fx' ? paid + t.amount_minor : paid - r.total_minor) };
}

const METHOD_RANK: Record<Method, number> = { exact: 3, original: 3, fx: 2, tip: 1 };
// Higher is better: how the amount fits, to the cent or within the tolerance,
// how alike the names are, then how close the dates are. A payment booked on or
// after the receipt's date beats one booked as many days before it.
export const level = (f: Fit) =>
  METHOD_RANK[f.method] * 1_000_000 +
  (f.diff === 0 ? 100_000 : 0) +
  (f.name >= 0.9 ? 2 : 1) * 10_000 +
  (9999 - Math.min(9999, f.gap >= 0 ? 2 * f.gap : -2 * f.gap + 1));

// One charge often arrives as two files, an invoice and a receipt, with the same
// number. They are one charge: only its best document is offered for matching.
const INVOICE_NAME = /invoice|lasku|rechnung|facture|faktura|factura/i;
export function documentScore(r: Receipt): number {
  return (
    (r.total_minor !== null && r.vendor ? 8 : 0) +
    (INVOICE_NAME.test(r.filename) ? 4 : 0) +
    (r.media_type === 'application/pdf' ? 2 : 0) +
    (r.status === 'ready' ? 1 : 0)
  );
}
export function chargeKey(r: Receipt): string | null {
  if (!r.vendor || !r.invoice_number || !r.issue_date || !r.currency || r.total_minor === null) return null;
  return [r.kind, normalize(r.vendor), r.currency, r.total_minor, r.issue_date, normalize(r.invoice_number)].join('|');
}
const byDocument = (a: Receipt, b: Receipt) =>
  documentScore(b) - documentScore(a) || a.received_at.localeCompare(b.received_at) || a.id.localeCompare(b.id);
// The receipts that stand for their charge: same number, date, currency and
// total, and sellers that read alike ("Account holder Example Inc." and
// "Example Inc."). A charge whose other file is already matched is matched.
const numberKey = (r: Receipt) =>
  r.invoice_number && r.issue_date && r.currency && r.total_minor !== null && r.vendor
    ? [r.kind, r.currency, r.total_minor, r.issue_date, normalize(r.invoice_number)].join('|')
    : null;
export function chargeLeaders(open: readonly Receipt[], matched: readonly Receipt[]): Receipt[] {
  const groups = new Map<string, { vendor: string; taken: boolean }[]>();
  const join = (r: Receipt, taken: boolean): boolean => {
    const key = numberKey(r);
    if (key === null) return true;
    const group = groups.get(key) ?? [];
    groups.set(key, group);
    if (group.some((g) => nameScore(g.vendor, r.vendor!) >= 0.6)) return false;
    group.push({ vendor: r.vendor!, taken });
    return !taken;
  };
  for (const r of matched) join(r, true);
  return [...open].sort(byDocument).filter((r) => join(r, false));
}

// Rows that read the same are interchangeable: which of two identical charges
// gets which of two identical receipts makes no difference.
const receiptClass = (r: Receipt) => [normalize(r.vendor ?? ''), r.issue_date, r.currency, r.total_minor].join('|');
const paymentClass = (t: Transaction) =>
  [
    t.account_key,
    t.booking_date,
    t.amount_minor,
    t.currency,
    t.original_amount_minor,
    t.original_currency,
    normalize(t.merchant),
  ].join('|');

// Bank rows by currency and size, so each receipt looks only at nearby amounts.
type Indexed = { amount: number; t: Transaction };
function index(rows: readonly Transaction[], key: (t: Transaction) => [string, number] | null) {
  const by = new Map<string, Indexed[]>();
  for (const t of rows) {
    const k = key(t);
    if (k) by.set(k[0], [...(by.get(k[0]) ?? []), { amount: k[1], t }]);
  }
  for (const list of by.values()) list.sort((a, b) => a.amount - b.amount);
  return (currency: string, low: number, high: number): Transaction[] => {
    const list = by.get(currency) ?? [];
    let lo = 0,
      hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid]!.amount < low) lo = mid + 1;
      else hi = mid;
    }
    const found: Transaction[] = [];
    for (let i = lo; i < list.length && list[i]!.amount <= high; i++) found.push(list[i]!.t);
    return found;
  };
}

export type Plan = { pairs: Pair[]; tied: Set<string> };
// The automatic matches for these open receipts and payments. rejected holds
// "transaction|receipt" pairs the owner took apart.
export function planMatches(
  receipts: readonly Receipt[],
  transactions: readonly Transaction[],
  rules: readonly Rule[],
  tuning: Tuning,
  rejected: ReadonlySet<string> = new Set(),
): Plan {
  const out = transactions.filter((t) => t.amount_minor < 0);
  const byBank = index(out, (t) => [t.currency, -t.amount_minor]);
  const byOriginal = index(out, (t) =>
    t.original_currency && t.original_amount_minor !== null
      ? [t.original_currency, Math.abs(t.original_amount_minor)]
      : null,
  );
  const edges: { r: Receipt; t: Transaction; fit: Fit; level: number }[] = [];
  for (const r of receipts) {
    if (r.total_minor === null || !r.currency) continue;
    const high = r.total_minor + Math.max(200, Math.round(r.total_minor * 0.2));
    const near = new Set([
      ...byBank(r.currency, r.total_minor - MONEY_TOLERANCE_MINOR, high),
      ...byOriginal(r.currency, r.total_minor - MONEY_TOLERANCE_MINOR, high),
      ...(r.currency !== 'EUR' && r.fx_eur_minor !== null
        ? byBank(
            'EUR',
            r.fx_eur_minor - Math.max(100, r.fx_eur_minor * 0.04),
            r.fx_eur_minor + Math.max(100, r.fx_eur_minor * 0.04),
          )
        : []),
    ]);
    for (const t of near) {
      if (rejected.has(`${t.id}|${r.id}`)) continue;
      const fit = pairFit(r, t, rules, tuning);
      if (fit) edges.push({ r, t, fit, level: level(fit) });
    }
  }
  edges.sort((a, b) => b.level - a.level || a.t.id.localeCompare(b.t.id) || a.r.id.localeCompare(b.r.id));
  const used = new Set<string>(),
    tied = new Set<string>(),
    pairs: Pair[] = [];
  for (let i = 0; i < edges.length;) {
    let j = i;
    while (j < edges.length && edges[j]!.level === edges[i]!.level) j++;
    const open = edges.slice(i, j).filter((e) => !used.has(e.r.id) && !used.has(e.t.id));
    i = j;
    // Classes on each side, and which classes each one wants at this level.
    const wants = new Map<string, Set<string>>();
    const add = (from: string, to: string) => wants.set(from, (wants.get(from) ?? new Set()).add(to));
    for (const e of open) {
      add('r:' + receiptClass(e.r), 't:' + paymentClass(e.t));
      add('t:' + paymentClass(e.t), 'r:' + receiptClass(e.r));
    }
    const members = new Map<string, { receipts: Receipt[]; payments: Transaction[]; fit: Map<string, Fit> }>();
    for (const e of open) {
      const rc = 'r:' + receiptClass(e.r),
        tc = 't:' + paymentClass(e.t);
      if (wants.get(rc)!.size !== 1 || wants.get(tc)!.size !== 1) {
        tied.add(e.r.id).add(e.t.id);
        continue;
      }
      const group = members.get(rc + tc) ?? {
        receipts: [] as Receipt[],
        payments: [] as Transaction[],
        fit: new Map<string, Fit>(),
      };
      if (!group.receipts.includes(e.r)) group.receipts.push(e.r);
      if (!group.payments.includes(e.t)) group.payments.push(e.t);
      group.fit.set(`${e.t.id}|${e.r.id}`, e.fit);
      members.set(rc + tc, group);
    }
    for (const group of members.values()) {
      const rs = [...group.receipts].sort(byDocument),
        ts = [...group.payments].sort((a, b) => a.id.localeCompare(b.id));
      for (const r of rs) {
        const t = ts.find((t) => !used.has(t.id) && group.fit.has(`${t.id}|${r.id}`));
        if (!t) continue;
        used.add(r.id).add(t.id);
        pairs.push({ receipt: r, transaction: t, fit: group.fit.get(`${t.id}|${r.id}`)! });
      }
    }
    // A tied receipt or payment is not offered a worse answer further down.
    for (const id of tied) used.add(id);
  }
  return { pairs, tied };
}
