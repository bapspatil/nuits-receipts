// One Undo for every action that resolves a list row. CHANGES says, per
// action, which rows of which tables it changes and which columns, so the
// snapshot and the restore are generic. withUndo writes the snapshot in the
// same batch as the change (before it) and seals the after-state at its end,
// so the log and the change commit together or not at all.
//
// Revision: approve and discard bump receipts.revision, and arrivalMonth and
// sendStatus fingerprint a sent month by id:revision. Undo puts revision back
// to its value before the action, so a month that was sent before it reads as
// sent again rather than changed. Undo only runs on a row whose revision is
// still the action's, so no form drawn after the action can save over it.
import type { Env } from './env';
import { emptyFacts, emptySales, requireInput, type Receipt, type Rule } from './domain';
import type { Transaction } from './banking';

type Rows = { receipts: Receipt; bank_transactions: Transaction; vendor_rules: Rule };
type Table = keyof Rows;
type Column<T extends Table> = Extract<keyof Rows[T], string>;

// by: the column the action's ids pick rows on. cols: what the action
// changes, restored on Undo. watch: the columns that tell whether the row
// changed again since; Undo skips such a row. deletes: the action removes the
// rows, so cols is every column and Undo inserts them back.
type Change = {
  [T in Table]: {
    tbl: T;
    by: Column<T>;
    cols: readonly Column<T>[];
    watch?: readonly Column<T>[];
    deletes?: true;
  };
}[Table];

// A bank row goes back to its receipt only while both are free: the receipt
// still exists, is not discarded and no other row took it (receipt_id is UNIQUE).
const RELINK = `(json_extract(l.before_json,'$.receipt_id') IS NULL OR (EXISTS(SELECT 1 FROM receipts r WHERE r.id=json_extract(l.before_json,'$.receipt_id') AND r.discarded_at IS NULL) AND NOT EXISTS(SELECT 1 FROM bank_transactions o WHERE o.receipt_id=json_extract(l.before_json,'$.receipt_id'))))`;
const TABLES: Record<Table, { intKey?: true; guard?: string }> = {
  receipts: {},
  bank_transactions: { guard: RELINK },
  vendor_rules: { intKey: true },
};

const LINK = ['receipt_id', 'match_method', 'matched_at'] as const;
const RULE_COLUMNS = Object.keys({
  id: 1,
  priority: 1,
  vendor_contains: 1,
  context_contains: 1,
  bank_alias: 1,
  product: 1,
  expense_type: 1,
} satisfies Record<keyof Rule, 1>) as (keyof Rule)[];
// Everything correctReceipt can write on a save with Approve. cacheFx and
// reconcile write fx and reasons after it without a revision bump, so only
// revision tells a later change apart.
const APPROVED = [
  ...(Object.keys(emptyFacts) as (keyof typeof emptyFacts)[]),
  ...(Object.keys(emptySales) as (keyof typeof emptySales)[]),
  'product',
  'expense_type',
  'eur_override_minor',
  'eur_override_reason',
  'duplicate_of',
  'status',
  'manual_fields_json',
  'review_reasons_json',
  'reviewed_at',
  'fx_eur_minor',
  'fx_requested_date',
  'revision',
] as const satisfies readonly Column<'receipts'>[];
const linked: Change = { tbl: 'bank_transactions', by: 'receipt_id', cols: LINK };
// SET_REQUIRED_SQL also drops a match on the rows it marks.
const required: Change = { tbl: 'bank_transactions', by: 'id', cols: ['receipt_required', 'exempt_by', ...LINK] };

// The first change of each action is the one Undo counts.
const CHANGES = {
  approve: [{ tbl: 'receipts', by: 'id', cols: APPROVED, watch: ['revision'] }, linked],
  discard: [
    { tbl: 'receipts', by: 'id', cols: ['discarded_at', 'discard_reason', 'revision'], watch: ['revision'] },
    linked,
  ],
  exempt: [required],
  require: [required],
  match: [{ tbl: 'bank_transactions', by: 'id', cols: LINK }],
  unmatch: [{ tbl: 'bank_transactions', by: 'id', cols: LINK }],
  paid: [{ tbl: 'receipts', by: 'id', cols: ['paid_outside_on', 'paid_outside_note'] }],
  deleteRule: [{ tbl: 'vendor_rules', by: 'id', cols: RULE_COLUMNS, deletes: true }],
} satisfies Record<string, readonly [Change, ...Change[]]>;
export type UndoOp = keyof typeof CHANGES;
export type UndoAt = string & { readonly __brand: 'UndoAt' };
export type UndoAction = { at: UndoAt; op: UndoOp; ids: readonly (string | number)[] };

