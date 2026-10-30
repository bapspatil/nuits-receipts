// POST /receipts/bulk, /payments/bulk and /senders/bulk: one action on many
// rows of a list. Each op keeps the guards of its single-row endpoint and
// writes in one batch.
import type { Env } from './env';
import {
  emptyFacts,
  emptySales,
  EXPONENTS,
  KINDS,
  object,
  requireInput,
  type Kind,
  type Receipt,
  type Rule,
} from './domain';
import { BANK_SHOWS, cacheFx, clearBankReview, reconcile, SET_REQUIRED_SQL, showRows, type BankShow } from './banking';
import { AI_CAP, BULK_CAP, type PaymentOp, type ReceiptOp, type SenderOp } from './bulk';
import { config } from './config';
import { discardReceipts, restoreReceipts } from './discard';
import {
  approveSenders,
  deleteHeldMail,
  heldSenders,
  ignoreSenders,
  removeSenders,
  senderAddress,
  unignoreSenders,
} from './inbound';
import { BULK_MAX, likelyPairs, matchableReceipts, matchLikely, unlinkMatches } from './match';
import { backPath, withDone, type EventKey } from './events';
import { kindWrites, paidFields, processReceipt } from './receipts';
import { reviewQueue } from './views';
import { filterIds, parseQuery } from './all';
import { invoiceRows, invoiceShow } from './invoices';
import { month } from './ui';

// skipped: rows the op left alone, when that is not simply the ids it did not change.
type Done = { n: number; skipped?: number; event: EventKey; params?: Record<string, string | number | null> };
export type Caller = { who: string; ctx: Pick<ExecutionContext, 'waitUntil'> };
// back: the list to land on, which Undo returns to as well. id: parses one
// posted id, when the op's rows differ from the endpoint's.
type Op = {
  max?: number;
  id?: (value: string) => string;
  run: (env: Env, ids: string[], form: FormData, back: string, caller: Caller) => Promise<Done>;
};
// One bulk route: its ops, the shape of its ids, every row of the list's
// filter for all=1 (refused without), and the list it lands on.
type Endpoint = {
  ops: Record<string, Op>;
  id: (value: string) => string;
  all?: (env: Env, form: FormData) => Promise<string[]>;
  back: (form: FormData) => string;
};
export type BulkResult = { location: string; n: number; skipped: number };
const ROW_ID = /^[a-f0-9]{64}$/;
const rowId = (value: string) => {
  requireInput(ROW_ID.test(value), 'Invalid selection', 400);
  return value;
};

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
async function rowsOf(env: Env, ids: readonly string[]): Promise<Receipt[]> {
  return (
    await env.DB.prepare('SELECT * FROM receipts WHERE id IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(ids))
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
      const approved = todo.filter((_, i) => results[i]?.meta.changes === 1);
      // As correctReceipt does: the ECB estimate before reconcile, which may put
      // missing_eur back. A row already valued on its date has nothing to fetch.
      for (const r of approved)
        if (r.fx_eur_minor === null || r.fx_requested_date !== r.issue_date)
          await cacheFx(env, { ...r, status: 'ready', review_reasons_json: '[]', revision: r.revision + 1 });
      if (approved.length) await reconcile(env);
      return { n: approved.length, event: 'approvedMany' };
    },
  },
  discard: {
    run: async (env, ids, _form, back) => {
      const { at, n } = await discardReceipts(env, ids, { unmatch: true });
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
        "UPDATE receipts SET paid_outside_on=?,paid_outside_note=? WHERE kind='sales' AND id IN (SELECT value FROM json_each(?))",
      )
        .bind(on, note, JSON.stringify(ids))
        .run();
      return { n: result.meta.changes ?? 0, event: 'paidMany', params: { on } };
    },
  },
};

