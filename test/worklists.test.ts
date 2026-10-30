// The list invariants of docs/app-v4/PLAN.md, read through docs/app-v4/CONTRACT.md on a busy
// month (test/busy-month.ts). A test.fails is an invariant the app does not meet yet; the PR
// that makes it true flips it to test() by name. Every name and amount is invented.
import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { viewCounts } from '../src/banking';
import { seedBusyMonth, MONTH, type Busy } from './busy-month';
import { htmlForm, locationOf, request } from './helpers';

const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));

// The one list on a page: its container and its rows in document order.
function list(html: string) {
  const container = html.match(/<[a-z0-9]+\b[^>]*\bdata-list="[^"]*"[^>]*>/)?.[0];
  if (!container) throw new Error('No element with data-list on the page');
  const a = attrs(container);
  const rows = [...html.matchAll(/\bdata-row="([a-f0-9]{64})"/g)].map((m) => m[1]!);
  const anchors = [...html.matchAll(/\bid="row-([a-f0-9]{64})"/g)].map((m) => m[1]!);
  const chip = (view: string) =>
    Number(attrs(html.match(new RegExp(`<a\\b[^>]*\\bdata-view="${view}"[^>]*>`))?.[0] ?? '')['data-count']);
  const bar = html.match(/<form\b[^>]*\bdata-bulk\b[^>]*>/)?.[0];
  return {
    name: a['data-list'],
    total: Number(a['data-total']),
    rows,
    anchors,
    todoChip: chip('todo'),
    allChip: chip('all'),
    barTotal: bar === undefined ? NaN : Number(attrs(bar)['data-total']),
  };
}
const get = async (path: string) => (await request(path)).text();
const toUrl = (response: Response) => new URL(locationOf(response), 'http://localhost');
function post(path: string, fields: Record<string, string | string[]>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) body.append(k, one);
  return request(path, { method: 'POST', body });
}
const bankState = { view: 'todo', month: MONTH, upto: '50' };
const bulkBank = (op: string, ids: string[]) => post('/payments/bulk', { ...bankState, op, id: ids });
const bulkApprove = (ids: string[], more: Record<string, string> = {}) =>
  post('/receipts/bulk', { op: 'approve', approval_reason: 'Checked', view: 'todo', upto: '50', id: ids, ...more });

// Receipts To do ids in order, optionally cut to one month, as the app lists them.
async function todoIds(b: Busy, month?: string): Promise<string[]> {
  const rows = (
    await env.DB.prepare(
      `SELECT id FROM receipts WHERE status='needs_review' AND duplicate_of IS NULL AND discarded_at IS NULL ${month ? 'AND (substr(issue_date,1,7)=? OR issue_date IS NULL)' : ''} ORDER BY issue_date IS NOT NULL,issue_date,received_at,id`,
    )
      .bind(...(month ? [month] : []))
      .all<{ id: string }>()
  ).results;
  return rows.map((r) => r.id).filter((id) => b.todo.includes(id));
}
// The first row after cur in the order it was in before the save that is still in the list after it.
function nextAfter(before: string[], after: string[], cur: string, wrap: boolean): string | undefined {
  const at = before.indexOf(cur);
  return after.find((id) => before.indexOf(id) > at) ?? (wrap ? after[0] : undefined);
}
type Row = Record<string, string | number | null>;
async function formFor(id: string, action: string, more: Record<string, string>) {
  const r = (await env.DB.prepare('SELECT * FROM receipts WHERE id=?').bind(id).first<Row>())!;
  const money = (v: unknown) => (typeof v === 'number' ? (v / 100).toFixed(2) : '');
  return {
    vendor: String(r.vendor ?? ''),
    invoice_number: String(r.invoice_number ?? ''),
    issue_date: String(r.issue_date ?? ''),
    due_date: '',
    currency: String(r.currency ?? ''),
    total: money(r.total_minor),
    net: money(r.net_minor),
    vat: money(r.vat_minor),
    vat_rate: '25.5',
    product: String(r.product),
    expense_type: String(r.expense_type),
    revision: String(r.revision),
    approval_reason: 'Checked',
    action,
    ...more,
  };
}

test('inv1: Bank To do shows min(upto, missing) rows, including ones past row 100', async () => {
  const b = await seedBusyMonth();
  expect(b.missing).toHaveLength(60);
  expect(b.missingPast100).toHaveLength(35);
  const page = list(await get(`/payments?month=${MONTH}&view=todo`));
  expect(page.name).toBe('bank-todo');
  expect(page.total).toBe(60);
  expect(page.rows).toEqual(b.missing.slice(0, 50));
  expect(page.rows.some((id) => b.missingPast100.includes(id))).toBe(true);
  expect(list(await get(`/payments?month=${MONTH}&view=todo&upto=100`)).rows).toEqual(b.missing);
  expect(list(await get(`/payments?month=${MONTH}&view=todo&upto=10`)).rows).toEqual(b.missing.slice(0, 10));
});

