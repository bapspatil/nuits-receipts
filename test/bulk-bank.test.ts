// POST /payments/bulk and the bar on Bank. Every name, amount and id here is invented.
import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import worker from '../src/index';
import { importBankCsv, parsePreset, type Transaction } from '../src/banking';
import { BULK_CAP } from '../src/bulk';
import { htmlForm, idFrom, locationOf, request, uploadPdf } from './helpers';

// The mock receipt is Sample Cloud Lantern Oy, EUR 125.50, 4 Sep.
async function statement(rows: string, account = 'holvi') {
  const text = `Transaction ID;Date;Amount;Currency;Payee;Reference\n${rows}`;
  await importBankCsv(env, {
    bytes: new TextEncoder().encode(text),
    parsed: parsePreset(text, account, 'EUR'),
    collision: 'keep_existing',
  });
}
const tx = async (merchant: string) =>
  (await env.DB.prepare('SELECT * FROM bank_transactions WHERE merchant=?').bind(merchant).first<Transaction>())!;
function form(fields: Record<string, string | string[]>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) body.append(k, one);
  return body;
}
const bulk = (fields: Record<string, string | string[]>, headers: Record<string, string> = {}) =>
  request('/payments/bulk', { method: 'POST', body: form(fields), headers });
const json = (fields: Record<string, string | string[]>) => bulk(fields, { Accept: 'application/json' });
const sept = { month: '2026-09', view: 'all' };
const hex = (n: number) => n.toString(16).padStart(64, '0');

test('ids, ops, scope and caps are checked at the door', async () => {
  await statement('a;2026-09-10;-10,00;EUR;Fake Paper Shop;x\n');
  const paper = await tx('Fake Paper Shop');
  expect(
    (await bulk({ ...sept, op: 'exempt', id: Array.from({ length: BULK_CAP + 1 }, (_, i) => hex(i)) })).status,
  ).toBe(400);
  expect((await bulk({ ...sept, op: 'explode', id: paper.id })).status).toBe(400);
  expect((await bulk({ ...sept, op: 'toString', id: paper.id })).status).toBe(400);
  expect((await bulk({ ...sept, op: 'exempt', id: 'not-an-id' })).status).toBe(400);
  expect((await bulk({ ...sept, op: 'exempt' })).status).toBe(400);
  expect((await bulk({ month: '2026-09', view: 'nope', op: 'exempt', id: paper.id })).status).toBe(400);
  expect((await bulk({ month: '2026-9', view: 'all', op: 'exempt', id: paper.id })).status).toBe(400);
  expect((await tx('Fake Paper Shop')).receipt_required).toBe(1);

  const anonymous = await worker.fetch(
    new Request('http://localhost/payments/bulk', {
      method: 'POST',
      body: form({ ...sept, op: 'exempt', id: paper.id }),
      headers: { Origin: 'http://localhost' },
    }),
    env,
  );
  expect(anonymous.status).toBe(401);
  const foreign = await request('/payments/bulk', {
    method: 'POST',
    body: form({ ...sept, op: 'exempt', id: paper.id }),
    headers: { Origin: 'http://evil.example' },
  });
  expect(foreign.status).toBe(403);
  expect((await tx('Fake Paper Shop')).receipt_required).toBe(1);

  // A refusal comes back as JSON to the bar's script.
  const refused = await json({ ...sept, op: 'explode', id: paper.id });
  expect(refused.status).toBe(400);
  expect(await refused.json()).toEqual({ error: expect.any(String) });
});