// Every row of a list's filter, the way its page picks them. Refused over the cap.
const LISTS: Record<string, (env: Env, form: FormData) => Promise<string[]>> = {
  review: async (env) => (await reviewQueue(env)).map((r) => r.id),
  receipts: (env, form) => {
    const params = new URLSearchParams();
    for (const key of ['show', 'month', 'q']) if (text(form, key)) params.set(key, text(form, key));
    return filterIds(env, parseQuery(params), BULK_CAP + 1);
  },
  invoices: async (env, form) =>
    (await invoiceRows(env, month(text(form, 'month') || null), invoiceShow(form.get('show')))).shown.map((r) => r.id),
};
const HOME: Record<string, string> = { review: '/review', receipts: '/receipts', invoices: '/invoices' };
const RECEIPTS: Endpoint = {
  ops: OPS,
  id: rowId,
  all: (env, form) => {
    const list = text(form, 'list');
    requireInput(Object.hasOwn(LISTS, list), 'Invalid list', 400);
    return LISTS[list]!(env, form);
  },
  back: (form) => backPath(form.get('back'), HOME[text(form, 'list')] ?? '/receipts'),
};

// ---------- Bank ----------
// The month, Show chip and page the bar was drawn for.
function bankScope(form: FormData): { month: string; show: BankShow; offset: number } {
  const month = text(form, 'month'),
    show = text(form, 'show'),
    offset = Number(text(form, 'offset') || 0);
  requireInput(/^\d{4}-(0[1-9]|1[0-2])$/.test(month), 'Choose a month like 2026-10');
  requireInput(
    BANK_SHOWS.some((s) => s === show),
    'Invalid filter',
    400,
  );
  requireInput(Number.isSafeInteger(offset) && offset >= 0, 'Invalid page', 400);
  return { month, show: show as BankShow, offset };
}
// Not a purchase (0) and Needs receipt (1): only money out that is not that already.
const required = (to: 0 | 1, event: EventKey): Op => ({
  run: async (env, ids) => {
    const result = await env.DB.prepare(
      `${SET_REQUIRED_SQL} AND id IN (SELECT value FROM json_each(?)) AND amount_minor<0 AND receipt_required=?`,
    )
      .bind(to, JSON.stringify(ids), 1 - to)
      .run();
    const n = result.meta.changes ?? 0;
    if (n) await reconcile(env);
    return { n, event };
  },
});
const PAYMENT_OPS: Record<PaymentOp, Op> = {
  // Only the exact likely pairs Bank shows for the month, as Match all takes them;
  // one time on all of them, so the banner's Undo finds them.
  match: {
    run: async (env, ids, form) => {
      const { month } = bankScope(form);
      const tuning = config(env).tuning;
      const [open, receipts, rules] = await Promise.all([
        showRows(env, month, 'missing', BULK_CAP),
        matchableReceipts(env),
        env.DB.prepare('SELECT * FROM vendor_rules')
          .all<Rule>()
          .then((r) => r.results),
      ]);
      const picked = new Set(ids);
      const pairs = likelyPairs(open, receipts, rules, tuning)
        .exact.filter(({ t }) => picked.has(t.id))
        .map(({ t, r }) => [t.id, r.id] as const);
      requireInput(pairs.length <= BULK_MAX, `Up to ${BULK_MAX} matches at a time. Narrow the filter.`, 400);
      const at = new Date().toISOString();
      const { matched } = pairs.length ? await matchLikely(env, pairs, rules, tuning, at) : { matched: 0 };
      if (matched) await clearBankReview(env);
      // The Undo reads the month from the Bank address it lands on.
      return { n: matched, event: 'matchedMany', params: { at: matched ? at : null, picked: 1 } };
    },
  },
  exempt: required(0, 'notPurchaseMany'),
  require: required(1, 'needsReceiptMany'),
  unmatch: {
    run: async (env, ids) => {
      const n = await unlinkMatches(env, ids);
      if (n) await clearBankReview(env);
      return { n, event: 'unmatchedMany' };
    },
  },
};
const PAYMENTS: Endpoint = {
  ops: PAYMENT_OPS,
  id: rowId,
  all: async (env, form) => {
    const { month, show } = bankScope(form);
    return (await showRows(env, month, show, BULK_CAP + 1)).map((t) => t.id);
  },
  back: (form) => {
    const { month, show, offset } = bankScope(form);
    return `/payments?month=${month}&show=${show}${offset ? `&offset=${offset}` : ''}`;
  },
};

