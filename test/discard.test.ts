// Discard sets a receipt aside: out of Review, totals, exports, the package,
// dedupe and matching; files kept; Undo and Restore bring it back.
import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { DISCARD_REASONS, type Receipt } from '../src/domain';
import { mergePlan } from '../src/dedupe';
import { placement } from '../src/package';
import { documentRows, monthRows } from '../src/ui';
import { MAX_BULK } from '../src/discard';
import { locationOf, request, uploadPdf } from './helpers';

const id = (n: number) => n.toString(16).padStart(64, '0');
async function receipt(n: number, o: { status?: string; vendor?: string; total?: number; invoice?: string } = {}) {
  await env.DB.prepare(
    `INSERT INTO receipts (id,original_key,filename,media_type,source,received_at,status,vendor,invoice_number,issue_date,currency,total_minor,net_minor,vat_minor,vat_rate_bps)
     VALUES (?,?,?,'application/pdf','upload',?,?,?,?,'2026-10-20','EUR',?,?,0,0)`,
  )
    .bind(
      id(n),
      `receipts/${id(n)}`,
      `r${n}.pdf`,
      `2026-10-2${n % 10}T10:00:00Z`,
      o.status ?? 'ready',
      o.vendor ?? `Vendor ${n}`,
      o.invoice ?? `INV-${n}`,
      o.total ?? 1000 + n,
      o.total ?? 1000 + n,
    )
    .run();
}
const row = (n: number) => env.DB.prepare('SELECT * FROM receipts WHERE id=?').bind(id(n)).first<Receipt>();
function post(path: string, fields: Record<string, string | string[]>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) form.append(k, one);
  return request(path, { method: 'POST', body: form });
}
async function matchTo(n: number) {
  await env.DB.prepare(
    "INSERT INTO imports(id,account_key,original_key,status,row_count,imported_at,snapshot_json) VALUES ('imp','default-account','imp-file','complete',1,'2026-10-21','{}')",
  ).run();
  await env.DB.prepare(
    "INSERT INTO bank_transactions(id,account_key,import_id,booking_date,amount_minor,currency,merchant,reference,raw_json,receipt_id,match_method,matched_at) VALUES ('tx1','default-account','imp','2026-10-20',?,'EUR','Vendor','ref','{}',?,'manual','2026-10-21')",
  )
    .bind(-(1000 + n), id(n))
    .run();
}

test('discard leaves Review, totals, CSV, package, dedupe and the list; Undo brings it all back', async () => {
  await receipt(1);
  await receipt(2, { status: 'needs_review' });
  await env.DB.prepare(`UPDATE receipts SET review_reasons_json='["vendor_missing"]' WHERE id=?`).bind(id(2)).run();
  expect(await (await request('/review')).text()).toContain('Discard');

  const res = await post('/discard', { id: [id(1), id(2)], reason: 'personal', back: '/review' });
  expect(res.status).toBe(303);
  const location = res.headers.get('Location')!;
  expect(location).toMatch(/^\/review\?done=discarded&n=2&at=/);
  const discarded = (await row(1))!;
  expect(discarded.discarded_at).toBeTruthy();
  expect(discarded.discard_reason).toBe('personal');

  const review = await (await request(location)).text();
  expect(review).toContain('2 discarded.');
  expect(review).toContain('Undo');
  expect(review).not.toContain('Vendor 2');
  expect(await monthRows(env, '2026-10')).toEqual([]);
  expect(await documentRows(env, '2026-10')).toEqual([]);
  expect(placement(discarded, { anyway: true, undated: true })).toBeNull();
  expect(await (await request('/export.csv?month=2026-10')).text()).not.toContain('Vendor 1');
  expect(await (await request('/receipts')).text()).not.toContain('Vendor 1');
  const list = await (await request('/receipts?show=discarded')).text();
  expect(list).toContain('Vendor 1');
  expect(list).toContain('Personal');
  expect(list).toContain('Restore');
  const page = await (await request(`/receipts/${id(1)}`)).text();
  expect(page).toContain('Discarded · Personal');
  expect(page).not.toContain('action="/discard"');

  const at = new URL(location, 'http://localhost').searchParams.get('at')!;
  const undo = await post('/restore', { at, back: '/review' });
  expect(locationOf(undo)).toBe('/review?done=restored&n=2');
  expect((await row(1))!.discarded_at).toBeNull();
  expect((await monthRows(env, '2026-10')).map((r) => r.id)).toEqual([id(1), id(2)]);
  expect(await (await request('/receipts?show=discarded')).text()).toContain('Nothing discarded.');
});

