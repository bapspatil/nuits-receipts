import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import worker from '../src/index';
import { feedback } from '../src/events';
import { authorization, confirmationForm, htmlForm, locationOf, request } from './helpers';
import holvi from './fixtures/banks/holvi.csv?raw';
import nordea from './fixtures/banks/nordea.csv?raw';
import op from './fixtures/banks/op.csv.b64?raw';
import revolut from './fixtures/banks/revolut.csv?raw';
import wise from './fixtures/banks/wise.csv?raw';
import n26 from './fixtures/banks/n26.csv?raw';
import us from './fixtures/banks/us.csv?raw';
import le from './fixtures/banks/utf16le.csv.b64?raw';
import be from './fixtures/banks/utf16be.csv.b64?raw';

const text = (s: string) => new TextEncoder().encode(s);
const binary = (s: string) => Uint8Array.from(atob(s.replace(/\s/g, '')), (c) => c.charCodeAt(0));
async function only(id: string, bank = '') {
  await env.DB.prepare('DELETE FROM accounts WHERE id<>?').bind(id).run();
  await env.DB.prepare('UPDATE accounts SET bank_name=? WHERE id=?').bind(bank, id).run();
}
function upload(bytes: Uint8Array | string, extra: Record<string, string> = {}, path = '/import') {
  const body = new FormData();
  body.set('file', new File([bytes], 'statement.csv'));
  for (const [k, v] of Object.entries(extra)) body.set(k, v);
  return request(path, { method: 'POST', body });
}
const count = async (table: string) => Number(await env.DB.prepare(`SELECT count(*) n FROM ${table}`).first('n'));
const params = (r: Response) => new URL(r.headers.get('Location')!, 'http://localhost').searchParams;
const said = (r: Response) => feedback(params(r))!;
const NO_ID = (rows: string[]) => `Date;Amount;Payee\n${rows.join('\n')}\n`;

// Every fixture goes through the one route. A file the app can read comes in with no question;
// the two it cannot (a preamble row, a slash date order) open the editor and write nothing.
const READ: [string, Uint8Array][] = [
  ['holvi', text(holvi)],
  ['op', binary(op)],
  ['revolut', text(revolut)],
  ['wise', text(wise)],
  ['n26', text(n26)],
  ['utf16le', binary(le)],
  ['utf16be', binary(be)],
];
test.each(READ)('%s imports in one step', async (_name, bytes) => {
  await only('holvi');
  const done = await upload(bytes);
  expect(done.status).toBe(303);
  expect(said(done).text).toMatch(/^Added \d+ payments?\./);
  expect(await count('bank_transactions')).toBeGreaterThan(0);
  expect(said(done).undo).toMatchObject({ action: '/undo', fields: { op: 'import' } });
});
test.each([
  ['nordea', text(nordea), 'No preset maps these headers'],
  ['us', text(us), 'Confirm the selected slash date order'],
])('%s opens the editor instead of guessing, and writes nothing', async (_name, bytes, why) => {
  await only('holvi');
  const response = await upload(bytes);
  expect(response.status).toBe(422);
  const html = await response.text();
  expect(html).toContain(why);
  expect(html).toContain('<details open>');
  expect(await count('imports')).toBe(0);
  expect(await count('bank_transactions')).toBe(0);
});
test('a slash-date file finishes through the editor and keeps its layout for the next one', async () => {
  await only('holvi');
  const html = await (await upload(text(us))).text();
  const form = htmlForm(html, '/imports/csv/preview');
  form.set('slash_order_confirmed', 'yes');
  const checked = await request('/imports/csv/preview', { method: 'POST', body: form });
  expect(checked.status).toBe(200);
  expect(
    (await request('/imports/csv/confirm', { method: 'POST', body: confirmationForm(await checked.text()) })).status,
  ).toBe(303);
  expect(await count('bank_transactions')).toBeGreaterThan(0);
  expect(await count('bank_presets')).toBe(1);
});

