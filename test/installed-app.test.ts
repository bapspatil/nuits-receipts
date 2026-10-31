import { expect, test } from 'vitest';
import { seed } from './package-helpers';
import { request } from './helpers';

// The installed app has no browser back and no address bar, so a screen without a tab names its
// way out, and a file is a plain same-origin link that says it is a download.
const crumb = (html: string) => html.match(/<div class="crumbs"><a href="([^"]+)">‹ ([^<]+)<\/a>/)?.slice(1);

test('screens that are not a tab have a way back to their list or to Home', async () => {
  expect(crumb(await (await request('/help')).text())).toEqual(['/', 'Home']);
  expect(crumb(await (await request('/import')).text())).toEqual(['/payments', 'Bank']);
  expect(crumb(await (await request('/add')).text())).toEqual(['/receipts?view=todo', 'Receipts']);
  expect(crumb(await (await request('/add?kind=sales')).text())).toEqual([
    '/receipts?view=all&amp;kind=sales',
    'Invoices',
  ]);
  // The receipt page already has its crumb; the tabs are their own way out.
  const row = await seed({ status: 'ready' });
  expect(crumb(await (await request(`/receipts/${row.id}`)).text())?.[1]).toMatch(/Home|To do/);
});

test('the question and the import preview go back to Bank', async () => {
  const csv = 'Date;Amount;Payee\n2026-09-07;-9,00;Somewhere\n';
  const body = new FormData();
  body.set('csv', btoa(csv));
  body.set('account', 'gone');
  const refused = await request('/import', { method: 'POST', body });
  expect(crumb(await refused.text())).toEqual(['/payments', 'Bank']);
});

test('a month closes with files that are downloads, not pages', async () => {
  await seed({ status: 'needs_review', review_reasons_json: '["missing_total"]', issue_date: '2026-10-05' });
  const home = await (await request('/?month=2026-10')).text();
  // The ready ZIP link is asserted in package.test; here the CSV, which every state offers.
  expect(home).toMatch(/<a class="[^"]*" href="\/export\.csv\?month=2026-10" download>/);
  await seed({ kind: 'sales', client: 'Sample Client', status: 'ready', issue_date: '2026-10-06' });
  const sales = await (await request('/receipts?view=all&kind=sales&month=2026-10')).text();
  expect(sales).toMatch(/<a class="[^"]*" href="\/export-sales\.csv\?month=2026-10" download>/);
});

test('a failed OneDrive sign-in comes back to Settings, since Microsoft leaves no page to go back to', async () => {
  const failed = await request('/settings/onedrive/callback?error=access_denied', {
    headers: { Referer: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize' },
  });
  const html = await failed.text();
  expect(failed.status).toBeGreaterThanOrEqual(400);
  expect(html).toContain('href="/settings#onedrive"');
});
