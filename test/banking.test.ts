import { env } from 'cloudflare:workers';
import { expect, test, vi } from 'vitest';
import {
  cacheFx,
  collisions,
  eligible,
  eurValue,
  importBankCsv,
  importIdentity,
  parsePreset,
  reconcile,
  type Transaction,
} from '../src/banking';
import { hash, type Receipt } from '../src/domain';
import { getReceipt } from '../src/receipts';
import { request, uploadPdf, confirmationForm, idFrom } from './helpers';

const csv =
  'Transaction ID;Booking date;Amount;Currency;Payee;Reference\na;2026-09-07;-125,50;EUR;Sample Cloud Lantern Oy;SAMPLE-1001\nb;2026-09-08;-9,99;EUR;Sample Missing;missing\n';
async function importCsv(text = csv, collision = '') {
  const bytes = new TextEncoder().encode(text),
    parsed = parsePreset(text, 'holvi', 'EUR');
  return importBankCsv(env, { bytes, parsed, collision });
}
async function receipt(): Promise<Receipt> {
  const response = await uploadPdf();
  return getReceipt(env, idFrom(response));
}
async function seedForeign(): Promise<Receipt> {
  const row = await receipt();
  await env.DB.prepare(
    "UPDATE receipts SET vendor='Sample Foreign',currency='USD',total_minor=2000,net_minor=2000,vat_minor=0,vat_rate_bps=0,issue_date='2026-09-05' WHERE id=?",
  )
    .bind(row.id)
    .run();
  return getReceipt(env, row.id);
}
test('confirmed import and reimport match one receipt and show one missing payment without changing costs', async () => {
  const row = await receipt();
  await importCsv();
  await importCsv();
  expect(await env.DB.prepare('SELECT count(*) AS n FROM bank_transactions').first('n')).toBe(2);
  expect((await eurValue(env, row)).source).toBe('bank');
  const view = await (await request('/payments?month=2026-09&show=all')).text();
  expect(view).toContain(
    `<span class="tag ok">Matched automatically</span> <a class="tag" href="/receipts/${row.id}">Receipt</a>`,
  );
  expect(view).toContain('<span class="stamp missing">Missing</span>');
  // Bank opens on what is missing.
  expect(await (await request('/payments?month=2026-09')).text()).not.toContain(`href="/receipts/${row.id}"`);
  const monthly = await (await request('/?month=2026-09')).text();
  expect(monthly).toContain('125.50');
  const exported = await (await request('/export.csv?month=2026-09')).text();
  expect(exported).toContain(',bank,');
});
test('overlapping files with IDs remain idempotent and conflicting bank facts are rejected', async () => {
  await importCsv();
  await importCsv(csv + 'c;2026-09-09;-4,00;EUR;Sample Other;other\n');
  expect(await env.DB.prepare('SELECT count(*) AS n FROM bank_transactions').first('n')).toBe(3);
  await expect(importCsv(csv.replace('-125,50', '-120,50'))).rejects.toThrow('the same ID');
});
test('fallback overlap requires a decision; identical distinct rows remain visible', async () => {
  const text = 'Date;Amount;Payee\n2026-09-01;-10,00;Sample\n2026-09-01;-10,00;Sample\n';
  await importCsv(text);
  const other = text.replaceAll('-10,00', '-10.00');
  const parsed = parsePreset(other, 'holvi', 'EUR'),
    bytes = new TextEncoder().encode(other),
    identity = await importIdentity('holvi', bytes);
  expect(await collisions(env, parsed, identity.id)).toHaveLength(2);
  await expect(importBankCsv(env, { bytes, parsed, collision: '' })).rejects.toThrow(
    'look like ones you already imported',
  );
  await importBankCsv(env, { bytes, parsed, collision: 'additional' });
  await importBankCsv(env, { bytes, parsed, collision: 'additional' });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM bank_transactions').first('n')).toBe(4);
});
test('interrupted import replays safely and pending transactions never reconcile', async () => {
  await receipt();
  const prepare = env.DB.prepare.bind(env.DB);
  const spy = vi.spyOn(env.DB, 'prepare').mockImplementation((sql) => {
    if (sql.startsWith("UPDATE imports SET status='complete'")) throw new Error('interrupted');
    return prepare(sql);
  });
  await expect(importCsv()).rejects.toThrow('interrupted');
  spy.mockRestore();
  expect(await env.DB.prepare('SELECT status FROM imports').first('status')).toBe('pending');
  await reconcile(env);
  expect(
    await env.DB.prepare('SELECT count(*) AS n FROM bank_transactions WHERE receipt_id IS NOT NULL').first('n'),
  ).toBe(0);
  await importCsv();
  expect(await env.DB.prepare('SELECT count(*) AS n FROM bank_transactions').first('n')).toBe(2);
  expect(
    await env.DB.prepare('SELECT count(*) AS n FROM bank_transactions WHERE receipt_id IS NOT NULL').first('n'),
  ).toBe(1);
});
test('ambiguous recurring payments stay unlinked and exemptions remove missing warnings', async () => {
  await receipt();
  await importCsv(
    csv.replace(
      'b;2026-09-08;-9,99;EUR;Sample Missing;missing',
      'b;2026-09-08;-125,50;EUR;Sample Cloud Lantern Oy;recurring',
    ),
  );
  expect(
    await env.DB.prepare('SELECT count(*) AS n FROM bank_transactions WHERE receipt_id IS NOT NULL').first('n'),
  ).toBe(0);
  const id = await hash('holvi:id:a');
  const body = new URLSearchParams({ receipt_required: '0' });
  expect((await request('/payments/' + id, { method: 'POST', body })).status).toBe(303);
  expect(
    await env.DB.prepare('SELECT receipt_required FROM bank_transactions WHERE id=?')
      .bind(id)
      .first('receipt_required'),
  ).toBe(0);
});
test('foreign original amount auto-matches; approximate EUR only suggests until confirmed', async () => {
  const row = await seedForeign();
  await cacheFx(env, row);
  const updated = await getReceipt(env, row.id);
  const foreign =
    'Transaction ID;Date;Amount;Currency;Payee;Original amount;Original currency\nf;2026-09-07;-18,42;EUR;Sample Foreign;-20,00;USD\n';
  await importCsv(foreign);
  expect((await eurValue(env, updated)).minor).toBe(1842);
  expect((await eurValue(env, updated)).source).toBe('bank');
  await env.DB.prepare('DELETE FROM bank_transactions').run();
  await importCsv('Transaction ID;Date;Amount;Currency;Payee\ng;2026-09-07;-18,42;EUR;Sample Foreign\n');
  const transaction = await env.DB.prepare('SELECT * FROM bank_transactions').first<Transaction>();
  expect(transaction?.receipt_id).toBeNull();
  expect(eligible(updated, transaction!, [], true)).toBe(true);
  expect(eligible(updated, transaction!, [])).toBe(false);
  const form = new URLSearchParams({
    transaction_id: transaction!.id,
    receipt_id: row.id,
    action: 'link',
  });
  expect((await request('/matches', { method: 'POST', body: form })).status).toBe(422);
  form.set('confirm_exception', 'yes');
  expect((await request('/matches', { method: 'POST', body: form })).status).toBe(303);
  expect((await eurValue(env, await getReceipt(env, row.id))).minor).toBe(1842);
});
test('weekend FX uses the preceding date, outage stays null, and GET never fetches FX', async () => {
  const row = await seedForeign();
  await cacheFx(env, row);
  const updated = await getReceipt(env, row.id),
    eur = await eurValue(env, updated);
  expect(eur.minor).toBe(1800);
  expect(eur.rateDate).toBe('2026-09-04');
  await env.DB.prepare("UPDATE receipts SET currency='GBP',fx_eur_minor=NULL,fx_requested_date=NULL WHERE id=?")
    .bind(row.id)
    .run();
  await cacheFx({ ...env, AI_MODE: 'live' }, await getReceipt(env, row.id));
  expect((await eurValue(env, await getReceipt(env, row.id))).minor).toBeNull();
  const fetchSpy = vi.mocked(fetch);
  fetchSpy.mockClear();
  await request('/?month=2026-09');
  await request('/export.csv?month=2026-09');
  expect(fetchSpy).not.toHaveBeenCalled();
});
test('bank aliases allow a vendor-specific processor name without accepting generic processors', async () => {
  const row = await receipt();
  await importCsv(csv.replace('Sample Cloud Lantern Oy', 'STRIPE'));
  expect((await eurValue(env, row)).source).toBe('native');
  await env.DB.prepare(
    "INSERT INTO vendor_rules(vendor_contains,bank_alias,product,expense_type) VALUES ('Sample Cloud Lantern','STRIPE','general','other')",
  ).run();
  await reconcile(env);
  expect((await eurValue(env, row)).source).toBe('bank');
});
test('CSV HTTP preview validates everything before confirmation', async () => {
  const preview = new FormData();
  preview.set('file', new File([csv], 'sample.csv', { type: 'text/csv' }));
  preview.set('account', 'holvi');
  preview.set('account_currency', 'EUR');
  const response = await request('/imports/csv', {
    method: 'POST',
    body: preview,
  });
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain('<h1>Check the file</h1>');
  expect(await env.DB.prepare('SELECT count(*) AS n FROM imports').first('n')).toBe(0);
  expect((await request('/imports/csv/confirm', { method: 'POST', body: confirmationForm(html) })).status).toBe(303);
});

