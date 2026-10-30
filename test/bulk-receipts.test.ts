// POST /receipts/bulk and the bars on Review, All receipts and Invoices.
// Every name, amount and id here is invented.
import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import worker from '../src/index';
import { importBankCsv, parsePreset } from '../src/banking';
import { BULK_CAP } from '../src/bulk';
import type { Receipt } from '../src/domain';
import { idFrom, locationOf, request, uploadPdf } from './helpers';

const id = (n: number) => n.toString(16).padStart(64, '0');
type Seed = { status?: string; kind?: string; vendor?: string; net?: number | null; month?: string; client?: string };
async function receipt(n: number, o: Seed = {}) {
  await env.DB.prepare(
    `INSERT INTO receipts (id,original_key,filename,media_type,source,received_at,status,kind,vendor,client,invoice_number,issue_date,currency,total_minor,net_minor,vat_minor,vat_rate_bps,review_reasons_json)
     VALUES (?,?,?,'application/pdf','upload',?,?,?,?,?,?,?,'EUR',?,?,0,0,?)`,
  )
    .bind(
      id(n),
      `receipts/${id(n)}`,
      `r${n}.pdf`,
      `${o.month ?? '2026-10'}-20T10:00:${String(n % 60).padStart(2, '0')}Z`,
      o.status ?? 'ready',
      o.kind ?? 'expense',
      o.vendor ?? `Vendor ${n}`,
      o.client ?? null,
      `INV-${n}`,
      `${o.month ?? '2026-10'}-20`,
      1000 + n,
      o.net === undefined ? 1000 + n : o.net,
      o.status === 'needs_review' ? '["uncertain_total"]' : '[]',
    )
    .run();
}
const row = (n: number) => env.DB.prepare('SELECT * FROM receipts WHERE id=?').bind(id(n)).first<Receipt>();
function form(fields: Record<string, string | string[]>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) body.append(k, one);
  return body;
}
// Every bar posts its list's state; these default to Receipts All unless a test says otherwise.
const bulk = (fields: Record<string, string | string[]>, headers: Record<string, string> = {}) =>
  request('/receipts/bulk', { method: 'POST', body: form({ list: 'receipts', view: 'all', ...fields }), headers });
const json = (fields: Record<string, string | string[]>) => bulk(fields, { Accept: 'application/json' });
const ids = (...ns: number[]) => ns.map(id);

test('ids, ops and caps are checked at the door', async () => {
  await receipt(1);
  expect((await bulk({ op: 'discard', id: Array.from({ length: BULK_CAP + 1 }, (_, i) => id(i + 10)) })).status).toBe(
    400,
  );
  expect((await bulk({ op: 'retry', id: Array.from({ length: 11 }, (_, i) => id(i + 10)) })).status).toBe(400);
  expect((await bulk({ op: 'kind', to: 'sales', id: Array.from({ length: 11 }, (_, i) => id(i + 10)) })).status).toBe(
    400,
  );
  expect((await bulk({ op: 'explode', id: id(1) })).status).toBe(400);
  expect((await bulk({ op: 'toString', id: id(1) })).status).toBe(400);
  expect((await bulk({ op: 'discard', id: 'not-an-id' })).status).toBe(400);
  expect((await bulk({ op: 'discard' })).status).toBe(400);
  expect((await bulk({ op: 'discard', id: id(1), done_before: '-1' })).status).toBe(400);
  expect((await bulk({ op: 'discard', all: '1', list: 'payments' })).status).toBe(400);
  expect((await row(1))!.discarded_at).toBeNull();
});

test('a post needs the sign-in and the app origin', async () => {
  await receipt(1);
  const anonymous = await worker.fetch(
    new Request('http://localhost/receipts/bulk', {
      method: 'POST',
      body: form({ op: 'discard', id: id(1) }),
      headers: { Origin: 'http://localhost' },
    }),
    env,
  );
  expect(anonymous.status).toBe(401);
  const foreign = await request('/receipts/bulk', {
    method: 'POST',
    body: form({ op: 'discard', id: id(1) }),
    headers: { Origin: 'http://evil.example' },
  });
  expect(foreign.status).toBe(403);
  expect((await row(1))!.discarded_at).toBeNull();
});

