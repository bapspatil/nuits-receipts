import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { hash } from '../src/domain';
import { importBankCsv, parsePreset } from '../src/banking';
import { formById, htmlForm, idFrom, request, uploadPdf } from './helpers';
import { seed } from './package-helpers';
import { createAccount, defaultAccount, type AccountId } from '../src/accounts';

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
  const row = html.match(/<li class="row"[^>]*>[\s\S]*?<\/li>(?=<li class="row"|<\/ul>)/)![0];
  expect(row).toContain(`id="f-confirm-${tx}" aria-describedby="e-why-${tx} e-match-${tx}"`);
  expect(row).toContain('<span>Match</span></button>');
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
  const row = page.match(/<li class="row"[^>]*>[\s\S]*?<\/li>(?=<li class="row"|<\/ul>)/)![0];
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

test('the import form names the file field when the file cannot be read', async () => {
  const body = new FormData();
  body.set('file', new File([new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3])], 'bank.xlsx'));
  const refused = await post('/import', body);
  expect(refused.status).toBe(422);
  const html = await refused.text();
  expect(alertOf(html)).toContain('<a href="#f-file">Go to it</a>');
  expect(html).toMatch(
    /<input type="file" name="file"[^>]* id="f-file" aria-invalid="true" aria-describedby="e-import"/,
  );
  expect(html.match(/aria-invalid="true"/g)).toHaveLength(1);
});

test('a refused Settings save re-renders Settings with the typed value and the field marked', async () => {
  const settings = await (await request('/settings')).text();
  const form = formById(settings, 'settings-form');
  const key = [...form.keys()].find((k) => /^[A-Z_]+$/.test(k) && !['AUTH_USERNAME'].includes(k))!;
  form.set(key, 'x'.repeat(1500));
  const refused = await post('/settings/setup', form);
  expect(refused.status).toBe(422);
  const html = await refused.text();
  expect(alertOf(html)).toContain(`<a href="#f-${key}">Go to it</a>`);
  expect(html).toContain(`id="f-${key}" form="settings-form" aria-invalid="true" aria-describedby="e-setup"`);
  expect(html).toContain('x'.repeat(1500));
});

test('a form that is not wired keeps the plain error page', async () => {
  const id = idFrom(await uploadPdf());
  const refused = await post(`/receipts/${id}/kind`, new URLSearchParams({ kind: 'nonsense', revision: '1' }));
  expect(refused.status).toBeGreaterThanOrEqual(400);
  const html = await refused.text();
  expect(html).toContain('role="alert"');
  expect(html).not.toContain('Nothing was saved.');
});

test("one request's refusal never shows in another running at the same time", async () => {
  const { id, tx } = await seedMismatch();
  const bad = () => post('/matches', new URLSearchParams({ transaction_id: tx, receipt_id: id, action: 'link' }));
  const bankUrl = '/payments?month=2026-09&view=all';
  const quiet = await Promise.all(
    [bankUrl, '/receipts?view=todo', '/'].map(async (path) => (await request(path)).text()),
  );
  const results = await Promise.all([bad(), request(bankUrl), bad(), request('/receipts?view=todo'), request('/')]);
  const [first, ...rest] = await Promise.all(results.map((r) => r.text()));
  expect(first).toContain('Nothing was saved.');
  expect(rest[1]).toContain('Nothing was saved.');
  // The pages that were not refused are what they were without any refusal running beside them.
  expect([rest[0], rest[2], rest[3]]).toEqual(quiet);
  expect(results.map((r) => r.status)).toEqual([422, 200, 422, 200, 200]);
});

// ---- Every other form that takes typed input answers a refusal in place ----
// Each: the refused status, "Nothing was saved." at the top, what was typed still in its control,
// the message beside that control (aria-describedby names it), and no full-page "That didn't work".
const plainPage = (html: string) => html.includes("That didn't work") || html.includes('That didn&#39;t work');
function described(html: string, id: string, scope: string) {
  expect(html).toMatch(new RegExp(`id="${id}"[^>]*aria-invalid="true" aria-describedby="e-${scope}"`));
  expect(html).toMatch(new RegExp(`<p class="ferr" id="e-${scope}">`));
}