test('the account is the only one, the bank of the layout, or asked', async () => {
  // One account: no question.
  await only('holvi');
  expect((await upload(text(n26))).status).toBe(303);
  expect(await env.DB.prepare('SELECT DISTINCT account_key k FROM bank_transactions').first('k')).toBe('holvi');
  // Several accounts, one of them the layout's bank: no question.
  await env.DB.batch([env.DB.prepare('DELETE FROM bank_transactions'), env.DB.prepare('DELETE FROM imports')]);
  for (const id of ['race', 'retry-account'])
    await env.DB.prepare(
      "INSERT OR IGNORE INTO accounts(id,label,bank_name,default_currency,created_at) VALUES (?,?,'','EUR','2026-10-20')",
    )
      .bind(id, id)
      .run();
  await env.DB.prepare("UPDATE accounts SET bank_name='Synthetic bank'").run();
  await env.DB.prepare("UPDATE accounts SET bank_name='N26' WHERE id='race'").run();
  expect((await upload(text(n26))).status).toBe(303);
  expect(await env.DB.prepare('SELECT DISTINCT account_key k FROM bank_transactions').first('k')).toBe('race');
  // Several accounts and no bank to go by: one question, then the import.
  await env.DB.batch([env.DB.prepare('DELETE FROM bank_transactions'), env.DB.prepare('DELETE FROM imports')]);
  await env.DB.prepare("UPDATE accounts SET bank_name='Synthetic bank'").run();
  const asked = await upload(text(n26));
  expect(asked.status).toBe(200);
  const html = await asked.text();
  expect(html).toContain('Which account is this?');
  expect(await count('imports')).toBe(0);
  const answer = htmlForm(html, '/import');
  answer.set('account', 'retry-account');
  const done = await request('/import', { method: 'POST', body: answer });
  expect(done.status).toBe(303);
  expect(await env.DB.prepare('SELECT DISTINCT account_key k FROM bank_transactions').first('k')).toBe('retry-account');
});
test('with no account yet, one is made from the layout', async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM bank_transactions'),
    env.DB.prepare('DELETE FROM imports'),
    env.DB.prepare('DELETE FROM accounts'),
  ]);
  expect((await upload(text(n26))).status).toBe(303);
  expect(await count('accounts')).toBe(1);
});

test('rows already imported are skipped and counted, in this account only, and Import anyway adds them', async () => {
  await only('holvi');
  await env.DB.prepare(
    "INSERT INTO accounts(id,label,bank_name,default_currency,created_at) VALUES ('other','other','','EUR','2026-10-20')",
  ).run();
  const first = NO_ID(['2026-09-01;-10,00;Fake Merchant', '2026-09-02;-5,00;Other Shop']);
  const second = NO_ID(['2026-09-01;-10,00;Fake Merchant', '2026-09-03;-7,00;Third Shop']);
  expect(said(await upload(first, { account: 'holvi' })).text).toMatch(/^Added 2 payments\./);
  const done = await upload(second, { account: 'holvi' });
  const banner = said(done);
  expect(banner.text).toBe(
    'Added 1 payment. Paid out: 0 matched, 0 not a purchase, 1 missing. Skipped 1 already imported.',
  );
  expect(banner.link?.label).toBe('Import anyway');
  expect(await count('bank_transactions')).toBe(3);
  // Another account has no such rows to skip, and the banner warns that they look alike.
  const third = NO_ID(['2026-09-01;-10,00;Fake Merchant', '2026-09-04;-3,00;Fourth Shop']);
  const elsewhere = await upload(third, { account: 'other' });
  expect(said(elsewhere).text).toContain('Added 2 payments.');
  expect(said(elsewhere).text).toContain('1 payment looks like one in another account.');
  expect(said(elsewhere).text).not.toContain('Skipped');
  // Back in the first account: skip, then Import anyway takes the skipped one as an extra payment.
  await env.DB.batch([env.DB.prepare('DELETE FROM bank_transactions'), env.DB.prepare('DELETE FROM imports')]);
  await upload(first, { account: 'holvi' });
  const again = await upload(second, { account: 'holvi' });
  const link = said(again).link!;
  const confirm = await request(link.href);
  expect(confirm.status).toBe(200);
  const page = await confirm.text();
  expect(page).toContain('1 payment was skipped');
  const anyway = await request('/import/anyway', { method: 'POST', body: htmlForm(page, '/import/anyway') });
  expect(anyway.status).toBe(303);
  expect(said(anyway).text).toContain('Added 1 payment.');
  expect(await count('bank_transactions')).toBe(4);
  expect(said(anyway).link).toBeNull();
});
test('payments with a bank ID are skipped and cannot be taken twice', async () => {
  await only('holvi');
  await upload(text(holvi));
  const before = await count('bank_transactions');
  const done = await upload(text(holvi + 'holvi-fake-3;2026-09-03;-1,00;EUR;New Shop;;;\n'));
  expect(said(done).text).toMatch(/^Added 1 payment\..* Skipped 2 already imported\.$/);
  expect(said(done).link).toBeNull();
  expect(await count('bank_transactions')).toBe(before + 1);
});
test('the same file again changes nothing', async () => {
  await only('holvi');
  await upload(text(revolut));
  const again = await upload(text(revolut));
  expect(said(again).text).toMatch(/^You imported this file before/);
  expect(said(again).undo).toBeNull();
});