test('inv2: bulk Not a purchase on every visible missing row refills the page', async () => {
  const b = await seedBusyMonth();
  const response = await bulkBank('exempt', b.missing.slice(0, 50));
  expect(response.status).toBe(303);
  const html = await get(locationOf(response));
  expect(html).not.toContain('Every payment has a receipt');
  const page = list(html);
  expect(page.total).toBe(10);
  expect(page.rows).toEqual(b.missing.slice(50));
  expect(toUrl(response).hash).toBe(`#row-${b.missing[50]}`);
  const done = await env.DB.prepare(
    'SELECT count(*) n FROM bank_transactions WHERE exempt_by=? AND id IN (SELECT value FROM json_each(?))',
  )
    .bind('owner', JSON.stringify(b.missing.slice(0, 50)))
    .first<number>('n');
  expect(done).toBe(50);
});

test('inv3: chip counts equal viewCounts and the bulk total equals the rendered to do count', async () => {
  await seedBusyMonth();
  const counts = await viewCounts(env, MONTH);
  expect(counts).toEqual({ todo: 60, all: 220 });
  for (const upto of [10, 50]) {
    const page = list(await get(`/payments?month=${MONTH}&view=todo&upto=${upto}`));
    expect(page.total).toBe(counts.todo);
    expect(page.rows).toHaveLength(upto);
    expect(page.todoChip).toBe(counts.todo);
    expect(page.allChip).toBe(counts.all);
    expect(page.barTotal).toBe(page.total);
  }
  const all = list(await get(`/payments?month=${MONTH}&view=all`));
  expect(all.name).toBe('bank-all');
  expect(all.total).toBe(counts.all);
  expect(all.rows).toHaveLength(counts.all);
  expect(all.barTotal).toBe(all.total);
});

// Today: Receipts has no To do list yet.
test.fails('inv3 (Receipts): the bulk total equals the rendered to do count', async () => {
  const b = await seedBusyMonth();
  const receipts = list(await get('/receipts?view=todo'));
  expect(receipts.name).toBe('receipts-todo');
  expect(receipts.total).toBe(b.todo.length);
  expect(receipts.todoChip).toBe(b.todo.length);
  expect(receipts.barTotal).toBe(receipts.total);
});

// Today: Location is /payments?month=M with no view and no row fragment.
test.fails('inv4: a single Not a purchase keeps the view and ends at the next open row', async () => {
  const b = await seedBusyMonth();
  const response = await post(`/payments/${b.missing[3]}`, { receipt_required: '0', ...bankState });
  expect(response.status).toBe(303);
  const to = toUrl(response);
  expect(to.pathname).toBe('/payments');
  expect(to.searchParams.get('view')).toBe('todo');
  expect(to.searchParams.get('month')).toBe(MONTH);
  expect(to.searchParams.has('offset')).toBe(false);
  expect(to.hash).toBe(`#row-${b.missing[4]}`);
});

test.fails(
  'inv5: Approve from To do lands on the next open item of the same month filter, after the save',
  async () => {
    const b = await seedBusyMonth();
    const [first, , last] = b.earlier as [string, string, string];
    const month = b.earlierMonth;
    const before = await todoIds(b, month);
    expect(before).toEqual(b.earlier);
    // Without the month filter the next one is a different receipt, so a stale or global next shows.
    const global = await todoIds(b);
    expect(global[global.indexOf(last) + 1]).not.toBe(first);
    const response = await post(`/receipts/${last}`, await formFor(last, 'approve', { from: 'todo', month }));
    expect(response.status).toBe(303);
    expect(await env.DB.prepare('SELECT status FROM receipts WHERE id=?').bind(last).first<string>('status')).toBe(
      'ready',
    );
    const after = await todoIds(b, month);
    const next = nextAfter(before, after, last, true);
    expect(next).toBe(first);
    const to = toUrl(response);
    expect(to.pathname).toBe(`/receipts/${next}`);
    expect(to.searchParams.get('from')).toBe('todo');
    expect(to.searchParams.get('month')).toBe(month);
  },
);

