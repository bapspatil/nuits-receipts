// Automatic matching over a whole statement, and automatic "Not a purchase".
// Every name, amount and account here is invented.
import { env } from 'cloudflare:workers';
import { expect, test, vi } from 'vitest';
import { importBankCsv, parsePreset, reconcile, type Transaction } from '../src/banking';
import { originalFromText, parseCsv } from '../src/csv';
import { DEFAULT_TUNING, type Receipt } from '../src/domain';
import type { Env } from '../src/env';
import { CLEF_MAX_ROWS, clefExemptions, exemptionFor, unclear } from '../src/exempt';
import { amountFit, nameScore, planMatches } from '../src/matcher';
import { suggestMappings } from '../src/presets';
import { confirmationForm, locationOf, request, uploadPdf, idFrom } from './helpers';
import { feedback } from '../src/events';

let n = 0;
function receipt(over: Partial<Receipt>): Receipt {
  n++;
  return {
    id: `r${String(n).padStart(3, '0')}`,
    original_key: `originals/fake-${n}`,
    filename: 'Receipt-1.pdf',
    media_type: 'application/pdf',
    source: 'upload',
    email_key: null,
    received_at: '2026-10-01T00:00:00Z',
    status: 'ready',
    revision: 0,
    vendor: 'Fake Vendor Oy',
    invoice_number: null,
    issue_date: '2026-10-01',
    currency: 'EUR',
    total_minor: 1000,
    fx_eur_minor: null,
    kind: 'expense',
    duplicate_of: null,
    discarded_at: null,
    review_reasons_json: '[]',
    ...over,
  } as Receipt;
}
function payment(over: Partial<Transaction>): Transaction {
  n++;
  return {
    id: `t${String(n).padStart(3, '0')}`,
    account_key: 'fake-account',
    external_id: null,
    import_id: 'fake-import',
    booking_date: '2026-10-02',
    amount_minor: -1000,
    currency: 'EUR',
    original_amount_minor: null,
    original_currency: null,
    merchant: 'FAKE VENDOR',
    reference: null,
    raw_json: '{}',
    receipt_required: 1,
    receipt_id: null,
    match_method: null,
    matched_at: null,
    ...over,
  };
}
const plan = (rs: Receipt[], ts: Transaction[], rejected = new Set<string>()) =>
  planMatches(rs, ts, [], DEFAULT_TUNING, rejected);
const pairs = (p: ReturnType<typeof plan>) => p.pairs.map((x) => [x.receipt.id, x.transaction.id, x.fit.method]);

test('bank names are read past card processors, legal forms and statement noise', () => {
  const alike = (vendor: string, merchant: string) => nameScore(vendor, merchant) >= DEFAULT_TUNING.minVendorSimilarity;
  expect(alike('Fakeco Ireland, Limited', 'FAKECO IRELAND')).toBe(true);
  expect(alike('Fakeco Ireland Limited', 'FAKECO* WIDGET SUB')).toBe(true);
  expect(alike('Sample Bakery Oy', 'SumUp  *Sample Bakery')).toBe(true);
  expect(alike('Fake Pharmacy', 'PTL*Fake Pharmacy')).toBe(true);
  expect(alike('Fake Flowers', 'SP FAKE FLOWERS')).toBe(true);
  expect(alike('Fakeride B.V.', 'FAKERIDE * EATS PENDING')).toBe(true);
  expect(alike('Fakeride B.V.', 'FAKERIDE *TRIP HELP.UBER.COM')).toBe(true);
  expect(alike('Fakegame', 'PADDLE.NET* FAKEGAME')).toBe(true);
  expect(alike('Account holder Fakevideo Technology Inc.', 'FAKEVIDEO TECHNOLOGY INC.')).toBe(true);
  // A processor alone says nothing about the seller; unrelated names stay apart.
  expect(alike('Fake Vendor', 'STRIPE')).toBe(false);
  expect(alike('Fake Vendor Oy', 'Other Shop Oy')).toBe(false);
});

