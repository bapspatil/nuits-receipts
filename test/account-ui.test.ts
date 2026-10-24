import { env } from 'cloudflare:workers';
import Papa from 'papaparse';
import { expect, test } from 'vitest';
import { importBankCsv, parsePreset, reconcile, eurValue } from '../src/banking';
import { getReceipt } from '../src/receipts';
import { idFrom, locationOf, request, uploadPdf } from './helpers';
async function account(id: string, label: string) {
  await env.DB.prepare('INSERT INTO accounts(id,label,bank_name,default_currency,created_at) VALUES (?,?,?, ?,?)')
    .bind(id, label, 'Fake Bank', 'EUR', '2026-10-20')
    .run();
}
const csv = 'Transaction ID;Date;Amount;Currency;Payee\na;2026-09-07;-125,50;EUR;Sample Cloud Lantern Oy\n';
async function bank(key: string, text = csv) {
  return importBankCsv(env, {
    bytes: new TextEncoder().encode(text),
    parsed: parsePreset(text, key, 'EUR'),
    collision: '',
    crossAccountAcknowledged: true,
  });
}
async function receipt() {
  const response = await uploadPdf();
  return getReceipt(env, idFrom(response));
}
test('account picker and create/rename forms use immutable IDs and generic labels', async () => {
  // The import form lives on /import only (no longer duplicated on home and payments).
  expect(await (await request('/?month=2026-09')).text()).not.toContain('action="/imports/csv"');
  const page = await (await request('/import')).text();
  expect(page).toContain('Import a bank statement');
  expect(page).toContain('value="default-account"');
  expect(page).toContain('account_label');
  const created = await request('/accounts', {
    method: 'POST',
    body: new URLSearchParams({ label: 'Fake Savings', bank_name: 'Fake Bank', default_currency: 'EUR' }),
  });
  expect(created.status).toBe(303);
  // Accounts are configuration: the forms live in Settings, and so does the way back.
  expect(locationOf(created)).toBe('/settings?done=accountCreated#accounts');
  const id = await env.DB.prepare("SELECT id FROM accounts WHERE label='Fake Savings'").first<string>('id');
  expect(id).toBeTruthy();
  const renamed = await request('/accounts/' + id, {
    method: 'POST',
    body: new URLSearchParams({ label: 'Renamed Savings' }),
  });
  expect(renamed.status).toBe(303);
  expect(locationOf(renamed)).toBe('/settings?done=accountRenamed&name=Renamed+Savings#accounts');
  expect(await env.DB.prepare('SELECT id FROM accounts WHERE label=?').bind('Renamed Savings').first('id')).toBe(id);
});
test('automatic matching searches all accounts and ambiguity across accounts stays unlinked', async () => {
  await account('account-a', 'Fake Main');
  await account('account-b', 'Fake Savings');
  await bank('account-a');
  await bank('account-b', csv.replace('-125,50', '-125.50'));
  const r = await receipt();
  await reconcile(env);
  expect(await env.DB.prepare('SELECT count(*) n FROM bank_transactions WHERE receipt_id IS NOT NULL').first('n')).toBe(
    0,
  );
  const page = await (await request('/receipts/' + r.id)).text();
  expect(page).toContain('Fake Main');
  expect(page).toContain('Fake Savings');
  expect(page.indexOf('Fake Main')).toBeLessThan(page.indexOf('Fake Savings'));
  expect(await env.DB.prepare('SELECT count(*) n FROM bank_transactions').first('n')).toBe(2);
});
test('matches and payments show accounts and export appends two formula-safe account fields', async () => {
  await account('account-a', '=Fake Main');
  await bank('account-a');
  const r = await receipt();
  expect((await eurValue(env, r)).source).toBe('bank');
  const payments = await (await request('/payments?month=2026-09')).text();
  expect(payments).toContain('=Fake Main');
  expect(payments).toContain(`<a class="tag ok" href="/receipts/${r.id}">Receipt</a>`);
  expect(await (await request('/receipts/' + r.id)).text()).toContain('=Fake Main');
  const csv = Papa.parse<Record<string, string>>(await (await request('/export.csv?month=2026-09')).text(), {
    header: true,
  });
  expect(csv.meta.fields?.slice(-2)).toEqual(['matched_account_id', 'matched_account_name']);
  expect(csv.meta.fields).toHaveLength(20);
  expect(csv.data[0]?.matched_account_id).toBe('account-a');
  expect(csv.data[0]?.matched_account_name).toBe("'=Fake Main");
});
test('manual transfer confirm and undo retain both legs and block normal exemption toggles', async () => {
  await account('account-a', 'Fake Main');
  await account('account-b', 'Fake Savings');
  await bank('account-a', csv.replace('-125,50', '-50,00').replace('Sample Cloud Lantern Oy', 'Fake own transfer'));
  await bank('account-b', csv.replace('-125,50', '50,00').replace('Sample Cloud Lantern Oy', 'Fake own transfer'));
  const rows = (
    await env.DB.prepare('SELECT id,amount_minor FROM bank_transactions ORDER BY amount_minor').all<{
      id: string;
      amount_minor: number;
    }>()
  ).results;
  const debit = rows[0]!.id,
    credit = rows[1]!.id;
  const paired = await request('/transfers', {
    method: 'POST',
    body: new URLSearchParams({ debit_id: debit, credit_id: credit, reason: 'Fake own transfer' }),
  });
  expect(paired.status).toBe(303);
  // Transfers live on Bank now, in the month the money left.
  expect(locationOf(paired)).toMatch(
    /^\/payments\?month=2026-09&show=all&done=transferMade&tx=[a-f0-9]{64}&name=[^&#]+#transfers$/,
  );
  const page = await (await request('/payments?month=2026-09&show=all')).text();
  // Both legs say where the money went; Undo is in each row's More.
  expect(page).toContain(`<li class="pay" id="transfers">`);
  expect(page).toContain('<span class="tag">Transfer to Fake Savings</span>');
  expect(page).toContain('<span class="tag">Transfer from Fake Main</span>');
  expect(page.match(/<button class="linkbtn">Undo transfer<\/button>/g)).toHaveLength(2);
  expect(page).toContain('<div class="stmts" id="imports"><details><summary>Statements (2)</summary>');
  expect(page).not.toContain('stamp missing');
  expect(
    (await request('/payments/' + debit, { method: 'POST', body: new URLSearchParams({ receipt_required: '1' }) }))
      .status,
  ).toBe(409);
  const undone = await request('/transfers/' + debit + '/undo', { method: 'POST' });
  expect(undone.status).toBe(303);
  expect(locationOf(undone)).toMatch(/^\/payments\?month=2026-09&show=all&done=transferUndone#transfers$/);
  // Unpaired again: the debit is missing, and its More offers the pair once more.
  const again = await (await request('/payments?month=2026-09')).text();
  expect(again).toContain(
    `<input type="hidden" name="debit_id" value="${debit}"><select name="credit_id" aria-label="Arrived in"><option value="${credit}">Fake Savings · 7 Sep</option>`,
  );
  expect(await env.DB.prepare('SELECT sum(receipt_required) n FROM bank_transactions').first('n')).toBe(2);
  expect(await env.DB.prepare('SELECT count(*) n FROM bank_transactions').first('n')).toBe(2);
  expect(await (await request('/payments?month=2026-09')).text()).toContain(
    '<span class="stamp missing">Missing</span>',
  );
});

test('legacy account IDs with spaces keep their identity when renamed through the rendered form', async () => {
  await account('Legacy EUR account', 'Legacy account');
  const html = await (await request('/settings')).text();
  expect(html).toContain('/accounts/Legacy%20EUR%20account');
  expect(
    (
      await request('/accounts/Legacy%20EUR%20account', {
        method: 'POST',
        body: new URLSearchParams({ label: 'Renamed legacy account' }),
      })
    ).status,
  ).toBe(303);
  expect(await env.DB.prepare('SELECT id FROM accounts WHERE label=?').bind('Renamed legacy account').first('id')).toBe(
    'Legacy EUR account',
  );
});
test('legacy formula account IDs are escaped in accountant exports', async () => {
  await account('=1+1', 'Fake formula account');
  await bank('=1+1');
  await receipt();
  const csv = Papa.parse<Record<string, string>>(await (await request('/export.csv?month=2026-09')).text(), {
    header: true,
  });
  expect(csv.data[0]?.matched_account_id).toBe("'=1+1");
});
