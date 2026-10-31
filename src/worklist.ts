// One model for the work lists: where a list lives, which of its rows are open, their order, and
// where every action, single or bulk, returns to. docs/app-v4/CONTRACT.md is the observable side.
import type { Env } from './env';
import { BANK_ORDER, BANK_UPTO, bankPath, VIEW_SQL } from './banking';
import { BULK_CAP } from './bulk';
import { requireInput } from './domain';
import { withDone, type EventKey } from './events';
import { config } from './config';
import { needsReviewSql, readySql } from './flags';
import { escape } from './ui';

export type ListKey = 'receipts' | 'invoices' | 'bank';
export type View = 'todo' | 'all';
// The list a page shows and an action came from, under the names its URL uses. show is the
// filter chip of the archive and Invoices; q is the archive's search and folder its folder (in=),
// both on Home. There is no offset.
export type ListState = {
  key: ListKey;
  view: View;
  month: string | null;
  show: string | null;
  q: string;
  upto: number;
  folder: string | null;
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const SHOW = /^[a-z]{1,20}$/;
// A Home folder as its URL names it; src/archive.ts reads what it means.
export const FOLDER_PARAM =
  /^(year:(19|20)\d{2}|vendor:.{1,100}|client:.{1,100}|kind:[a-z]{4,10}|tag:.{1,40}|starred|recent)$/s;
export const RECEIPTS_TODO: ListState = {
  key: 'receipts',
  view: 'todo',
  month: null,
  show: null,
  q: '',
  upto: BANK_UPTO,
  folder: null,
};

export type Params = Pick<URLSearchParams, 'get'> | Pick<FormData, 'get'>;
const read = (p: Params, key: string) => String(p.get(key) ?? '').trim();
// A list's state from a query or a form, each value checked; anything missing or malformed
// takes the fallback's value. Which list it is comes from the route, never from the request.
export function listState(p: Params, fallback: Partial<ListState> & Pick<ListState, 'key'>): ListState {
  const view = read(p, 'view'),
    month = read(p, 'month'),
    show = read(p, 'show'),
    folder = read(p, 'in'),
    upto = Number(read(p, 'upto'));
  return {
    ...RECEIPTS_TODO,
    ...fallback,
    ...(view === 'todo' || view === 'all' ? { view } : {}),
    ...(MONTH.test(month) ? { month } : {}),
    ...(SHOW.test(show) ? { show } : {}),
    ...(read(p, 'q') ? { q: read(p, 'q').slice(0, 100) } : {}),
    ...(FOLDER_PARAM.test(folder) ? { folder } : {}),
    ...(Number.isSafeInteger(upto) && upto > 0 ? { upto: Math.min(upto, BULK_CAP) } : {}),
  };
}
// The list a bulk bar posts, in full, as its form carries it. One that is missing a value or sends
// one the list doesn't take comes from a page older than the server, and is refused, never guessed:
// a guessed To do once discarded rows the All search on screen did not match. shows says which
// filter chips the list has.
export function postedState(p: Params, key: ListKey, shows: (show: string) => boolean): ListState {
  const s = listState(p, { key });
  const upto = read(p, 'upto');
  requireInput(
    read(p, 'view') === s.view &&
      read(p, 'month') === (s.month ?? '') &&
      read(p, 'show') === (s.show ?? '') &&
      (!s.show || shows(s.show)) &&
      read(p, 'q') === s.q &&
      read(p, 'in') === (s.folder ?? '') &&
      (!upto || upto === String(s.upto)),
    'This page is out of date. Reload it and try again.',
    400,
  );
  return s;
}
// The list a receipt page was opened from: ?from=todo|all&month=M, and &q= and &in= from Home.
// Without one, an open receipt belongs to To do and any other to All.
export function receiptState(p: Params, open: boolean): ListState {
  const from = read(p, 'from');
  const view = from === 'todo' || from === 'all' ? from : open ? 'todo' : 'all';
  const all = view === 'all';
  return listState(
    new URLSearchParams({ view, month: read(p, 'month'), q: all ? read(p, 'q') : '', in: all ? read(p, 'in') : '' }),
    { key: 'receipts' },
  );
}
// Where a receipt page's own form returns: the page under the list it was opened from, rebuilt from
// the fields receiptFields posted. A form without them (a page older than the server) gets the
// bare page, which picks its list from the receipt's status.
export function receiptReturn(id: string, p: Params): string {
  return read(p, 'from') ? receiptUrl(id, receiptState(p, true)) : `/receipts/${id}`;
}

// Each list's address. Empty parameters are left out, and upto only when it isn't the default.
const PATHS: Record<ListKey, (s: ListState) => string> = {
  // The archive, Receipts All before, is Home.
  receipts: (s) =>
    s.view === 'todo'
      ? query('/receipts', { view: 'todo', month: s.month, upto: upto(s) })
      : query('/', { in: s.folder, month: s.month, show: s.show, q: s.q }),
  invoices: (s) => query('/receipts', { view: 'all', kind: 'sales', month: s.month, show: s.show }),
  bank: (s) => (s.month ? bankPath(s.month, s.view, s.upto) : query('/payments', { view: s.view, upto: upto(s) })),
};
const upto = (s: ListState) => (s.view === 'todo' && s.upto !== BANK_UPTO ? String(s.upto) : null);
function query(path: string, params: Record<string, string | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const text = q.toString();
  return text ? `${path}?${text}` : path;
}

type Done = { event: EventKey; params?: Record<string, string | number | null | undefined> };
// The only builder of return URLs: the list as it was, the signed event, and the next open row.
export function listUrl(state: ListState, o: { done?: Done; next?: string | null } = {}): string {
  const path = PATHS[state.key](state) + (o.next ? `#row-${o.next}` : '');
  return o.done ? withDone(o.done.event, path, o.done.params) : path;
}
// A receipt page that keeps the list it was opened from, so its count and Next use the same filter.
export function receiptUrl(id: string, state: ListState): string {
  const all = state.view === 'all';
  return query(`/receipts/${id}`, {
    from: state.view,
    month: state.month,
    q: all ? state.q : null,
    in: all ? state.folder : null,
  });
}
// The list state as form fields, for every form and bulk bar on a list.
export function listParams(state: ListState): Record<string, string> {
  const fields: Record<string, string | null> = {
    list: state.key,
    view: state.view,
    month: state.month,
    show: state.show,
    q: state.q,
    in: state.folder,
    upto: state.view === 'todo' ? String(state.upto) : null,
  };
  return Object.fromEntries(Object.entries(fields).filter((f): f is [string, string] => !!f[1]));
}
export function listFields(state: ListState): string {
  return Object.entries(listParams(state))
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escape(v)}">`)
    .join('');
}
// The receipt page's list, for every one of its own forms, under the names its URL uses.
export function receiptFields(state: ListState): string {
  const all = state.view === 'all';
  const fields = { from: state.view, month: state.month, q: all ? state.q : null, in: all ? state.folder : null };
  return Object.entries(fields)
    .filter((f): f is [string, string] => !!f[1])
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escape(v)}">`)
    .join('');
}
// A list's state from one of its own addresses, or null for anything else.
export function listFrom(path: string): ListState | null {
  if (!/^\/(?!\/)/.test(path) || path.length > 300) return null;
  const url = new URL(path, 'http://app.invalid');
  const p = url.searchParams;
  const sales = url.pathname === '/invoices' || (url.pathname === '/receipts' && p.get('kind') === 'sales');
  const key = sales
    ? 'invoices'
    : ({ '/': 'receipts', '/receipts': 'receipts', '/review': 'receipts', '/payments': 'bank' } as const)[url.pathname];
  if (url.origin !== 'http://app.invalid' || !key) return null;
  // Every list defaults to To do (Review was To do), except Invoices, which lives in All, and an
  // old Receipts link with a filter or a search, from before To do.
  const all = sales || url.pathname === '/' || (key === 'receipts' && !p.has('view') && (p.has('show') || p.has('q')));
  return listState(p, { key, view: all ? 'all' : 'todo' });
}
// A posted return address made safe: a receipt page as it is, a list rebuilt from its state.
export function parseReturn(value: unknown): string | null {
  const text = String(value ?? '');
  if (/^\/receipts\/[a-f0-9]{64}$/.test(text)) return text;
  const state = listFrom(text);
  return state && listUrl(state);
}