test('missing headers return an editable mapping with 422 and no writes', async () => {
  const form = new FormData();
  form.set('file', new File(['Date;Balance;Payee\n2026-09-01;100;Sample\n'], 'invalid.csv'));
  form.set('account', 'holvi');
  form.set('account_currency', 'EUR');
  const response = await request('/imports/csv', { method: 'POST', body: form });
  expect(response.status).toBe(422);
  expect(await response.text()).toContain('map_amount');
  expect(await env.DB.prepare('SELECT count(*) AS n FROM imports').first('n')).toBe(0);
});

test('Windows-1252 requires an explicit encoding choice when UTF-8 decoding fails', async () => {
  const prefix = new TextEncoder().encode('Date;Amount;Payee\n2026-09-01;-12,50;S');
  const suffix = new TextEncoder().encode('mple\n');
  const bytes = new Uint8Array([...prefix, 228, ...suffix]);
  const form = new FormData();
  form.set('file', new File([bytes], 'windows.csv'));
  form.set('account', 'holvi');
  form.set('account_currency', 'EUR');
  expect((await request('/imports/csv', { method: 'POST', body: form })).status).toBe(422);
  form.set('encoding', 'windows-1252');
  expect((await request('/imports/csv', { method: 'POST', body: form })).status).toBe(200);
});

