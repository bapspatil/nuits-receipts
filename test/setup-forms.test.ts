import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { request } from './helpers';

test('with no bank account the import form creates one instead of preselecting an empty choice', async () => {
  const withAccount = await (await request('/import')).text();
  expect(withAccount).toContain('The account chosen here');
  await env.DB.prepare('DELETE FROM accounts').run();
  const html = await (await request('/import')).text();
  expect(html).not.toContain('The account chosen here');
  expect(html).toContain('<input type="hidden" name="account_action" value="new">');
  expect(html).toContain('<legend>Your bank account</legend>');
  expect(html).toMatch(/name="account_label"[^>]*required/);
});

test('Settings loads its own script under a policy that allows only same-origin scripts', async () => {
  const settings = await request('/settings');
  expect(settings.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
  expect(settings.headers.get('Content-Security-Policy')).not.toContain("unsafe-inline'; script");
  expect(await settings.text()).toContain('<script src="/assets/settings.js" defer></script>');
  const script = await request('/assets/settings.js');
  expect(script.headers.get('Content-Type')).toContain('text/javascript');
  expect(await script.text()).toContain('beforeunload');
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
