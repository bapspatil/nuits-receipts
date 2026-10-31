// A resolved row leaves without script: the cross-document transition rule, the next row ready to be
// landed on and described by the banner, a title that names the event, and a second submit that is quiet.
import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { seedBusyMonth } from './busy-month';
import { locationOf, request } from './helpers';

const RULE = '@view-transition{navigation:auto}';
const get = async (path: string) => (await request(path)).text();
function post(path: string, fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return request(path, { method: 'POST', body });
}
type Row = Record<string, string | number | null>;
async function approveFields(id: string): Promise<Record<string, string>> {
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
    from: 'todo',
  };
}

test('the transition rule is on Receipts To do, Bank and the receipt page, and nowhere else', async () => {
  const b = await seedBusyMonth();
  for (const path of ['/receipts?view=todo', `/payments?month=${b.month}`, `/receipts/${b.todo[0]}?from=todo`])
    expect(await get(path), path).toContain(RULE);
  // Not Home: its rows change place when the preview opens, and morphing 50 named rows cost
  // Chrome seconds of style work on every click.
  for (const path of ['/', '/?open=r%3Ax', '/settings', '/help', '/add'])
    expect(await get(path), path).not.toContain('@view-transition');
  const css = await get('/receipts?view=todo');
  expect(css).toContain('@media (prefers-reduced-motion:reduce){@view-transition{navigation:none}}');
  expect(css).not.toContain('scroll-behavior:smooth');
});

test('after a Bank action the next row can be landed on, is described by the banner, and the title names the event', async () => {
  const b = await seedBusyMonth();
  const res = await post(`/payments/${b.missing[0]}`, {
    receipt_required: '0',
    view: 'todo',
    month: b.month,
    upto: '50',
  });
  const to = locationOf(res);
  const next = /#row-([a-f0-9]{64})$/.exec(to)?.[1];
  expect(next).toBeTruthy();
  const html = await get(res.headers.get('Location')!);
  expect(html).toMatch(new RegExp(`<li [^>]*id="row-${next}" tabindex="-1" aria-describedby="banner"`));
  expect(html).toContain('[data-row]{scroll-margin-top:');
  expect(html).toMatch(/<(p|div) class="banner[^"]*" id="banner" role="status"/);
  const title = /<title>([^<]*)<\/title>/.exec(html)![1]!;
  expect(title).toMatch(/^[^·]+ · Bank · /);
  const plain = await get(`/payments?month=${b.month}&view=todo`);
  expect(plain).not.toContain('aria-describedby="banner"');
});

test('a second submit of Not a purchase or Approve is a quiet redirect to the list', async () => {
  const b = await seedBusyMonth();
  const tx = b.missing[0]!;
  const fields = { receipt_required: '0', view: 'todo', month: b.month, upto: '50' };
  expect(locationOf(await post(`/payments/${tx}`, fields))).toContain('done=notPurchase');
  const again = locationOf(await post(`/payments/${tx}`, fields));
  expect(again).not.toContain('done=');
  expect(again).toMatch(/^\/payments\?month=2026-09/);

  const id = b.todoApprovable[0]!;
  const form = await approveFields(id);
  expect(locationOf(await post(`/receipts/${id}`, form))).toContain('done=approved');
  const second = locationOf(await post(`/receipts/${id}`, form));
  expect(second).not.toContain('done=');
  expect(second).toMatch(/^\/receipts\?view=todo/);
});

test('Approve lands the next receipt on its first field to fill', async () => {
  const b = await seedBusyMonth();
  const id = b.todoApprovable[0]!;
  const to = locationOf(await post(`/receipts/${id}`, await approveFields(id)));
  expect(to).toMatch(/#(f-[a-z_]+|main)$/);
});

test('a Reading receipt refreshes itself; a settled one does not; a Reading row offers Refresh', async () => {
  const b = await seedBusyMonth();
  const id = b.todo[0]!;
  expect(await get(`/receipts/${id}?from=todo`)).not.toContain('http-equiv="refresh"');
  await env.DB.prepare("UPDATE receipts SET status='processing' WHERE id=?").bind(id).run();
  expect(await get(`/receipts/${id}`)).toContain('<meta http-equiv="refresh" content="10">');
  expect(await get('/?show=reading')).toMatch(/<a class="refresh" href="[^"]+">Refresh<\/a>/);
  expect(await get('/receipts?view=todo')).not.toContain('http-equiv="refresh"');
});
