// POST /senders/bulk, the Unknown senders bar on Review and the Senders bars in Settings.
// Every address and message here is invented.
import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import worker from '../src/index';
import { BULK_CAP } from '../src/bulk';
import { htmlForm, locationOf, request } from './helpers';

const LINK_AUTH =
  'Authentication-Results: mx.cloudflare.net; dkim=pass header.d=link.com header.s=x header.b=y; dmarc=pass header.from=link.com policy.dmarc=reject; spf=pass (mx.cloudflare.net: domain of bounce@amazonses.com designates 1.2.3.4 as permitted sender) smtp.mailfrom=0100-abc@amazonses.com\r\n';
const SHOP_AUTH = 'Authentication-Results: mx.cloudflare.net; spf=pass smtp.mailfrom=new@shop.example\r\n';
function mail(auth: string, from: string, id: string, body: string) {
  return new Response(
    `${auth}From: ${from}\r\nTo: receipts@example.com\r\nSubject: Fake receipt ${id}\r\nMessage-ID: ${id}\r\nContent-Type: text/plain\r\n\r\n${body}`,
  ).body!;
}
async function deliver(raw: ReadableStream<Uint8Array>, from: string) {
  const context = createExecutionContext();
  await worker.email({ from, to: 'receipts@example.com', raw } as never, env, context as ExecutionContext);
  await waitOnExecutionContext(context);
}
const fromLink = (n: number) =>
  deliver(
    mail(
      LINK_AUTH,
      '"Link" <notifications@link.com>',
      `<l${n}@amazonses.com>`,
      `vendor: Fake Shop ${n}\r\ntotal: 1${n}.00`,
    ),
    '0100-abc@amazonses.com',
  );
const fromShop = (n: number) =>
  deliver(mail(SHOP_AUTH, 'new@shop.example', `<s${n}@shop.example>`, `vendor: Fake Store ${n}`), 'new@shop.example');
const held = async () =>
  (
    await env.DB.prepare("SELECT id,sender,email_key FROM inbound_mail WHERE state='held' ORDER BY sender,id").all<{
      id: string;
      sender: string;
      email_key: string;
    }>()
  ).results;
const receipts = async () => Number(await env.DB.prepare('SELECT count(*) AS n FROM receipts').first('n'));
const allowedWrites = async () =>
  Number(await env.DB.prepare("SELECT count(*) n FROM settings_audit WHERE key='ALLOWED_SENDER_EMAILS'").first('n'));
const allowedList = async () =>
  JSON.parse(
    (await env.DB.prepare("SELECT value_json FROM settings WHERE key='ALLOWED_SENDER_EMAILS'").first<string>(
      'value_json',
    )) ?? '""',
  ) as string;
function form(fields: Record<string, string | string[]>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) body.append(k, one);
  return body;
}
const bulk = (fields: Record<string, string | string[]>, headers: Record<string, string> = {}) =>
  request('/senders/bulk', { method: 'POST', body: form(fields), headers });
const json = (fields: Record<string, string | string[]>) => bulk(fields, { Accept: 'application/json' });
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

test('ops, ids and caps are checked at the door', async () => {
  await fromLink(1);
  const [one] = await held();
  expect(
    (await bulk({ op: 'ignore', id: Array.from({ length: BULK_CAP + 1 }, () => crypto.randomUUID()) })).status,
  ).toBe(400);
  expect((await bulk({ op: 'explode', id: one!.id })).status).toBe(400);
  // Delete email is gone: Ignore covers it.
  expect((await bulk({ op: 'delete', id: one!.id })).status).toBe(400);
  expect((await bulk({ op: 'ignore', id: 'not-an-id' })).status).toBe(400);
  expect((await bulk({ op: 'ignore' })).status).toBe(400);
  // Held mail has no filter to take all of.
  expect((await bulk({ op: 'ignore', all: '1' })).status).toBe(400);
  expect((await bulk({ op: 'remove', id: 'not an address' })).status).toBe(422);

  const anonymous = await worker.fetch(
    new Request('http://localhost/senders/bulk', {
      method: 'POST',
      body: form({ op: 'ignore', id: one!.id }),
      headers: { Origin: 'http://localhost' },
    }),
    env,
  );
  expect(anonymous.status).toBe(401);
  const foreign = await request('/senders/bulk', {
    method: 'POST',
    body: form({ op: 'ignore', id: one!.id }),
    headers: { Origin: 'http://evil.example' },
  });
  expect(foreign.status).toBe(403);
  expect(await held()).toHaveLength(1);
});

test('Allow adds every sender in one write and reads all their waiting mail', async () => {
  await fromLink(1);
  await fromLink(2);
  await fromShop(1);
  const rows = await held();
  const link = rows.find((r) => r.sender === 'notifications@link.com')!;
  const shop = rows.find((r) => r.sender === 'new@shop.example')!;
  const res = await bulk({ op: 'allow', id: [link.id, shop.id], back: 'review' });
  expect(res.status).toBe(303);
  expect(locationOf(res)).toBe('/receipts?view=todo&done=mailAllowed&n=3&senders=2');
  expect(await allowedWrites()).toBe(1);
  expect(await allowedList()).toBe(
    'owner@example.com, bookkeeping@example.org, sender@example.net, notifications@link.com, new@shop.example',
  );
  expect(await held()).toHaveLength(0);
  expect(await receipts()).toBe(3);
  expect(await (await request(res.headers.get('Location')!)).text()).toContain('Allowed 2 senders. Reading 3 emails.');

  const again = await json({ op: 'allow', id: [link.id, shop.id] });
  const body = (await again.json()) as { location: string; n: number; skipped: number };
  expect(body).toMatchObject({
    n: 0,
    skipped: 2,
    location: expect.stringMatching(/^\/receipts\?view=todo&done=mailAllowed&n=0/),
  });
  expect(await allowedWrites()).toBe(1);
  expect(await (await request(body.location)).text()).toContain('Nothing was allowed. 2 skipped.');
});