test('a refused new vendor rule keeps what was typed, on Settings, with the message at the seller field', async () => {
  const body = new URLSearchParams({
    vendor_contains: '   ',
    context_contains: 'typed context',
    product: 'general',
    expense_type: 'other',
    priority: '3',
  });
  const refused = await post('/rules', body);
  expect(refused.status).toBe(422);
  const html = await refused.text();
  expect(plainPage(html)).toBe(false);
  expect(html).toContain('<h1>Settings</h1>');
  expect(alertOf(html)).toContain('Nothing was saved.');
  expect(alertOf(html)).toContain('<a href="#f-rule-new-vendor_contains">Go to it</a>');
  described(html, 'f-rule-new-vendor_contains', 'rule-new');
  expect(html).toContain('value="typed context"');
  // The section holding it is open, and so is the add form.
  expect(html).toMatch(/<details class="sect" open><summary><h2>Business<\/h2>/);
  expect(html).toMatch(/<details class="add" open><summary>Add rule/);
});

test('a refused edit of one vendor rule shows the typed value in that rule only', async () => {
  const created = await post(
    '/rules',
    new URLSearchParams({
      vendor_contains: 'Edit Me Shop',
      product: 'general',
      expense_type: 'other',
      priority: '1',
    }),
  );
  expect(created.status).toBe(303);
  const id = Number(
    await env.DB.prepare("SELECT id FROM vendor_rules WHERE vendor_contains='Edit Me Shop'").first('id'),
  );
  const refused = await post(
    `/rules/${id}`,
    new URLSearchParams({
      vendor_contains: 'Edit Me Shop',
      bank_alias: 'x'.repeat(201),
      product: 'general',
      expense_type: 'other',
      priority: '1',
    }),
  );
  expect(refused.status).toBe(422);
  const html = await refused.text();
  expect(alertOf(html)).toContain('Nothing was saved.');
  described(html, `f-rule-${id}-bank_alias`, `rule-${id}`);
  expect(html).toContain('x'.repeat(201));
  expect(html).toContain(`<details open><summary>Edit Me Shop`);
});

test('a refused rule made from a receipt page stays on that receipt with the form open', async () => {
  const id = idFrom(await uploadPdf());
  const refused = await post(
    '/rules',
    new URLSearchParams({
      return_to: `/receipts/${id}`,
      vendor_contains: ' ',
      context_contains: 'kept words',
      product: 'general',
      expense_type: 'other',
      priority: '0',
    }),
  );
  expect(refused.status).toBe(422);
  const html = await refused.text();
  expect(plainPage(html)).toBe(false);
  expect(html).toContain(`action="/receipts/${id}`);
  described(html, 'f-rule-receipt-vendor_contains', 'rule-receipt');
  expect(html).toContain('value="kept words"');
  expect(html).toMatch(/<details open><summary>Always file as/);
});

test('a refused rename of an account keeps the typed name beside the account', async () => {
  const [first] = (
    await env.DB.prepare('SELECT id,label FROM accounts ORDER BY label').all<{ id: string; label: string }>()
  ).results;
  await env.DB.prepare(
    "INSERT INTO accounts (id,label,bank_name,default_currency,created_at) VALUES ('second','Second','','EUR','2026-01-01')",
  ).run();
  const refused = await post(`/accounts/second`, new URLSearchParams({ label: first!.label }));
  expect(refused.status).toBe(409);
  const html = await refused.text();
  expect(plainPage(html)).toBe(false);
  expect(alertOf(html)).toContain('<a href="#f-rename-second-label">Go to it</a>');
  described(html, 'f-rename-second-label', 'rename-second');
  expect(html).toContain(`value="${first!.label}"`);
  expect(html).toMatch(/<details class="sect" open><summary><h2>Bank<\/h2>/);
});

