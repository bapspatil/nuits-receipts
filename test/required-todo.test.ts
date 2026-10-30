// Only a missing or wrong required fact puts a receipt in To do. Optional reasons stay on the
// receipt as a note. Every consumer of the count agrees. Names and amounts here are invented.
import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { hasTodoReason, isReady, needsReview, needsReviewSql, OPTIONAL_REASONS, readySql } from '../src/flags';
import { placement } from '../src/package';
import type { Receipt } from '../src/domain';
import { request } from './helpers';

const id = (n: number) => n.toString(16).padStart(64, '0');
async function receipt(n: number, status: string, reasons: string[], month = '2026-10') {
  await env.DB.prepare(
    `INSERT INTO receipts (id,original_key,filename,media_type,source,received_at,status,kind,vendor,invoice_number,issue_date,currency,total_minor,net_minor,vat_minor,vat_rate_bps,review_reasons_json)
     VALUES (?,?,?,'application/pdf','upload',?,?,'expense',?,?,?,'EUR',1000,1000,0,0,?)`,
  )
    .bind(
      id(n),
      `receipts/${id(n)}`,
      `r${n}.pdf`,
      `${month}-20T10:00:0${n}Z`,
      status,
      `Vendor ${n}`,
      `INV-${n}`,
      `${month}-20`,
      JSON.stringify(reasons),
    )
    .run();
}
const get = (n: number) => env.DB.prepare('SELECT * FROM receipts WHERE id=?').bind(id(n)).first<Receipt>();

test('optional reasons never put a receipt in To do, every other reason does', () => {
  for (const code of OPTIONAL_REASONS) expect(hasTodoReason([code]), code).toBe(false);
  for (const code of ['missing_total', 'uncertain_vendor', 'vat_mismatch', 'credit_or_sign', 'missing_eur'])
    expect(hasTodoReason([code]), code).toBe(true);
  expect(hasTodoReason(['probable_duplicate'])).toBe(true);
  expect(hasTodoReason(['uncertain_product', 'missing_vat'])).toBe(true);
  const flagged = (reasons: string[]) => ({ status: 'needs_review', review_reasons_json: JSON.stringify(reasons) });
  expect(needsReview(flagged(['missing_invoice_number']))).toBe(false);
  expect(isReady(flagged(['missing_invoice_number']))).toBe(true);
  expect(needsReview(flagged([]))).toBe(true);
  expect(needsReview({ status: 'ready', review_reasons_json: '["missing_total"]' })).toBe(false);
});

test('the SQL predicates agree with the TypeScript ones', async () => {
  const cases: [string, string[]][] = [
    ['needs_review', []],
    ['needs_review', ['missing_invoice_number']],
    ['needs_review', ['uncertain_product', 'rule_conflict']],
    ['needs_review', ['missing_invoice_number', 'missing_total']],
    ['needs_review', ['missing_eur']],
    ['ready', ['missing_invoice_number']],
    ['pending', []],
  ];
  for (const [i, [status, reasons]] of cases.entries()) await receipt(i + 1, status, reasons);
  const rows = (await env.DB.prepare('SELECT * FROM receipts ORDER BY id').all<Receipt>()).results;
  const ids = async (where: string) =>
    (await env.DB.prepare(`SELECT id FROM receipts WHERE ${where} ORDER BY id`).all<{ id: string }>()).results.map(
      (r) => r.id,
    );
  expect(await ids(needsReviewSql())).toEqual(rows.filter(needsReview).map((r) => r.id));
  expect(await ids(readySql())).toEqual(rows.filter(isReady).map((r) => r.id));
  expect(await ids(needsReviewSql('receipts'))).toEqual(await ids(needsReviewSql()));
});

test('an optional-only receipt is ready, a required one goes to To do, and the counts agree', async () => {
  await receipt(1, 'needs_review', ['missing_total']);
  await receipt(2, 'needs_review', ['missing_invoice_number']);
  await receipt(3, 'ready', ['uncertain_product']);
  const review = await (await request('/receipts?view=todo')).text();
  expect(review).toContain('<p class="listhead">1 to do</p>');
  expect(review).toContain('Vendor 1');
  expect(review).not.toContain('Vendor 2');
  expect(review).not.toContain('Vendor 3');
  const home = await (await request('/?month=2026-10')).text();
  expect(home).toContain('1 to check');
  expect(home).not.toContain('2 to check');
  expect(home).not.toContain('3 to check');
  expect(review).toContain('Receipts <span class="count">1<span class="vh"> to do</span>');
  const receipts = await (await request('/receipts?view=all&month=2026-10')).text();
  expect(receipts).toContain('Vendor 2');
});

test('an old optional-only row counts as ready everywhere, with no migration', async () => {
  await receipt(1, 'needs_review', ['missing_invoice_number']);
  const row = (await get(1))!;
  expect(placement(row, { anyway: false, undated: false })).toBe('main');
  expect(await (await request('/?month=2026-10')).text()).toContain('All checked');
  expect(await (await request('/receipts?view=todo')).text()).toContain('Nothing to do.');
  const page = await (await request(`/receipts/${id(1)}`)).text();
  expect(page).toContain('Not needed to approve: What is the receipt number?');
  expect(page).not.toContain('class="stamp needs"');
});
