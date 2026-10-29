import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import worker from '../src/index';
import { preserve, receiveEmail } from '../src/receipts';
import { authenticatedSender, dmarcPassDomain, headerFromAddress } from '../src/sender';
import { MAX_HELD, MAX_HELD_PER_SENDER } from '../src/inbound';
import { allRows, PAGE_SIZE } from '../src/all';
import { MAX_ALLOWED_SENDERS } from '../src/config';
import type { Env } from '../src/env';
import { authorization, locationOf, request, signed } from './helpers';

// What Cloudflare prepends to a mail service's message: DMARC passes for the
// From domain while the envelope is a per-message bounce address.
const LINK_AUTH =
  'Authentication-Results: mx.cloudflare.net; dkim=pass header.d=link.com header.s=x header.b=y; dmarc=pass header.from=link.com policy.dmarc=reject; spf=pass (mx.cloudflare.net: domain of bounce@amazonses.com designates 1.2.3.4 as permitted sender) smtp.mailfrom=0100-abc@amazonses.com\r\n';
const BOUNCE = '0100-abc@amazonses.com';
function mail(
  {
    auth = LINK_AUTH,
    from = '"Link" <notifications@link.com>',
    id = '<a1@amazonses.com>',
    subject = 'Your receipt from Example',
  } = {},
  body = 'vendor: Example Shop\r\ntotal: 12.00',
) {
  return new Response(
    `${auth}From: ${from}\r\nTo: receipts@example.com\r\nSubject: ${subject}\r\n${id ? `Message-ID: ${id}\r\n` : ''}Content-Type: text/plain\r\n\r\n${body}`,
  ).body!;
}
async function deliver(raw: ReadableStream<Uint8Array>, from = BOUNCE, deploy: Env = env) {
  const context = createExecutionContext();
  // worker.email layers in-app settings, as production does.
  await worker.email({ from, to: 'receipts@example.com', raw } as never, deploy, context as ExecutionContext);
  await waitOnExecutionContext(context);
}
const receipts = async () => Number(await env.DB.prepare('SELECT count(*) AS n FROM receipts').first('n'));
const held = async () =>
  (
    await env.DB.prepare("SELECT * FROM inbound_mail WHERE state='held' ORDER BY received_at").all<
      Record<string, unknown>
    >()
  ).results;
function post(path: string, fields: Record<string, string>, deploy: Env = env) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return worker.fetch(
    new Request('http://localhost' + path, {
      method: 'POST',
      body,
      headers: { Authorization: authorization, Origin: 'http://localhost' },
    }),
    deploy,
  );
}
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

test('From is trusted only when Cloudflare says DMARC passed for its exact domain', () => {
  const bytes = (text: string) => new TextEncoder().encode(text);
  const link = bytes(`${LINK_AUTH}From: "Link, Inc" <Notifications@Link.com>\r\n\r\nx`);
  expect(headerFromAddress(link)).toBe('notifications@link.com');
  expect(dmarcPassDomain(link)).toBe('link.com');
  expect(authenticatedSender(link, BOUNCE)).toBe('notifications@link.com');
  // A lookalike From domain: DMARC was for link.com, so the From is not used
  // and the envelope (SPF pass) is what is known.
  expect(authenticatedSender(bytes(`${LINK_AUTH}From: billing@link.com.evil.example\r\n\r\nx`), BOUNCE)).toBe(BOUNCE);
  // Two From addresses: not trusted.
  expect(headerFromAddress(bytes('From: a@link.com, b@link.com\r\n\r\nx'))).toBeNull();
  // A forged result below Cloudflare's own header is ignored.
  const forged = bytes(
    'Authentication-Results: mx.cloudflare.net; spf=none; dmarc=none\r\nAuthentication-Results: mx.cloudflare.net; dmarc=pass header.from=example.com\r\nFrom: owner@example.com\r\n\r\nx',
  );
  expect(dmarcPassDomain(forged)).toBeNull();
  expect(authenticatedSender(forged, 'x@evil.example')).toBeNull();
  expect(authenticatedSender(bytes('From: owner@example.com\r\n\r\nx'), 'owner@example.com')).toBeNull();
});

