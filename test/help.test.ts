import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { setupChecklist, type SetupStep } from '../src/checklist';
import { FLAGS } from '../src/flags';
import { helpSections } from '../src/help';
import { STATUS } from '../src/status';
import { request, signed } from './helpers';

const sources: Record<string, string> = JSON.parse(env.SOURCE_FILES);
const entries = () => helpSections().flatMap((s) => s.groups.flatMap((g) => g.entries));

test('every status word and every flag has a help entry', () => {
  const terms = entries().map((e) => e.term);
  for (const [key, word] of Object.entries(STATUS)) {
    expect(terms, key).toContain(word);
    expect(
      entries().some((e) => e.ids.includes(`status-${key}`)),
      key,
    ).toBe(true);
  }
  const anchors = new Set(entries().flatMap((e) => e.ids));
  for (const [code, flag] of Object.entries(FLAGS)) {
    expect(anchors.has(`flag-${code}`), code).toBe(true);
    expect(
      entries().some((e) => e.ids.includes(`flag-${code}`) && e.term === flag.title),
      code,
    ).toBe(true);
  }
  for (const term of ['Match anyway', 'Undated', 'Changed since you sent it', 'Kind', 'Email Routing'])
    expect(terms, term).toContain(term);
});

test('every /help#anchor the app links to exists', async () => {
  const html = await (await request('/help')).text();
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const linked = new Set<string>();
  for (const text of Object.values(sources)) for (const m of text.matchAll(/\/help#([a-z-]+)/g)) linked.add(m[1]!);
  expect([...linked].sort()).toEqual(expect.arrayContaining(['kind', 'match-anyway', 'part']));
  for (const id of linked) expect(ids.has(id), id).toBe(true);
});

test('Help is a page of its own, not a tab, and is linked from the footer and Settings', async () => {
  const html = await (await request('/help')).text();
  expect(html).toContain('<title>Help ·');
  expect(html).not.toMatch(/<nav class="main"[^>]*>[\s\S]*aria-current="page"[\s\S]*<\/nav>/);
  expect(html).toContain('<a href="/help">Help</a>');
  expect(await (await request('/settings')).text()).toContain('<a href="/help">');
});

const step = (id: SetupStep['id'], done: boolean): SetupStep => ({
  id,
  done,
  action: `Do ${id}`,
  finished: `Did ${id}`,
  why: `Because ${id}.`,
  href: `/x#${id}`,
});
const IDS = ['business', 'email', 'accountant', 'bank', 'statement'] as const;

test('the checklist counts what is done, marks the first open step Next, and is gone when all five are done', () => {
  const html = setupChecklist(IDS.map((id) => step(id, id === 'business' || id === 'bank')))!;
  expect(html).toContain('2 of 5 done');
  expect(html).toContain(
    '<li class="step done"><a href="/x#business"><span class="vh">Done: </span><b>Did business</b>',
  );
  expect(html).toContain('<li class="step now"><a href="/x#email"><span class="vh">Next: </span><b>Do email</b>');
  expect(html).toContain('<li class="step todo"><a href="/x#accountant">');
  expect(html).toContain('<span>Because email.</span>');
  expect(setupChecklist(IDS.map((id) => step(id, true)))).toBeNull();
});

test('a fresh install shows the checklist with the first upload; the seeded account is not the person’s own', async () => {
  await env.DB.prepare('DELETE FROM accounts WHERE is_default=0').run();
  const html = await (await request('/')).text();
  expect(html).toContain('<h1>Welcome</h1>');
  expect(html).toMatch(/Finish setting up <span>\d of 5 done<\/span>/);
  expect(html).toContain('<b>Add your bank account</b>');
  expect(html).toContain('name="file"');
  await env.DB.prepare("UPDATE accounts SET label='Main account'").run();
  expect(await (await request('/')).text()).toContain('<b>Bank account added</b>');
});

test('with a receipt address the email step asks to confirm Email Routing; a receipt by email completes it', async () => {
  const html = await (await request('/')).text();
  expect(html).toContain('<b>Confirm Email Routing in Cloudflare</b>');
  expect(html).toContain('href="/settings?routing=1#setup-email"');
  await env.DB.prepare(
    "INSERT INTO receipts (id,original_key,filename,media_type,source,received_at,status) VALUES (?,'k','a.pdf','application/pdf','email','2026-09-01T00:00:00Z','ready')",
  )
    .bind('a'.repeat(64))
    .run();
  const after = await (await request('/')).text();
  expect(after).toContain('<b>Email Routing confirmed</b>');
});

test('Settings names the group in its banner', async () => {
  const saved = await (await request(await signed('/settings?done=settingsSaved&group=accountant'))).text();
  expect(saved).toContain('Saved your accountant.');
  const same = await (await request(await signed('/settings?done=settingsSame&group=email'))).text();
  expect(same).toContain('Nothing changed in your email settings.');
});