test.fails('inv6: Skip on the last item ends on the list', async () => {
  const b = await seedBusyMonth();
  const last = b.earlier[2]!;
  const month = b.earlierMonth;
  const response = await post(`/receipts/${last}`, await formFor(last, 'skip', { from: 'todo', month }));
  expect(response.status).toBe(303);
  const to = toUrl(response);
  expect(to.pathname).toBe('/receipts');
  expect(to.searchParams.get('view')).toBe('todo');
  expect(to.searchParams.get('month')).toBe(month);
  expect(await env.DB.prepare('SELECT status FROM receipts WHERE id=?').bind(last).first<string>('status')).toBe(
    'needs_review',
  );
});

test.fails('inv7: Discard from a month-filtered To do keeps the month', async () => {
  const b = await seedBusyMonth();
  const [, middle, last] = b.earlier as [string, string, string];
  const response = await post('/discard', { id: middle, view: 'todo', month: b.earlierMonth, upto: '50' });
  expect(response.status).toBe(303);
  expect(
    await env.DB.prepare('SELECT discarded_at IS NOT NULL d FROM receipts WHERE id=?').bind(middle).first<number>('d'),
  ).toBe(1);
  const to = toUrl(response);
  expect(to.pathname).toBe('/receipts');
  expect(to.searchParams.get('view')).toBe('todo');
  expect(to.searchParams.get('month')).toBe(b.earlierMonth);
  expect(to.hash).toBe(`#row-${last}`);
});

// Today: the banner has no Undo form.
test.fails('inv8: Undo after a bulk approve brings every row back into To do', async () => {
  const b = await seedBusyMonth();
  const ids = b.todoApprovable.slice(0, 4);
  expect(ids).toHaveLength(4);
  const snapshot = async () =>
    (
      await env.DB.prepare(
        'SELECT id,status,review_reasons_json,manual_fields_json FROM receipts WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id',
      )
        .bind(JSON.stringify(ids))
        .all()
    ).results;
  const before = await snapshot();
  const approved = await bulkApprove(ids);
  expect(approved.status).toBe(303);
  expect((await snapshot()).every((r) => r.status === 'ready')).toBe(true);
  const banner = await get(locationOf(approved));
  const undo = htmlForm(banner, '/undo');
  expect(list(banner).rows).not.toEqual(expect.arrayContaining(ids));
  const undone = await request('/undo', { method: 'POST', body: undo });
  expect(undone.status).toBe(303);
  expect(await snapshot()).toEqual(before);
  expect(list(await get('/receipts?view=todo')).rows).toEqual(expect.arrayContaining(ids));
});

// Today: no data-list yet; the stable-order check needs the To do lists.
test.fails('inv9: a resolved id never renders in To do and the order is stable', async () => {
  const b = await seedBusyMonth();
  const approved = b.todoApprovable.slice(0, 4);
  const exempted = b.missing.slice(0, 5);
  expect((await bulkApprove(approved)).status).toBe(303);
  expect((await bulkBank('exempt', exempted)).status).toBe(303);
  const receipts = async () => list(await get('/receipts?view=todo'));
  const bank = async () => list(await get(`/payments?month=${MONTH}&view=todo`));
  const first = [await receipts(), await bank()];
  const again = [await receipts(), await bank()];
  expect(first[0]!.rows).toEqual((await todoIds(b)).slice(0, 50));
  expect(first[0]!.rows.filter((id) => approved.includes(id))).toEqual([]);
  expect(first[1]!.rows).toEqual(b.missing.slice(5, 55));
  expect(first[1]!.rows.filter((id) => exempted.includes(id))).toEqual([]);
  expect(again.map((p) => p.rows)).toEqual(first.map((p) => p.rows));
  for (const page of first) expect(page.anchors).toEqual(page.rows);
});

test('inv10: bulk Not a purchase never drops a match silently', async () => {
  const b = await seedBusyMonth();
  const matched = b.matched.map((m) => m.id);
  const open = b.missing.slice(0, 3);
  const response = await bulkBank('exempt', [...matched, ...open]);
  expect(response.status).toBe(303);
  const rows = (
    await env.DB.prepare(
      'SELECT id,receipt_id,receipt_required FROM bank_transactions WHERE id IN (SELECT value FROM json_each(?))',
    )
      .bind(JSON.stringify([...matched, ...open]))
      .all<{ id: string; receipt_id: string | null; receipt_required: number }>()
  ).results;
  const by = new Map(rows.map((r) => [r.id, r]));
  for (const m of b.matched) expect(by.get(m.id), m.id).toMatchObject({ receipt_id: m.receipt, receipt_required: 1 });
  for (const id of open) expect(by.get(id)!.receipt_required).toBe(0);
});
