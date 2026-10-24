import { env } from 'cloudflare:workers';
import { createExecutionContext } from 'cloudflare:test';
import { expect, test, vi } from 'vitest';
import worker from '../src/index';
import { parseConfig, parseProducts, parseSenders } from '../src/config';
import { receiveEmail } from '../src/receipts';
import { APP_NOTICE, EXPORT_NOTICE } from '../src/ui';
import type { Env } from '../src/env';
import { uploadPdf } from './helpers';

function as(user: string, password: string, overrides: Partial<Env> = {}, path = '/', url = 'http://localhost') {
  return worker.fetch(new Request(url + path, { headers: { Authorization: 'Basic ' + btoa(`${user}:${password}`) } }), {
    ...env,
    ...overrides,
  } as Env);
}

test('defaults name no person, inbox or business', () => {
  const config = parseConfig({});
  expect(config.username).toBe('owner');
  expect([...config.allowedSenders]).toEqual([]);
  expect(config.receiptAddress).toBe('');
  expect(config.products).toEqual([{ id: 'general', label: 'General' }]);
  expect(config.defaultProduct).toBe('general');
  expect(config.accountantLabel).toBe('your accountant');
  expect(config.exportPrefix).toBe('receipts');
  expect(config.sourceRepository).toBe('');
});

test('config validation rejects bad senders, products and defaults', () => {
  expect([...parseSenders(' A@Example.com;b@example.org ')]).toEqual(['a@example.com', 'b@example.org']);
  expect(() => parseSenders('not-an-address')).toThrow(/ALLOWED_SENDER_EMAILS/);
  expect(() => parseProducts('nope', undefined)).toThrow(/PRODUCTS_JSON/);
  expect(() => parseProducts('[]', undefined)).toThrow(/PRODUCTS_JSON/);
  expect(() => parseProducts('[{"id":"a"},{"id":"a"}]', undefined)).toThrow(/duplicate/);
  expect(() => parseProducts('[{"id":""}]', undefined)).toThrow(/1 to 100/);
  expect(() => parseProducts('[{"id":"a"}]', 'b')).toThrow(/DEFAULT_PRODUCT/);
  expect(parseProducts('["Studio", {"id":"web","label":"Website"}]', 'web')).toEqual({
    products: [
      { id: 'Studio', label: 'Studio' },
      { id: 'web', label: 'Website' },
    ],
    defaultProduct: 'web',
  });
  expect(() => parseConfig({ AUTH_USERNAME: 'a:b' })).toThrow(/AUTH_USERNAME/);
  expect(() => parseConfig({ SOURCE_REPOSITORY: 'http://insecure.example' })).toThrow(/SOURCE_REPOSITORY/);
  expect(() => parseConfig({ EXPORT_PREFIX: 'bad name' })).toThrow(/EXPORT_PREFIX/);
});

test('sign-in uses the configured user name', async () => {
  expect((await as('owner', 'local-dummy-password')).status).toBe(200);
  expect((await as('owner', 'local-dummy-password', { AUTH_USERNAME: 'alex' })).status).toBe(401);
  expect((await as('alex', 'local-dummy-password', { AUTH_USERNAME: 'alex' })).status).toBe(200);
  const challenge = await as('x', 'y', { APP_NAME: 'Studio "Receipts"' });
  expect(challenge.headers.get('WWW-Authenticate')).toBe('Basic realm="Studio Receipts", charset="UTF-8"');
});

test('live mode refuses example and short passwords', async () => {
  const https = 'https://receipts.example';
  for (const password of ['local-dummy-password', 'short-password'])
    expect((await as('owner', password, { AI_MODE: 'live', NUITS_PASSWORD: password }, '/', https)).status).toBe(401);
  const strong = 'a-long-unique-password-for-tests';
  expect((await as('owner', strong, { AI_MODE: 'live', NUITS_PASSWORD: strong }, '/', https)).status).toBe(200);
});

test('invalid configuration fails closed with a clear error', async () => {
  const response = await as('owner', 'local-dummy-password', { PRODUCTS_JSON: '{' });
  expect(response.status).toBe(503);
  expect(await response.text()).toContain('PRODUCTS_JSON');
});

