// Which month Home and Bank open on when the address names none: the oldest
// month that is not sent, else the current one. Worked out from the receipts,
// the payments and the sends already stored, so there is no state to keep.
import { hash } from './domain';
import type { Env } from './env';
import { needsReview, reasonCodes } from './flags';
import { MISSING_PAYMENTS } from './ui';

export type Arrival = {
  month: string;
  current: string;
  // Why this month is not sent; null when it is simply the current month.
  why: 'unsent' | 'changed' | 'unmatched' | null;
};

// A month is not sent when it has documents that were never marked sent or
// changed since, or no documents but payments still missing a receipt. A
// document whose date is itself in question (missing or uncertain, and still
// open) is not evidence of its month: it would hold Home on a misdated old
// month, so a never-sent month with nothing else in it is skipped.
export async function arrivalMonth(env: Env, now = new Date()): Promise<Arrival> {
  const current = now.toISOString().slice(0, 7);
  const [docs, sends, missing] = await env.DB.batch<{
    id?: string;
    revision?: number;
    status?: string;
    reasons?: string;
    m: string;
    h?: string;
    n?: number;
  }>([
    env.DB.prepare(
      "SELECT id,revision,status,review_reasons_json reasons,substr(issue_date,1,7) m FROM receipts WHERE issue_date IS NOT NULL AND kind IN ('expense','sales') AND duplicate_of IS NULL AND discarded_at IS NULL",
    ),
    env.DB.prepare(
      'SELECT month m,receipts_hash h FROM month_sends s WHERE sent_at=(SELECT max(sent_at) FROM month_sends WHERE month=s.month)',
    ),
    env.DB.prepare(`SELECT substr(t.booking_date,1,7) m, count(*) n ${MISSING_PAYMENTS} GROUP BY m`),
  ]);
  const keys = new Map<string, string[]>();
  const sure = new Set<string>();
  for (const r of docs?.results ?? []) {
    keys.set(r.m, [...(keys.get(r.m) ?? []), `${r.id}:${r.revision}`]);
    const doubtful =
      needsReview({ status: r.status ?? '', review_reasons_json: r.reasons ?? '[]' }) &&
      reasonCodes(r.reasons ?? '[]').some((c) => c === 'missing_issue_date' || c === 'uncertain_issue_date');
    if (!doubtful) sure.add(r.m);
  }
  const sent = new Map((sends?.results ?? []).map((s) => [s.m, s.h]));
  const open = new Map<string, Arrival['why']>();
  for (const [m, list] of keys) {
    const last = sent.get(m);
    if (last === undefined) {
      if (sure.has(m)) open.set(m, 'unsent');
    } else if (last !== (await hash(list.sort().join('\n')))) open.set(m, 'changed');
  }
  for (const r of missing?.results ?? [])
    if (!open.has(r.m) && (!keys.has(r.m) || !sure.has(r.m))) open.set(r.m, 'unmatched');
  const oldest = [...open.keys()].sort()[0];
  return oldest ? { month: oldest, current, why: open.get(oldest) ?? null } : { month: current, current, why: null };
}