test('approve takes the complete ones, skips the rest, needs a reason, and survives a second run', async () => {
  await receipt(1, { status: 'needs_review' });
  await receipt(2, { status: 'needs_review' });
  await receipt(3, { status: 'needs_review', net: null });
  await receipt(4, { status: 'needs_review', kind: 'sales' });
  const all = ids(1, 2, 3, 4);
  const missing = await json({ op: 'approve', id: all, approval_reason: ' ' });
  expect(missing.status).toBe(422);
  expect(await missing.json()).toEqual({ error: expect.stringContaining('note') });

  const res = await bulk({ op: 'approve', id: all, approval_reason: 'Checked against the original', view: 'todo' });
  expect(res.status).toBe(303);
  // Back to To do, at the first row still open after the first one acted on.
  expect(locationOf(res)).toBe(`/receipts?view=todo&done=approvedMany&n=2&skipped=2#row-${id(3)}`);
  const done = (await row(1))!;
  expect(done).toMatchObject({ status: 'ready', review_reasons_json: '[]' });
  expect(done.reviewed_at).toBeTruthy();
  expect(JSON.parse(done.manual_fields_json)).toMatchObject({
    vendor: 'Vendor 1',
    approval_reason: 'Checked against the original',
    acknowledged_reasons: ['uncertain_total'],
  });
  // No net amount, and a sales invoice with no client: both stay for a person.
  expect((await row(3))!.status).toBe('needs_review');
  expect((await row(4))!.status).toBe('needs_review');
  const page = await (await request(res.headers.get('Location')!)).text();
  expect(page).toContain('Approved 2 receipts. 2 skipped.');

  const again = await json({ op: 'approve', id: all, approval_reason: 'Checked' });
  expect(await again.json()).toMatchObject({ n: 0, skipped: 4 });
});

test('discard sets the rows aside with one Undo back to the same list; restore brings them back', async () => {
  await receipt(1);
  await receipt(2);
  const res = await bulk({
    op: 'discard',
    id: ids(1, 2),
    list: 'receipts',
    view: 'all',
    month: '2026-10',
    q: 'vendor',
    offset: '50',
  });
  const location = locationOf(res);
  expect(location).toMatch(/^\/receipts\?view=all&month=2026-10&q=vendor&done=discarded&n=2&at=[^&]+&back=/);
  expect((await row(1))!.discard_reason).toBeNull();
  const page = await (await request(res.headers.get('Location')!)).text();
  expect(page).toContain('2 discarded.');
  expect(page).toContain('action="/restore"');
  const at = new URL(location, 'http://localhost').searchParams.get('at')!;
  const undo = await request('/restore', {
    method: 'POST',
    body: form({ at, back: '/receipts?view=all&month=2026-10&q=vendor' }),
  });
  expect(locationOf(undo)).toBe('/receipts?view=all&month=2026-10&q=vendor&done=restored&n=2');
  expect((await row(1))!.discarded_at).toBeNull();

  await bulk({ op: 'discard', id: ids(1, 2) });
  const restored = await json({ op: 'restore', id: ids(1, 2, 3) });
  expect(await restored.json()).toMatchObject({ n: 2, skipped: 1 });
  expect((await row(2))!.discarded_at).toBeNull();
});

