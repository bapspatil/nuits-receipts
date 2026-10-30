// Discard: set a receipt aside without deleting it. A discarded row keeps its
// files in R2 and its fields, but LIVE (domain.ts) leaves it out of Review,
// totals, exports, the month package, dedupe and bank matching. Restore brings
// one back; the banner's Undo (src/undo.ts) brings back the whole action. A
// matched receipt loses its match in the same batch, and Undo puts it back.
import type { Env } from './env';
import { requireInput } from './domain';
import { reconcile } from './banking';
import { button } from './actions';
import { escape } from './ui';
import { undoAt, withUndo, type UndoAt } from './undo';

export const MAX_BULK = 100;
const ID = /^[a-f0-9]{64}$/;

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

// Each row is discarded on its own terms (atomic per row). Returns the
// action's timestamp, which Undo uses, and how many rows it discarded.
export async function discardReceipts(
  env: Env,
  ids: readonly string[],
  o: { revision?: number | null } = {},
): Promise<{ at: UndoAt; n: number }> {
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
  const at = undoAt();
  const todo = rows.filter((r) => !r.discarded_at);
  // The discards, then (only where one applied) the unmatches. A row that
  // changed since the read is left as it was.
  const discards = todo.map((r) =>
    env.DB.prepare(
      'UPDATE receipts SET discarded_at=?,revision=revision+1 WHERE id=? AND revision=? AND discarded_at IS NULL',
    ).bind(at, r.id, r.revision),
  );
  const unmatches = todo
    .filter((r) => r.matched)
    .map((r) =>
      env.DB.prepare(
        'UPDATE bank_transactions SET receipt_id=NULL,match_method=NULL,matched_at=NULL WHERE receipt_id=?1 AND EXISTS(SELECT 1 FROM receipts WHERE id=?1 AND discarded_at=?2)',
      ).bind(r.id, at),
    );
  if (!discards.length) return { at, n: 0 };
  const results = await withUndo(env, { at, op: 'discard', ids: todo.map((r) => r.id) }, [...discards, ...unmatches]);
  if (unmatches.length) await reconcile(env);
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
// ---------- UI ----------
// One click discards, matched or not: the banner's Undo brings back the receipt and its match.
// list: the hidden fields of the list or receipt page it is on, which the return keeps.
export function discardControl(id: string | null, o: { list: string; revision?: number; name?: string }): string {
  const hidden = (k: string, v: string | number) => `<input type="hidden" name="${k}" value="${escape(String(v))}">`;
  const fields = `${id ? hidden('id', id) : ''}${o.list}${o.revision === undefined ? '' : hidden('revision', o.revision)}`;
  const aria = o.name ? ` aria-label="Discard ${escape(o.name)}"` : '';
  return `<form method="post" action="/discard" class="discard">${fields}${button('discard', { attrs: aria })}</form>`;
}

// fields: on a receipt page, the list it was opened from (receiptFields), which Restore keeps.
export function restoreForm(id: string, back: string, primary = false, fields = ''): string {
  return `<form method="post" action="/restore"><input type="hidden" name="id" value="${id}"><input type="hidden" name="back" value="${escape(back)}">${fields}${button('restore', { tone: primary ? 'primary' : 'ghost' })}</form>`;
}
