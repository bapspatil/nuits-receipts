// Matching a bank payment to a receipt or an invoice: which pairs fit, how a
// pair is compared for the person, the searchable picker's labels, and the
// bulk "Match all likely" write. The single-match route in index.ts uses the
// same fits() and linkMatch().
import { creditFit, eligible, matchable, MATCHABLE_SQL, openSales, type Transaction } from './banking';
import { InputError, money, normalize, withinWindow, type Receipt, type Rule, type Tuning } from './domain';
import { aliased, nameScore } from './matcher';
import type { Env } from './env';
import { invoiceName } from './invoices';
import { plural } from './ui';

export function receiptName(r: Receipt): string {
  return r.kind === 'sales' ? invoiceName(r) : (r.vendor ?? r.filename);
}

// Receipts that can be matched to a bank row, the same set the /matches handler accepts.
export async function matchableReceipts(env: Env): Promise<Receipt[]> {
  return (
    await env.DB.prepare(
      `SELECT * FROM receipts WHERE kind='expense' AND duplicate_of IS NULL AND discarded_at IS NULL AND status IN ('ready','needs_review') AND id NOT IN (SELECT receipt_id FROM bank_transactions t JOIN imports i ON i.id=t.import_id WHERE receipt_id IS NOT NULL AND i.status='complete') ORDER BY issue_date DESC,id`,
    ).all<Receipt>()
  ).results;
}
// What a payment can be matched to: receipts for money out, invoices you sent for money in.
export const candidatesFor = (env: Env, t: Transaction): Promise<Receipt[]> =>
  t.amount_minor > 0 ? openSales(env) : matchableReceipts(env);

// Whether a pair passes the check POST /matches makes before it asks for the exception.
export function fits(r: Receipt, t: Transaction, rules: Rule[], tuning: Tuning): boolean {
  return t.amount_minor > 0 ? creditFit(r, t, tuning) !== null : eligible(r, t, rules, tuning);
}

// ---------- The comparison ----------
export type Cell = { text: string; same: boolean };
export type PairFacts = { name: Cell; date: Cell; amount: Cell; exact: boolean; reason: string };
const days = (a: string, b: string) => Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / 86400000);
export function pairFacts(r: Receipt, t: Transaction, rules: Rule[], tuning: Tuning): PairFacts {
  const exact = fits(r, t, rules, tuning);
  const apart = r.issue_date ? days(r.issue_date, t.booking_date) : null;
  const bankCurrency = t.original_currency ?? t.currency;
  const sameCurrency = r.currency === bankCurrency;
  const sameAmount =
    sameCurrency &&
    r.total_minor !== null &&
    Math.abs(r.total_minor - Math.abs(t.original_amount_minor ?? t.amount_minor)) <= 2;
  const sameName = normalize(receiptName(r)) === normalize(t.merchant);
  const clauses: string[] = [];
  if (!sameAmount)
    clauses.push(
      sameCurrency
        ? 'the amounts differ'
        : `the receipt is in ${r.currency ?? 'another currency'} and the bank charged ${t.currency}, so the amount is an estimate`,
    );
  if (apart === null) clauses.push('the receipt has no date');
  else if (t.amount_minor < 0 && r.issue_date && !withinWindow(r.issue_date, t.booking_date, tuning))
    clauses.push(`the dates are ${plural(apart, 'day')} apart`);
  if (
    t.amount_minor < 0 &&
    !aliased(receiptName(r), t.merchant, rules) &&
    nameScore(receiptName(r), t.merchant) < tuning.minVendorSimilarity
  )
    clauses.push("the names don't look alike");
  return {
    name: { text: sameName ? 'Same' : 'Differs', same: sameName },
    date: {
      text: apart === null ? 'No date' : apart === 0 ? 'Same' : `${plural(apart, 'day')} apart`,
      same: apart === 0,
    },
    amount: { text: sameAmount ? 'Same' : 'Differs', same: sameAmount },
    exact,
    reason: exact
      ? ''
      : `This pair isn't exact: ${clauses.join('; ') || 'it is not a close fit'}. "Match anyway" says that is fine.`,
  };
}

// ---------- The searchable picker ----------
const ID = /^[a-f0-9]{64}$/;
const plainAmount = (r: Receipt) =>
  r.total_minor === null ? 'no amount' : `${r.currency ?? ''} ${money(r.total_minor, r.currency ?? 'EUR')}`.trim();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "Sample Domain Desk, 12 Sep, EUR 12.00": typing a seller, a date or an amount narrows the list.
