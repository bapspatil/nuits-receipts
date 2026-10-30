import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { hash } from '../src/domain';
import { importBankCsv, parsePreset } from '../src/banking';
import { htmlForm, idFrom, request, uploadPdf } from './helpers';

const post = (path: string, body: URLSearchParams | FormData) => request(path, { method: 'POST', body });

// A ready receipt and a payment that does not line up with it exactly.
async function seedMismatch() {
  const id = idFrom(await uploadPdf());
  const csv = 'Transaction ID;Date;Amount;Currency;Payee\na;2026-09-07;-99,00;EUR;Sample Cloud Lantern Oy\n';
  await importBankCsv(env, {
    bytes: new TextEncoder().encode(csv),
    parsed: parsePreset(csv, 'race', 'EUR'),
    collision: '',
  });
  return { id, tx: await hash('race:id:a') };
}
const alertOf = (html: string) => html.match(/<div class="alert" role="alert">[\s\S]*?<\/div>/)?.[0] ?? '';

test('a pair that is not exact is explained on its row, and Match goes through', async () => {
  const { id, tx } = await seedMismatch();
  const refused = await post('/matches', new URLSearchParams({ transaction_id: tx, receipt_id: id, action: 'link' }));
  expect(refused.status).toBe(422);
  const html = await refused.text();
  expect(html).toContain('<title>Bank · September 2026');
  expect(alertOf(html)).toContain(`<a href="#f-confirm-${tx}">Go to it</a>`);
  // The row now holds the pair, the reason, and one button that says what it does.
  const row = html.match(/<li class="pay[^"]*"[^>]*>[\s\S]*?<\/li>/)![0];
  expect(row).toContain(`id="f-confirm-${tx}" aria-describedby="e-why-${tx} e-match-${tx}"`);
  expect(row).toContain('>Match</button>');
  expect(row).not.toContain('Match anyway');
  expect(row).not.toContain('/help#match-anyway');
  expect(row).toContain('This pair isn&#39;t exact: the amounts differ');
  expect(row).toMatch(new RegExp(`<p class="ferr" id="e-match-${tx}">[^<]*line up[^<]*</p>`));
  expect(row).not.toContain('Not exact, still this');
  // The exception rides along as a hidden field of that one form, not a box to tick.
  const form = htmlForm(row.match(/<form action="\/matches"[^>]*class="likely"[\s\S]*?<\/form>/)![0], '/matches');
  expect(form.get('confirm_exception')).toBe('yes');
  form.set('action', 'link');
  expect((await post('/matches', form)).status).toBe(303);
});

test('a row with an exact pair has no exception field, and typing a label in the search box finds the receipt', async () => {
  const { id, tx } = await seedMismatch();
  const page = await (await request('/payments?month=2026-09&view=all')).text();
  // Nothing looks like this payment: the line says so and the search box stands alone.
  const row = page.match(/<li class="pay[^"]*"[^>]*>[\s\S]*?<\/li>/)![0];
  expect(row).toContain('No receipt fits.');
  expect(row).toContain('<input name="receipt_id" list="pick-receipts"');
  expect(row).not.toContain('name="confirm_exception"');
  expect(row).not.toContain('Receipt ID');
  const label = page.match(/<datalist id="pick-receipts"><option value="([^"]+)">/)![1]!;
  expect(label).toMatch(/^Sample Cloud Lantern Oy, 4 Sep, EUR 125\.50$/);
  // The label stands for the receipt: it gets as far as the exception check.
  const typed = await post('/matches', new URLSearchParams({ transaction_id: tx, receipt_id: label, action: 'link' }));
  expect(typed.status).toBe(422);
  expect(await typed.text()).toContain('This pair isn&#39;t exact');
  const withBox = new URLSearchParams({
    transaction_id: tx,
    receipt_id: label,
    action: 'link',
    confirm_exception: 'yes',
  });
  expect((await post('/matches', withBox)).status).toBe(303);
  expect(await env.DB.prepare('SELECT receipt_id FROM bank_transactions WHERE id=?').bind(tx).first('receipt_id')).toBe(
    id,
  );
});

test('text that names no receipt, or more than one, is refused at the search box', async () => {
  const { tx } = await seedMismatch();
  const none = await post(
    '/matches',
    new URLSearchParams({ transaction_id: tx, receipt_id: 'nothing like it', action: 'link' }),
  );
  expect(none.status).toBe(422);
  const html = await none.text();
  expect(html).toContain('Pick one of the receipts in the list');
  expect(html).toContain('value="nothing like it"');
  expect(html).toMatch(/<input name="receipt_id"[^>]*aria-invalid="true"/);
  const blank = await post('/matches', new URLSearchParams({ transaction_id: tx, receipt_id: '', action: 'link' }));
  expect(blank.status).toBe(422);
});