test('Ignore lists the senders once and deletes their mail; an approved sender is skipped', async () => {
  await fromLink(1);
  await fromLink(2);
  await fromShop(1);
  await env.DB.prepare(
    "INSERT INTO inbound_mail (id,received_at,sender,state,reason) VALUES (?,'2026-10-01T00:00:00Z','owner@example.com','held','sender_not_allowed')",
  )
    .bind(crypto.randomUUID())
    .run();
  const rows = await held();
  const res = await bulk({ op: 'ignore', id: rows.map((r) => r.id), back: '/receipts?view=all&show=unknown' });
  expect(locationOf(res)).toBe('/receipts?view=all&show=unknown&done=mailIgnored&n=3&senders=2&skipped=1');
  expect(await (await request(res.headers.get('Location')!)).text()).toContain(
    'Ignored 2 senders. 3 emails deleted. 1 skipped.',
  );
  expect(
    (await env.DB.prepare('SELECT address FROM ignored_senders ORDER BY address').all()).results.map((r) => r.address),
  ).toEqual(['new@shop.example', 'notifications@link.com']);
  expect((await held()).map((r) => r.sender)).toEqual(['owner@example.com']);
  expect((await env.ORIGINALS.list()).objects).toHaveLength(0);
  // Their next email is not kept.
  await fromShop(2);
  expect(await held()).toHaveLength(1);
});

test('Settings removes allowed senders in one write and stops ignoring others', async () => {
  const res = await bulk({
    op: 'remove',
    id: ['Sender@Example.net', 'bookkeeping@example.org', 'nobody@example.com'],
    back: 'settings',
  });
  expect(locationOf(res)).toBe('/settings?done=senderRemoved&n=2&skipped=1#senders');
  expect(await allowedList()).toBe('owner@example.com');
  expect(await allowedWrites()).toBe(1);
  const page = await (await request(res.headers.get('Location')!)).text();
  expect(page).toContain('Removed 2 senders. 1 skipped.');
  expect(page).toMatch(/<details class="sect" open><summary><h2>Email senders<\/h2>/);
  expect(await (await json({ op: 'remove', id: 'sender@example.net', back: 'settings' })).json()).toMatchObject({
    n: 0,
    skipped: 1,
  });
  expect(await allowedWrites()).toBe(1);
  // Undo puts the list back as the deploy set it: the app's own value goes again, with an audit row.
  const undone = await request('/undo', { method: 'POST', body: htmlForm(page, '/undo') });
  expect(locationOf(undone)).toBe('/settings?done=undone&op=settings&n=1&section=senders#senders');
  expect(await allowedList()).toBe('');
  expect(await allowedWrites()).toBe(2);
  expect(await (await request(undone.headers.get('Location')!)).text()).toContain(
    'Your settings are back as they were.',
  );

  await env.DB.batch(
    ['a@fake.example', 'b@fake.example'].map((a) =>
      env.DB.prepare("INSERT INTO ignored_senders (address,added_at,added_by) VALUES (?,'2026-10-01','owner')").bind(a),
    ),
  );
  const unignored = await bulk({ op: 'unignore', id: ['a@fake.example', 'b@fake.example'], back: 'settings' });
  expect(locationOf(unignored)).toBe('/settings?done=senderUnignored&n=2#senders');
  expect(await env.DB.prepare('SELECT count(*) n FROM ignored_senders').first('n')).toBe(0);
  expect(await (await json({ op: 'unignore', id: 'a@fake.example', back: 'settings' })).json()).toMatchObject({
    n: 0,
    skipped: 1,
  });
});

test('Review and Settings render the boxes and bars, with the script once', async () => {
  await fromLink(1);
  const [mailRow] = await held();
  await env.DB.prepare(
    "INSERT INTO ignored_senders (address,added_at,added_by) VALUES ('a@fake.example','2026-10-01','owner')",
  ).run();
  // To do shows held mail as rows with Allow and Ignore, and no bar of its own: one bar per page.
  const review = await (await request('/receipts?view=todo')).text();
  expect(review).toContain(`<li id="mail-${mailRow!.id}">`);
  expect(review).not.toContain('bulk-held');
  expect(review).toContain('<input type="hidden" name="back" value="/receipts?view=todo">');
  expect(review).toContain('aria-label="Allow notifications@link.com">Allow</button>');
  expect(review).toContain('<summary aria-label="Ignore notifications@link.com">Ignore</summary>');
  expect(review).not.toContain('/assets/bulk.js');

  const settings = await (await request('/settings?open=senders')).text();
  expect(settings).toMatch(/<details class="sect" open><summary><h2>Email senders<\/h2>/);
  expect(settings).toContain('<input type="checkbox" name="id" value="owner@example.com" form="bulk-allowed">');
  expect(settings).toContain('<input type="checkbox" name="id" value="a@fake.example" form="bulk-ignored">');
  expect(settings).toContain('<summary class="btn danger">Remove</summary>');
  expect(settings).toContain('<button name="op" value="unignore" class="btn">Stop ignoring</button>');
  expect(settings).toContain('<script src="/assets/settings.js" defer></script>');
  expect([...settings.matchAll(/<script src="\/assets\/bulk\.js" defer><\/script>/g)]).toHaveLength(1);
});
