// POST /receipts/bulk: one action on many receipts from a list. Each op keeps
// the guards of its single-receipt endpoint and writes in one batch.
import type { Env } from './env';
import { emptyFacts, emptySales, EXPONENTS, KINDS, object, requireInput, type Kind, type Receipt } from './domain';
import { reconcile } from './banking';
import { AI_CAP, BULK_CAP, type ReceiptOp } from './bulk';
import { discardReason, discardReceipts, receiptIds, restoreReceipts } from './discard';
import { backPath, withDone, type EventKey } from './events';
import { kindWrites, paidFields, processReceipt } from './receipts';
import { matchesFilter, reasonCodes, REVIEW_FILTERS, type ReviewFilter } from './flags';
import { reviewQueue } from './views';
import { filterIds, parseQuery } from './all';
import { invoiceRows, invoiceShow } from './invoices';
import { month } from './ui';

type Done = { n: number; event: EventKey; params?: Record<string, string> };
// back: the list to land on, which Undo returns to as well.
type Op = { max?: number; run: (env: Env, ids: string[], form: FormData, back: string) => Promise<Done> };
export type BulkResult = { location: string; n: number; skipped: number };

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const changes = (results: readonly D1Result[]) => results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
async function rowsOf(env: Env, ids: readonly string[]): Promise<Receipt[]> {
  return (
    await env.DB.prepare(`SELECT * FROM receipts WHERE id IN (${ids.map(() => '?').join(',')})`)
      .bind(...ids)
      .all<Receipt>()
  ).results;
}
// What approval needs, as correctReceipt checks it.
const complete = (r: Receipt) =>
  !!r.vendor &&
  !!r.issue_date &&
  !!r.currency &&
  EXPONENTS[r.currency] !== undefined &&
  r.total_minor !== null &&
  r.net_minor !== null &&
  r.vat_minor !== null &&
  (r.kind !== 'sales' || !!r.client);

const OPS: Record<ReceiptOp, Op> = {
  // The facts are pinned as typed and the current reasons acknowledged, as
  // correctReceipt does, so reading it again keeps it approved.
  approve: {
    run: async (env, ids, form) => {
      const reason = text(form, 'approval_reason');
      requireInput(reason.length > 0, 'Approval needs a reason', 422, 'approval_reason');
      requireInput(reason.length <= 1000, 'Field too long', 422, 'approval_reason');
      const now = new Date().toISOString();
      const todo = (await rowsOf(env, ids)).filter(
        (r) => r.status === 'needs_review' && !r.discarded_at && complete(r),
      );
      if (!todo.length) return { n: 0, event: 'approvedMany' };
      const pick = (r: Receipt, keys: object) =>
        Object.fromEntries(Object.keys(keys).map((k) => [k, r[k as keyof Receipt]]));
      const results = await env.DB.batch(
        todo.map((r) =>
          env.DB.prepare(
            "UPDATE receipts SET status='ready',manual_fields_json=?,review_reasons_json='[]',reviewed_at=?,revision=revision+1,attempt_id=NULL,lease_until=NULL WHERE id=? AND revision=? AND status='needs_review' AND discarded_at IS NULL",
          ).bind(
            JSON.stringify({
              ...object(JSON.parse(r.manual_fields_json)),
              ...pick(r, emptyFacts),
              ...(r.kind === 'sales' ? pick(r, emptySales) : {}),
              product: r.product,
              expense_type: r.expense_type,
              approval_reason: reason,
              acknowledged_reasons: JSON.parse(r.review_reasons_json),
            }),
            now,
            r.id,
            r.revision,
          ),
        ),
      );
      const n = changes(results);
      if (n) await reconcile(env);
      return { n, event: 'approvedMany' };
    },
  },
  discard: {
    run: async (env, ids, form, back) => {
      const { at, n } = await discardReceipts(env, ids, { reason: discardReason(form.get('reason')), unmatch: true });
      return { n, event: 'discarded', params: { at, back } };
    },
  },
  restore: {
    run: async (env, ids) => {
      const n = await restoreReceipts(env, ids);
      if (n) await reconcile(env);
      return { n, event: 'restored' };
    },
  },
  retry: {
    max: AI_CAP,
    run: async (env, ids) => {
      const todo = (await rowsOf(env, ids)).filter((r) => !r.discarded_at);
      for (const r of todo) await processReceipt(env, r.id, { retry: true });
      return { n: todo.length, event: 'readAgainMany' };
    },
  },
  kind: {
    max: AI_CAP,
    run: async (env, ids, form) => {
      const to = text(form, 'to');
      requireInput(
        KINDS.some((k) => k === to),
        'Choose where to move them',
        400,
      );
      const todo = (await rowsOf(env, ids)).filter((r) => r.kind !== to);
      if (!todo.length) return { n: 0, event: 'kindMovedMany', params: { to } };
      const results = await env.DB.batch(todo.flatMap((r) => kindWrites(env, r.id, to as Kind, r.revision)));
      // Only the rows whose move applied are read again.
      const moved = todo.filter((_, i) => results[i * 2 + 1]?.meta.changes === 1);
      for (const r of moved) await processReceipt(env, r.id);
      return { n: moved.length, event: 'kindMovedMany', params: { to } };
    },
  },
  paid: {
    run: async (env, ids, form) => {
      const { on, note } = paidFields(form);
      requireInput(on.length > 0, 'Choose the day it was paid', 422, 'paid_outside_on');
      const result = await env.DB.prepare(
        `UPDATE receipts SET paid_outside_on=?,paid_outside_note=? WHERE kind='sales' AND id IN (${ids.map(() => '?').join(',')})`,
      )
        .bind(on, note, ...ids)
        .run();
      return { n: result.meta.changes ?? 0, event: 'paidMany', params: { on } };
    },
  },
};