test('amounts fit exactly, in the original currency, by ECB estimate, or with a small tip', () => {
  const eur = receipt({ total_minor: 1000 });
  expect(amountFit(eur, payment({ amount_minor: -1001 }))).toBe('exact');
  expect(amountFit(eur, payment({ amount_minor: -1150 }))).toBe('tip');
  expect(amountFit(eur, payment({ amount_minor: -1500 }))).toBeNull();
  const usd = receipt({ currency: 'USD', total_minor: 1046, fx_eur_minor: 900 });
  expect(amountFit(usd, payment({ amount_minor: -925, original_amount_minor: -1046, original_currency: 'USD' }))).toBe(
    'original',
  );
  // The statement shows another original amount: no estimate is tried.
  expect(amountFit(usd, payment({ amount_minor: -925, original_amount_minor: -2000, original_currency: 'USD' }))).toBe(
    null,
  );
  expect(amountFit(usd, payment({ amount_minor: -925 }))).toBe('fx');
  expect(amountFit(usd, payment({ amount_minor: -1100 }))).toBeNull();
});

test('a recurring subscription: each receipt goes to the payment closest after it', () => {
  const r1 = receipt({ issue_date: '2026-09-01' }),
    r2 = receipt({ issue_date: '2026-10-01' });
  const t1 = payment({ booking_date: '2026-09-02' }),
    t2 = payment({ booking_date: '2026-10-02' });
  expect(pairs(plan([r2, r1], [t2, t1]))).toEqual(
    expect.arrayContaining([
      [r1.id, t1.id, 'exact'],
      [r2.id, t2.id, 'exact'],
    ]),
  );
});

test('an invoice and a receipt of one charge count once; identical charges are interchangeable', () => {
  const invoice = receipt({ filename: 'Invoice-1.pdf', invoice_number: 'FAKE-1' }),
    copy = receipt({ filename: 'Receipt-1.pdf', invoice_number: 'FAKE-1' });
  const t = payment({});
  const p = plan([copy, invoice], [t]);
  expect(pairs(p)).toEqual([[invoice.id, t.id, 'exact']]);
  // Two charges of the same amount on the same day, two identical payments: both are linked.
  const a = receipt({ invoice_number: 'FAKE-2' }),
    b = receipt({ invoice_number: 'FAKE-3' });
  const ta = payment({}),
    tb = payment({});
  expect(plan([a, b], [ta, tb]).pairs).toHaveLength(2);
});

test('an equal-score choice between different payments is left for the person', () => {
  const r = receipt({});
  const one = payment({ merchant: 'FAKE VENDOR' }),
    two = payment({ merchant: 'FAKE VENDOR HELSINKI' }),
    other = payment({ account_key: 'second-account', merchant: 'FAKE VENDOR' });
  const tie = plan([r], [one, two]);
  expect(tie.pairs).toEqual([]);
  expect([...tie.tied].sort()).toEqual([r.id, one.id, two.id].sort());
  // Two accounts are never interchangeable.
  expect(plan([r], [one, other]).pairs).toEqual([]);
  // A tied receipt is not handed a worse payment further down.
  const later = payment({ booking_date: '2026-10-20' });
  expect(plan([r], [one, two, later]).pairs).toEqual([]);
  // A pair the owner took apart is never linked again.
  expect(plan([r], [one], new Set([`${one.id}|${r.id}`])).pairs).toEqual([]);
});