test('an unknown sender is held with its facts, never read, and only the domain is logged', async () => {
  const forward = vi.fn(async () => ({ messageId: 'x' }));
  const context = createExecutionContext();
  await receiveEmail(
    { from: BOUNCE, to: 'receipts@example.com', raw: mail(), forward },
    { ...env, FORWARD_COPY_TO: 'copy@example.net' } as Env,
    context,
  );
  await waitOnExecutionContext(context);
  expect(forward).toHaveBeenCalledTimes(1);
  expect(await receipts()).toBe(0);
  const [row] = await held();
  expect(row).toMatchObject({
    sender: 'notifications@link.com',
    envelope: BOUNCE,
    to_address: 'receipts@example.com',
    subject: 'Your receipt from Example',
    message_id: '<a1@amazonses.com>',
    attachments: 0,
    reason: 'sender_not_allowed',
  });
  expect(await env.ORIGINALS.get(String(row!.email_key))).not.toBeNull();
  const logged = warn.mock.calls.flat().join(' ');
  expect(logged).toContain('"reason":"sender_not_allowed"');
  expect(logged).toContain('"domain":"link.com"');
  expect(logged).not.toContain('notifications@');
  // Review shows it with Allow, Ignore and (under More) Delete, named for screen readers; the nav badge counts it.
  const html = await (await request('/review')).text();
  expect(html).toContain('notifications@link.com');
  expect(html).toContain('Your receipt from Example');
  expect(html).toContain('<button class="btn primary" aria-label="Allow notifications@link.com">Allow</button>');
  expect(html).toContain('<button class="linkbtn" aria-label="Ignore notifications@link.com">Ignore</button>');
  expect(html).toMatch(
    /<details class="more"><summary aria-label="More for notifications@link.com">More<\/summary><div class="body">[\s\S]*?Delete email<\/button>/,
  );
  expect(html).toMatch(/Review <span class="count">1/);
});

test('the same Message-ID is held once; the pending limits log the rest', async () => {
  await deliver(mail());
  await deliver(mail());
  expect(await held()).toHaveLength(1);
  expect(await env.DB.prepare("SELECT count(*) FROM inbound_mail WHERE reason='duplicate'").first('count(*)')).toBe(1);
  // Per sender.
  for (let i = 1; i < MAX_HELD_PER_SENDER; i++) await deliver(mail({ id: `<a${i + 1}@amazonses.com>` }));
  expect(await held()).toHaveLength(MAX_HELD_PER_SENDER);
  await deliver(mail({ id: '<over@amazonses.com>' }));
  expect(await held()).toHaveLength(MAX_HELD_PER_SENDER);
  expect(await env.DB.prepare("SELECT count(*) FROM inbound_mail WHERE reason='held_limit'").first('count(*)')).toBe(1);
  // In total.
  const fill = [];
  for (let i = MAX_HELD_PER_SENDER; i < MAX_HELD; i++)
    fill.push(
      env.DB.prepare(
        "INSERT INTO inbound_mail (id,received_at,sender,state,reason) VALUES (?,?,?,'held','sender_not_allowed')",
      ).bind(crypto.randomUUID(), new Date().toISOString(), `s${i}@other.example`),
    );
  await env.DB.batch(fill);
  const other = 'Authentication-Results: mx.cloudflare.net; spf=pass smtp.mailfrom=new@shop.example\r\n';
  await deliver(mail({ auth: other, from: 'new@shop.example', id: '<n1@shop.example>' }), 'new@shop.example');
  expect(await held()).toHaveLength(MAX_HELD);
  expect(await env.DB.prepare("SELECT count(*) FROM inbound_mail WHERE reason='held_limit'").first('count(*)')).toBe(2);
});

test('a From address on the list is read even when the envelope is a bounce address', async () => {
  const auth =
    'Authentication-Results: mx.cloudflare.net; dkim=pass header.d=example.com; dmarc=pass header.from=example.com; spf=pass smtp.mailfrom=bounce-1@mailer.example\r\n';
  await deliver(mail({ auth, from: 'Owner <owner@example.com>', id: '<o1@example.com>' }), 'bounce-1@mailer.example');
  expect(await receipts()).toBe(1);
  expect(await held()).toHaveLength(0);
  expect(await env.DB.prepare('SELECT sender,state,reason FROM inbound_mail').first()).toEqual({
    sender: 'owner@example.com',
    state: 'imported',
    reason: 'allowed',
  });
});

