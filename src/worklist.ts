// One model for the work lists: where a list lives, which of its rows are open, their order, and
// where every action, single or bulk, returns to. docs/app-v4/CONTRACT.md is the observable side.
import type { Env } from './env';
import { BANK_ORDER, BANK_UPTO, bankPath, VIEW_SQL } from './banking';
import { BULK_CAP } from './bulk';
import { withDone, type EventKey } from './events';
import { needsReviewSql } from './flags';
import { escape } from './ui';

export type ListKey = 'receipts' | 'invoices' | 'bank';
export type View = 'todo' | 'all';
// The list a page shows and an action came from, under the names its URL uses. show is the
// filter chip of Receipts All and Invoices; q is the search of Receipts All. There is no offset.
export type ListState = {
  key: ListKey;
  view: View;
  month: string | null;
  show: string | null;
  q: string;
  upto: number;
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const SHOW = /^[a-z]{1,20}$/;
export const RECEIPTS_TODO: ListState = {
  key: 'receipts',
  view: 'todo',
  month: null,
  show: null,
  q: '',
  upto: BANK_UPTO,
};

export type Params = Pick<URLSearchParams, 'get'> | Pick<FormData, 'get'>;
const read = (p: Params, key: string) => String(p.get(key) ?? '').trim();
// A list's state from a query or a form, each value checked; anything missing or malformed
// takes the fallback's value. Which list it is comes from the route, never from the request.
export function listState(p: Params, fallback: Partial<ListState> & Pick<ListState, 'key'>): ListState {
  const view = read(p, 'view'),
    month = read(p, 'month'),
    show = read(p, 'show'),
    upto = Number(read(p, 'upto'));
  return {
    ...RECEIPTS_TODO,
    ...fallback,
    ...(view === 'todo' || view === 'all' ? { view } : {}),
    ...(MONTH.test(month) ? { month } : {}),
    ...(SHOW.test(show) ? { show } : {}),
    ...(read(p, 'q') ? { q: read(p, 'q').slice(0, 100) } : {}),
    ...(Number.isSafeInteger(upto) && upto > 0 ? { upto: Math.min(upto, BULK_CAP) } : {}),
  };
}
// The list a receipt page was opened from: ?from=todo|all&month=M. Without one, an open receipt
// belongs to To do and any other to All.
export function receiptState(p: Params, open: boolean): ListState {
  const from = read(p, 'from');
  return listState(
    new URLSearchParams({
      view: from === 'todo' || from === 'all' ? from : open ? 'todo' : 'all',
      month: read(p, 'month'),
    }),
    {
      key: 'receipts',
    },
  );
}

// Each list's address. Empty parameters are left out, and upto only when it isn't the default.
const PATHS: Record<ListKey, (s: ListState) => string> = {
  receipts: (s) =>
    query(
      '/receipts',
      s.view === 'todo'
        ? { view: 'todo', month: s.month, upto: upto(s) }
        : { view: 'all', show: s.show, month: s.month, q: s.q },
    ),
  invoices: (s) => query('/invoices', { month: s.month, show: s.show }),
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
  return query(`/receipts/${id}`, { from: state.view, month: state.month });
}
// The list state as form fields, for every form and bulk bar on a list.
export function listParams(state: ListState): Record<string, string> {
  const fields: Record<string, string | null> = {
    list: state.key,
    view: state.view,
    month: state.month,
    show: state.show,
    q: state.q,
    upto: state.view === 'todo' ? String(state.upto) : null,
  };
  return Object.fromEntries(Object.entries(fields).filter((f): f is [string, string] => !!f[1]));
}
export function listFields(state: ListState): string {
  return Object.entries(listParams(state))
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escape(v)}">`)
    .join('');
}
// The receipt page's list, for its own forms.
export function receiptFields(state: ListState): string {
  return `<input type="hidden" name="from" value="${state.view}">${state.month ? `<input type="hidden" name="month" value="${state.month}">` : ''}`;
}
// A list's state from one of its own addresses, or null for anything else.
export function listFrom(path: string): ListState | null {
  if (!/^\/(?!\/)/.test(path) || path.length > 300) return null;
  const url = new URL(path, 'http://app.invalid');
  const key = (
    { '/receipts': 'receipts', '/review': 'receipts', '/invoices': 'invoices', '/payments': 'bank' } as const
  )[url.pathname];
  if (url.origin !== 'http://app.invalid' || !key) return null;
  // Receipts is All unless it says To do (Review was To do); Bank defaults to To do.
  const todo = url.pathname === '/review' || key === 'bank' || url.searchParams.get('view') === 'todo';
  return listState(url.searchParams, { key, view: todo ? 'todo' : 'all' });
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
  open: string;
  order: readonly string[];
  // The views whose rows render in this order, each with its #row-<id> anchor.
  views: readonly View[];
  where: (s: ListState) => { sql: string; binds: unknown[] };
};
const RECEIPTS: ListDef = {
  from: 'receipts r',
  table: 'receipts r',
  alias: 'r',
  open: `${needsReviewSql('r')} AND r.duplicate_of IS NULL AND r.discarded_at IS NULL`,
  // Undated first, as they wait on a date before anything else.
  order: ['r.issue_date IS NOT NULL', "coalesce(r.issue_date,'')", 'r.received_at', 'r.id'],
  views: ['todo'],
  // An undated receipt belongs to no month yet, so it stays in every month's To do.
  where: (s) =>
    s.month
      ? { sql: '(substr(r.issue_date,1,7)=? OR r.issue_date IS NULL)', binds: [s.month] }
      : { sql: '1', binds: [] },
};
const BANK: ListDef = {
  from: 'bank_transactions t JOIN imports i ON i.id=t.import_id',
  table: 'bank_transactions t',
  alias: 't',
  open: `i.status='complete' AND ${VIEW_SQL.todo}`,
  order: BANK_ORDER.split(','),
  views: ['todo', 'all'],
  where: (s) => (s.month ? { sql: 'substr(t.booking_date,1,7)=?', binds: [s.month] } : { sql: '1', binds: [] }),
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
  const where = def.where(state);
  const order = orderOf(def);
  const select = `SELECT ${def.alias}.id AS id FROM ${def.from} WHERE ${def.open} AND ${where.sql}`;
  if (!cursor)
    return env.DB.prepare(`${select} ORDER BY ${order} LIMIT 1`)
      .bind(...where.binds)
      .first<string>('id');
  const after = `(${order})${cursor.at ? '>=' : '>'}${cursor.sql}`;
  return env.DB.prepare(
    wrap ? `${select} ORDER BY ${after} DESC,${order} LIMIT 1` : `${select} AND ${after} ORDER BY ${order} LIMIT 1`,
  )
    .bind(...where.binds, ...cursor.binds)
    .first<string>('id');
}
// Where one row stands in the open list: its place from 0 (-1 when it isn't open) and the count.
export async function openPlace(
  env: Env,
  def: ListDef,
  state: ListState,
  id: string,
): Promise<{ position: number; total: number }> {
  const where = def.where(state);
  const row = await env.DB.prepare(
    `SELECT count(*) total,total((${orderOf(def)})<${current(def)}) before,total(${def.alias}.id=?) here FROM ${def.from} WHERE ${def.open} AND ${where.sql}`,
  )
    .bind(JSON.stringify([id]), id, ...where.binds)
    .first<{ total: number; before: number; here: number }>();
  return { position: row?.here ? row.before : -1, total: row?.total ?? 0 };
}
// The open rows themselves, in order.
export async function openRows<T>(env: Env, def: ListDef, state: ListState, limit: number): Promise<T[]> {
  const where = def.where(state);
  return (
    await env.DB.prepare(
      `SELECT ${def.alias}.* FROM ${def.from} WHERE ${def.open} AND ${where.sql} ORDER BY ${orderOf(def)} LIMIT ?`,
    )
      .bind(...where.binds, limit)
      .all<T>()
  ).results;
}
// The return after an action: the list it came from, at its next open row when it has one. The
// cursor is cursorFor on the same state, read before the write.
export async function landing(env: Env, state: ListState, cursor: Cursor | null, done: Done): Promise<string> {
  const def = openDef(state);
  return listUrl(state, { done, next: def ? await nextOpen(env, def, state, cursor, { wrap: true }) : null });
}