test('a Holvi statement keeps the original amount from "Currency and amount"', () => {
  expect(
    originalFromText('Payment sent to X\nCurrency and amount: USD 10.46\nExchange rate: 1.13', 'EUR', -925),
  ).toEqual({ amount: -1046, currency: 'USD' });
  expect(originalFromText('Currency and amount: USD 1,400.00', 'EUR', -120400)).toEqual({
    amount: -140000,
    currency: 'USD',
  });
  expect(originalFromText('Currency and amount: JPY 1500', 'EUR', 900)).toEqual({ amount: 1500, currency: 'JPY' });
  // Unsupported currencies, the account's own currency and no line at all give nothing.
  expect(originalFromText('Currency and amount: XYZ 10.00', 'EUR', -900)).toBeNull();
  expect(originalFromText('Currency and amount: EUR 10.00', 'EUR', -1000)).toBeNull();
  expect(originalFromText('Payment sent to X', 'EUR', -1000)).toBeNull();
  const headers = [
    'Value date',
    'Booking date',
    'Amount',
    'Currency',
    'Counterparty',
    'Description',
    'Reference',
    'Message',
    'Filing ID',
  ];
  const mapping = suggestMappings(headers, 'EUR').find((s) => s.id === 'builtin-holvi-statement')!.mapping;
  const csv = `${headers.join(',')}\n"1 Oct 2026","2 Oct 2026",-9.25,EUR,FAKECLOUD,"Payment sent to FAKECLOUD\nCurrency and amount: USD 10.46\nExchange rate: 1.13",,"Payment sent to FAKECLOUD",${'a'.repeat(32)}\n`;
  const [row] = parseCsv(new TextEncoder().encode(csv), mapping).rows;
  expect(row?.value).toMatchObject({ amount_minor: -925, original_amount_minor: -1046, original_currency: 'USD' });
});

test('obvious non-purchases are found by rule; a shop that only looks alike is not', () => {
  const own = ['Fake Studio', 'Jane Fakename'];
  const rule = (merchant: string, reference: string | null = null, amount_minor = -1000) =>
    exemptionFor(payment({ merchant, reference, amount_minor }), own);
  expect(rule('JANE FAKENAME')).toBe('own');
  expect(rule('Someone', 'Payment sent to Someone / self-transfer')).toBe('own');
  expect(rule('Verohallinto')).toBe('tax');
  expect(rule('Fakebank service fee')).toBe('fee');
  expect(rule('ATM 01234 FAKE STREET')).toBe('cash');
  expect(rule('Fake Mutual Pension Insurance Company')).toBe('pension');
  expect(rule('Fakepay top-up')).toBe('topup');
  expect(rule('Vero Fashion Store')).toBeNull();
  expect(rule('Pension Alpenfake')).toBeNull();
  expect(rule('Fake Studio Supplies Oy')).toBeNull();
  // Money in is never marked.
  expect(rule('Verohallinto', null, 1000)).toBeNull();
  // Only a transfer to a name that reads like a person is unclear enough to ask Clef.
  expect(
    unclear(payment({ merchant: 'Jane Fakeperson', reference: 'RF12FAKE / Payment sent to Jane Fakeperson' })),
  ).toBe(true);
  expect(unclear(payment({ merchant: 'Fake Vendor Oy', reference: 'RF12FAKE / Payment sent to Fake Vendor Oy' }))).toBe(
    false,
  );
  expect(unclear(payment({ merchant: 'Jane Fakeperson', reference: 'Payment sent to Jane Fakeperson' }))).toBe(false);
  expect(unclear(payment({ merchant: 'FAKE*SHOP 123', reference: '12345 / Payment sent' }))).toBe(false);
});

test('Clef is asked once, about at most 40 rows, and only confident answers count', async () => {
  const rows = Array.from({ length: CLEF_MAX_ROWS + 5 }, (_, i) =>
    payment({ id: `clef-${i}`, merchant: 'Jane Fakeperson', reference: `RF12FAKE${i} / Payment sent` }),
  );
  const answers = (probability: number) =>
    Object.fromEntries(
      rows.slice(0, CLEF_MAX_ROWS).map((_, i) => [
        `p${i}`,
        {
          type: 'choice',
          choice: i % 2 ? 'purchase' : 'not_purchase',
          probabilities: { purchase: 1 - probability, not_purchase: probability },
          confidence: 0.9,
        },
      ]),
    );
  const run = vi.fn(async () => ({ answers: answers(0.95) }));
  const live = { ...env, AI_MODE: 'live', AI: { run } } as unknown as Env;
  const marked = await clefExemptions(live, rows, 0.85);
  expect(run).toHaveBeenCalledTimes(1);
  const questions = (run.mock.calls[0] as unknown as [string, { questions: object }])[1].questions;
  expect(Object.keys(questions)).toHaveLength(CLEF_MAX_ROWS);
  // Odd rows answered "purchase" with 0.05 for it: below the bar, so left alone.
  expect(marked).toEqual(
    rows
      .slice(0, CLEF_MAX_ROWS)
      .filter((_, i) => i % 2 === 0)
      .map((t) => t.id),
  );
  // A weak answer or a failing call marks nothing.
  run.mockImplementationOnce(async () => ({ answers: answers(0.6) }));
  expect(await clefExemptions(live, rows, 0.85)).toEqual([]);
  run.mockImplementationOnce(async () => {
    throw new Error('fake outage');
  });
  expect(await clefExemptions(live, rows, 0.85)).toEqual([]);
});

