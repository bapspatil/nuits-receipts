import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { expect, test } from 'vitest';
import Papa from 'papaparse';
import { getReceipt, kindFor, preserve, processReceipt, receiveEmail } from '../src/receipts';
import { creditFit, reconcile } from '../src/banking';
import { countryIn, referenceNumber, salesReview, vatIds } from '../src/sales';
import { parseConfig, parseSellerNames } from '../src/config';
import { fileName, placement } from '../src/package';
import { hash, type Receipt } from '../src/domain';
import type { Env } from '../src/env';
import { htmlForm, pdfBytes, request } from './helpers';
import { seed, zipOf } from './package-helpers';
// Headers Cloudflare Email Routing prepends after authenticating the envelope.
const cloudflarePass = 'Authentication-Results: mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass;\r\n';

// Synthetic invoices from the owner (SELLER_NAMES "Example Studio Oy" in
// wrangler.local.jsonc). The mock reader takes the labelled lines at the end.
function invoice(lines: string[], labels: Record<string, string>): string {
  return [...lines, ...Object.entries(labels).map(([k, v]) => `${k}: ${v}`)].join('\n');
}
const REVERSE = invoice(
  [
    'INVOICE',
    'Example Studio Oy · Business ID 1234567-8 · VAT FI12345678',
    'Bill to',
    'Sample Client GmbH',
    'Hauptstrasse 1, 10115 Berlin, Germany',
    'VAT ID DE 123 456 789',
    'Reverse charge, Article 196 VAT Directive',
    'Reference RF18 5390 0754 7034',
  ],
  {
    vendor: 'Example Studio Oy',
    client: 'Sample Client GmbH',
    client_vat_id: 'DE123456789',
    invoice_number: '2026-014',
    issue_date: '2026-09-03',
    due_date: '2026-09-17',
    currency: 'EUR',
    total: '1500.00',
    net: '1500.00',
    vat_amount: '0.00',
    vat_rate: '0',
  },
);
const DOMESTIC = invoice(
  ['LASKU', 'Example Studio Oy', 'Y-tunnus 1234567-8', 'Laskutetaan', 'Esimerkki Asiakas Oy', 'Viitenumero 1232'],
  {
    vendor: 'Example Studio Oy',
    client: 'Esimerkki Asiakas Oy',
    invoice_number: '2026-015',
    issue_date: '2026-09-10',
    currency: 'EUR',
    total: '1255.00',
    net: '1000.00',
    vat_amount: '255.00',
    vat_rate: '25.5',
  },
);
// A bill the owner received, sent to the invoices address by mistake.
const BILL = invoice(['INVOICE', 'Sample Cloud Lantern Oy', 'Bill to', 'Example Studio Oy', 'Somewhere 1, Helsinki'], {
  vendor: 'Sample Cloud Lantern Oy',
  client: 'Example Studio Oy',
  invoice_number: 'SCL-9',
  issue_date: '2026-09-05',
  currency: 'EUR',
  total: '12.55',
  net: '10.00',
  vat_amount: '2.55',
  vat_rate: '25.5',
});

async function sales(text: string, filename = 'invoice.txt'): Promise<Receipt> {
  const row = await preserve(env, {
    bytes: new TextEncoder().encode(text),
    media: 'text/plain',
    filename,
    source: 'upload',
    kind: 'sales',
  });
  await processReceipt(env, row.id);
  return getReceipt(env, row.id);
}
async function credit(id: string, date: string, minor: number, merchant: string, reference: string | null = null) {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO imports (id,account_key,original_key,status,row_count,imported_at,snapshot_json) VALUES ('synthetic-import','holvi','imports/synthetic','complete',1,'2026-10-21T00:00:00Z','{}')",
    ),
    env.DB.prepare(
      "INSERT INTO bank_transactions (id,account_key,import_id,booking_date,amount_minor,currency,merchant,reference,raw_json) VALUES (?,'holvi','synthetic-import',?,?,'EUR',?,?,'{}')",
    ).bind(await hash(id), date, minor, merchant, reference),
  ]);
  return hash(id);
}

