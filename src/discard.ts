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
export function receiptIds(values: readonly unknown[]): string[] {
  const ids = [...new Set(values.map(String))];
  requireInput(ids.length > 0, 'Choose a receipt', 400);
  requireInput(ids.length <= MAX_BULK, `Up to ${MAX_BULK} at a time.`, 400);
  requireInput(
    ids.every((id) => ID.test(id)),
    'Invalid receipt',
    400,
  );
  return ids;
}

export type DiscardOptions = { reason: DiscardReason | null; unmatch?: boolean; revision?: number | null };

// Each row is discarded on its own terms (atomic per row). Returns the
// action's timestamp, which Undo uses.
export async function discardReceipts(env: Env, ids: readonly string[], o: DiscardOptions): Promise<string> {
  const rows = (
    await env.DB.prepare(
      `SELECT r.id,r.revision,r.discarded_at,EXISTS(SELECT 1 FROM bank_transactions t WHERE t.receipt_id=r.id) AS matched FROM receipts r WHERE r.id IN (${ids.map(() => '?').join(',')})`,
    )
      .bind(...ids)
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
  // Per row: the discard, then (only if it applied) the unmatch. A row that
  // changed since the read is left as it was.
  const statements = todo.flatMap((r) => [
    env.DB.prepare(
      'UPDATE receipts SET discarded_at=?,discard_reason=?,revision=revision+1 WHERE id=? AND revision=? AND discarded_at IS NULL',
    ).bind(at, o.reason, r.id, r.revision),
    ...(r.matched
      ? [
          env.DB.prepare(
            'UPDATE bank_transactions SET receipt_id=NULL,match_method=NULL,matched_at=NULL WHERE receipt_id=?1 AND EXISTS(SELECT 1 FROM receipts WHERE id=?1 AND discarded_at=?2)',
          ).bind(r.id, at),
        ]
      : []),
  ]);
  if (!statements.length) return at;
  await env.DB.batch(statements);
  if (matched.length) await reconcile(env);
  return at;
}

export async function restoreReceipts(env: Env, ids: readonly string[]): Promise<number> {
  const result = await env.DB.prepare(
    `UPDATE receipts SET discarded_at=NULL,discard_reason=NULL,revision=revision+1 WHERE discarded_at IS NOT NULL AND id IN (${ids.map(() => '?').join(',')})`,
  )
    .bind(...ids)
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
// bare: no form of its own (bulk select puts it inside the list's form).
export function discardControl(
  id: string | null,
  o: { back: string; matched?: boolean; revision?: number; name?: string; bare?: boolean },
  // bare (bulk) is always open: the bar shows the chips straight away.
): string {
  const hidden = (k: string, v: string | number) => `<input type="hidden" name="${k}" value="${escape(String(v))}">`;
  const fields = `${id ? hidden('id', id) : ''}${o.bare ? '' : hidden('back', o.back)}${o.revision === undefined ? '' : hidden('revision', o.revision)}${o.matched ? hidden('unmatch', '1') : ''}`;
  const chips = (Object.keys(DISCARD_REASONS) as DiscardReason[])
    .map((k) => `<button class="chip" name="reason" value="${k}">${DISCARD_REASONS[k]}</button>`)
    .join('');
  const body = `${fields}${o.matched ? '<p class="ask">Remove match?</p>' : ''}<div class="reasons">${chips}<button class="btn secondary" name="reason" value="">${o.matched ? 'Remove and discard' : 'Discard'}</button></div>`;
  return `<details class="discard"${o.bare ? ' open' : ''}><summary${o.name ? ` aria-label="Discard ${escape(o.name)}"` : ''}>Discard</summary><div class="body">${
    o.bare ? body : `<form method="post" action="/discard">${body}</form>`
  }</div></details>`;
}

// "Discarded. Undo" on the page a discard lands on.
export function discardBanner(params: URLSearchParams, back: string): string {
  const at = params.get('discarded_at');
  if (params.get('restored') !== null) return '<p class="banner" role="status">Restored.</p>';
  if (!at) return '';
  const n = Number(params.get('discarded')) || 1;
  return `<div class="banner undo" role="status">${n > 1 ? `${n} discarded.` : 'Discarded.'}<form method="post" action="/restore"><input type="hidden" name="at" value="${escape(at)}"><input type="hidden" name="back" value="${escape(back)}"><button class="linkbtn">Undo</button></form></div>`;
}

export function restoreForm(id: string, back: string, primary = false): string {
  return `<form method="post" action="/restore"><input type="hidden" name="id" value="${id}"><input type="hidden" name="back" value="${escape(back)}"><button class="${primary ? 'btn primary' : 'linkbtn'}">Restore</button></form>`;
}

// Where a discard or restore form may send you back to.
export function backPath(value: unknown, fallback = '/review'): string {
  const text = String(value ?? '');
  return /^\/(review|receipts(\/[a-f0-9]{64})?)$/.test(text) ? text : fallback;
}
