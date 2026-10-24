import Papa from 'papaparse';
import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { hash, type Receipt } from '../src/domain';
import { getReceipt } from '../src/receipts';
import { request, uploadPdf } from './helpers';

test('matrix and CSV agree to the cent across provisional, missing, undated, duplicate, and estimated costs', async () => {
  const response = await uploadPdf(),
    original = await getReceipt(env, response.headers.get('Location')!.split('/').at(-1)!);
  async function copy(name: string, changes: Partial<Receipt>) {
    const id = await hash(name),
      fields = { ...original, id, original_key: 'receipts/' + id, ...changes };
    const entries = Object.entries(fields);
    await env.DB.prepare(
      `INSERT INTO receipts (${entries.map(([k]) => k).join(',')}) VALUES (${entries.map(() => '?').join(',')})`,
    )
      .bind(...entries.map(([, v]) => v))
      .run();
  }
  await copy('review', {
    vendor: '=SAMPLE()',
    invoice_number: 'REVIEW',
    total_minor: 1999,
    net_minor: null,
    vat_minor: null,
    status: 'needs_review',
    review_reasons_json: '["missing_net","missing_vat"]',
  });
  await copy('missing', {
    currency: 'USD',
    total_minor: 2000,
    fx_eur_minor: null,
    status: 'needs_review',
    review_reasons_json: '["missing_eur"]',
  });
  await copy('estimated', {
    currency: 'USD',
    total_minor: 2000,
    fx_eur_minor: 1525,
    fx_requested_date: '2026-09-04',
  });
  await copy('manual', {
    total_minor: 100,
    eur_override_minor: 444,
    eur_override_reason: 'Manual fixture',
  });
  await copy('undated', {
    issue_date: null,
    total_minor: 5500,
    status: 'needs_review',
  });
  await copy('duplicate', { duplicate_of: original.id, total_minor: 8000 });
  // The cost summary moved from home to the month page, in plain words.
  const monthly = await (await request('/?month=2026-09')).text();
  expect(monthly).toContain('<span>Spent</span><span>EUR 165.18</span>');
  expect(monthly).toContain('<td class="n">EUR 165.18</td>');
  expect(monthly).toContain('Not yet checked 19.99');
  expect(monthly).toContain('Converted at the ECB rate 15.25');
  expect(monthly).toContain('1 receipt has no euro amount yet');
  expect(monthly).toContain('Plus 1 receipt with no date');
  expect(await (await request('/?month=2026-09')).text()).toContain('EUR 165.18');
  const exported = await request('/export.csv?month=2026-09'),
    bytes = new Uint8Array(await exported.arrayBuffer());
  expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]);
  const csv = Papa.parse<Record<string, string>>(new TextDecoder().decode(bytes), { header: true });
  expect(csv.data).toHaveLength(5);
  const total = csv.data.reduce((sum, row) => sum + (row.eur_total ? Math.round(Number(row.eur_total) * 100) : 0), 0);
  expect(total).toBe(16518);
  const review = csv.data.find((r) => r.invoice_no === 'REVIEW');
  expect(review?.vendor).toBe("'=SAMPLE()");
  expect(review?.net).toBe('');
  expect(review?.vat).toBe('');
  expect(review?.needs_review).toBe('true');
});