// Undo is offered only while the signed done= link lives (FEEDBACK_TTL, 15
// minutes), so a day of log is margin enough.
const KEEP_MS = 24 * 60 * 60 * 1000;
const AT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

export const undoAt = (now = new Date()) => now.toISOString() as UndoAt;
export function parseUndo(at: unknown, op: unknown): { at: UndoAt; op: UndoOp } {
  requireInput(typeof at === 'string' && AT.test(at), 'Invalid undo', 400);
  requireInput(typeof op === 'string' && Object.hasOwn(CHANGES, op), 'Invalid undo', 400);
  return { at: at as UndoAt, op: op as UndoOp };
}

const json = (cols: readonly string[], row: string) =>
  `json_object(${cols.map((c) => `'${c}',${row}.${c}`).join(',')})`;
const key = (c: Change, log: string) => (TABLES[c.tbl].intKey ? `CAST(${log}.row_id AS INTEGER)` : `${log}.row_id`);
const before = (c: string) => `json_extract(l.before_json,'$.${c}')`;

// Runs writes in one batch with the action's snapshot before them and its
// seal after, and returns the writes' own results.
export async function withUndo(env: Env, a: UndoAction, writes: readonly D1PreparedStatement[]): Promise<D1Result[]> {
  if (!writes.length) return [];
  const changes: readonly Change[] = CHANGES[a.op];
  const ids = JSON.stringify(a.ids);
  const head = [
    env.DB.prepare('DELETE FROM undo_log WHERE at<?').bind(new Date(Date.parse(a.at) - KEEP_MS).toISOString()),
    ...changes.map((c) =>
      env.DB.prepare(
        `INSERT INTO undo_log(at,op,tbl,row_id,before_json) SELECT ?1,?2,'${c.tbl}',t.id,${json(c.cols, 't')} FROM ${c.tbl} t WHERE t.${c.by} IN (SELECT value FROM json_each(?3)) ON CONFLICT DO NOTHING`,
      ).bind(a.at, a.op, ids),
    ),
  ];
  // after_json is 'null' for a row the action deleted; a row it left as it
  // was is dropped, so Undo counts only what changed.
  const tail = changes.flatMap((c) => [
    env.DB.prepare(
      `UPDATE undo_log SET after_json=COALESCE((SELECT ${json(c.cols, 't')} FROM ${c.tbl} t WHERE t.id=${key(c, 'undo_log')}),'null') WHERE at=?1 AND tbl='${c.tbl}' AND after_json IS NULL`,
    ).bind(a.at),
    env.DB.prepare(`DELETE FROM undo_log WHERE at=?1 AND tbl='${c.tbl}' AND after_json=before_json`).bind(a.at),
  ]);
  const results = await env.DB.batch([...head, ...writes, ...tail]);
  return results.slice(head.length, head.length + writes.length);
}

function restore(env: Env, at: UndoAt, op: UndoOp, c: Change): D1PreparedStatement {
  const scope = `l.at=?1 AND l.op=?2 AND l.tbl='${c.tbl}'`;
  if (c.deletes)
    return env.DB.prepare(
      `INSERT OR IGNORE INTO ${c.tbl}(${c.cols.join(',')}) SELECT ${c.cols.map(before).join(',')} FROM undo_log l WHERE ${scope} AND l.after_json='null'`,
    ).bind(at, op);
  const unchanged = (c.watch ?? c.cols).map((w) => `${c.tbl}.${w} IS json_extract(l.after_json,'$.${w}')`);
  return env.DB.prepare(
    `UPDATE ${c.tbl} SET ${c.cols.map((col) => `${col}=${before(col)}`).join(',')} FROM undo_log l WHERE ${scope} AND l.after_json<>'null' AND ${c.tbl}.id=${key(c, 'l')} AND ${[...unchanged, TABLES[c.tbl].guard ?? '1'].join(' AND ')}`,
  ).bind(at, op);
}

// Puts back every row the action changed that nothing has changed since, in
// one batch, and forgets the action. n: rows of its first table put back.
export async function undo(env: Env, at: UndoAt, op: UndoOp): Promise<{ n: number }> {
  const results = await env.DB.batch([
    ...CHANGES[op].map((c) => restore(env, at, op, c)),
    env.DB.prepare('DELETE FROM undo_log WHERE at=? AND op=?').bind(at, op),
  ]);
  return { n: results[0]?.meta.changes ?? 0 };
}