const statement = (rows: string) => 'Transaction ID;Date;Amount;Currency;Payee;Reference\n' + rows;
async function importText(text: string, account = 'holvi') {
  return importBankCsv(env, {
    bytes: new TextEncoder().encode(text),
    parsed: parsePreset(text, account, 'EUR'),
    collision: 'keep_existing',
  });
}
const row = (merchant: string) =>
  env.DB.prepare('SELECT receipt_id,receipt_required,exempt_by,match_method FROM bank_transactions WHERE merchant=?')
    .bind(merchant)
    .first();

test('an import marks non-purchases by rule, an owner choice sticks, and Undo brings them back', async () => {
  const id = await importText(
    statement(
      'a;2026-09-07;-500,00;EUR;Verohallinto;RF55FAKE / tax\nb;2026-09-08;-5,00;EUR;Fakebank service fee;fee\nc;2026-09-09;-40,00;EUR;ATM 01234 FAKE STREET;cash\nd;2026-09-10;-12,00;EUR;Fake Corner Shop;card\n',
    ),
  );
  expect(await row('Verohallinto')).toMatchObject({ receipt_required: 0, exempt_by: 'tax' });
  expect(await row('Fakebank service fee')).toMatchObject({ receipt_required: 0, exempt_by: 'fee' });
  expect(await row('ATM 01234 FAKE STREET')).toMatchObject({ receipt_required: 0, exempt_by: 'cash' });
  expect(await row('Fake Corner Shop')).toMatchObject({ receipt_required: 1, exempt_by: null });
  const bank = await (await request('/payments?month=2026-09&view=all')).text();
  expect(bank).toContain('<span class="tag">Tax</span>');
  expect(bank).toContain('4 out, 0 matched, 3 not a purchase, <span class="red">1 missing</span>');
  // The owner says the fee needs a receipt: no rule marks it again.
  const fee = (await env.DB.prepare("SELECT id FROM bank_transactions WHERE merchant='Fakebank service fee'").first<{
    id: string;
  }>())!.id;
  await request('/payments/' + fee, { method: 'POST', body: new URLSearchParams({ receipt_required: '1' }) });
  await reconcile(env);
  expect(await row('Fakebank service fee')).toMatchObject({ receipt_required: 1, exempt_by: 'owner' });
  // Undo for the import: every automatic mark of that file needs a receipt again.
  const undone = await request(`/imports/${id}/exempt/undo`, {
    method: 'POST',
    body: new URLSearchParams({ month: '2026-09' }),
  });
  expect(locationOf(undone)).toMatch(/done=exemptUndone&n=2(#row-[0-9a-f]{64})?$/);
  expect(await row('Verohallinto')).toMatchObject({ receipt_required: 1, exempt_by: 'owner' });
  expect(await row('ATM 01234 FAKE STREET')).toMatchObject({ receipt_required: 1, exempt_by: 'owner' });
});

test('the import banner reports matched, not a purchase and missing, with Clef in mock mode and an Undo', async () => {
  await uploadPdf();
  const text = statement(
    'a;2026-09-05;-125,50;EUR;Sample Cloud Lantern Oy;card\nb;2026-09-06;-50,00;EUR;Verohallinto;RF55FAKE / tax\nc;2026-09-07;-30,00;EUR;Jane Fakeperson;RF12FAKE / Payment sent to Jane Fakeperson\nd;2026-09-08;-9,99;EUR;Fake Corner Shop;card\n',
  );
  const body = new FormData();
  body.set('account', 'holvi');
  body.set('file', new File([text], 'statement.csv', { type: 'text/csv' }));
  const preview = await request('/imports/csv', { method: 'POST', body });
  const done = await request('/imports/csv/confirm', { method: 'POST', body: confirmationForm(await preview.text()) });
  const said = feedback(new URL(locationOf(done), 'https://x.example').searchParams)!;
  expect(said.text).toBe('Added 4 payments. Paid out: 1 matched, 2 not a purchase, 1 missing.');
  expect(said.undo).toMatchObject({ label: 'Undo not a purchase', fields: { month: '2026-09' } });
  expect(await row('Jane Fakeperson')).toMatchObject({ receipt_required: 0, exempt_by: 'clef' });
  expect(said.text).not.toMatch(/[\u2013\u2014]/);
});

test('food delivery is marked by rule; Uber rides and restaurants are not', () => {
  const rule = (merchant: string) => exemptionFor(payment({ merchant, amount_minor: -2350 }), []);
  for (const merchant of [
    'UBER * EATS PENDING',
    'UBER *EATS',
    'UBER EATS',
    'Uber Eats Fakecity',
    'WOLT FAKE KITCHEN',
    'Foodora Fakecity',
    'ZOMATO FAKE',
    'Swiggy*Fake Order',
    'Deliveroo Fake',
  ])
    expect(rule(merchant)).toBe('delivery');
  for (const merchant of [
    'UBER *TRIP',
    'UBER *TRIP HELP.UBER.C',
    'UBER * PENDING',
    'Fake Bistro Oy',
    'Trattoria Fakeria',
  ])
    expect(rule(merchant)).toBeNull();
});

test('a delivery mark shows its label, Undo brings it back, and an owner choice is never overridden', async () => {
  const id = await importText(
    statement(
      'a;2026-09-11;-23,50;EUR;UBER * EATS PENDING;card\nb;2026-09-12;-18,90;EUR;WOLT FAKE KITCHEN;card\nc;2026-09-13;-14,20;EUR;UBER *TRIP;card\nd;2026-09-14;-42,00;EUR;Fake Bistro Oy;card\n',
    ),
  );
  expect(await row('UBER * EATS PENDING')).toMatchObject({ receipt_required: 0, exempt_by: 'delivery' });
  expect(await row('WOLT FAKE KITCHEN')).toMatchObject({ receipt_required: 0, exempt_by: 'delivery' });
  expect(await row('UBER *TRIP')).toMatchObject({ receipt_required: 1, exempt_by: null });
  expect(await row('Fake Bistro Oy')).toMatchObject({ receipt_required: 1, exempt_by: null });
  const bank = await (await request('/payments?month=2026-09&view=all')).text();
  expect(bank).toContain('<span class="tag">Delivery</span>');
  // The owner says the Wolt order needs a receipt: no rule marks it again.
  const wolt = (await env.DB.prepare("SELECT id FROM bank_transactions WHERE merchant='WOLT FAKE KITCHEN'").first<{
    id: string;
  }>())!.id;
  await request('/payments/' + wolt, { method: 'POST', body: new URLSearchParams({ receipt_required: '1' }) });
  await reconcile(env);
  expect(await row('WOLT FAKE KITCHEN')).toMatchObject({ receipt_required: 1, exempt_by: 'owner' });
  const undone = await request(`/imports/${id}/exempt/undo`, {
    method: 'POST',
    body: new URLSearchParams({ month: '2026-09' }),
  });
  expect(locationOf(undone)).toMatch(/done=exemptUndone&n=1(#row-[0-9a-f]{64})?$/);
  expect(await row('UBER * EATS PENDING')).toMatchObject({ receipt_required: 1, exempt_by: 'owner' });
  await reconcile(env);
  expect(await row('UBER * EATS PENDING')).toMatchObject({ receipt_required: 1, exempt_by: 'owner' });
});

test('matching runs again for every month when a receipt arrives, and a removed match stays removed', async () => {
  await importText(statement('a;2026-09-05;-125,50;EUR;SumUp *Sample Cloud Lantern;card\n'));
  expect(await row('SumUp *Sample Cloud Lantern')).toMatchObject({ receipt_id: null, receipt_required: 1 });
  const id = idFrom(await uploadPdf());
  expect(await row('SumUp *Sample Cloud Lantern')).toMatchObject({ receipt_id: id, match_method: 'automatic' });
  const tx = (await env.DB.prepare('SELECT id FROM bank_transactions').first<{ id: string }>())!.id;
  await request('/matches', { method: 'POST', body: new URLSearchParams({ transaction_id: tx, action: 'unlink' }) });
  await reconcile(env);
  expect(await row('SumUp *Sample Cloud Lantern')).toMatchObject({ receipt_id: null });
  // Matching it again by hand forgets the refusal.
  await request('/matches', {
    method: 'POST',
    body: new URLSearchParams({ transaction_id: tx, receipt_id: id, action: 'link' }),
  });
  expect(await env.DB.prepare('SELECT count(*) n FROM match_rejections').first('n')).toBe(0);
});

test('a restored receipt is matched again, and a receipt for a row a rule marked wins', async () => {
  const id = idFrom(await uploadPdf());
  await request('/discard', { method: 'POST', body: new URLSearchParams({ id, back: '/review', reason: 'other' }) });
  await importText(statement('a;2026-09-05;-125,50;EUR;Sample Cloud Lantern Oy service fee;fee\n'));
  expect(await row('Sample Cloud Lantern Oy service fee')).toMatchObject({ receipt_required: 0, exempt_by: 'fee' });
  await request('/restore', { method: 'POST', body: new URLSearchParams({ id, back: '/review' }) });
  expect(await row('Sample Cloud Lantern Oy service fee')).toMatchObject({
    receipt_id: id,
    receipt_required: 1,
    match_method: 'automatic',
  });
});

test('an import of a thousand rows against a hundred receipts reconciles in a few database round trips', async () => {
  const lines = Array.from(
    { length: 1000 },
    (_, i) =>
      `x${i};2026-09-${String((i % 28) + 1).padStart(2, '0')};-${(i % 97) + 3},${String(i % 100).padStart(2, '0')};EUR;Fake Merchant ${i % 50};card`,
  ).join('\n');
  await importText(statement(lines + '\n'));
  const inserts = Array.from({ length: 100 }, (_, i) =>
    env.DB.prepare(
      "INSERT INTO receipts(id,original_key,filename,media_type,source,received_at,status,vendor,issue_date,currency,total_minor) VALUES (?,?,?,'application/pdf','upload','2026-09-01T00:00:00Z','ready',?,?,'EUR',?)",
    ).bind(
      `bulk-${i}`,
      `originals/bulk-${i}`,
      `r${i}.pdf`,
      `Fake Merchant ${i % 50}`,
      `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
      ((i % 97) + 3) * 100 + (i % 100),
    ),
  );
  await env.DB.batch(inserts);
  const batch = vi.spyOn(env.DB, 'batch'),
    prepare = vi.spyOn(env.DB, 'prepare');
  const started = Date.now();
  await reconcile(env);
  const batches = batch.mock.calls.length,
    statements = prepare.mock.calls.length;
  batch.mockRestore();
  prepare.mockRestore();
  // Reads are batched and writes go 50 to a batch: no query per row or per pair.
  expect(batches).toBeLessThan(10);
  expect(statements).toBeLessThan(150);
  expect(Date.now() - started).toBeLessThan(5000);
  expect(
    Number(await env.DB.prepare('SELECT count(*) n FROM bank_transactions WHERE receipt_id IS NOT NULL').first('n')),
  ).toBeGreaterThan(50);
});