// The year shows only when it isn't the page's. Two receipts that read alike get a short code.
export function pickLabels(receipts: Receipt[], year: string): Map<string, string> {
  const base = receipts.map((r) => {
    const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(r.issue_date ?? '');
    const date = m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}${m[1] === year ? '' : ' ' + m[1]}` : 'no date';
    return [r, `${receiptName(r)}, ${date}, ${plainAmount(r)}`] as const;
  });
  const seen = new Map<string, number>();
  for (const [, label] of base) seen.set(label, (seen.get(label) ?? 0) + 1);
  return new Map(base.map(([r, label]) => [r.id, seen.get(label)! > 1 ? `${label}, ${r.id.slice(0, 6)}` : label]));
}
// The receipts a typed or chosen value stands for: an id, a whole label, or text only one label contains.
export function pickMatches(raw: string, receipts: Receipt[], year: string): Receipt[] {
  const value = raw.trim().toLowerCase();
  if (!value) return [];
  if (ID.test(value)) return receipts.filter((r) => r.id === value);
  const labels = pickLabels(receipts, year);
  const whole = receipts.filter((r) => labels.get(r.id)!.toLowerCase() === value);
  return whole.length ? whole : receipts.filter((r) => labels.get(r.id)!.toLowerCase().includes(value));
}
// The receipt id a typed or chosen label names.
export function resolvePick(raw: string, receipts: Receipt[], year: string): string {
  const found = pickMatches(raw, receipts, year);
  if (found.length > 1) throw new InputError('More than one receipt fits that', 422, 'receipt_id');
  if (!found[0]) throw new InputError('Pick a receipt from the list', 422, 'receipt_id');
  return found[0].id;
}

// Why a pair is likely, in a line: "Name differs, date 1 day apart, amount the same."
export function whyLikely(f: PairFacts): string {
  const word = (c: Cell) => (c.same ? 'the same' : c.text === 'Differs' ? 'differs' : c.text.toLowerCase());
  return `Name ${word(f.name)}, date ${word(f.date)}, amount ${word(f.amount)}.`;
}

export const matchAllLabel = (n: number): string => (n === 1 ? 'Match the likely one' : `Match all ${n} likely`);

// ---------- Writing a match ----------
// One guarded write for POST /matches and the bulk route; true when the pair was still open.
export async function linkMatch(env: Env, t: Transaction, r: Receipt, at: string): Promise<boolean> {
  const credit = t.amount_minor > 0;
  const result = await env.DB.prepare(
    `UPDATE bank_transactions SET receipt_id=?,match_method='manual',matched_at=? WHERE id=? AND receipt_id IS NULL AND receipt_required=1 AND ${credit ? 'amount_minor>0' : 'amount_minor<0'} AND EXISTS(SELECT 1 FROM imports WHERE id=bank_transactions.import_id AND status='complete') AND EXISTS(SELECT 1 FROM receipts WHERE id=? AND kind=? AND revision=? AND duplicate_of IS NULL AND discarded_at IS NULL AND ${MATCHABLE_SQL})`,
  )
    .bind(r.id, at, t.id, r.id, r.kind, r.revision)
    .run();
  return result.meta.changes === 1;
}

export const BULK_MAX = 100;
// Match every listed pair that still fits exactly, all stamped with one time so
// Undo can find them. A pair that changed since the page was drawn is skipped.
export async function matchLikely(
  env: Env,
  pairs: readonly (readonly [string, string])[],
  rules: Rule[],
  tuning: Tuning,
  at: string,
): Promise<{ matched: number; skipped: number }> {
  let matched = 0;
  for (const [txId, receiptId] of pairs.slice(0, BULK_MAX)) {
    const t = await env.DB.prepare(
      "SELECT t.* FROM bank_transactions t JOIN imports i ON i.id=t.import_id WHERE t.id=? AND i.status='complete'",
    )
      .bind(txId)
      .first<Transaction>();
    const r = ID.test(receiptId)
      ? await env.DB.prepare('SELECT * FROM receipts WHERE id=?').bind(receiptId).first<Receipt>()
      : null;
    if (!t || !r || t.amount_minor >= 0 || r.kind !== 'expense' || r.duplicate_of || r.discarded_at || !matchable(r))
      continue;
    if (!fits(r, t, rules, tuning) || t.receipt_id || !t.receipt_required) continue;
    try {
      if (await linkMatch(env, t, r, at)) matched++;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('UNIQUE constraint')) throw error;
    }
  }
  return { matched, skipped: Math.min(pairs.length, BULK_MAX) - matched };
}
// Undo for the bulk match: only rows still carrying that batch's time, and only by-you matches.
export async function unmatchLikely(env: Env, at: string): Promise<number> {
  const result = await env.DB.prepare(
    "UPDATE bank_transactions SET receipt_id=NULL,match_method=NULL,matched_at=NULL WHERE matched_at=? AND match_method='manual'",
  )
    .bind(at)
    .run();
  return result.meta.changes;
}