test('Approve sender saves it next to the defaults and reads every waiting email from them', async () => {
  await deliver(mail());
  await deliver(mail({ id: '<a2@amazonses.com>', subject: 'Second' }, 'vendor: Other Shop'));
  const response = await post('/senders/approve', { address: 'Notifications@Link.com' });
  expect(response.status).toBe(303);
  expect(locationOf(response)).toBe('/review?done=mailAllowed&n=2');
  expect(await receipts()).toBe(2);
  expect(await held()).toHaveLength(0);
  const saved = await env.DB.prepare("SELECT value_json FROM settings WHERE key='ALLOWED_SENDER_EMAILS'").first<string>(
    'value_json',
  );
  expect(JSON.parse(saved!)).toBe(
    'owner@example.com, bookkeeping@example.org, sender@example.net, notifications@link.com',
  );
  expect(
    await env.DB.prepare("SELECT count(*) FROM inbound_mail WHERE state='imported' AND reason='sender_approved'").first(
      'count(*)',
    ),
  ).toBe(2);
  // Their next email goes straight in.
  await deliver(mail({ id: '<a3@amazonses.com>' }, 'vendor: Third Shop'));
  expect(await receipts()).toBe(3);
  expect(await held()).toHaveLength(0);
  expect(await (await request(await signed('/review?done=mailAllowed&n=2'))).text()).toContain(
    'Allowed. Reading 2 emails.',
  );
  // Settings lists it next to the defaults, with no source badges.
  const settings = await (await request('/settings')).text();
  expect(settings).toMatch(/notifications@link\.com<\/span><\/div>/);
  expect(settings).toMatch(/owner@example\.com<\/span><\/div>/);
  expect(settings).toContain('<span class="sum">4 allowed</span>');
});

test('the approved list stops at the cap with a clear message', async () => {
  const many = Array.from({ length: MAX_ALLOWED_SENDERS }, (_, i) => `s${i}@example.com`).join(', ');
  await deliver(mail());
  const response = await post('/senders/approve', { address: 'notifications@link.com' }, {
    ...env,
    ALLOWED_SENDER_EMAILS: many,
  } as Env);
  expect(response.status).toBe(409);
  expect(await response.text()).toContain(`You already have ${MAX_ALLOWED_SENDERS} approved senders`);
  expect(await held()).toHaveLength(1);
  expect(await receipts()).toBe(0);
  expect((await post('/senders/approve', { address: 'not an address' })).status).toBe(422);
});

test('Ignore sender deletes their waiting mail and keeps none of it later', async () => {
  await deliver(mail());
  await deliver(mail({ id: '<a2@amazonses.com>' }));
  expect((await env.ORIGINALS.list()).objects.length).toBeGreaterThan(0);
  const response = await post('/senders/ignore', { address: 'notifications@link.com' });
  expect(locationOf(response)).toBe('/review?done=mailIgnored&n=2');
  expect(await held()).toHaveLength(0);
  expect((await env.ORIGINALS.list()).objects).toHaveLength(0);
  await deliver(mail({ id: '<a3@amazonses.com>' }));
  expect(await held()).toHaveLength(0);
  expect((await env.ORIGINALS.list()).objects).toHaveLength(0);
  expect(
    await env.DB.prepare("SELECT count(*) FROM inbound_mail WHERE reason='sender_ignored'").first('count(*)'),
  ).toBe(3);
  // An approved sender cannot be ignored; Stop ignoring lets mail wait again.
  expect((await post('/senders/ignore', { address: 'owner@example.com' })).status).toBe(422);
  expect(await (await request('/settings')).text()).toContain('Stop ignoring');
  await post('/senders/unignore', { address: 'notifications@link.com', back: 'settings' });
  await deliver(mail({ id: '<a4@amazonses.com>' }));
  expect(await held()).toHaveLength(1);
});

test('Delete removes one email; Remove takes a sender off the list', async () => {
  await deliver(mail());
  await deliver(mail({ id: '<a2@amazonses.com>' }, 'different body'));
  const [first] = await held();
  const response = await post('/senders/delete', { id: String(first!.id) });
  expect(locationOf(response)).toBe('/review?done=mailDeleted');
  expect(await held()).toHaveLength(1);
  expect(await env.ORIGINALS.get(String(first!.email_key))).toBeNull();
  expect((await post('/senders/delete', { id: String(first!.id) })).status).toBe(404);

  const removed = await post('/senders/remove', { address: 'sender@example.net', back: 'settings' });
  expect(locationOf(removed)).toBe('/settings?done=senderRemoved&from=settings#senders');
  const saved = await env.DB.prepare("SELECT value_json FROM settings WHERE key='ALLOWED_SENDER_EMAILS'").first<string>(
    'value_json',
  );
  expect(JSON.parse(saved!)).toBe('owner@example.com, bookkeeping@example.org');
});