// ---------- Unknown senders and Settings > Senders ----------
const BACK_TO: Record<string, string> = { settings: '/settings#senders', receipts: '/receipts' };
// Settings opens its Senders section for the mail events too.
const from = (back: string) => ({ from: back.startsWith('/settings') ? 'settings' : null });
const SENDER_OPS: Record<SenderOp, Op> = {
  // Every sender of the checked emails, added in one write; then all their waiting mail is read.
  allow: {
    run: async (env, ids, _form, back, { who, ctx }) => {
      const { held, senders } = await heldSenders(env, ids);
      const n = senders.length ? await approveSenders(env, senders, who, ctx) : 0;
      return {
        n,
        skipped: ids.length - held,
        event: 'mailAllowed',
        params: { senders: senders.length, ...from(back) },
      };
    },
  },
  // An approved sender is left alone, as Ignore refuses it one at a time.
  ignore: {
    run: async (env, ids, _form, back, { who }) => {
      const { held, senders } = await heldSenders(env, ids);
      const allowed = config(env).allowedSenders;
      const todo = senders.filter((s) => !allowed.has(s));
      const n = todo.length ? await ignoreSenders(env, todo, who) : 0;
      return {
        n,
        skipped: ids.length - held + (senders.length - todo.length),
        event: 'mailIgnored',
        params: { senders: todo.length, ...from(back) },
      };
    },
  },
  delete: {
    run: async (env, ids, _form, back) => ({
      n: await deleteHeldMail(env, ids),
      event: 'mailDeleted',
      params: from(back),
    }),
  },
  remove: {
    id: senderAddress,
    run: async (env, ids, _form, _back, { who }) => ({ n: await removeSenders(env, ids, who), event: 'senderRemoved' }),
  },
  unignore: {
    id: senderAddress,
    run: async (env, ids) => ({ n: await unignoreSenders(env, ids), event: 'senderUnignored' }),
  },
};
const SENDERS: Endpoint = {
  ops: SENDER_OPS,
  id: (value) => {
    requireInput(/^[0-9a-f-]{36}$/.test(value), 'Invalid email', 400);
    return value;
  },
  back: (form) => BACK_TO[text(form, 'back')] ?? '/review',
};

// The checked ids: at least one, at most max, each of the list's shape.
function bulkIds(values: readonly unknown[], max: number, parse: (value: string) => string): string[] {
  const raw = [...new Set(values.map(String))];
  requireInput(raw.length > 0, 'Choose at least one', 400);
  requireInput(raw.length <= max, `Up to ${max} at a time.`, 400);
  return [...new Set(raw.map(parse))];
}

// The totals of the chunks the bar already posted; a run never passes BULK_CAP ids.
function progress(form: FormData, key: string): number {
  const raw = form.get(key);
  const value = raw === null ? 0 : Number(raw);
  requireInput(Number.isSafeInteger(value) && value >= 0 && value <= BULK_CAP * 2, 'Invalid progress', 400);
  return value;
}

async function runBulk(endpoint: Endpoint, env: Env, form: FormData, caller: Caller): Promise<BulkResult> {
  const name = text(form, 'op');
  requireInput(Object.hasOwn(endpoint.ops, name), 'Invalid action', 400);
  const op = endpoint.ops[name]!;
  const max = op.max ?? BULK_CAP;
  let ids: string[];
  if (form.get('all') === '1') {
    requireInput(endpoint.all, 'Invalid list', 400);
    const all = await endpoint.all(env, form);
    requireInput(all.length <= max, `Up to ${max} at a time. Narrow the filter.`, 400);
    requireInput(all.length > 0, 'Nothing matches the filter.', 400);
    ids = all;
  } else ids = bulkIds(form.getAll('id'), max, op.id ?? endpoint.id);
  const before = progress(form, 'done_before'),
    skippedBefore = progress(form, 'skipped_before');
  const back = endpoint.back(form);
  const done = await op.run(env, ids, form, back, caller);
  const n = before + done.n,
    skipped = skippedBefore + (done.skipped ?? ids.length - done.n);
  return {
    location: withDone(done.event, back, { n, ...done.params, skipped: skipped || null }),
    n,
    skipped,
  };
}
export const receiptsBulk = (env: Env, form: FormData, caller: Caller) => runBulk(RECEIPTS, env, form, caller);
export const paymentsBulk = (env: Env, form: FormData, caller: Caller) => runBulk(PAYMENTS, env, form, caller);
export const sendersBulk = (env: Env, form: FormData, caller: Caller) => runBulk(SENDERS, env, form, caller);