test('a restored receipt is matched to its payment again', async () => {
  const receiptId = idFrom(await uploadPdf());
  await bulk({ op: 'discard', id: receiptId });
  const text =
    'Transaction ID;Date;Amount;Currency;Payee;Reference\na;2026-09-05;-125,50;EUR;Sample Cloud Lantern Oy;card\n';
  await importBankCsv(env, {
    bytes: new TextEncoder().encode(text),
    parsed: parsePreset(text, 'holvi', 'EUR'),
    collision: 'keep_existing',
  });
  const payment = () => env.DB.prepare('SELECT receipt_id,match_method FROM bank_transactions').first();
  expect(await payment()).toMatchObject({ receipt_id: null });
  await bulk({ op: 'restore', id: receiptId });
  expect(await payment()).toMatchObject({ receipt_id: receiptId, match_method: 'automatic' });
});

test('paid marks sales invoices only, and needs the day and how', async () => {
  await receipt(1, { kind: 'sales', client: 'Example Client Oy' });
  await receipt(2);
  expect((await bulk({ op: 'paid', id: ids(1, 2), paid_outside_on: '', paid_outside_note: 'Stripe' })).status).toBe(
    422,
  );
  expect((await bulk({ op: 'paid', id: ids(1, 2), paid_outside_on: '2026-10-25' })).status).toBe(422);
  const res = await bulk({
    op: 'paid',
    id: ids(1, 2),
    paid_outside_on: '2026-10-25',
    paid_outside_note: 'Stripe payout',
    list: 'invoices',
    month: '2026-10',
  });
  expect(locationOf(res)).toBe('/receipts?view=all&kind=sales&month=2026-10&done=paidMany&n=1&on=2026-10-25&skipped=1');
  expect(await row(1)).toMatchObject({ paid_outside_on: '2026-10-25', paid_outside_note: 'Stripe payout' });
  expect((await row(2))!.paid_outside_on).toBeNull();
});

test('read again and move skip what does not apply; chunks add up through done_before', async () => {
  await receipt(1);
  await receipt(2, { kind: 'sales', client: 'Example Client Oy' });
  await receipt(3);
  await bulk({ op: 'discard', id: id(3) });
  const again = await json({ op: 'retry', id: ids(1, 3), done_before: '10' });
  expect(await again.json()).toMatchObject({ n: 11, skipped: 1 });
  const moved = await json({ op: 'kind', id: ids(1, 2), to: 'sales' });
  expect(await moved.json()).toMatchObject({ n: 1, skipped: 1 });
  expect((await row(1))!.kind).toBe('sales');
  expect((await bulk({ op: 'kind', id: id(1), to: 'gift' })).status).toBe(400);
});

test('all=1 takes the list filter, never more than the cap', async () => {
  await receipt(1, { vendor: 'Alpha Fake Oy' });
  await receipt(2, { vendor: 'Beta Fake Oy' });
  await receipt(3, { vendor: 'Alpha Fake Oy', month: '2026-09' });
  const res = await json({ op: 'discard', all: '1', list: 'receipts', view: 'all', q: 'alpha', month: '2026-10' });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { location: string; n: number; skipped: number };
  expect(body).toMatchObject({ n: 1, skipped: 0 });
  // The location is the signed banner link for the list the post came from.
  expect(body.location).toMatch(/^\/receipts\?view=all&month=2026-10&q=alpha&done=discarded&n=1&at=.*&iat=\d+&sig=/);
  expect((await row(1))!.discarded_at).toBeTruthy();
  expect((await row(2))!.discarded_at).toBeNull();
  expect((await row(3))!.discarded_at).toBeNull();

  // Over the AI cap for the filter: refused, nothing read.
  for (let n = 10; n < 21; n++) await receipt(n);
  const capped = await json({ op: 'retry', all: '1', list: 'receipts', view: 'all' });
  expect(capped.status).toBe(400);
  expect(await capped.json()).toEqual({ error: 'Up to 10 at a time. Narrow the filter.' });

  const many = Array.from({ length: BULK_CAP + 1 }, (_, i) =>
    env.DB.prepare(
      `INSERT INTO receipts (id,original_key,filename,media_type,source,received_at,status) VALUES (?,?,'x.pdf','application/pdf','upload','2026-08-01T00:00:00Z','ready')`,
    ).bind(id(1000 + i), `receipts/${id(1000 + i)}`),
  );
  await env.DB.batch(many);
  // Over the cap: the first 500 in the list's order (newest first), as the bar offers.
  const over = await json({ op: 'discard', all: '1', list: 'receipts', view: 'all' });
  expect(await over.json()).toMatchObject({ n: BULK_CAP });
  expect((await row(1000 + BULK_CAP))!.discarded_at).toBeTruthy();
  expect((await row(1000))!.discarded_at).toBeNull();
});