test('a discarded row is never a merge primary and cannot be matched or edited', async () => {
  await receipt(1, { vendor: 'Same', invoice: 'X-1', total: 500 });
  await receipt(2, { vendor: 'Same', invoice: 'X-1', total: 500 });
  expect((await mergePlan(env)).length).toBe(1);
  await post('/discard', { id: id(1), back: '/receipts' });
  expect((await row(1))!.discard_reason).toBeNull();
  expect(await mergePlan(env)).toEqual([]);
  const edit = await post(`/receipts/${id(1)}`, { revision: String((await row(1))!.revision), action: 'save' });
  expect(edit.status).toBe(409);
});

test('a bank-matched row needs unmatch, which removes the match in the same step', async () => {
  await receipt(1);
  await matchTo(1);
  const page = await (await request(`/receipts/${id(1)}`)).text();
  expect(page).toContain('Remove match?');
  expect((await post('/discard', { id: id(1), back: '/receipts' })).status).toBe(409);
  expect((await row(1))!.discarded_at).toBeNull();
  const ok = await post('/discard', { id: id(1), unmatch: '1', reason: 'other', back: '/receipts' });
  expect(ok.status).toBe(303);
  expect((await row(1))!.discarded_at).toBeTruthy();
  expect(
    await env.DB.prepare("SELECT receipt_id FROM bank_transactions WHERE id='tx1'").first('receipt_id'),
  ).toBeNull();
  // The freed payment is not matched back to the discarded receipt.
  expect((await post('/matches', { transaction_id: 'tx1', receipt_id: id(1), action: 'link' })).status).toBe(422);
});

test('stale revisions, bad reasons and oversized batches are refused', async () => {
  await receipt(1);
  expect((await post('/discard', { id: id(1), revision: '99', back: '/review' })).status).toBe(409);
  expect((await post('/discard', { id: id(1), reason: 'food', back: '/review' })).status).toBe(400);
  expect((await post('/discard', { id: Array.from({ length: MAX_BULK + 1 }, (_, i) => id(i + 10)) })).status).toBe(400);
  expect((await post('/discard', { id: 'not-an-id' })).status).toBe(400);
  expect((await row(1))!.discarded_at).toBeNull();
});

test('from the queue, discard moves on to the next receipt like Skip', async () => {
  for (const n of [1, 2]) {
    await receipt(n, { status: 'needs_review' });
    await env.DB.prepare(`UPDATE receipts SET review_reasons_json='["vendor_missing"]' WHERE id=?`).bind(id(n)).run();
  }
  const r = (await row(1))!;
  const res = await post('/discard', { id: id(1), revision: String(r.revision), back: 'queue' });
  expect(locationOf(res)).toMatch(new RegExp(`^/receipts/${id(2)}\\?done=discarded&n=1&`));
  const last = await post('/discard', { id: id(2), back: 'queue' });
  expect(locationOf(last)).toMatch(/^\/review\?done=discarded&n=1&/);
});

test('the same file sent again stays discarded', async () => {
  await uploadPdf();
  const first = await env.DB.prepare('SELECT id FROM receipts').first<{ id: string }>();
  await post('/discard', { id: first!.id, reason: 'duplicate', back: '/receipts' });
  expect(await env.ORIGINALS.head(`receipts/${first!.id}`)).not.toBeNull();
  await uploadPdf();
  const rows = (await env.DB.prepare('SELECT id,discarded_at FROM receipts').all()).results;
  expect(rows).toHaveLength(1);
  expect(rows[0]!.discarded_at).toBeTruthy();
});

test('labels stay short and every live-row query also skips discarded rows', () => {
  for (const label of Object.values(DISCARD_REASONS)) expect(label.split(' ').length).toBeLessThanOrEqual(3);
  const sources = JSON.parse(env.SOURCE_FILES) as Record<string, string>;
  for (const [name, text] of Object.entries(sources))
    for (const m of text.matchAll(/\b(\w+\.)?duplicate_of IS NULL(.{0,30})/g))
      expect(m[2], `${name}: ${m[0]}`).toMatch(
        new RegExp(`^ AND ${(m[1] ?? '').replace('.', '\\.')}discarded_at IS NULL`),
      );
});
