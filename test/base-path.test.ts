import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import worker, { withBase } from '../src/index';
import { parseConfig } from '../src/config';
import type { Env } from '../src/env';
import { authorization, htmlForm, locationOf, pdfBytes, signed } from './helpers';
import { MONTH, seedBusyMonth } from './busy-month';

const based = { ...env, APP_BASE_PATH: '/app' } as Env;
function at(path: string, init: RequestInit = {}, headers: Record<string, string> = {}) {
  return worker.fetch(
    new Request('http://localhost' + path, {
      ...init,
      headers: { Authorization: authorization, Origin: 'http://localhost', ...headers },
    }),
    based,
  );
}
async function upload() {
  const form = new FormData();
  form.set('file', new File([pdfBytes()], 'sample.pdf', { type: 'application/pdf' }));
  return at('/app/upload', { method: 'POST', body: form });
}

test('APP_BASE_PATH defaults to the root and rejects odd values', () => {
  expect(parseConfig({}).basePath).toBe('');
  expect(parseConfig({ APP_BASE_PATH: '/app/' }).basePath).toBe('/app');
  expect(parseConfig({ APP_BASE_PATH: '/tools/receipts' }).basePath).toBe('/tools/receipts');
  for (const bad of ['app', '/a b', '//evil.example', '/app?x', '/../x/'.replace(/\/$/, 'é')])
    expect(() => parseConfig({ APP_BASE_PATH: bad })).toThrow(/APP_BASE_PATH/);
  expect(withBase('/payments', '/app')).toBe('/app/payments');
  expect(withBase('//evil.example/', '/app')).toBe('//evil.example/');
  expect(withBase('https://github.com/x', '/app')).toBe('https://github.com/x');
  expect(withBase('/x', '')).toBe('/x');
});

test('only paths under the base path reach the app', async () => {
  expect((await at('/app')).status).toBe(200);
  expect((await at('/app/')).status).toBe(200);
  expect((await at('/app/payments')).status).toBe(200);
  for (const path of ['/', '/payments', '/apple', '/privacy/']) {
    const response = await at(path);
    expect(response.status).toBe(404);
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
  }
  const anonymous = await worker.fetch(new Request('http://localhost/app'), based);
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers.get('WWW-Authenticate')).toContain('Basic');
});

test('links, form actions and redirects carry the base path', async () => {
  const html = await (await at('/app/payments?month=2026-09')).text();
  const targets = [...html.matchAll(/\b(?:href|action|formaction|src)="(\/[^"]*)"/g)].map((m) => m[1]!);
  expect(targets.length).toBeGreaterThan(3);
  for (const target of targets) expect(target.startsWith('/app/')).toBe(true);
  const uploaded = await upload();
  expect(uploaded.status).toBe(303);
  const signedLocation = uploaded.headers.get('Location')!,
    location = locationOf(uploaded);
  expect(location).toMatch(/^\/app\/receipts\/[a-f0-9]{64}\?done=uploaded$/);
  const receipt = await (await at(signedLocation)).text();
  expect(receipt).toMatch(/href="\/app\/originals\/[a-f0-9]{64}"/);
  expect(receipt).toMatch(/action="\/app\/receipts\/[a-f0-9]{64}\/retry"/);
  expect((await at(location.replace('/receipts/', '/originals/'))).status).toBe(200);
});

test('Review and Invoices answer 302 to Receipts under the base path, keeping their list', async () => {
  for (const [from, to] of [
    ['/app/review', '/app/receipts?view=todo'],
    ['/app/review?month=2026-09', '/app/receipts?view=todo&month=2026-09'],
    ['/app/review/merge', '/app/receipts?view=todo'],
    ['/app/invoices', '/app/receipts?view=all&kind=sales'],
    ['/app/invoices?month=2026-09&show=overdue', '/app/receipts?view=all&kind=sales&month=2026-09&show=overdue'],
  ]) {
    const response = await at(from!);
    expect(response.status, from).toBe(302);
    expect(response.headers.get('Location'), from).toBe(to);
  }
  // An old Review page's Merge still merges, then lands on To do.
  const merge = await at('/app/review/merge', { method: 'POST', body: new URLSearchParams() });
  expect(merge.status).toBe(303);
  expect(merge.headers.get('Location')).toMatch(/^\/app\/receipts\?view=todo&done=merged&n=0&/);
  // The pages they point at render, with the To do | All switch under the base path.
  const todo = await (await at('/app/receipts?view=todo&month=2026-09')).text();
  expect(todo).toContain('data-list="receipts-todo"');
  expect(todo).toContain('href="/app/?month=2026-09" data-view="all"');
  expect(await (await at('/app/receipts?view=all&kind=sales&month=2026-09')).text()).toContain(
    'href="/app/receipts?view=todo&amp;month=2026-09" data-view="todo"',
  );
});

test('cross-origin posts are refused under the base path', async () => {
  const form = new FormData();
  form.set('label', 'x');
  const response = await at('/app/accounts', { method: 'POST', body: form }, { Origin: 'https://evil.example' });
  expect(response.status).toBe(403);
});

