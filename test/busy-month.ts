// A busy month for the list tests: 150 receipts, 220 bank rows, 3 held mails.
// The row recipe lives in scripts/busy-month.mjs so the journeys seed the same shape.
import { env } from 'cloudflare:workers';
import { importBankCsv, parsePreset } from '../src/banking';
import {
  busyMail,
  busyReceipts,
  busyStatement,
  earlierMonth,
  EARLIER,
  classifyBank,
  isComplete,
  isOverdue,
  isTodo,
  READY,
  SALES,
  statementCsv,
  UNDATED,
} from '../scripts/busy-month.mjs';

export const MONTH = '2026-09';
const insert = (table: string, row: Record<string, string | number | null>) =>
  env.DB.prepare(
    `INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row)
      .map(() => '?')
      .join(',')})`,
  ).bind(...Object.values(row));
const inList = (sql: string, ids: string[]) => env.DB.prepare(sql).bind(JSON.stringify(ids));

export type Busy = Awaited<ReturnType<typeof seedBusyMonth>>;
export async function seedBusyMonth() {
  const receipts = busyReceipts(MONTH);
  await env.DB.batch(receipts.map((r) => insert('receipts', r)));
  await env.DB.batch(busyMail(MONTH).map((m) => insert('inbound_mail', m)));

  const statement = busyStatement(MONTH);
  const text = statementCsv(statement);
  await importBankCsv(env, {
    bytes: new TextEncoder().encode(text),
    parsed: parsePreset(text, 'holvi', 'EUR'),
    collision: 'keep_existing',
  });
  const stored = (
    await env.DB.prepare('SELECT id,external_id FROM bank_transactions ORDER BY booking_date,account_key,id').all<{
      id: string;
      external_id: string;
    }>()
  ).results;
  const bank = stored.map((t) => t.id);
  const byExt = new Map(stored.map((t) => [t.external_id, t.id]));
  const kinds = classifyBank(
    statement.map((r) => byExt.get(r.ext)!),
    bank,
  );
  const now = `${MONTH}-28T12:00:00Z`;
  await env.DB.batch([
    inList(
      "UPDATE bank_transactions SET receipt_required=0,exempt_by='owner' WHERE id IN (SELECT value FROM json_each(?))",
      kinds.owner,
    ),
    inList(
      "UPDATE bank_transactions SET receipt_required=0,exempt_by='own' WHERE id IN (SELECT value FROM json_each(?))",
      kinds.transfers.flatMap((t) => [t.debit, t.credit]),
    ),
    ...kinds.matched.map((m) =>
      env.DB.prepare("UPDATE bank_transactions SET receipt_id=?,match_method='manual',matched_at=? WHERE id=?").bind(
        m.receipt,
        now,
        m.id,
      ),
    ),
    ...kinds.transfers.map((t) =>
      insert('internal_transfers', { debit_id: t.debit, credit_id: t.credit, reason: 'Busy month', confirmed_at: now }),
    ),
  ]);

  // Receipts To do order today: undated first, then oldest date, then arrival, then id.
  const todoOrder = (
    await env.DB.prepare(
      "SELECT id FROM receipts WHERE status='needs_review' ORDER BY issue_date IS NOT NULL,issue_date,received_at,id",
    ).all<{ id: string }>()
  ).results.map((r) => r.id);
  const review = receipts.filter((r) => r.status === 'needs_review');
  const inTodo = (pick: (r: (typeof receipts)[number]) => boolean) => {
    const ids = new Set(review.filter(pick).map((r) => r.id as string));
    return todoOrder.filter((id) => ids.has(id));
  };
  const reviewIds = review.map((r) => r.id as string);
  const approvable = inTodo(isComplete);
  // A receipt flagged only for optional reasons is as good as ready, so it stays out of To do,
  // unless it is a sales invoice past its payment terms.
  const today = new Date().toISOString().slice(0, 10);
  const todo = inTodo((r) => isTodo(r) || isOverdue(r, today));
  return {
    month: MONTH,
    earlierMonth: earlierMonth(MONTH),
    ready: receipts.slice(0, READY).map((r) => r.id as string),
    needsReview: todoOrder,
    // What Receipts To do holds, in its order.
    todo,
    // Facts all there, so Approve accepts them.
    approvable,
    // Approvable and in To do: they carry a reason Approve clears.
    todoApprovable: approvable.filter((id) => todo.includes(id)),
    // Complete receipts dated the month before, in To do order.
    earlier: EARLIER.map((j: number) => reviewIds[j]!).sort(
      (a: string, b: string) => todoOrder.indexOf(a) - todoOrder.indexOf(b),
    ),
    sales: SALES.map((j: number) => reviewIds[j]!),
    // Sales invoices in To do because they are overdue, in To do order.
    overdue: inTodo((r) => isOverdue(r, today)),
    undated: UNDATED.map((j: number) => reviewIds[j]!),
    heldMail: busyMail(MONTH).map((m) => m.id as string),
    bank,
    // Every id below is in `bank` order, the order Bank lists them in.
    missing: kinds.missing,
    missingPast100: kinds.missing.filter((id: string) => bank.indexOf(id) >= 100),
    exempted: kinds.exempted,
    matched: kinds.matched,
    transfers: kinds.transfers,
  };
}