// Where a list's open rows come from and the order they stand in. from names the row table as
// alias, and table names it again for the acted-on row; order ends in the id, so it is total.
export type ListDef = {
  from: string;
  table: string;
  alias: string;
  order: readonly string[];
  // The views whose rows render in this order, each with its #row-<id> anchor.
  views: readonly View[];
  // The rows that need the owner, under the list's filter, in SQL.
  open: (env: Env, s: ListState) => { sql: string; binds: unknown[] };
};
// A sales invoice that nobody marked paid and no bank line pays, past its due date: the date on it,
// else the payment terms after it was issued. The terms are bound, since Settings can change them.
const OVERDUE = `(r.kind='sales' AND ${readySql('r')} AND r.paid_outside_on IS NULL AND r.issue_date IS NOT NULL AND coalesce(r.due_date,date(r.issue_date,'+'||?||' days'))<date('now') AND NOT EXISTS (SELECT 1 FROM bank_transactions t JOIN imports i ON i.id=t.import_id WHERE t.receipt_id=r.id AND i.status='complete'))`;
const RECEIPTS: ListDef = {
  from: 'receipts r',
  table: 'receipts r',
  alias: 'r',
  // Undated first, as they wait on a date before anything else.
  order: ['r.issue_date IS NOT NULL', "coalesce(r.issue_date,'')", 'r.received_at', 'r.id'],
  views: ['todo'],
  // A receipt to check or an overdue invoice. An undated receipt belongs to no month yet, so it
  // stays in every month's To do.
  open: (env, s) => ({
    sql: `r.duplicate_of IS NULL AND r.discarded_at IS NULL AND (${needsReviewSql('r')} OR ${OVERDUE})${s.month ? ' AND (substr(r.issue_date,1,7)=? OR r.issue_date IS NULL)' : ''}`,
    binds: [config(env).tuning.paymentTermsDays, ...(s.month ? [s.month] : [])],
  }),
};
const BANK: ListDef = {
  from: 'bank_transactions t JOIN imports i ON i.id=t.import_id',
  table: 'bank_transactions t',
  alias: 't',
  order: BANK_ORDER.split(','),
  views: ['todo', 'all'],
  open: (_env, s) => ({
    sql: `i.status='complete' AND ${VIEW_SQL.todo}${s.month ? ' AND substr(t.booking_date,1,7)=?' : ''}`,
    binds: s.month ? [s.month] : [],
  }),
};
export const LIST_DEFS: Partial<Record<ListKey, ListDef>> = { receipts: RECEIPTS, bank: BANK };
// The list's model when its view shows open rows with anchors to land on.
export function openDef(state: ListState): ListDef | null {
  const def = LIST_DEFS[state.key];
  return def?.views.includes(state.view) ? def : null;
}