test('a match refused from the receipt page comes back to that receipt', async () => {
  const { id, tx } = await seedMismatch();
  const refused = await post(
    '/matches',
    new URLSearchParams({ transaction_id: tx, receipt_id: id, action: 'link', on_error: `/receipts/${id}` }),
  );
  expect(refused.status).toBe(422);
  const html = await refused.text();
  expect(html).toContain(`<form action="/receipts/${id}" method="post" class="fix"`);
  expect(alertOf(html)).toContain('Nothing was saved.');
  // Anything but a receipt address is ignored.
  const elsewhere = await post(
    '/matches',
    new URLSearchParams({ transaction_id: tx, receipt_id: id, action: 'link', on_error: 'https://evil.example/' }),
  );
  expect(await elsewhere.text()).toContain('<title>Bank');
});

test('a bad value on the receipt form comes back in place, marked, with what was typed', async () => {
  const { id } = await seedMismatch();
  const form = htmlForm(await (await request(`/receipts/${id}`)).text(), `/receipts/${id}`);
  form.set('total', '12,5x');
  form.set('vendor', 'Typed Vendor');
  const refused = await post(`/receipts/${id}`, form);
  expect(refused.status).toBe(422);
  const html = await refused.text();
  expect(alertOf(html)).toContain('<a href="#f-total">Go to it</a>');
  expect(html).toMatch(
    /<input name="total" value="12,5x"[^>]* id="f-total" aria-invalid="true" aria-describedby="e-receipt"/,
  );
  expect(html).toContain('value="Typed Vendor"');
  expect(html.match(/aria-invalid="true"/g)).toHaveLength(1);
  // Nothing was saved.
  expect(await env.DB.prepare('SELECT vendor FROM receipts WHERE id=?').bind(id).first('vendor')).not.toBe(
    'Typed Vendor',
  );
});

test('the import form keeps its choices and names the new account field that is missing', async () => {
  const body = new FormData();
  body.set('file', new File(['a;b\n1;2\n'], 'bank.csv', { type: 'text/csv' }));
  body.set('account_action', 'new');
  body.set('account_label', '');
  body.set('bank_name', 'Typed Bank');
  body.set('encoding', 'auto');
  const refused = await post('/imports/csv', body);
  expect(refused.status).toBe(422);
  const html = await refused.text();
  expect(alertOf(html)).toContain('<a href="#f-account_label">Go to it</a>');
  expect(html).toMatch(
    /<input name="account_label"[^>]* id="f-account_label" aria-invalid="true" aria-describedby="e-import"/,
  );
  expect(html).toContain('name="bank_name" value="Typed Bank"');
  expect(html).toContain('<option value="new" selected>');
  expect(html.match(/aria-invalid="true"/g)).toHaveLength(1);
});

test('a refused Settings save re-renders Settings with the typed value and the field marked', async () => {
  const settings = await (await request('/settings')).text();
  const form = htmlForm(settings, '/settings/setup');
  const group = form.get('group');
  expect(group).toBeTruthy();
  const key = [...form.keys()].find((k) => /^[A-Z_]+$/.test(k) && !['AUTH_USERNAME'].includes(k))!;
  form.set(key, 'x'.repeat(1500));
  const refused = await post('/settings/setup', form);
  expect(refused.status).toBe(422);
  const html = await refused.text();
  expect(alertOf(html)).toContain(`<a href="#f-${key}">Go to it</a>`);
  expect(html).toContain(`id="f-${key}" aria-invalid="true" aria-describedby="e-setup-${group}"`);
  expect(html).toContain('x'.repeat(1500));
});

test('a form that is not wired keeps the plain error page', async () => {
  const refused = await post(
    '/rules',
    new URLSearchParams({ vendor_contains: '', product: 'x', expense_type: 'y', priority: '1' }),
  );
  expect(refused.status).toBe(422);
  const html = await refused.text();
  expect(html).toContain('role="alert"');
  expect(html).not.toContain('Nothing was saved.');
});

test("one request's refusal never shows in another running at the same time", async () => {
  const { id, tx } = await seedMismatch();
  const bad = () => post('/matches', new URLSearchParams({ transaction_id: tx, receipt_id: id, action: 'link' }));
  const bankUrl = '/payments?month=2026-09&view=all';
  const quiet = await Promise.all([bankUrl, '/review', '/'].map(async (path) => (await request(path)).text()));
  const results = await Promise.all([bad(), request(bankUrl), bad(), request('/review'), request('/')]);
  const [first, ...rest] = await Promise.all(results.map((r) => r.text()));
  expect(first).toContain('Nothing was saved.');
  expect(rest[1]).toContain('Nothing was saved.');
  // The pages that were not refused are what they were without any refusal running beside them.
  expect([rest[0], rest[2], rest[3]]).toEqual(quiet);
  expect(results.map((r) => r.status)).toEqual([422, 200, 422, 200, 200]);
});