test('all=1 on To do acts on the To do rows only', async () => {
  await receipt(1, { status: 'needs_review' });
  await receipt(2, { status: 'needs_review' });
  await env.DB.prepare(`UPDATE receipts SET review_reasons_json='["missing_total"]' WHERE id=?`).bind(id(1)).run();
  await env.DB.prepare(`UPDATE receipts SET review_reasons_json='["missing_invoice_number"]' WHERE id=?`)
    .bind(id(2))
    .run();
  const res = await json({ op: 'discard', all: '1', list: 'receipts', view: 'todo' });
  expect(await res.json()).toMatchObject({ n: 1, location: expect.stringMatching(/^\/receipts\?view=todo&done=/) });
  expect((await row(1))!.discarded_at).toBeTruthy();
  expect((await row(2))!.discarded_at).toBeNull();
});

test('the return is rebuilt from the list state, never followed as sent', async () => {
  await receipt(1);
  for (const back of ['https://evil.example/receipts', '//evil.example/review', '/\\evil.example', '/settings', 'x'])
    expect(locationOf(await bulk({ op: 'restore', id: id(1), list: 'invoices', back })), back).toBe(
      '/receipts?view=all&kind=sales&done=restored&n=0&skipped=1',
    );
  // Only the list's own state is kept. Other fields are ignored; a value the list doesn't take is
  // refused, never guessed.
  const odd = { list: 'receipts', view: 'all', show: 'discarded', select: '1', evil: '1' };
  expect(locationOf(await bulk({ op: 'restore', id: id(1), ...odd }))).toBe(
    '/receipts?view=all&show=discarded&done=restored&n=0&skipped=1',
  );
  const stale = await json({ op: 'restore', id: id(1), ...odd, month: '2026-13' });
  expect(stale.status).toBe(400);
  expect(await stale.json()).toEqual({ error: 'This page is out of date. Reload it and try again.' });
});