const orderOf = (def: ListDef) => def.order.join(',');
// The order key of the first of ids, in the list's order, as the rows stand now.
const current = (def: ListDef) =>
  `(SELECT ${orderOf(def)} FROM ${def.table} WHERE ${def.alias}.id IN (SELECT value FROM json_each(?)) ORDER BY ${orderOf(def)} LIMIT 1)`;
// A place in a list's order to look on from: after the acted-on row, or at it (a restore lands on
// what it brought back). sql is a row value, with its binds.
export type Cursor = { sql: string; binds: readonly unknown[]; at: boolean };
// The first of ids in list order, its key read now. An action reads it before its write, since the
// write can move the row (a date typed on an undated receipt) and Next means next from where it was.
export async function cursorOf(
  env: Env,
  def: ListDef,
  ids: readonly string[],
  { at = false }: { at?: boolean } = {},
): Promise<Cursor | null> {
  if (!ids.length) return null;
  const order = orderOf(def);
  const [key] = await env.DB.prepare(
    `SELECT ${order} FROM ${def.table} WHERE ${def.alias}.id IN (SELECT value FROM json_each(?)) ORDER BY ${order} LIMIT 1`,
  )
    .bind(JSON.stringify(ids))
    .raw();
  return key ? { sql: `(${key.map(() => '?').join(',')})`, binds: key, at } : null;
}
// The cursor in the list an action came from, or null when that view has no rows to land on.
export function cursorFor(
  env: Env,
  state: ListState,
  ids: readonly string[],
  o?: { at?: boolean },
): Promise<Cursor | null> {
  const def = openDef(state);
  return def ? cursorOf(env, def, ids, o) : Promise.resolve(null);
}
// A row as it stands, for a page that writes nothing, so its Next needs no query of its own.
export const standing = (def: ListDef, id: string): Cursor => ({
  sql: current(def),
  binds: [JSON.stringify([id])],
  at: false,
});
// The first open row after the cursor (at it, for a restore), else, when it wraps or there is no
// cursor, the first open row. One query, run after the write.
export async function nextOpen(
  env: Env,
  def: ListDef,
  state: ListState,
  cursor: Cursor | null,
  { wrap }: { wrap: boolean },
): Promise<string | null> {
  const open = def.open(env, state);
  const order = orderOf(def);
  const select = `SELECT ${def.alias}.id AS id FROM ${def.from} WHERE ${open.sql}`;
  if (!cursor)
    return env.DB.prepare(`${select} ORDER BY ${order} LIMIT 1`)
      .bind(...open.binds)
      .first<string>('id');
  const after = `(${order})${cursor.at ? '>=' : '>'}${cursor.sql}`;
  return env.DB.prepare(
    wrap ? `${select} ORDER BY ${after} DESC,${order} LIMIT 1` : `${select} AND ${after} ORDER BY ${order} LIMIT 1`,
  )
    .bind(...open.binds, ...cursor.binds)
    .first<string>('id');
}
// Where one row stands in the open list: its place from 0 (-1 when it isn't open) and the count.
export async function openPlace(
  env: Env,
  def: ListDef,
  state: ListState,
  id: string,
): Promise<{ position: number; total: number }> {
  const open = def.open(env, state);
  const row = await env.DB.prepare(
    `SELECT count(*) total,total((${orderOf(def)})<${current(def)}) before,total(${def.alias}.id=?) here FROM ${def.from} WHERE ${open.sql}`,
  )
    .bind(JSON.stringify([id]), id, ...open.binds)
    .first<{ total: number; before: number; here: number }>();
  return { position: row?.here ? row.before : -1, total: row?.total ?? 0 };
}
// The open rows themselves, in order.
export async function openRows<T>(env: Env, def: ListDef, state: ListState, limit: number): Promise<T[]> {
  const open = def.open(env, state);
  return (
    await env.DB.prepare(`SELECT ${def.alias}.* FROM ${def.from} WHERE ${open.sql} ORDER BY ${orderOf(def)} LIMIT ?`)
      .bind(...open.binds, limit)
      .all<T>()
  ).results;
}
// How many rows are open, uncapped, and how many of them also meet also (SQL over the alias).
export async function openCount(
  env: Env,
  def: ListDef,
  state: ListState,
  also = '0',
): Promise<{ total: number; also: number }> {
  const open = def.open(env, state);
  const row = await env.DB.prepare(`SELECT count(*) total,total(${also}) also FROM ${def.from} WHERE ${open.sql}`)
    .bind(...open.binds)
    .first<{ total: number; also: number }>();
  return { total: row?.total ?? 0, also: row?.also ?? 0 };
}
// The return after an action: the list it came from, at its next open row when it has one. The
// cursor is cursorFor on the same state, read before the write.
export async function landing(env: Env, state: ListState, cursor: Cursor | null, done: Done): Promise<string> {
  const def = openDef(state);
  return listUrl(state, { done, next: def ? await nextOpen(env, def, state, cursor, { wrap: true }) : null });
}