test('all=1 over the cap takes the first 500, and the bar counts the whole month, not the page', async () => {
  await statement('a;2026-08-01;-1,00;EUR;Fake Seed Shop;x\n');
  const seed = await tx('Fake Seed Shop');
  await env.DB.batch(
    Array.from({ length: BULK_CAP }, (_, i) =>
      env.DB.prepare(
        "INSERT INTO bank_transactions (id,account_key,import_id,booking_date,amount_minor,currency,merchant,raw_json) VALUES (?,?,?,'2026-08-02',-100,'EUR',?,'{}')",
      ).bind(hex(5000 + i), seed.account_key, seed.import_id, `Fake Row ${i}`),
    ),
  );
  const page = await (await request('/payments?month=2026-08&view=todo')).text();
  expect(page).toContain(`data-total="${BULK_CAP + 1}"`);
  expect(page).toContain(`Select the first ${BULK_CAP} payments`);
  // To do renders its first 50 rows.
  expect([...page.matchAll(/form="bulk-payments"/g)]).toHaveLength(50);
  expect(page).toContain(`50 of ${BULK_CAP + 1} to do`);
  const over = await json({ month: '2026-08', view: 'todo', op: 'exempt', all: '1' });
  expect(await over.json()).toMatchObject({ n: BULK_CAP });
  // The first 500 in Bank's order: the seed row, then by id; the last one is left.
  const left = await env.DB.prepare(
    "SELECT t.id FROM bank_transactions t WHERE receipt_required=1 AND substr(booking_date,1,7)='2026-08'",
  ).all<{ id: string }>();
  expect(left.results.map((r) => r.id)).toEqual([hex(5000 + BULK_CAP - 1)]);
});

test('Not a purchase leaves a matched payment alone; Needs receipt undoes it; a second run changes nothing', async () => {
  const receipt = idFrom(await uploadPdf());
  await statement('a;2026-09-05;-125,50;EUR;Sample Cloud Lantern Oy;card\nb;2026-09-10;-10,00;EUR;Fake Paper Shop;x\n');
  const lantern = await tx('Sample Cloud Lantern Oy');
  const paper = await tx('Fake Paper Shop');
  expect(lantern).toMatchObject({ receipt_id: receipt, match_method: 'automatic' });

  const res = await bulk({ ...sept, op: 'exempt', id: [lantern.id, paper.id] });
  expect(res.status).toBe(303);
  expect(locationOf(res)).toBe('/payments?month=2026-09&view=all&done=notPurchaseMany&n=1&skipped=1');
  expect(await tx('Sample Cloud Lantern Oy')).toMatchObject({
    receipt_required: 1,
    receipt_id: receipt,
    match_method: 'automatic',
  });
  expect(await tx('Fake Paper Shop')).toMatchObject({ receipt_required: 0, exempt_by: 'owner' });
  expect(await (await request(res.headers.get('Location')!)).text()).toContain('Marked 1 payment as not a purchase.');
  expect(await (await json({ ...sept, op: 'exempt', id: [lantern.id, paper.id] })).json()).toMatchObject({
    n: 0,
    skipped: 2,
  });

  const back = await bulk({ ...sept, op: 'require', id: paper.id });
  expect(locationOf(back)).toBe(`/payments?month=2026-09&view=all&done=needsReceiptMany&n=1#row-${paper.id}`);
  expect(await tx('Fake Paper Shop')).toMatchObject({ receipt_required: 1, receipt_id: null });
  expect(await (await json({ ...sept, op: 'require', id: paper.id })).json()).toMatchObject({ n: 0, skipped: 1 });
});

test('a transfer side is skipped by every op', async () => {
  await statement('a;2026-09-10;-50,00;EUR;Own Fake Savings;x\n');
  await statement('b;2026-09-10;50,00;EUR;Own Fake Savings In;x\n', 'race');
  const debit = await tx('Own Fake Savings'),
    credit = await tx('Own Fake Savings In');
  await env.DB.prepare(
    "INSERT INTO internal_transfers (debit_id,credit_id,reason,confirmed_at) VALUES (?,?,'Synthetic move','2026-09-10')",
  )
    .bind(debit.id, credit.id)
    .run();
  for (const op of ['exempt', 'require', 'unmatch', 'match'])
    expect(await (await json({ ...sept, op, id: [debit.id, credit.id] })).json(), op).toMatchObject({
      n: 0,
      skipped: 2,
    });
  expect(await tx('Own Fake Savings')).toMatchObject({ receipt_required: 1, exempt_by: null });
  // Its row has no box on the page.
  expect(await (await request('/payments?month=2026-09&view=all')).text()).not.toContain(`value="${debit.id}"`);
});

