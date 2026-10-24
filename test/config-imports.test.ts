import { env } from 'cloudflare:workers';
import { expect, test, vi } from 'vitest';
import Papa from 'papaparse';
import worker from '../src/index';
import type { Env } from '../src/env';
import { FOOTER_NOTICE, EXPORT_LINE } from '../src/ui';
import { confirmationForm, pdfBytes } from './helpers';

const configured: Env = {
  ...env,
  AUTH_USERNAME: 'studio-owner',
  APP_NAME: 'Synthetic Studio Books',
  SOURCE_REPOSITORY: 'https://example.com/studio-books',
  PRODUCTS_JSON: '[{"id":"studio","label":"Studio work"}]',
  DEFAULT_PRODUCT: 'studio',
  ACCOUNTANT_LABEL: 'Synthetic Accounts',
  EXPORT_PREFIX: 'studio-books',
  RECEIPT_ADDRESS: 'invoices@example.org',
};
function request(path: string, body?: FormData) {
  return worker.fetch(
    new Request('http://localhost' + path, {
      method: body ? 'POST' : 'GET',
      body,
      headers: {
        Authorization: 'Basic ' + btoa('studio-owner:local-dummy-password'),
        Origin: 'http://localhost',
      },
    }),
    configured,
  );
}
async function preview(amount = '-125.50') {
  const form = new FormData();
  form.set('account_action', 'new');
  form.set('account_label', 'Synthetic operating account');
  form.set('bank_name', 'Synthetic Bank');
  form.set('account_currency', 'EUR');
  form.set(
    'file',
    new File(
      [
        `Transaction ID;Date;Amount;Currency;Payee\nSYNTHETIC-STUDIO;2026-09-07;${amount};EUR;Sample Cloud Lantern Oy\n`,
      ],
      'synthetic.csv',
      { type: 'text/csv' },
    ),
  );
  return request('/imports/csv', form);
}
function expectBranding(html: string) {
  expect(html).toContain('Synthetic Studio Books');
  expect(html).toContain('https://example.com/studio-books/releases/tag/v');
  expect(html).toContain(FOOTER_NOTICE);
  expect(html).not.toMatch(/Check Holvi|github\.com/);
}

test('configured owner imports into a new account and retains products, notices and account export fields', async () => {
  const upload = new FormData();
  upload.set('file', new File([pdfBytes()], 'sample.pdf', { type: 'application/pdf' }));
  const receipt = await request('/upload', upload);
  expect(receipt.status).toBe(303);
  expect(await env.DB.prepare('SELECT product FROM receipts').first('product')).toBe('studio');
  const before = await env.DB.prepare('SELECT count(*) n FROM accounts').first('n');
  const response = await preview();
  expect(response.status).toBe(200);
  const html = await response.text();
  expectBranding(html);
  expect(await env.DB.prepare('SELECT count(*) n FROM accounts').first('n')).toBe(before);
  expect((await request('/imports/csv/confirm', confirmationForm(html))).status).toBe(303);
  for (const path of ['/?month=2026-09', '/payments?month=2026-09', receipt.headers.get('Location')!]) {
    const page = await request(path);
    expect(page.status).toBe(200);
    const rendered = await page.text();
    expectBranding(rendered);
    if (path.startsWith('/?')) {
      expect(rendered).toContain('<th scope="row">Studio work</th>');
      expect(rendered).toContain('<b>Send</b>');
      expect(rendered).toMatch(/Mark as sent<\/button>/);
      expect(rendered).toContain(EXPORT_LINE);
    } else {
      expect(rendered).toContain('Synthetic operating account');
    }
  }
  const csv = await request('/export.csv?month=2026-09');
  expect(csv.headers.get('Content-Disposition')).toBe('attachment; filename="studio-books-2026-09.csv"');
  expect(await csv.text()).toMatch(/matched_account_id,matched_account_name[\s\S]*Synthetic operating account/);
});

test('invalid preview and successful import with preset failure retain configured branding and notices', async () => {
  const invalid = await preview('invalid');
  expect(invalid.status).toBe(422);
  expectBranding(await invalid.text());
  const valid = await preview();
  const body = confirmationForm(await valid.text());
  body.set('preset_name', 'Synthetic saved layout');
  body.set('preset_bank', 'Synthetic Bank');
  const prepare = env.DB.prepare.bind(env.DB);
  const spy = vi.spyOn(env.DB, 'prepare').mockImplementation((sql) => {
    if (sql.startsWith('INSERT INTO bank_presets')) throw new Error('Synthetic preset failure');
    return prepare(sql);
  });
  try {
    const response = await request('/imports/csv/confirm', body);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Transactions were imported. Preset was not saved.');
    expectBranding(html);
  } finally {
    spy.mockRestore();
  }
  expect(await env.DB.prepare('SELECT status FROM imports').first('status')).toBe('complete');
});

test('configured product ids remain formula-safe in accountant exports', async () => {
  const form = new FormData();
  form.set('file', new File([pdfBytes()], 'sample.pdf', { type: 'application/pdf' }));
  const response = await worker.fetch(
    new Request('http://localhost/upload', {
      method: 'POST',
      body: form,
      headers: { Authorization: 'Basic ' + btoa('studio-owner:local-dummy-password'), Origin: 'http://localhost' },
    }),
    { ...configured, PRODUCTS_JSON: '["=1+1"]', DEFAULT_PRODUCT: '=1+1' },
  );
  expect(response.status).toBe(303);
  const csv = await (await request('/export.csv?month=2026-09')).text();
  expect(Papa.parse<{ product: string }>(csv, { header: true }).data[0]?.product).toBe("'=1+1");
});