async function receipt(n: number, at: string, fields: Record<string, unknown> = {}) {
  const row = await preserve(env, {
    bytes: new TextEncoder().encode(`receipt ${n}`),
    media: 'message/rfc822',
    filename: `r${n}.eml`,
    source: 'email',
  });
  const sets = Object.keys(fields)
    .map((k) => `${k}=?`)
    .join(',');
  await env.DB.prepare(`UPDATE receipts SET received_at=?${sets ? `,${sets}` : ''} WHERE id=?`)
    .bind(at, ...Object.values(fields), row.id)
    .run();
  return row.id;
}

test('Receipts lists receipts and held mail newest first, with filters and paging', async () => {
  const ready = await receipt(1, '2026-09-03T10:00:00Z', { status: 'ready', vendor: 'Coffee Shop', total_minor: 450 });
  const needs = await receipt(2, '2026-10-02T10:00:00Z', { status: 'needs_review', vendor: 'Hosting Co' });
  const sales = await receipt(3, '2026-10-05T10:00:00Z', { status: 'ready', kind: 'sales', client: 'Acme' });
  const dup = await receipt(4, '2026-10-06T10:00:00Z', { status: 'ready', duplicate_of: ready });
  await deliver(mail());
  const ids = async (query: Partial<Parameters<typeof allRows>[1]>) =>
    (await allRows(env, { show: null, month: null, q: '', offset: 0, ...query })).map((r) => r.id);
  const all = await ids({});
  expect(all.slice(1)).toEqual([dup, needs, ready]);
  expect((await allRows(env, { show: null, month: null, q: '', offset: 0 }))[0]!.type).toBe('mail');
  expect(await ids({ show: 'ready' })).toEqual([sales, ready]);
  expect(await ids({ show: 'needs' })).toEqual([needs]);
  expect(await ids({ show: 'duplicate' })).toEqual([dup]);
  expect(await ids({ show: 'sales' })).toEqual([sales]);
  expect(await ids({ show: 'reading' })).toEqual([]);
  expect(await ids({ show: 'unknown' })).toHaveLength(1);
  // The month is the document's month; undated ones count where they arrived.
  expect(await ids({ month: '2026-09' })).toEqual([ready]);
  await env.DB.prepare("UPDATE receipts SET issue_date='2026-08-30' WHERE id=?").bind(needs).run();
  expect(await ids({ month: '2026-08' })).toEqual([needs]);
  expect(await ids({ month: '2026-10' })).not.toContain(needs);
  expect(await ids({ q: 'coffee' })).toEqual([ready]);
  expect(await ids({ q: 'acme' })).toEqual([sales]);
  expect(await ids({ q: 'link.com' })).toHaveLength(1);
  expect(await ids({ q: '%' })).toEqual([]);

  const html = await (await request('/receipts')).text();
  expect(html).toContain('<h1>Receipts</h1>');
  expect(html).toContain(`href="/receipts/${needs}"`);
  expect(html).toContain('<span class="stamp needs">Needs you</span> 30 Aug');
  // Rows show the document date only; held mail is Review's, with no mail log here.
  expect(html).not.toContain('Received ');
  expect(html).not.toContain('Recent mail');
  const september = await (await request('/receipts?month=2026-09')).text();
  expect(september).toContain('<h1>September 2026</h1>');
  expect(september).toContain(`href="/receipts/${ready}"`);
  expect(september).not.toContain(`href="/receipts/${needs}"`);
  expect(html.indexOf(`/receipts/${dup}`)).toBeLessThan(html.indexOf(`/receipts/${ready}`));
  expect((await request('/receipts?month=2026-13')).status).toBe(422);

  // Paging.
  for (let i = 10; i < 10 + PAGE_SIZE; i++) await receipt(i, `2026-08-01T00:00:${String(i % 60).padStart(2, '0')}Z`);
  const first = await (await request('/receipts')).text();
  expect(first).toContain(`href="/receipts?offset=${PAGE_SIZE}"`);
  const second = await (await request(`/receipts?offset=${PAGE_SIZE}`)).text();
  expect(second).toContain('Newer');
  expect([...second.matchAll(/<li><label class="pick">.*?<\/label><a href="\/receipts\/[0-9a-f]{64}"/g)]).toHaveLength(
    4,
  );
});

test('Receipts empty states: one line and one action', async () => {
  const html = await (await request('/receipts')).text();
  expect(html).toContain('<h2>No receipts yet. Forward to <code>receipts@example.com</code>.</h2>');
  expect(await (await request('/receipts?month=2026-09')).text()).toContain('<h2>Nothing dated September.</h2>');
  const search = await (await request('/receipts?q=xyz')).text();
  expect(search).toContain(
    '<h2>Nothing matches &#8220;xyz&#8221;.</h2><a class="btn primary" href="/receipts">Clear search</a>',
  );
});