test('Remove match takes matches off, remembers the pair as rejected, and runs once', async () => {
  const receipt = idFrom(await uploadPdf());
  await statement('a;2026-09-05;-125,50;EUR;Sample Cloud Lantern Oy;card\nb;2026-09-10;-10,00;EUR;Fake Paper Shop;x\n');
  const lantern = await tx('Sample Cloud Lantern Oy');
  const paper = await tx('Fake Paper Shop');
  const res = await bulk({ ...sept, op: 'unmatch', id: [lantern.id, paper.id] });
  expect(locationOf(res)).toBe(`/payments?month=2026-09&view=all&done=unmatchedMany&n=1&skipped=1#row-${paper.id}`);
  expect(await (await request(res.headers.get('Location')!)).text()).toContain('Removed 1 match. 1 skipped.');
  expect((await tx('Sample Cloud Lantern Oy')).receipt_id).toBeNull();
  expect(await env.DB.prepare('SELECT transaction_id,receipt_id FROM match_rejections').all()).toMatchObject({
    results: [{ transaction_id: lantern.id, receipt_id: receipt }],
  });
  expect(await (await json({ ...sept, op: 'unmatch', id: lantern.id })).json()).toMatchObject({ n: 0, skipped: 1 });
});

test('Match takes only the exact likely pairs, and the banner Undo takes them back', async () => {
  const receipt = idFrom(await uploadPdf());
  // Two payments fit the receipt equally, so neither matches on its own and only the first is offered.
  await statement(
    'a;2026-09-05;-125,50;EUR;Sample Cloud Lantern Oy;card\nb;2026-09-05;-125,50;EUR;Sample Cloud Lantern Helsinki;card\nc;2026-09-12;-9,00;EUR;Fake Paper Shop;x\n',
    'race',
  );
  const page = await (await request('/payments?month=2026-09&view=all')).text();
  const offered = htmlForm(page, '/matches/bulk').getAll('transaction_id');
  expect(offered).toHaveLength(1);
  const ids = (await env.DB.prepare('SELECT id FROM bank_transactions').all<{ id: string }>()).results.map((r) => r.id);
  const res = await bulk({ month: '2026-09', view: 'todo', op: 'match', id: ids });
  const location = locationOf(res);
  expect(location).toMatch(
    /^\/payments\?month=2026-09&view=todo&done=matchedMany&n=1&picked=1&skipped=2#row-[a-f0-9]{64}$/,
  );
  expect(
    await env.DB.prepare('SELECT id,receipt_id,match_method FROM bank_transactions WHERE receipt_id IS NOT NULL').all(),
  ).toMatchObject({ results: [{ id: offered[0], receipt_id: receipt, match_method: 'manual' }] });
  const done = await (await request(res.headers.get('Location')!)).text();
  expect(done).toContain(
    'Matched 1 payment. 2 skipped: no exact likely receipt, or changed since you opened the page.',
  );
  const undo = await request('/undo', { method: 'POST', body: htmlForm(done, '/undo') });
  expect(locationOf(undo)).toBe(`/payments?month=2026-09&view=todo&done=undone&op=match&n=1#row-${offered[0]}`);
  expect(await env.DB.prepare('SELECT count(*) n FROM bank_transactions WHERE receipt_id IS NOT NULL').first('n')).toBe(
    0,
  );
});