test('live FX lookup requests ECB-only historical observations and ignores future or stale dates', async () => {
  const row = await seedForeign();
  vi.mocked(fetch).mockImplementationOnce(async (input) => {
    const url = new URL(String(input));
    expect(url.hostname).toBe('api.frankfurter.dev');
    expect(url.pathname).toBe('/v2/rates');
    expect(url.searchParams.get('providers')).toBe('ecb');
    expect(url.searchParams.get('base')).toBe('USD');
    expect(url.searchParams.get('quotes')).toBe('EUR');
    expect(url.searchParams.get('from')).toBe('2026-08-30');
    expect(url.searchParams.get('to')).toBe('2026-09-05');
    return Response.json([
      { date: '2026-09-07', rate: 1.5 },
      { date: '2026-08-01', rate: 1.4 },
      { date: '2026-09-04', rate: 0.91 },
      { date: '2026-09-03', rate: 0.92 },
    ]);
  });
  await cacheFx({ ...env, AI_MODE: 'live' }, row);
  expect(await eurValue(env, await getReceipt(env, row.id))).toMatchObject({
    source: 'ecb',
    minor: 1820,
    rateDate: '2026-09-04',
  });
});
test('saving a receipt keeps its manual match unless the matched facts change', async () => {
  const row = await receipt();
  await importCsv(
    'Transaction ID;Booking date;Amount;Currency;Payee;Reference\nm;2026-09-07;-126,00;EUR;Card payment;card\n',
  );
  const id = await hash('holvi:id:m');
  const link = new URLSearchParams({
    transaction_id: id,
    receipt_id: row.id,
    action: 'link',
    confirm_exception: 'yes',
  });
  expect((await request('/matches', { method: 'POST', body: link })).status).toBe(303);
  const linked = () =>
    env.DB.prepare('SELECT receipt_id FROM bank_transactions WHERE id=?').bind(id).first('receipt_id');
  expect(await linked()).toBe(row.id);
  const save = async (extra: Record<string, string>) => {
    const current = await getReceipt(env, row.id);
    const body = new URLSearchParams({
      revision: String(current.revision),
      vendor: current.vendor ?? '',
      invoice_number: current.invoice_number ?? '',
      issue_date: current.issue_date ?? '',
      due_date: current.due_date ?? '',
      currency: current.currency ?? '',
      total: '125.50',
      net: '100.00',
      vat: '25.50',
      vat_rate: '25.5',
      product: 'app',
      expense_type: 'infra',
      action: 'save',
      ...extra,
    });
    expect((await request('/receipts/' + row.id, { method: 'POST', body })).status).toBe(303);
  };
  await save({ expense_type: 'subscriptions' });
  expect(await linked()).toBe(row.id);
  await save({ total: '125.60', net: '100.10' });
  expect(await linked()).toBeNull();
});