const UNKNOWN =
  'Posted date,Amount,Beneficiary,Details,Bank id\n2026-09-01,-4.20,Fake Shop,Card,x1\n2026-09-02,"1,250.00",Example Client,Invoice,x2\n';
test('a layout read by the model is saved on a good import, and the next file needs no detection', async () => {
  await only('holvi');
  expect(await count('bank_presets')).toBe(0);
  expect((await upload(UNKNOWN)).status).toBe(303);
  expect(await count('bank_presets')).toBe(1);
  // The saved layout answers next time, ahead of the model: change what it reads and the next file shows it.
  await env.DB.prepare("UPDATE bank_presets SET mapping_json=json_set(mapping_json,'$.merchant',3)").run();
  expect((await upload(UNKNOWN.replace('x1', 'y1').replace('x2', 'y2'))).status).toBe(303);
  expect(
    await env.DB.prepare("SELECT count(*) n FROM bank_transactions WHERE merchant IN ('Card','Invoice')").first('n'),
  ).toBe(2);
  expect(await count('bank_presets')).toBe(1);
});

test('Undo removes the import and the same file imports again', async () => {
  await only('holvi');
  const done = await upload(text(holvi));
  const rows = await count('bank_transactions');
  const { at, op } = { at: params(done).get('at')!, op: params(done).get('op')! };
  expect(op).toBe('import');
  // Marks and pairs the import's rows carry go with them.
  const [a, b] = (await env.DB.prepare('SELECT id FROM bank_transactions').all<{ id: string }>()).results;
  await env.DB.prepare(
    "INSERT INTO internal_transfers(debit_id,credit_id,reason,confirmed_at) VALUES (?,?,'x','2026-10-01')",
  )
    .bind(a!.id, b!.id)
    .run();
  await env.DB.prepare("UPDATE bank_transactions SET receipt_required=0,exempt_by='tax' WHERE id=?").bind(a!.id).run();
  const undone = await request('/undo', { method: 'POST', body: new URLSearchParams({ at, op }) });
  expect(undone.status).toBe(303);
  expect(said(undone).text).toBe(`Removed ${rows} payments of that import.`);
  expect(await count('bank_transactions')).toBe(0);
  expect(await count('imports')).toBe(0);
  expect(await count('internal_transfers')).toBe(0);
  expect(await count('undo_log')).toBe(0);
  const back = await upload(text(holvi));
  expect(said(back).text).toMatch(/^Added /);
  expect(await count('bank_transactions')).toBe(rows);
});
test.each([
  ['matched by hand', "UPDATE bank_transactions SET match_method='manual' WHERE id=?"],
  [
    'marked Not a purchase by the owner',
    "UPDATE bank_transactions SET receipt_required=0,exempt_by='owner' WHERE id=?",
  ],
])('Undo refuses once a payment was %s, and removes nothing', async (_what, sql) => {
  await only('holvi');
  const done = await upload(text(holvi));
  const rows = await count('bank_transactions');
  const id = await env.DB.prepare('SELECT id FROM bank_transactions LIMIT 1').first<string>('id');
  await env.DB.prepare(sql).bind(id).run();
  const undone = await request('/undo', {
    method: 'POST',
    body: new URLSearchParams({ at: params(done).get('at')!, op: 'import' }),
  });
  expect(undone.status).toBe(303);
  expect(said(undone).text).toBe('1 of these payments were changed since; nothing was removed.');
  expect(await count('bank_transactions')).toBe(rows);
  expect(await count('imports')).toBe(1);
});
test('Undo refuses once a payment was paired as a transfer with one of another import', async () => {
  await only('holvi');
  await upload(NO_ID(['2026-09-01;-10,00;Fake Merchant']), { account: 'holvi' });
  const done = await upload(NO_ID(['2026-09-02;10,00;Fake Merchant']), { account: 'holvi' });
  const [out, back] = (
    await env.DB.prepare('SELECT id FROM bank_transactions ORDER BY booking_date').all<{ id: string }>()
  ).results;
  await env.DB.prepare(
    "INSERT INTO internal_transfers(debit_id,credit_id,reason,confirmed_at) VALUES (?,?,'x','2026-10-01')",
  )
    .bind(out!.id, back!.id)
    .run();
  const undone = await request('/undo', {
    method: 'POST',
    body: new URLSearchParams({ at: params(done).get('at')!, op: 'import' }),
  });
  expect(undone.status).toBe(303);
  expect(said(undone).text).toBe('1 of these payments were changed since; nothing was removed.');
  expect(await count('bank_transactions')).toBe(2);
  expect(await count('internal_transfers')).toBe(1);
  expect(await count('imports')).toBe(2);
});
test('an automatic mark does not stop the Undo', async () => {
  await only('holvi');
  const done = await upload(text(holvi));
  await env.DB.prepare("UPDATE bank_transactions SET receipt_required=0,exempt_by='fee'").run();
  const undone = await request('/undo', {
    method: 'POST',
    body: new URLSearchParams({ at: params(done).get('at')!, op: 'import' }),
  });
  expect(said(undone).text).toMatch(/^Removed \d+ payments? of that import\.$/);
  expect(await count('bank_transactions')).toBe(0);
});

