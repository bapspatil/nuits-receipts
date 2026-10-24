import { expect, test } from 'vitest';
import { NAV, PAGES } from '../src/ui';
import { request } from './helpers';

test('every page names a real nav section and carries its label as the title', () => {
  for (const [key, page] of Object.entries(PAGES)) {
    if (!('nav' in page)) continue;
    const tab = NAV.find((t) => t.key === page.nav);
    expect(tab, key).toBeTruthy();
    expect(page.title, key).toBe(tab!.label);
  }
});

test.each([
  ['/', 'Home', 'Home'],
  ['/review', 'Review', 'Review'],
  ['/receipts', 'Receipts', 'Receipts'],
  ['/invoices?month=2026-09', 'Receipts', 'Receipts · Invoices · September 2026'],
  ['/add', 'Receipts', 'Receipts · Add'],
  ['/payments?month=2026-09', 'Bank', 'Bank · September 2026'],
  ['/import', 'Bank', 'Bank · Import a bank statement'],
  ['/settings', 'Settings', 'Settings'],
])('%s highlights %s and is titled for it', async (path, tab, title) => {
  const html = await (await request(path)).text();
  expect(html).toContain(`<title>${title} ·`);
  const current = [...html.matchAll(/<nav class="main"[\s\S]*?<\/nav>/g)][0]![0];
  expect(current.match(/aria-current="page"[^>]*>([A-Za-z]+)/)![1]).toBe(tab);
});
