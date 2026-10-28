// One charge, one receipt. A Stripe email carries Receipt-*.pdf and
// Invoice-*.pdf for the same payment, and the same charge is sometimes
// forwarded twice. The extra rows are marked duplicate_of the one that counts,
// which already keeps them out of Review, totals, exports, the package and bank
// matching. Nothing is deleted: every file stays in R2, is linked from the
// primary receipt, and "Duplicate of" on a receipt page undoes a merge.
import type { Env } from './env';
import { normalize, type Receipt } from './domain';
import { reconcile } from './banking';
import { chargeKey, documentScore } from './matcher';

const SETTLED = "status IN ('ready','needs_review') AND media_type<>'message/rfc822'";

// Two documents of one email are one charge unless they say otherwise.
export function compatible(a: Receipt, b: Receipt): boolean {
  const differ = <T>(x: T | null, y: T | null) => x !== null && y !== null && x !== y;
  if (differ(a.total_minor, b.total_minor) || differ(a.currency, b.currency)) return false;
  const number = (r: Receipt) => (r.invoice_number ? normalize(r.invoice_number) : null);
  return !(differ(number(a), number(b)) && differ(a.issue_date, b.issue_date));
}
// Rows a person touched or a bank line points at are never hidden.
function touched(r: Receipt, matched: ReadonlySet<string>): boolean {
  return matched.has(r.id) || r.reviewed_at !== null || r.manual_fields_json !== '{}';
}
function rank(matched: ReadonlySet<string>) {
  return (a: Receipt, b: Receipt) =>
    Number(touched(b, matched)) - Number(touched(a, matched)) ||
    documentScore(b) - documentScore(a) ||
    a.received_at.localeCompare(b.received_at) ||
    a.id.localeCompare(b.id);
}

export type Merge = { primary: string; duplicate: string };
// Groups rows into charges; each charge keeps its best row.
export function planGroup(rows: readonly Receipt[], matched: ReadonlySet<string>, same = compatible): Merge[] {
  const charges: Receipt[][] = [],
    merges: Merge[] = [];
  for (const row of [...rows].sort(rank(matched))) {
    const charge = touched(row, matched) ? undefined : charges.find((c) => c.every((m) => same(m, row)));
    if (charge) {
      merges.push({ primary: charge[0]!.id, duplicate: row.id });
      charge.push(row);
    } else charges.push([row]);
  }
  return merges;
}

export async function matchedIds(env: Env): Promise<Set<string>> {
  const rows = await env.DB.prepare(
    'SELECT DISTINCT receipt_id FROM bank_transactions WHERE receipt_id IS NOT NULL',
  ).all<{
    receipt_id: string;
  }>();
  return new Set(rows.results.map((r) => r.receipt_id));
}