test('the lists render checkboxes, the bar and its script; an empty list renders none', async () => {
  for (const path of ['/receipts?view=todo', '/receipts?view=all', '/receipts?view=all&kind=sales&month=2026-10']) {
    const empty = await (await request(path)).text();
    expect(empty, path).not.toContain('<form id="bulk-');
    expect(empty, path).not.toContain('/assets/bulk.js');
    expect(empty, path).not.toContain('<div data-bulk-list');
  }
  await receipt(1, { status: 'needs_review' });
  await receipt(2);
  await receipt(3, { kind: 'sales', client: 'Example Client Oy' });
  const review = await (await request('/receipts?view=todo')).text();
  expect(review).toContain(`<input type="checkbox" name="id" value="${id(1)}" form="bulk-todo">`);
  expect(review).toContain('<div data-list="receipts-todo" data-total="1" data-bulk-list="bulk-todo">');
  expect(review).toMatch(/<\/div><form id="bulk-todo" class="bulkbar" data-bulk data-total="1"/);
  expect(review).toContain('name="approval_reason" value="Checked against the original"');
  expect(review).toContain(
    '<input type="hidden" name="list" value="receipts"><input type="hidden" name="view" value="todo">',
  );
  expect(review).toContain('<script src="/assets/bulk.js" defer></script>');
  // The old Select mode is gone, and so is the per-row Discard: it is in the bar.
  expect(review).not.toContain('class="bulk"');
  expect(review).not.toContain('action="/discard"');
  expect(await (await request('/receipts?view=todo&select=1')).text()).not.toContain('data-selecting');

  const all = await (await request('/receipts?view=all&month=2026-10')).text();
  expect(all).toContain(`value="${id(2)}" form="bulk-receipts"`);
  expect(all).toContain('data-total="2"');
  expect(all).toContain('<button name="op" value="retry" class="btn" data-max="10">Read again</button>');
  expect(all).not.toContain('value="restore"');
  const discarded = await (await request('/receipts?show=discarded')).text();
  expect(discarded).not.toContain('<form id="bulk-');
  await bulk({ op: 'discard', id: id(2) });
  const after = await (await request('/receipts?show=discarded')).text();
  expect(after).toContain('<button name="op" value="restore" class="btn">Restore</button>');
  expect(after).not.toContain('value="discard"');

  const invoices = await (await request('/receipts?view=all&kind=sales&month=2026-10')).text();
  expect(invoices).toContain(`value="${id(3)}" form="bulk-invoices"`);
  expect(invoices).toContain('name="paid_outside_on" value="');
  expect(invoices).toContain('<input type="hidden" name="list" value="invoices">');

  // Select mode is gone: the boxes are always there and no list links to ?select=1.
  for (const path of [
    '/receipts?view=todo',
    '/receipts?view=all&month=2026-10',
    '/receipts?view=all&kind=sales&month=2026-10',
    '/settings?open=senders',
  ]) {
    const html = await (await request(path)).text();
    expect(html, path).not.toContain('select=1');
    expect(html, path).not.toContain('data-bulk-select');
    expect(html, path).not.toContain('data-selecting');
  }
});

test('chunk totals of done and skipped add up, within bounds', async () => {
  await receipt(1);
  await receipt(2, { kind: 'sales', client: 'Example Client Oy' });
  const moved = await json({ op: 'kind', id: ids(1, 2), to: 'sales', done_before: '7', skipped_before: '3' });
  expect(await moved.json()).toMatchObject({ n: 8, skipped: 4 });
  for (const bad of ['-1', '1.5', 'x', String(BULK_CAP * 2 + 1)])
    for (const key of ['done_before', 'skipped_before'])
      expect((await bulk({ op: 'restore', id: id(1), [key]: bad })).status, `${key}=${bad}`).toBe(400);
});

test('names from the object prototype are not reasons or shows', async () => {
  await receipt(1, { status: 'needs_review' });
  expect((await row(1))!.discarded_at).toBeNull();
  for (const path of ['/receipts?view=todo&reason=constructor', '/receipts?show=toString'])
    expect((await request(path)).status, path).toBe(200);
});

test('approving a foreign receipt values it in euros, as approving one does', async () => {
  await receipt(1, { status: 'needs_review', month: '2026-09' });
  await env.DB.prepare("UPDATE receipts SET currency='USD',issue_date='2026-09-05' WHERE id=?").bind(id(1)).run();
  const res = await json({ op: 'approve', id: id(1), approval_reason: 'Checked' });
  expect(await res.json()).toMatchObject({ n: 1 });
  expect(await row(1)).toMatchObject({ status: 'ready', fx_eur_minor: 901, fx_requested_date: '2026-09-05' });
});

test('a run that changed nothing says so, with no Undo', async () => {
  await receipt(1);
  await bulk({ op: 'discard', id: id(1) });
  const res = await bulk({ op: 'discard', id: id(1), list: 'receipts', view: 'all' });
  expect(locationOf(res)).toMatch(
    /^\/receipts\?view=all&done=discarded&n=0&at=[^&]+&back=%2Freceipts%3Fview%3Dall&skipped=1$/,
  );
  const page = await (await request(res.headers.get('Location')!)).text();
  expect(page).toContain('Nothing changed. 1 skipped.');
  expect(page).not.toContain('action="/restore"');
});
