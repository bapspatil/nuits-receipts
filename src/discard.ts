// Discard: set a receipt aside without deleting it. A discarded row keeps its
// files in R2 and its fields, but LIVE (domain.ts) leaves it out of Review,
// totals, exports, the month package, dedupe and bank matching. Restore undoes
// it. A row a bank line points at is discarded only with unmatch, which
// removes the match in the same batch.
import type { Env } from './env';
import { DISCARD_REASONS, type DiscardReason, requireInput } from './domain';
import { reconcile } from './banking';
import { escape } from './ui';

export const MAX_BULK = 100;
const ID = /^[a-f0-9]{64}$/;

export function discardReason(value: unknown): DiscardReason | null {
  const text = String(value ?? '');
  if (!text) return null;
  requireInput(text in DISCARD_REASONS, 'Invalid reason', 400);
  return text as DiscardReason;
}
export function receiptIds(values: readonly unknown[], max = MAX_BULK): string[] {
  const ids = [...new Set(values.map(String))];
  requireInput(ids.length > 0, 'Choose a receipt', 400);
  requireInput(ids.length <= max, `Up to ${max} at a time.`, 400);
  requireInput(
    ids.every((id) => ID.test(id)),
    'Invalid receipt',
    400,
  );
  return ids;
}

export type DiscardOptions = { reason: DiscardReason | null; unmatch?: boolean; revision?: number | null };

// Each row is discarded on its own terms (atomic per row). Returns the
// action's timestamp, which Undo uses, and how many rows it discarded.
export async function discardReceipts(
  env: Env,
  ids: readonly string[],
  o: DiscardOptions,
): Promise<{ at: string; n: number }> {
  const rows = (
    await env.DB.prepare(
      `SELECT r.id,r.revision,r.discarded_at,EXISTS(SELECT 1 FROM bank_transactions t WHERE t.receipt_id=r.id) AS matched FROM receipts r WHERE r.id IN (SELECT value FROM json_each(?))`,
    )
      .bind(JSON.stringify(ids))
      .all<{ id: string; revision: number; discarded_at: string | null; matched: number }>()
  ).results;
  requireInput(rows.length === ids.length, 'Receipt not found', 404);
  requireInput(
    o.revision === undefined || o.revision === null || ids.length !== 1 || rows[0]!.revision === o.revision,
    'This receipt changed. Reload and try again.',
    409,
  );
  const matched = rows.filter((r) => r.matched);
  requireInput(!matched.length || o.unmatch, 'Remove the match first.', 409);
  const at = new Date().toISOString();
  const todo = rows.filter((r) => !r.discarded_at);
  // The discards, then (only where one applied) the unmatches. A row that
  // changed since the read is left as it was.
  const discards = todo.map((r) =>
    env.DB.prepare(
      'UPDATE receipts SET discarded_at=?,discard_reason=?,revision=revision+1 WHERE id=? AND revision=? AND discarded_at IS NULL',
    ).bind(at, o.reason, r.id, r.revision),
  );
  const unmatches = todo
    .filter((r) => r.matched)
    .map((r) =>
      env.DB.prepare(
        'UPDATE bank_transactions SET receipt_id=NULL,match_method=NULL,matched_at=NULL WHERE receipt_id=?1 AND EXISTS(SELECT 1 FROM receipts WHERE id=?1 AND discarded_at=?2)',
      ).bind(r.id, at),
    );
  if (!discards.length) return { at, n: 0 };
  const results = await env.DB.batch([...discards, ...unmatches]);
  if (matched.length) await reconcile(env);
  return { at, n: results.slice(0, discards.length).reduce((n, r) => n + (r.meta.changes ?? 0), 0) };
}

export async function restoreReceipts(env: Env, ids: readonly string[]): Promise<number> {
  const result = await env.DB.prepare(
    `UPDATE receipts SET discarded_at=NULL,discard_reason=NULL,revision=revision+1 WHERE discarded_at IS NOT NULL AND id IN (SELECT value FROM json_each(?))`,
  )
    .bind(JSON.stringify(ids))
    .run();
  return result.meta.changes ?? 0;
}
// Undo: everything discarded in one action shares its timestamp.
export async function restoreBatch(env: Env, at: string): Promise<number> {
  requireInput(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(at), 'Invalid undo', 400);
  const result = await env.DB.prepare(
    'UPDATE receipts SET discarded_at=NULL,discard_reason=NULL,revision=revision+1 WHERE discarded_at=?',
  )
    .bind(at)
    .run();
  return result.meta.changes ?? 0;
}

// ---------- UI ----------
// The reason chips. Each one discards; the plain button skips the reason.
export function discardControl(
  id: string | null,
  o: { back: string; matched?: boolean; revision?: number; name?: string },
): string {
  const hidden = (k: string, v: string | number) => `<input type="hidden" name="${k}" value="${escape(String(v))}">`;
  const fields = `${id ? hidden('id', id) : ''}${hidden('back', o.back)}${o.revision === undefined ? '' : hidden('revision', o.revision)}${o.matched ? hidden('unmatch', '1') : ''}`;
  const chips = (Object.keys(DISCARD_REASONS) as DiscardReason[])
    .map((k) => `<button class="chip" name="reason" value="${k}">${DISCARD_REASONS[k]}</button>`)
    .join('');
  return `<details class="discard"><summary${o.name ? ` aria-label="Discard ${escape(o.name)}"` : ''}>Discard</summary><div class="body"><form method="post" action="/discard">${fields}${o.matched ? '<p class="ask">Remove match?</p>' : ''}<div class="reasons">${chips}<button class="btn secondary" name="reason" value="">${o.matched ? 'Remove and discard' : 'Discard'}</button></div></form></div></details>`;
}

export function restoreForm(id: string, back: string, primary = false): string {
  return `<form method="post" action="/restore"><input type="hidden" name="id" value="${id}"><input type="hidden" name="back" value="${escape(back)}"><button class="${primary ? 'btn primary' : 'linkbtn'}">Restore</button></form>`;
}