// Guarded: the duplicate must still be untouched and unmatched, the primary
// must still count. Rows already pointing at the duplicate move to the primary.
export async function markDuplicate(env: Env, merge: Merge): Promise<boolean> {
  const [marked] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE receipts SET duplicate_of=?1,revision=revision+1 WHERE id=?2 AND id<>?1 AND duplicate_of IS NULL AND discarded_at IS NULL AND reviewed_at IS NULL AND manual_fields_json='{}' AND ${SETTLED}
      AND NOT EXISTS(SELECT 1 FROM bank_transactions WHERE receipt_id=?2)
      AND EXISTS(SELECT 1 FROM receipts p WHERE p.id=?1 AND p.duplicate_of IS NULL AND p.discarded_at IS NULL)`,
    ).bind(merge.primary, merge.duplicate),
    env.DB.prepare(
      'UPDATE receipts SET duplicate_of=?1,revision=revision+1 WHERE duplicate_of=?2 AND id<>?1 AND EXISTS(SELECT 1 FROM receipts d WHERE d.id=?2 AND d.duplicate_of=?1)',
    ).bind(merge.primary, merge.duplicate),
  ]);
  return (marked?.meta.changes ?? 0) === 1;
}

// A "probable duplicate" flag whose twin is now merged into this row is stale.
export async function clearDuplicateFlag(env: Env, id: string): Promise<void> {
  const r = await env.DB.prepare('SELECT * FROM receipts WHERE id=? AND duplicate_of IS NULL AND discarded_at IS NULL')
    .bind(id)
    .first<Receipt>();
  if (!r) return;
  const reasons: string[] = JSON.parse(r.review_reasons_json);
  if (!reasons.includes('probable_duplicate')) return;
  const peers = (
    await env.DB.prepare(
      'SELECT vendor FROM receipts WHERE id<>? AND kind=? AND invoice_number=? AND issue_date=? AND currency=? AND total_minor=? AND duplicate_of IS NULL AND discarded_at IS NULL',
    )
      .bind(r.id, r.kind, r.invoice_number, r.issue_date, r.currency, r.total_minor)
      .all<{ vendor: string | null }>()
  ).results;
  if (peers.some((p) => normalize(p.vendor ?? '') === normalize(r.vendor ?? ''))) return;
  const left = reasons.filter((reason) => reason !== 'probable_duplicate');
  await env.DB.prepare(
    "UPDATE receipts SET review_reasons_json=?,status=CASE WHEN ?=0 AND status='needs_review' THEN 'ready' ELSE status END,revision=revision+1 WHERE id=? AND revision=?",
  )
    .bind(JSON.stringify(left), left.length, r.id, r.revision)
    .run();
}

// After an email's documents are read: one receipt per charge in the email,
// and none for a charge an earlier email already brought in.
export async function settleEmailRows(env: Env, emailKey: string, ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  const rows = (
    await env.DB.prepare(
      `SELECT * FROM receipts WHERE id IN (${ids.map(() => '?').join(',')}) AND email_key=? AND duplicate_of IS NULL AND discarded_at IS NULL AND ${SETTLED}`,
    )
      .bind(...ids, emailKey)
      .all<Receipt>()
  ).results;
  if (!rows.length) return;
  const matched = await matchedIds(env);
  const merged = new Set<string>(),
    primaries = new Set<string>();
  for (const merge of planGroup(rows, matched))
    if (await markDuplicate(env, merge)) {
      merged.add(merge.duplicate);
      primaries.add(merge.primary);
    }
  for (const row of rows.filter((r) => !merged.has(r.id) && !touched(r, matched))) {
    const key = chargeKey(row);
    if (!key) continue;
    const earlier = (
      await env.DB.prepare(
        `SELECT * FROM receipts WHERE id<>? AND (email_key IS NULL OR email_key<>?) AND duplicate_of IS NULL AND discarded_at IS NULL AND kind=? AND currency=? AND total_minor=? AND issue_date=? AND ${SETTLED}`,
      )
        .bind(row.id, emailKey, row.kind, row.currency, row.total_minor, row.issue_date)
        .all<Receipt>()
    ).results
      .filter((r) => chargeKey(r) === key)
      .sort(rank(matched))[0];
    if (earlier && (await markDuplicate(env, { primary: earlier.id, duplicate: row.id }))) {
      primaries.delete(row.id);
      primaries.add(earlier.id);
    }
  }
  for (const id of primaries) await clearDuplicateFlag(env, id);
  if (merged.size || primaries.size) await reconcile(env);
}

// Rows made before one-row-per-email: per source email first, then the same
// charge across emails. Dry run for the Review page's count.
// known: the matched ids when the caller is already loading them.
export async function mergePlan(env: Env, known?: Promise<Set<string>>): Promise<Merge[]> {
  const [rows, matched] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM receipts WHERE duplicate_of IS NULL AND discarded_at IS NULL AND ${SETTLED} ORDER BY received_at,id`,
    )
      .all<Receipt>()
      .then((r) => r.results),
    known ?? matchedIds(env),
  ]);
  const merges: Merge[] = [],
    hidden = new Set<string>();
  const byEmail = new Map<string, Receipt[]>();
  for (const r of rows)
    if (r.source === 'email' && r.email_key) {
      const group = `${r.kind}|${r.email_key}`;
      byEmail.set(group, [...(byEmail.get(group) ?? []), r]);
    }
  for (const group of byEmail.values())
    for (const merge of planGroup(group, matched)) {
      merges.push(merge);
      hidden.add(merge.duplicate);
    }
  const byCharge = new Map<string, Receipt[]>();
  for (const r of rows) {
    const key = hidden.has(r.id) ? null : chargeKey(r);
    if (key) byCharge.set(key, [...(byCharge.get(key) ?? []), r]);
  }
  for (const group of byCharge.values()) {
    if (group.length < 2) continue;
    for (const merge of planGroup(group, matched, () => true)) {
      // A primary of the email pass that now folds into another charge row
      // takes its own duplicates along (markDuplicate moves them).
      merges.push(merge);
      hidden.add(merge.duplicate);
    }
  }
  return merges;
}

// The Review page's "Merge" action. Safe to run again: merged rows are skipped.
export async function mergeDuplicates(env: Env): Promise<number> {
  let count = 0;
  const primaries = new Set<string>();
  for (const merge of await mergePlan(env))
    if (await markDuplicate(env, merge)) {
      count++;
      primaries.add(merge.primary);
    }
  for (const id of primaries) await clearDuplicateFlag(env, id);
  if (count) await reconcile(env);
  return count;
}