// Every row of a list's filter, the way its page picks them. Refused over the cap.
const LISTS: Record<string, (env: Env, form: FormData) => Promise<string[]>> = {
  review: async (env, form) => {
    const filter = text(form, 'filter');
    requireInput(!filter || filter in REVIEW_FILTERS, 'Invalid filter', 400);
    const rows = await reviewQueue(env);
    return (
      filter ? rows.filter((r) => matchesFilter(reasonCodes(r.review_reasons_json), filter as ReviewFilter)) : rows
    ).map((r) => r.id);
  },
  receipts: (env, form) => {
    const params = new URLSearchParams();
    for (const key of ['show', 'month', 'q']) if (text(form, key)) params.set(key, text(form, key));
    return filterIds(env, parseQuery(params), BULK_CAP + 1);
  },
  invoices: async (env, form) =>
    (await invoiceRows(env, month(text(form, 'month') || null), invoiceShow(form.get('show')))).shown.map((r) => r.id),
};
const HOME: Record<string, string> = { review: '/review', receipts: '/receipts', invoices: '/invoices' };

export async function receiptsBulk(env: Env, form: FormData): Promise<BulkResult> {
  const name = text(form, 'op');
  requireInput(Object.hasOwn(OPS, name), 'Invalid action', 400);
  const op = OPS[name as ReceiptOp];
  const max = op.max ?? BULK_CAP;
  const list = text(form, 'list');
  let ids: string[];
  if (form.get('all') === '1') {
    requireInput(Object.hasOwn(LISTS, list), 'Invalid list', 400);
    const all = await LISTS[list]!(env, form);
    requireInput(all.length <= max, `Up to ${max} at a time. Narrow the filter.`, 400);
    requireInput(all.length > 0, 'Nothing matches the filter.', 400);
    ids = all;
  } else ids = receiptIds(form.getAll('id'), max);
  const before = form.get('done_before') === null ? 0 : Number(form.get('done_before'));
  requireInput(Number.isSafeInteger(before) && before >= 0, 'Invalid progress', 400);
  const back = backPath(form.get('back'), HOME[list] ?? '/receipts');
  const done = await op.run(env, ids, form, back);
  const n = before + done.n,
    skipped = ids.length - done.n;
  return {
    location: withDone(done.event, back, { n, ...done.params, skipped: skipped || null }),
    n,
    skipped,
  };
}