test('all=1 takes the month and the view', async () => {
  await uploadPdf();
  await statement(
    'a;2026-09-05;-125,50;EUR;Sample Cloud Lantern Oy;card\nb;2026-09-10;-10,00;EUR;Fake Paper Shop;x\nc;2026-10-10;-20,00;EUR;Fake October Shop;x\n',
  );
  const missing = await json({ month: '2026-09', view: 'todo', op: 'exempt', all: '1' });
  const body = (await missing.json()) as { location: string; n: number; skipped: number };
  expect(body).toMatchObject({ n: 1, skipped: 0 });
  expect(body.location).toMatch(
    /^\/payments\?month=2026-09&view=todo&done=notPurchaseMany&n=1&at=[^&]+&op=exempt&iat=\d+&sig=/,
  );
  expect((await tx('Fake Paper Shop')).receipt_required).toBe(0);
  // The matched row is not missing, and October is another month.
  expect((await tx('Sample Cloud Lantern Oy')).receipt_required).toBe(1);
  expect((await tx('Fake October Shop')).receipt_required).toBe(1);

  const auto = await json({ month: '2026-09', view: 'all', op: 'unmatch', all: '1' });
  expect(await auto.json()).toMatchObject({ n: 1, skipped: 1 });
  expect((await tx('Sample Cloud Lantern Oy')).receipt_id).toBeNull();
  expect((await tx('Fake October Shop')).receipt_required).toBe(1);
});

test('Bank renders a box per payment, the bar for its filter, and the script once', async () => {
  await uploadPdf();
  await statement('a;2026-09-05;-125,50;EUR;Sample Cloud Lantern Oy;card\nb;2026-09-10;-10,00;EUR;Fake Paper Shop;x\n');
  const paper = await tx('Fake Paper Shop');
  const html = await (await request('/payments?month=2026-09&view=all')).text();
  expect(html).toContain(
    `<li class="pay missing" data-row="${paper.id}" id="row-${paper.id}"><label class="pick"><input type="checkbox" name="id" value="${paper.id}" form="bulk-payments">`,
  );
  expect(html).toContain(
    '<div data-list="bank-all" data-total="2" data-bulk-list="bulk-payments"><div class="bulktools">',
  );
  expect(html).toMatch(/<\/ol><\/div><form id="bulk-payments" class="bulkbar" data-bulk data-total="2"/);
  expect(html).toContain(
    '<input type="hidden" name="list" value="bank"><input type="hidden" name="view" value="all"><input type="hidden" name="month" value="2026-09">',
  );
  expect(html).toContain('<button name="op" value="match" class="btn primary">Match</button>');
  expect(html).toContain('<button name="op" value="exempt" class="btn">Not a purchase</button>');
  expect(html).toContain('<button name="op" value="require" class="btn">Needs receipt</button>');
  expect(html).toContain('<summary class="btn danger">Remove match</summary>');
  // Every nested row form stays.
  expect(html).toContain(`<form action="/payments/${paper.id}" method="post">`);
  expect([...html.matchAll(/<script src="\/assets\/bulk\.js" defer><\/script>/g)]).toHaveLength(1);
  const missing = await (await request('/payments?month=2026-09&view=todo&select=1')).text();
  expect(missing).toContain('<div data-list="bank-todo" data-total="1" data-bulk-list="bulk-payments">');
  expect(missing).not.toContain('data-selecting');
  expect(html).not.toContain('select=1');
  expect(html).not.toContain('data-bulk-select');
  expect(missing).toContain('data-total="1"');
});

test('the bar lands back on the same view and month, at the next open row, never an offset', async () => {
  await statement('a;2026-09-10;-10,00;EUR;Fake Paper Shop;x\nb;2026-09-11;-12,00;EUR;Fake Ink Shop;x\n');
  const paper = await tx('Fake Paper Shop');
  const ink = await tx('Fake Ink Shop');
  const todo = { month: '2026-09', view: 'todo', upto: '100', offset: '100' };
  const res = await bulk({ ...todo, op: 'exempt', id: paper.id });
  expect(locationOf(res)).toBe(`/payments?month=2026-09&view=todo&upto=100&done=notPurchaseMany&n=1#row-${ink.id}`);
  const last = await bulk({ ...todo, upto: '50', op: 'exempt', id: ink.id });
  expect(locationOf(last)).toBe('/payments?month=2026-09&view=todo&done=notPurchaseMany&n=1');
});