test('VAT numbers, countries and payment references are read from invoice lines', () => {
  expect(vatIds('VAT FI12345678').map((v) => v.id)).toEqual(['FI12345678']);
  expect(vatIds('VAT ID DE 123 456 789').map((v) => v.id)).toEqual(['DE123456789']);
  expect(vatIds('BTW NL123456789B01').map((v) => v.id)).toEqual(['NL123456789B01']);
  expect(vatIds('Phone +358 40 123 4567')).toEqual([]);
  expect(countryIn('Hauptstrasse 1, 10115 Berlin, Germany')).toBe('DE');
  expect(referenceNumber('Viitenumero 1232')).toBe('1232');
  expect(referenceNumber('Reference RF18 5390 0754 7034')).toBe('RF18539007547034');
  expect(
    salesReview(
      { vat_minor: 0, vat_rate_bps: 0 },
      { client: null, client_country: null, client_vat_id: null, vat_treatment: null, reference_number: null },
    ),
  ).toEqual(expect.arrayContaining(['missing_client', 'vat_treatment_unknown']));
});

test('INVOICES_ADDRESS and SELLER_NAMES are validated', () => {
  expect(parseSellerNames('Example Studio, Jane Doe')).toEqual(['Example Studio', 'Jane Doe']);
  expect(parseSellerNames('')).toEqual([]);
  expect(() => parseSellerNames(Array.from({ length: 21 }, (_, i) => `n${i}`).join(','))).toThrow(/SELLER_NAMES/);
  expect(
    parseConfig({ RECEIPT_ADDRESS: 'r@example.com', INVOICES_ADDRESS: 'Invoices@Example.com' }).invoicesAddress,
  ).toBe('invoices@example.com');
  expect(() => parseConfig({ RECEIPT_ADDRESS: 'r@example.com', INVOICES_ADDRESS: 'R@example.com' })).toThrow(
    /INVOICES_ADDRESS/,
  );
  expect(() => parseConfig({ INVOICES_ADDRESS: 'not an address' })).toThrow(/INVOICES_ADDRESS/);
  expect(kindFor(env, 'Invoices@Example.com')).toBe('sales');
  expect(kindFor(env, 'receipts@example.com')).toBe('expense');
  expect(kindFor({ ...env, INVOICES_ADDRESS: '' } as Env, 'invoices@example.com')).toBe('expense');
});

test('an EU reverse-charge invoice is read with client, VAT number, treatment and reference', async () => {
  const r = await sales(REVERSE);
  expect(r).toMatchObject({
    kind: 'sales',
    status: 'ready',
    vendor: 'Example Studio Oy',
    client: 'Sample Client GmbH',
    client_vat_id: 'DE123456789',
    client_country: 'DE',
    vat_treatment: 'reverse_charge',
    reference_number: 'RF18539007547034',
    total_minor: 150000,
    expense_type: 'other',
  });
  expect(JSON.parse(r.review_reasons_json)).toEqual([]);
  const d = await sales(DOMESTIC, 'lasku.txt');
  expect(JSON.parse(d.review_reasons_json)).toEqual([]);
  expect(d).toMatchObject({ status: 'ready', vat_treatment: 'domestic', client: 'Esimerkki Asiakas Oy' });
});