test('a refused sender address keeps what was typed in the Add row, in an open Email section', async () => {
  const refused = await post('/senders/approve', new URLSearchParams({ address: 'not an address', back: 'settings' }));
  expect(refused.status).toBe(422);
  const html = await refused.text();
  expect(plainPage(html)).toBe(false);
  described(html, 'f-address', 'sender-new');
  expect(html).toContain('value="not an address"');
  expect(html).toMatch(/<details class="sect" open><summary><h2>Email<\/h2>/);
});

test('a refused Mark paid on an invoice keeps the date and says what is missing at the field', async () => {
  const row = await seed({ kind: 'sales', client: 'Sample Client GmbH', status: 'ready', issue_date: '2026-09-01' });
  const refused = await post(
    `/receipts/${row.id}/paid`,
    new URLSearchParams({ paid_outside_on: '2026-09-30', paid_outside_note: '' }),
  );
  expect(refused.status).toBe(422);
  const html = await refused.text();
  expect(plainPage(html)).toBe(false);
  expect(alertOf(html)).toContain('<a href="#f-paid_outside_note">Go to it</a>');
  described(html, 'f-paid_outside_note', 'paid');
  expect(html).toContain('value="2026-09-30"');
});

test('a refused Add keeps the kind and says to choose a file at the file field', async () => {
  const body = new FormData();
  body.set('kind', 'sales');
  const refused = await post('/upload', body);
  expect(refused.status).toBe(422);
  const html = await refused.text();
  expect(plainPage(html)).toBe(false);
  expect(alertOf(html)).toContain('<a href="#f-file">Go to it</a>');
  described(html, 'f-file', 'add');
  expect(html).toMatch(/<input type="radio" name="kind" value="sales" checked>/);
});

test('a refused own-account transfer keeps the note typed, on the payment, in Bank', async () => {
  const left = (await defaultAccount(env.DB)).id;
  const right = (await createAccount(env.DB, { label: 'Right', bank_name: '', default_currency: 'EUR' })).id;
  const side = async (account: AccountId, id: string, amount: string) => {
    const csv = `Transaction ID;Date;Amount;Currency;Payee\n${id};2026-09-07;${amount};EUR;Own Transfer\n`;
    await importBankCsv(env, {
      bytes: new TextEncoder().encode(csv),
      parsed: parsePreset(csv, account, 'EUR'),
      collision: '',
      accountChoice: { kind: 'existing', id: account },
    });
    return hash(`${account}:id:${id}`);
  };
  const debit = await side(left, 'a', '-99,00');
  await side(right, 'b', '99,00');
  const bank = await (await request('/payments?month=2026-09&view=all')).text();
  expect(bank).toContain(`<input type="hidden" name="debit_id" value="${debit}">`);
  const refused = await post(
    '/transfers',
    new URLSearchParams({ debit_id: debit, credit_id: 'f'.repeat(64), reason: 'moving money' }),
  );
  expect(refused.status).toBe(409);
  const html = await refused.text();
  expect(plainPage(html)).toBe(false);
  expect(alertOf(html)).toContain('Nothing was saved.');
  expect(html).toContain(
    'name="reason" aria-label="Note" placeholder="Note" maxlength="500" required value="moving money"',
  );
  expect(html).toMatch(new RegExp(`<p class="ferr" id="e-transfer-${debit}">`));
});

test('the account question and the import preview answer a refusal in place', async () => {
  const csv = 'Date;Amount;Payee\n2026-09-07;-9,00;Somewhere\n';
  await env.DB.prepare(
    "INSERT INTO accounts (id,label,bank_name,default_currency,created_at) VALUES ('other','Other','','EUR','2026-01-01')",
  ).run();
  const asked = new FormData();
  asked.set('csv', btoa(csv));
  asked.set('account', 'gone-account');
  const refused = await post('/import', asked);
  expect(refused.status).toBe(409);
  const html = await refused.text();
  expect(plainPage(html)).toBe(false);
  expect(html).toContain('Which account is this?');
  described(html, 'f-account', 'import');
});
