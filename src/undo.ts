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

type Setting = { key: string; value_json: string; updated_at: string; updated_by: string };
type Rows = { receipts: Receipt; bank_transactions: Transaction; vendor_rules: Rule; settings: Setting };
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
// pk: the row's key, id unless named. absent: a row the action may create, so the snapshot keeps
// one it did not find as 'null' and Undo deletes it again.
const TABLES: Record<Table, { pk?: string; intKey?: true; guard?: string; absent?: true }> = {
  receipts: {},
  bank_transactions: { guard: RELINK },
  vendor_rules: { intKey: true },
  settings: { pk: 'key', absent: true },
};
const pk = (c: Change) => TABLES[c.tbl].pk ?? 'id';

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
  // A Settings save that takes a sender or a part away; ids are the setting keys it writes.
  settings: [{ tbl: 'settings', by: 'key', cols: ['value_json'] }],
} satisfies Record<string, readonly [Change, ...Change[]]>;
export type UndoOp = keyof typeof CHANGES;
export type UndoAt = string & { readonly __brand: 'UndoAt' };
export type UndoAction = { at: UndoAt; op: UndoOp; ids: readonly (string | number)[] };

// Undo is offered only while the signed done= link lives (FEEDBACK_TTL, 15
// minutes), so a day of log is margin enough.
const KEEP_MS = 24 * 60 * 60 * 1000;
const AT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

export const undoAt = (now = new Date()) => now.toISOString() as UndoAt;
export const isUndoOp = (op: unknown): op is UndoOp => typeof op === 'string' && Object.hasOwn(CHANGES, op);
// The action an Undo names, or null when either part is malformed.
export function undoOf(at: unknown, op: unknown): { at: UndoAt; op: UndoOp } | null {
  return typeof at === 'string' && AT.test(at) && isUndoOp(op) ? { at: at as UndoAt, op } : null;
}
export function parseUndo(at: unknown, op: unknown): { at: UndoAt; op: UndoOp } {
  const action = undoOf(at, op);
  requireInput(action, 'Invalid undo', 400);
  return action;
}

const json = (cols: readonly string[], row: string) =>
  `json_object(${cols.map((c) => `'${c}',${row}.${c}`).join(',')})`;
const key = (c: Change, log: string) => (TABLES[c.tbl].intKey ? `CAST(${log}.row_id AS INTEGER)` : `${log}.row_id`);
// The snapshot of the rows ids pick: for a table whose rows the action may create, every id, with
// 'null' for a row not there.
const snapshot = (c: Change) =>
  TABLES[c.tbl].absent
    ? `SELECT ?1,?2,'${c.tbl}',k.value,CASE WHEN t.${pk(c)} IS NULL THEN 'null' ELSE ${json(c.cols, 't')} END FROM json_each(?3) k LEFT JOIN ${c.tbl} t ON t.${c.by}=k.value`
    : `SELECT ?1,?2,'${c.tbl}',t.${pk(c)},${json(c.cols, 't')} FROM ${c.tbl} t WHERE t.${c.by} IN (SELECT value FROM json_each(?3))`;
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
      env.DB.prepare(`INSERT INTO undo_log(at,op,tbl,row_id,before_json) ${snapshot(c)} ON CONFLICT DO NOTHING`).bind(
        a.at,
        a.op,
        ids,
      ),
    ),
  ];
  // after_json is 'null' for a row the action deleted; a row it left as it
  // was is dropped, so Undo counts only what changed.
  const tail = changes.flatMap((c) => [
    env.DB.prepare(
      `UPDATE undo_log SET after_json=COALESCE((SELECT ${json(c.cols, 't')} FROM ${c.tbl} t WHERE t.${pk(c)}=${key(c, 'undo_log')}),'null') WHERE at=?1 AND tbl='${c.tbl}' AND after_json IS NULL`,
    ).bind(a.at),
    env.DB.prepare(`DELETE FROM undo_log WHERE at=?1 AND tbl='${c.tbl}' AND after_json=before_json`).bind(a.at),
  ]);
  const results = await env.DB.batch([...head, ...writes, ...tail]);
  return results.slice(head.length, head.length + writes.length);
}

// A row as it stands now, in the shape the log keeps it.
const now = (c: Change, log: string) =>
  `COALESCE((SELECT ${json(c.cols, 't')} FROM ${c.tbl} t WHERE t.${pk(c)}=${key(c, log)}),'null')`;