test('a bill sent to the invoices address is flagged and can be moved to receipts', async () => {
  const r = await sales(BILL, 'bill.txt');
  expect(r.status).toBe('needs_review');
  expect(JSON.parse(r.review_reasons_json)).toContain('seller_mismatch');
  const page = await (await request(`/receipts/${r.id}`)).text();
  expect(page).toContain('look like an invoice you sent.');
  expect(page).toContain('formaction="/receipts/' + r.id + '/kind"');
  const form = new FormData();
  form.set('kind', 'expense');
  form.set('revision', String(r.revision));
  const moved = await request(`/receipts/${r.id}/kind`, { method: 'POST', body: form });
  expect(moved.status).toBe(303);
  const after = await getReceipt(env, r.id);
  expect(after.kind).toBe('expense');
  expect(after.client).toBeNull();
  expect(JSON.parse(after.review_reasons_json)).not.toContain('seller_mismatch');
  // A stale revision is refused.
  const stale = await request(`/receipts/${r.id}/kind`, { method: 'POST', body: form });
  expect(stale.status).toBe(409);
});

test('reverse charge without the client VAT number is flagged and fixed on the invoice page', async () => {
  const text = REVERSE.replace('VAT ID DE 123 456 789\n', '').replace('client_vat_id: DE123456789\n', '');
  const r = await sales(text, 'novat.txt');
  expect(JSON.parse(r.review_reasons_json)).toContain('reverse_charge_without_vat_id');
  const html = await (await request(`/receipts/${r.id}`)).text();
  expect(html).toContain('Reverse charge needs the client');
  const body = htmlForm(html, `/receipts/${r.id}`);
  body.set('client_vat_id', 'de 123.456.789');
  body.set('action', 'approve');
  expect((await request(`/receipts/${r.id}`, { method: 'POST', body })).status).toBe(303);
  const fixed = await getReceipt(env, r.id);
  expect(fixed).toMatchObject({ status: 'ready', client_vat_id: 'DE123456789' });
});

test('mail to the invoices address is filed as a sales invoice; no attachment is held for review', async () => {
  const context = createExecutionContext();
  const raw = [
    'From: owner@example.com',
    'To: invoices@example.com',
    'Subject: Invoice 2026-014',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary=sample',
    '',
    '--sample',
    'Content-Type: text/plain',
    '',
    'Here is the invoice',
    '--sample',
    'Content-Type: application/pdf',
    'Content-Disposition: attachment; filename="invoice.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    env.SAMPLE_PDF,
    '--sample--',
    '',
  ].join('\r\n');
  await receiveEmail(
    { from: 'owner@example.com', to: 'invoices@example.com', raw: new Response(cloudflarePass + raw).body! },
    env,
    context,
  );
  await waitOnExecutionContext(context);
  const row = await getReceipt(env, await hash(pdfBytes()));
  expect(row.kind).toBe('sales');
  const plain = createExecutionContext();
  await receiveEmail(
    {
      from: 'owner@example.com',
      to: 'invoices@example.com',
      raw: new Response(
        cloudflarePass + 'MIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\nInvoice attached (forgot it)',
      ).body!,
    },
    env,
    plain,
  );
  await waitOnExecutionContext(plain);
  const held = await env.DB.prepare("SELECT * FROM receipts WHERE kind='sales' AND id<>?")
    .bind(row.id)
    .first<Receipt>();
  expect(held?.status).toBe('needs_review');
  expect(JSON.parse(held!.review_reasons_json)).toContain('invoice_no_attachment');
});

