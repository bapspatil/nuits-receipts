import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { droppedMail, hasRecentDropped, MAIL_REASONS, reasonWords } from '../src/inbound';
import { locationOf, request, signed } from './helpers';

const sources: Record<string, string> = JSON.parse(env.SOURCE_FILES);

test('every reason the code logs has words', () => {
  const found = new Set<string>();
  const skip = new Set(['imported', 'held', 'ignored', 'dropped', 'unknown', 'fail', 'pass']);
  for (const file of ['inbound.ts', 'receipts.ts']) {
    const text = sources[file] ?? '';
    expect(text.length, file).toBeGreaterThan(0);
    for (const m of text.matchAll(/(?:logMail|discard)\([^;]*;/g))
      for (const t of m[0].matchAll(/'([a-z_]+)'/g)) if (!skip.has(t[1]!)) found.add(t[1]!);
    for (const m of text.matchAll(/reason='(\w+)'/g)) found.add(m[1]!);
    for (const m of text.matchAll(/'held','(\w+)'/g)) found.add(m[1]!);
    for (const m of text.matchAll(/const reason = [^;]*;/g))
      for (const t of m[0].matchAll(/'([a-z_]+)'/g)) found.add(t[1]!);
  }
  for (const word of skip) found.delete(word);
  expect(found.size).toBeGreaterThan(5);
  for (const reason of found) expect(Object.keys(MAIL_REASONS), reason).toContain(reason);
  for (const reason of Object.keys(MAIL_REASONS)) expect(reasonWords(reason).length, reason).toBeGreaterThan(3);
});

const log = (sender: string, state: string, reason: string, at = new Date().toISOString(), subject = 'Hello') =>
  env.DB.prepare('INSERT INTO inbound_mail (id,received_at,sender,subject,state,reason) VALUES (?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), at, sender, subject, state, reason)
    .run();

test('Settings says so when nothing was dropped', async () => {
  const html = await (await request('/settings')).text();
  expect(html).toContain('Every email that reached the app was kept.');
  expect(await hasRecentDropped(env)).toBe(false);
});

test('Settings lists dropped mail newest first with words, and offers Allow only where it fits', async () => {
  await log('shop@elsewhere.example', 'ignored', 'sender_ignored', '2026-09-01T10:00:00.000Z', 'Older <b>one</b>');
  await log('spoof@bank.example', 'dropped', 'sender_auth_failed', '2026-09-02T10:00:00.000Z');
  await log('kept@example.org', 'imported', 'allowed', '2026-09-03T10:00:00.000Z');
  const rows = await droppedMail(env);
  expect(rows.map((r) => r.sender)).toEqual(['spoof@bank.example', 'shop@elsewhere.example']);
  const html = await (await request('/settings')).text();
  expect(html).toContain("Mail we didn't keep");
  expect(html).toContain('Older &lt;b&gt;one&lt;/b&gt;');
  expect(html).toContain('Sender not allowed: you chose to ignore them.');
  expect(html).toContain('Failed the sender check');
  expect(html).not.toContain('kept@example.org');
  expect(html).toContain('aria-label="Allow shop@elsewhere.example"');
  expect(html).not.toContain('aria-label="Allow spoof@bank.example"');
});

test('Allow this sender names them in a signed banner with Undo, and the Bank link follows recent mail', async () => {
  await log('shop@elsewhere.example', 'ignored', 'sender_ignored');
  const form = new FormData();
  form.set('address', 'shop@elsewhere.example');
  form.set('back', 'mail');
  const response = await request('/senders/approve', { method: 'POST', body: form });
  expect(response.status).toBe(303);
  const where = locationOf(response);
  expect(where).toBe('/settings?done=senderAllowed&sender=shop%40elsewhere.example&n=0#mail');
  const banner = await (
    await request(await signed('/settings?done=senderAllowed&sender=shop%40elsewhere.example&n=0'))
  ).text();
  expect(banner).toContain('Allowed shop@elsewhere.example. Their next emails will be read.');
  expect(banner).toContain('action="/senders/remove"');
  expect(banner).toMatch(
    /<details class="sect" open><summary><h2>Email senders<\/h2>[\s\S]*<h3 id="mail">Mail we didn't keep/,
  );
  expect((await droppedMail(env)).length).toBe(1);
});

test('an old log entry does not count as recent', async () => {
  await log('old@elsewhere.example', 'dropped', 'duplicate', new Date(Date.now() - 90 * 86400000).toISOString());
  expect(await hasRecentDropped(env)).toBe(false);
  await log('new@elsewhere.example', 'dropped', 'duplicate');
  expect(await hasRecentDropped(env)).toBe(true);
});