function restore(env: Env, at: UndoAt, op: UndoOp, c: Change, who: string): D1PreparedStatement[] {
  const scope = `l.at=?1 AND l.op=?2 AND l.tbl='${c.tbl}'`;
  if (c.deletes)
    return [
      env.DB.prepare(
        `INSERT OR IGNORE INTO ${c.tbl}(${c.cols.join(',')}) SELECT ${c.cols.map(before).join(',')} FROM undo_log l WHERE ${scope} AND l.after_json='null' RETURNING ${pk(c)} AS id`,
      ).bind(at, op),
    ];
  if (TABLES[c.tbl].absent) return restoreSetting(env, at, op, scope, who);
  const unchanged = (c.watch ?? c.cols).map((w) => `${c.tbl}.${w} IS json_extract(l.after_json,'$.${w}')`);
  return [
    env.DB.prepare(
      `UPDATE ${c.tbl} SET ${c.cols.map((col) => `${col}=${before(col)}`).join(',')} FROM undo_log l WHERE ${scope} AND l.after_json<>'null' AND ${c.tbl}.${pk(c)}=${key(c, 'l')} AND ${[...unchanged, TABLES[c.tbl].guard ?? '1'].join(' AND ')} RETURNING ${c.tbl}.${pk(c)} AS id`,
    ).bind(at, op),
  ];
}
// Settings go back the way Settings saves them: with an audit row each, so the history shows the
// Undo and a Settings page drawn before it is refused on save, as for any other save in between.
// Only a key still as the action left it goes back.
function restoreSetting(env: Env, at: UndoAt, op: UndoOp, scope: string, who: string): D1PreparedStatement[] {
  const c = CHANGES.settings[0];
  const back = `${scope} AND ${now(c, 'l')}=l.after_json`;
  const value = (side: string) => `json_extract(l.${side},'$.value_json')`;
  const stamp = new Date().toISOString();
  return [
    env.DB.prepare(
      `INSERT INTO settings_audit(key,old_json,new_json,changed_at,changed_by) SELECT l.row_id,${value('after_json')},${value('before_json')},?3,?4 FROM undo_log l WHERE ${back} RETURNING key AS id`,
    ).bind(at, op, stamp, who),
    env.DB.prepare(
      `DELETE FROM settings WHERE key IN (SELECT l.row_id FROM undo_log l WHERE ${back} AND l.before_json='null')`,
    ).bind(at, op),
    env.DB.prepare(
      `INSERT INTO settings(key,value_json,updated_at,updated_by) SELECT l.row_id,${value('before_json')},?3,?4 FROM undo_log l WHERE ${back} AND l.before_json<>'null' ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,
    ).bind(at, op, stamp, who),
  ];
}

// Approval runs the matcher after its batch, which may pair the receipt with a payment. That match
// rests on the approved facts, so undoing the approval takes it off first: an automatic match made
// after the action, on a receipt Undo is about to put back. A match the approval dropped can then
// go back on.
const FIRST: Partial<Record<UndoOp, string>> = {
  approve: `UPDATE bank_transactions SET receipt_id=NULL,match_method=NULL,matched_at=NULL WHERE match_method='automatic' AND matched_at>?1 AND receipt_id IN (SELECT l.row_id FROM undo_log l JOIN receipts r ON r.id=l.row_id WHERE l.at=?1 AND l.op=?2 AND l.tbl='receipts' AND r.revision IS json_extract(l.after_json,'$.revision'))`,
};

// Puts back every row the action changed that nothing has changed since, in
// one batch, and forgets the action. ids: the rows of its first table put back.
// who: the person undoing, for the Settings audit.
export async function undo(env: Env, at: UndoAt, op: UndoOp, who = 'owner'): Promise<{ ids: string[] }> {
  const first = FIRST[op] ? [env.DB.prepare(FIRST[op]).bind(at, op)] : [];
  const results = await env.DB.batch([
    ...first,
    ...CHANGES[op].flatMap((c) => restore(env, at, op, c, who)),
    env.DB.prepare('DELETE FROM undo_log WHERE at=? AND op=?').bind(at, op),
  ]);
  const put = (results[first.length]?.results ?? []) as { id: string | number }[];
  return { ids: put.map((r) => String(r.id)) };
}