test('export links point at the base path', async () => {
  await upload();
  const month = String(await env.DB.prepare('SELECT substr(received_at,1,7) m FROM receipts').first('m'));
  const issue = await env.DB.prepare('SELECT issue_date FROM receipts').first<string>('issue_date');
  const csv = await (await at(`/app/export.csv?month=${(issue ?? month).slice(0, 7)}`)).text();
  expect(csv).toContain('http://localhost/app/originals/');
  expect(csv).not.toMatch(/http:\/\/localhost\/originals\//);
});

test('the feedback banner and its Undo form carry the base path', async () => {
  const html = await (
    await at(
      await signed(`/app/receipts?view=todo&done=notPurchase&name=Acme&at=2026-09-03T10:00:00.000Z&op=exempt`, '/app'),
    )
  ).text();
  expect(html).toContain('<form method="post" action="/app/undo">');
  expect(html).toContain('Acme is not a purchase');
});

test('every list return keeps its list and its next open row under the base path', async () => {
  const b = await seedBusyMonth();
  const post = (path: string, fields: Record<string, string | string[]>) => {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) body.append(k, one);
    return at('/app' + path, { method: 'POST', body });
  };
  const to = async (path: string, fields: Record<string, string | string[]>) => locationOf(await post(path, fields));
  const bank = { view: 'todo', month: MONTH, upto: '50' };
  const onBank = `^/app/payments\\?month=${MONTH}&view=todo&done=`;
  const [m0, m1, m2, m3, m4] = b.missing as [string, string, string, string, string];
  expect(await to(`/payments/${m0}`, { receipt_required: '0', ...bank })).toMatch(
    new RegExp(`${onBank}notPurchase&.*#row-${m1}$`),
  );
  const exempted = await post('/payments/bulk', { ...bank, op: 'exempt', id: [m1, m2] });
  expect(locationOf(exempted)).toMatch(new RegExp(`${onBank}notPurchaseMany&n=2#row-${m3}$`));
  const exemptAt = new URL(exempted.headers.get('Location')!, 'http://x.example').searchParams.get('at')!;
  expect(await to('/matches/bulk', { ...bank, transaction_id: m3, receipt_id: b.earlier[0]! })).toMatch(
    new RegExp(`${onBank}matchedMany&n=0&skipped=1#row-${m4}$`),
  );
  // Undo lands on the first row it brought back, and on the first open row when nothing came back.
  expect(await to('/undo', { ...bank, at: '2026-09-01T00:00:00.000Z', op: 'match' })).toMatch(
    new RegExp(`${onBank}undone&op=match&n=0#row-${m3}$`),
  );
  expect(await to('/undo', { ...bank, at: exemptAt, op: 'exempt' })).toMatch(
    new RegExp(`${onBank}undone&op=exempt&n=2#row-${m1}$`),
  );
  expect((await post('/undo', { ...bank, at: exemptAt, op: 'nope' })).status).toBe(400);
  expect(await to('/matches', { ...bank, transaction_id: b.matched[0]!.id, action: 'unlink' })).toMatch(
    new RegExp(`${onBank}unmatched&.*#row-[0-9a-f]{64}$`),
  );

  const month = b.earlierMonth;
  const todo = { list: 'receipts', view: 'todo', month, upto: '50' };
  const onTodo = `^/app/receipts\\?view=todo&month=${month}&done=`;
  const [e0, e1, e2] = b.earlier as [string, string, string];
  const list = await (await at(`/app/receipts?view=todo&month=${month}`)).text();
  expect(list).toContain(`data-row="${e2}" id="row-${e2}"`);
  expect(list).toContain(`href="/app/receipts/${e2}?from=todo&amp;month=${month}"`);
  const page = await (await at(`/app/receipts/${e2}?from=todo&month=${month}`)).text();
  expect(page).toContain(`<a href="/app/receipts?view=todo&amp;month=${month}">`);
  const skip = htmlForm(page, `/app/receipts/${e2}`);
  skip.set('action', 'skip');
  expect(locationOf(await at(`/app/receipts/${e2}`, { method: 'POST', body: skip }))).toMatch(
    new RegExp(`${onTodo}skipped#row-[0-9a-f]{64}$`),
  );
  expect(await to('/receipts/bulk', { ...todo, op: 'discard', id: e0 })).toMatch(
    new RegExp(`${onTodo}discarded&.*#row-${e1}$`),
  );
  expect(await to('/discard', { ...todo, id: e1 })).toMatch(new RegExp(`${onTodo}discarded&.*#row-${e2}$`));
  expect(await to('/restore', { id: e1, back: `/receipts?view=todo&month=${month}` })).toMatch(
    new RegExp(`${onTodo}restored&n=1#row-[0-9a-f]{64}$`),
  );
  expect(await to('/discard', { id: e1, from: 'todo', month })).toMatch(
    new RegExp(`^/app/receipts/[0-9a-f]{64}\\?from=todo&month=${month}&done=discarded&`),
  );
  expect(await to('/receipts/merge', todo)).toBe(`/app/receipts?view=todo&month=${month}&done=merged&n=0`);
  const back = `/receipts?view=todo&month=${month}`;
  expect(await to('/senders/ignore', { address: 'nobody@example.com', back })).toMatch(
    new RegExp(`${onTodo}mailIgnored`),
  );
});