test('under a base path the form, the questions and the redirects carry it', async () => {
  await only('holvi');
  const based = { ...env, APP_BASE_PATH: '/app' };
  const at = (path: string, init: RequestInit = {}) =>
    worker.fetch(
      new Request('http://localhost' + path, {
        ...init,
        headers: { Authorization: authorization, Origin: 'http://localhost' },
      }),
      based,
    );
  const page = await (await at('/app/import')).text();
  expect(page).toContain('action="/app/import"');
  const body = new FormData();
  body.set('file', new File([text(n26)], 'n26.csv'));
  const done = await at('/app/import', { method: 'POST', body });
  expect(done.status).toBe(303);
  expect(locationOf(done)).toMatch(/^\/app\/payments\?month=2026-09&done=imported&inserted=1/);
  const undo = new URL(done.headers.get('Location')!, 'http://localhost').searchParams;
  const undone = await at('/app/undo', {
    method: 'POST',
    body: new URLSearchParams({ at: undo.get('at')!, op: 'import' }),
  });
  expect(undone.headers.get('Location')).toMatch(/^\/app\/payments\?done=undone&op=import&n=1/);
  // The Import anyway page and its form.
  const anyway = await (await at('/app/import/anyway?import=' + 'a'.repeat(64) + '&n=2')).text();
  expect(anyway).toContain('action="/app/import/anyway"');
});
