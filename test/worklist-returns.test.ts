// Every action returns to the list it came from, at the next open row, and every list says how
// many rows it really has. Each test here was a reviewer's repro on PR 5. Names are invented.
import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { seedBusyMonth, type Busy } from './busy-month';
import { htmlForm, locationOf, request } from './helpers';

const get = async (path: string) => (await request(path)).text();
function post(path: string, fields: Record<string, string | string[]>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) body.append(k, one);
  return request(path, { method: 'POST', body });
}

test('J: a long search answers with the list, not a crash', async () => {
  const b = await seedBusyMonth();
  const vendor = 'Fake Long Name Trading Company of Northern Example Province Oy Ab';
  await env.DB.prepare('UPDATE receipts SET vendor=? WHERE id=?').bind(vendor, b.ready[0]!).run();
  const hit = await request(`/receipts?q=${encodeURIComponent(vendor.slice(5, 65))}`);
  expect(hit.status).toBe(200);
  expect(await hit.text()).toContain(`/receipts/${b.ready[0]}`);
  const miss = await request(`/receipts?q=${encodeURIComponent(vendor + ' and more')}`);
  expect(miss.status).toBe(200);
  expect(await miss.text()).toContain('Nothing matches');
  expect((await request(`/receipts?q=${'y'.repeat(5000)}`)).status).toBe(200);
});

// Receipts To do ids for a month, in the list's order, as the database holds them now.
async function todoOrder(b: Busy, month: string): Promise<string[]> {
  const rows = (
    await env.DB.prepare(
      "SELECT id FROM receipts WHERE status='needs_review' AND duplicate_of IS NULL AND discarded_at IS NULL AND (substr(issue_date,1,7)=? OR issue_date IS NULL) ORDER BY issue_date IS NOT NULL,coalesce(issue_date,''),received_at,id",
    )
      .bind(month)
      .all<{ id: string }>()
  ).results;
  return rows.map((r) => r.id).filter((id) => b.todo.includes(id));
}
type Row = Record<string, string | number | null>;
async function approveForm(id: string, more: Record<string, string>): Promise<Record<string, string>> {
  const r = (await env.DB.prepare('SELECT * FROM receipts WHERE id=?').bind(id).first<Row>())!;
  const money = (v: unknown) => (typeof v === 'number' ? (v / 100).toFixed(2) : '');
  return {
    vendor: String(r.vendor ?? 'Fake Seller'),
    invoice_number: String(r.invoice_number ?? 'X1'),
    issue_date: String(r.issue_date ?? ''),
    due_date: '',
    currency: String(r.currency ?? 'EUR'),
    total: money(r.total_minor) || '12.00',
    net: money(r.net_minor) || '9.56',
    vat: money(r.vat_minor) || '2.44',
    vat_rate: '25.5',
    product: String(r.product),
    expense_type: String(r.expense_type),
    revision: String(r.revision),
    approval_reason: 'Checked',
    action: 'approve',
    ...more,
  };
}

test('C: Approve while typing a date moves on from where the receipt stood, not where the date puts it', async () => {
  const b = await seedBusyMonth();
  const month = b.earlierMonth;
  const before = await todoOrder(b, month);
  const [first, second] = before as [string, string];
  expect(b.undated).toContain(first);
  expect(b.undated).toContain(second);
  const res = await post(
    `/receipts/${first}`,
    await approveForm(first, { issue_date: `${month}-07`, from: 'todo', month }),
  );
  expect(await env.DB.prepare('SELECT status FROM receipts WHERE id=?').bind(first).first('status')).toBe('ready');
  expect(locationOf(res)).toBe(`/receipts/${second}?from=todo&month=${month}&done=approved`);
});

test('F: Undo of a Discard lands on the receipt it brought back', async () => {
  const b = await seedBusyMonth();
  const month = b.earlierMonth;
  const listHtml = await get(`/receipts?view=todo&month=${month}`);
  const [, e1] = b.earlier as [string, string];
  const row = listHtml.slice(listHtml.indexOf(`id="row-${e1}"`));
  const discarded = await request('/discard', { method: 'POST', body: htmlForm(row, '/discard') });
  const landed = await get(discarded.headers.get('Location')!);
  const undone = await request('/restore', { method: 'POST', body: htmlForm(landed, '/restore') });
  expect(locationOf(undone)).toBe(`/receipts?view=todo&month=${month}&done=restored&n=1#row-${e1}`);
});

const openCount = async () =>
  (await env.DB.prepare(
    "SELECT count(*) n FROM receipts WHERE discarded_at IS NULL AND status='needs_review'",
  ).first<number>('n'))!;
test('A: a bulk post without its full list state is refused, and select-all on All uses its search', async () => {
  const b = await seedBusyMonth();
  const before = await openCount();
  // What the All page posted before PR 5: no view. It used to fall back to To do.
  const stale = await post('/receipts/bulk', { op: 'discard', all: '1', list: 'receipts', q: 'zzzznomatch' });
  expect(stale.status).toBe(400);
  expect(await stale.text()).toContain('This page is out of date. Reload it and try again.');
  const one = { op: 'discard', id: b.earlier[0]! };
  expect((await post('/receipts/bulk', { ...one, list: 'receipts', month: b.earlierMonth, q: 'foo' })).status).toBe(
    400,
  );
  expect((await post('/receipts/bulk', { ...one, view: 'all' })).status).toBe(400);
  expect((await post('/receipts/bulk', { ...one, list: 'receipts', view: 'all', show: 'nope' })).status).toBe(400);
  expect(await openCount()).toBe(before);

  const none = await post('/receipts/bulk', {
    op: 'discard',
    all: '1',
    list: 'receipts',
    view: 'all',
    q: 'zzzznomatch',
  });
  expect(none.status).toBe(400);
  expect(await openCount()).toBe(before);

  const vendor = 'Fake Unique Searchable Seller';
  await env.DB.prepare('UPDATE receipts SET vendor=? WHERE id IN (?,?)').bind(vendor, b.ready[0]!, b.ready[1]!).run();
  const hit = await post('/receipts/bulk', {
    op: 'discard',
    all: '1',
    list: 'receipts',
    view: 'all',
    q: 'unique searchable',
  });
  expect(locationOf(hit)).toMatch(/^\/receipts\?view=all&q=unique\+searchable&done=discarded&n=2&/);
  const gone = await env.DB.prepare('SELECT id FROM receipts WHERE discarded_at IS NOT NULL ORDER BY id').all<{
    id: string;
  }>();
  expect(gone.results.map((r) => r.id)).toEqual([b.ready[0]!, b.ready[1]!].sort());
  // show narrows it too: Discarded holds just those two, and Restore on all of it takes exactly them.
  const back = await post('/receipts/bulk', {
    op: 'restore',
    all: '1',
    list: 'receipts',
    view: 'all',
    show: 'discarded',
  });
  expect(locationOf(back)).toMatch(/done=restored&n=2/);
});