test('an empty sender allowlist reads no mail: authenticated mail waits as Unknown sender', async () => {
  const raw = new Response(
    'Authentication-Results: mx.cloudflare.net; spf=pass smtp.mailfrom=owner@example.com\r\nFrom: owner@example.com\r\nSubject: Receipt\r\n\r\nvendor: A',
  ).body!;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await receiveEmail(
    { from: 'owner@example.com', to: 'receipts@example.com', raw },
    { ...env, ALLOWED_SENDER_EMAILS: '' } as Env,
    createExecutionContext(),
  );
  warn.mockRestore();
  expect(await env.DB.prepare('SELECT count(*) AS n FROM receipts').first('n')).toBe(0);
  expect(await env.DB.prepare("SELECT sender FROM inbound_mail WHERE state='held'").first('sender')).toBe(
    'owner@example.com',
  );
});

test('pages show the notices, configured labels and no private links', async () => {
  const labelled = { ACCOUNTANT_LABEL: 'Example Books' };
  const html = await (await as('owner', 'local-dummy-password', labelled)).text();
  expect(html).toContain(APP_NOTICE);
  expect(html).toContain('receipts@example.com');
  expect(html).not.toMatch(/github\.com/);
  // The export and its notice live on the month page; products are listed in Settings.
  const monthHtml = await (await as('owner', 'local-dummy-password', labelled, '/month')).text();
  expect(monthHtml).toContain(APP_NOTICE);
  expect(monthHtml).toContain(EXPORT_NOTICE);
  expect(monthHtml).toContain('<h2>Send to Example Books</h2>');
  expect(monthHtml).toContain('Spreadsheet only (CSV)</a>');
  const settings = await (await as('owner', 'local-dummy-password', labelled, '/settings')).text();
  for (const label of ['General', 'App', 'Website', 'Hosting'])
    expect(settings).toContain(`name="product_label" value="${label}"`);
  expect(settings).toMatch(/<option value="general" selected>General<\/option>/);
  expect(settings).toContain('Example Books');
  const linked = await (
    await as('owner', 'local-dummy-password', { SOURCE_REPOSITORY: 'https://github.com/example/receipts/' })
  ).text();
  expect(linked).toMatch(/href="https:\/\/github\.com\/example\/receipts\/releases\/tag\/v\d+\.\d+\.\d+"/);
});

test('notices match the legal review word for word', () => {
  expect(APP_NOTICE).toBe(
    'Figures are read automatically and can be wrong. Check every row before you use it. Not tax, VAT or accounting advice. Provided as is, without warranty. You run this in your own Cloudflare account; Nuits has no access to your data.',
  );
  expect(EXPORT_NOTICE).toBe('Review flagged rows first. Your accountant decides how these are booked.');
});

test('new receipts take the configured default product and exports use the prefix', async () => {
  const configured = {
    ...env,
    PRODUCTS_JSON: '[{"id":"studio","label":"Studio"},{"id":"general"}]',
    DEFAULT_PRODUCT: 'studio',
  };
  const form = new FormData();
  const { pdfBytes } = await import('./helpers');
  form.set('file', new File([pdfBytes()], 'sample.pdf', { type: 'application/pdf' }));
  const response = await worker.fetch(
    new Request('http://localhost/upload', {
      method: 'POST',
      body: form,
      headers: { Authorization: 'Basic ' + btoa('owner:local-dummy-password'), Origin: 'http://localhost' },
    }),
    configured as Env,
  );
  expect(response.status).toBe(303);
  expect(await env.DB.prepare('SELECT product FROM receipts').first('product')).toBe('studio');
  const csv = await as('owner', 'local-dummy-password', { EXPORT_PREFIX: 'books' }, '/export.csv?month=2026-09');
  expect(csv.headers.get('Content-Disposition')).toBe('attachment; filename="books-2026-09.csv"');
});

test('rows keep products that are no longer configured and show them for review', async () => {
  await uploadPdf();
  await env.DB.prepare("UPDATE receipts SET product='retired-product'").run();
  const html = await (await as('owner', 'local-dummy-password', {}, '/month?month=2026-09')).text();
  expect(html).toContain('<th scope="row">retired-product (not configured)</th>');
  const id = (await env.DB.prepare('SELECT id FROM receipts').first<string>('id'))!;
  const page = await (await as('owner', 'local-dummy-password', {}, `/receipts/${id}`)).text();
  expect(page).toContain('<option value="retired-product" selected>retired-product (not configured)</option>');
});