test('uploads take several files and a kind; the Add page loads its script under a strict CSP', async () => {
  const add = await request('/add?kind=sales');
  expect(add.status).toBe(200);
  expect(add.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
  const html = await add.text();
  expect(html).toContain('<script src="/assets/add.js" defer></script>');
  expect(html).toMatch(/value="sales" checked/);
  const js = await request('/assets/add.js');
  expect(js.headers.get('Content-Type')).toContain('text/javascript');
  // Other pages still allow no script at all.
  expect((await request('/')).headers.get('Content-Security-Policy')).not.toContain('script-src');
  const form = new FormData();
  form.set('kind', 'sales');
  form.append('file', new File([pdfBytes()], 'a.pdf', { type: 'application/pdf' }));
  form.append('file', new File([new Uint8Array([1, 2, 3])], 'b.pdf', { type: 'application/pdf' }));
  const many = await request('/upload', { method: 'POST', body: form });
  expect(many.status).toBe(303);
  expect(many.headers.get('Location')).toBe('/add?kind=sales&added=1&failed=1');
  expect((await getReceipt(env, await hash(pdfBytes()))).kind).toBe('sales');
  const one = new FormData();
  one.set('file', new File([new Uint8Array([1, 2, 3])], 'c.pdf', { type: 'application/pdf' }));
  const json = await request('/upload', { method: 'POST', body: one, headers: { Accept: 'application/json' } });
  expect(json.status).toBe(422);
  expect(await json.json()).toMatchObject({ error: expect.any(String) });
  const tooMany = new FormData();
  for (let i = 0; i < 11; i++) tooMany.append('file', new File([pdfBytes()], `${i}.pdf`, { type: 'application/pdf' }));
  expect((await request('/upload', { method: 'POST', body: tooMany })).status).toBe(422);
});

test('money in is matched to a sales invoice by amount and reference, never to a receipt', async () => {
  const r = await sales(REVERSE);
  const other = await sales(DOMESTIC, 'lasku.txt');
  const paid = await credit('c1', '2026-09-20', 150000, 'SAMPLE CLIENT GMBH', 'RF18539007547034');
  // Same amount, no reference or name: only a suggestion.
  const loose = await credit('c2', '2026-09-21', 125500, 'Someone Else');
  // A receipt for the same amount never takes a credit.
  await seed({
    vendor: 'Sample Client GmbH',
    total_minor: 150000,
    net_minor: 150000,
    vat_minor: 0,
    issue_date: '2026-09-02',
  });
  await reconcile(env);
  const t = (id: string) =>
    env.DB.prepare('SELECT receipt_id,match_method FROM bank_transactions WHERE id=?').bind(id).first<{
      receipt_id: string | null;
      match_method: string | null;
    }>();
  expect(await t(paid)).toEqual({ receipt_id: r.id, match_method: 'automatic' });
  expect((await t(loose))!.receipt_id).toBeNull();
  const tx = await env.DB.prepare('SELECT * FROM bank_transactions WHERE id=?').bind(loose).first();
  expect(creditFit(other, tx as never)).toBe('suggested');
  // A client name with no Latin letters normalizes to '' and must not match every payer.
  expect(creditFit({ ...other, client: 'Клиент', reference_number: null, invoice_number: null }, tx as never)).toBe(
    'suggested',
  );
  const page = await (await request(`/receipts/${other.id}`)).text();
  expect(page).toContain('Is this the payment?');
  // Linking money in to an expense receipt is refused.
  const receipt = await env.DB.prepare("SELECT id FROM receipts WHERE kind='expense'").first<string>('id');
  const wrong = new FormData();
  wrong.set('transaction_id', loose);
  wrong.set('receipt_id', receipt!);
  wrong.set('action', 'link');
  wrong.set('confirm_exception', 'yes');
  expect((await request('/matches', { method: 'POST', body: wrong })).status).toBe(422);
  const body = htmlForm(page, '/matches');
  body.set('action', 'link');
  const linked = await request('/matches', { method: 'POST', body });
  expect(linked.status, await linked.clone().text()).toBe(303);
  expect(linked.headers.get('Location')).toBe(`/receipts/${other.id}`);
  expect((await t(loose))!.receipt_id).toBe(other.id);
  const list = await (await request('/invoices?month=2026-09')).text();
  expect(list).toContain('Sample Client GmbH');
  expect(list.match(/stamp matched">Paid/g)).toHaveLength(2);
  // Money in on Payments links to the invoice.
  expect(await (await request('/payments?month=2026-09')).text()).toContain('View invoice');
});

test('overdue and paid outside the bank', async () => {
  const r = await sales(DOMESTIC, 'lasku.txt');
  const home = await (await request('/?month=2026-09')).text();
  expect(home).toContain(
    '<strong>1 invoice is overdue.</strong> <a href="/invoices?month=2026-09&show=overdue">See it</a>',
  );
  expect(await (await request('/invoices?month=2026-10&show=overdue')).text()).toContain('Esimerkki Asiakas Oy');
  const form = new FormData();
  form.set('paid_outside_on', '2026-09-30');
  form.set('paid_outside_note', 'Stripe payout');
  expect((await request(`/receipts/${r.id}/paid`, { method: 'POST', body: form })).status).toBe(303);
  expect(await getReceipt(env, r.id)).toMatchObject({
    paid_outside_on: '2026-09-30',
    paid_outside_note: 'Stripe payout',
  });
  expect(await (await request('/?month=2026-09')).text()).not.toMatch(/invoice is overdue/);
  const noNote = new FormData();
  noNote.set('paid_outside_on', '2026-09-30');
  expect((await request(`/receipts/${r.id}/paid`, { method: 'POST', body: noNote })).status).toBe(422);
  const expense = await seed({ issue_date: '2026-09-02' });
  expect((await request(`/receipts/${expense.id}/paid`, { method: 'POST', body: form })).status).toBe(422);
});

test('the month package puts checked invoices in sales/ with their own index; a flagged one blocks the month', async () => {
  const receipt = await seed({ vendor: 'Hetzner Online GmbH', issue_date: '2026-09-02' });
  const r = await sales(REVERSE);
  expect(fileName(r)).toBe(`2026-09-03_2026-014_Sample-Client-GmbH_EUR-1500.00_${r.id.slice(0, 6)}.txt`);
  expect(placement(r, { anyway: false, undated: false })).toBe('sales');
  const { entries } = await zipOf('/month/package.zip?month=2026-09');
  const names = entries.map((e) => e.name);
  expect(names).toContain('receipts-2026-09/00-sales-index-2026-09.csv');
  expect(names).toContain(`receipts-2026-09/sales/${fileName(r)}`);
  const index = Papa.parse<Record<string, string>>(
    new TextDecoder().decode(entries.find((e) => e.name.endsWith('00-index-2026-09.csv'))!.data).replace(/^﻿/, ''),
    { header: true },
  );
  expect(index.data.map((row) => row.original_id)).toEqual([receipt.id]);
  const salesIndex = Papa.parse<Record<string, string>>(
    new TextDecoder()
      .decode(entries.find((e) => e.name.endsWith('00-sales-index-2026-09.csv'))!.data)
      .replace(/^﻿/, ''),
    { header: true },
  );
  expect(salesIndex.data[0]).toMatchObject({
    client: 'Sample Client GmbH',
    vat_treatment: 'reverse_charge',
    folder: 'sales',
  });
  // Unpaid doesn't hold the month back...
  let month = await (await request('/?month=2026-09')).text();
  expect(month).toContain('Money in: invoices dated September');
  expect(month).not.toContain('need you</span>');
  // ...an invoice that needs a look does.
  const flagged = await sales(
    REVERSE.replace('Sample Client GmbH', 'Other Client AG')
      .replace('client: Sample Client GmbH', 'client: Other Client AG')
      .replace('2026-014', '2026-099')
      .replace('VAT ID DE 123 456 789\n', '')
      .replace('client_vat_id: DE123456789\n', ''),
    'flagged.txt',
  );
  expect(flagged.status).toBe('needs_review');
  month = await (await request('/?month=2026-09')).text();
  expect(month).toContain('1 need you</span>');
  expect(month).toContain(`/receipts/${flagged.id}`);
  const csv = await request('/export-sales.csv?month=2026-09');
  expect(csv.headers.get('Content-Disposition')).toContain('receipts-sales-2026-09.csv');
  expect((await csv.text()).split('\n').length).toBeGreaterThan(2);
});
