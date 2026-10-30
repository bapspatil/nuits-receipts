import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { request } from './helpers';
import { button } from '../src/actions';

test('the import form is a file and Import, with or without a bank account', async () => {
  for (const accounts of [1, 0]) {
    if (!accounts) await env.DB.prepare('DELETE FROM accounts').run();
    const html = await (await request('/import')).text();
    expect(html).toContain('<form action="/import" method="post" enctype="multipart/form-data">');
    expect(html).toContain('type="file" name="file"');
    expect(html).toContain(button('importStmt', { tone: 'primary' }));
    expect(html).not.toContain('name="account');
  }
});

test('pages load scripts only from this origin', async () => {
  const settings = await request('/settings');
  expect(settings.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
  expect(settings.headers.get('Content-Security-Policy')).not.toContain("unsafe-inline'; script");
  for (const path of ['/', '/help', '/receipts?view=todo', '/import'])
    expect((await request(path)).headers.get('Content-Security-Policy'), path).toContain("script-src 'self';");
});

test('Settings shows where each value comes from in plain words', async () => {
  const html = await (await request('/settings')).text();
  expect(html).toContain('Built-in default');
  expect(html).toContain('Set when deployed');
  await env.DB.prepare(
    "INSERT INTO settings VALUES ('APP_NAME','\"Example\"','2026-10-22T10:00:00.000Z','owner')",
  ).run();
  expect(await (await request('/settings')).text()).toContain('Set in the app');
});

test('a refused Reset and a refused new account are shown in place on Settings', async () => {
  await env.DB.prepare(
    "INSERT INTO settings VALUES ('APP_NAME','\"Example\"','2026-10-22T10:00:00.000Z','owner')",
  ).run();
  const reset = new FormData();
  reset.set('revision', '999');
  reset.set('reset', 'APP_NAME');
  const refusedReset = await request('/settings/setup/reset', { method: 'POST', body: reset });
  expect(refusedReset.status).toBe(409);
  const resetHtml = await refusedReset.text();
  expect(resetHtml).toContain('<h1>Settings</h1>');
  expect(resetHtml).toContain('class="ferr"');
  expect(resetHtml).toContain('Nothing was saved.');

  const account = new FormData();
  account.set('label', 'holvi');
  account.set('bank_name', 'Typed bank');
  account.set('default_currency', 'EUR');
  const refused = await request('/accounts', { method: 'POST', body: account });
  expect(refused.status).toBe(409);
  const html = await refused.text();
  expect(html).toContain('<h1>Settings</h1>');
  expect(html).toContain('You already have an account with that name.');
  expect(html).toContain('value="Typed bank"');
});
