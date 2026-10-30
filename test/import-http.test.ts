import { env } from 'cloudflare:workers';
import { expect, test, vi } from 'vitest';
import type { CsvMapping } from '../src/csv';
import { request, confirmationForm } from './helpers';

const holvi = 'Transaction ID;Date;Amount;Currency;Payee\na;2026-09-07;-12,50;EUR;Fake Merchant\n';
const generic = 'Booked|Seller|Paid\n2026-09-07|Fake Shop|-12.50\n';
const mapping: CsvMapping = {
  version: 1,
  encoding: 'utf-8',
  delimiter: '|',
  headerRecord: 0,
  trailingRecords: 0,
  date: { column: 0, format: 'ISO', time: 'none' },
  number: { decimal: '.', grouping: '' },
  amount: { kind: 'signed', column: 2, outgoing: 'negative' },
  currency: { kind: 'default', currency: 'EUR' },
  merchant: 1,
  reference: null,
  externalId: null,
  original: null,
};
function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [name, value] of Object.entries(values)) result.set(name, value);
  return result;
}
async function preview(text = holvi, values: Record<string, string> = {}) {
  const body = form({ account: 'holvi', ...values });
  body.set('file', new File([text], 'synthetic-bank.csv', { type: 'text/csv' }));
  return request('/imports/csv', { method: 'POST', body });
}
const confirmForm = confirmationForm;
async function confirm(body: FormData) {
  return request('/imports/csv/confirm', { method: 'POST', body });
}
async function inventory() {
  const counts = await env.DB.prepare(
    `SELECT
    (SELECT count(*) FROM accounts) accounts,
    (SELECT count(*) FROM imports) imports,
    (SELECT count(*) FROM bank_transactions) transactions,
    (SELECT count(*) FROM bank_presets) presets`,
  ).first();
  return { counts, keys: (await env.ORIGINALS.list()).objects.map((object) => object.key).sort() };
}

test('CSV preview and a forged legacy confirm flag never write D1 or R2', async () => {
  const before = await inventory();
  for (const confirm of ['', 'yes']) {
    const response = await preview(holvi, { confirm });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Fake Merchant');
    expect(confirmForm(html).get('preview_token')).toBeTruthy();
    expect(await inventory()).toEqual(before);
  }
  expect(fetch).not.toHaveBeenCalled();
});

test('a mapped generic CSV confirms once and replay preserves the transaction', async () => {
  const response = await preview(generic, { mapping: JSON.stringify(mapping) });
  expect(response.status).toBe(200);
  const body = confirmForm(await response.text());
  expect((await confirm(body)).status).toBe(303);
  const stored = await env.DB.prepare('SELECT id,amount_minor,currency,merchant FROM bank_transactions').first();
  expect(stored).toMatchObject({ amount_minor: -1250, currency: 'EUR', merchant: 'Fake Shop' });
  const complete = await inventory();
  expect(complete.counts).toMatchObject({ imports: 1, transactions: 1 });
  expect(complete.keys).toHaveLength(1);
  expect((await confirm(body)).status).toBe(303);
  expect(await inventory()).toEqual(complete);
  expect(await env.DB.prepare('SELECT id,amount_minor,currency,merchant FROM bank_transactions').first()).toEqual(
    stored,
  );
  expect(fetch).not.toHaveBeenCalled();
});

test('row errors retain an editable mapping and block confirmation without writes', async () => {
  const before = await inventory();
  const response = await preview(generic.replace('-12.50', 'oops'), { mapping: JSON.stringify(mapping) });
  expect(response.status).toBe(422);
  const html = await response.text();
  expect(html).toContain('map_amount');
  expect(html).toMatch(/amount/i);
  expect(html).not.toContain('action="/imports/csv/confirm"');
  expect(await inventory()).toEqual(before);
});

test('explicit slash mapping still requires a separate order confirmation', async () => {
  const slash = generic.replace('2026-09-07', '03/04/2026');
  const values = { mapping: JSON.stringify({ ...mapping, date: { column: 0, format: 'MM/DD/YYYY', time: 'none' } }) };
  const before = await inventory();
  const blocked = await preview(slash, values);
  expect(blocked.status).toBe(422);
  expect(await inventory()).toEqual(before);
  const response = await preview(slash, { ...values, slash_order_confirmed: 'yes' });
  expect(response.status).toBe(200);
  expect((await confirm(confirmForm(await response.text()))).status).toBe(303);
  expect(await env.DB.prepare('SELECT booking_date FROM bank_transactions').first('booking_date')).toBe('2026-03-04');
});

test('confirmation requires a signed preview and never accepts an unsigned import', async () => {
  const before = await inventory();
  const body = form({
    csv: btoa(holvi),
    mapping: JSON.stringify(mapping),
    account_choice: JSON.stringify({ kind: 'existing', id: 'holvi' }),
  });
  expect((await confirm(body)).status).toBe(409);
  expect(await inventory()).toEqual(before);
});

test.each(['csv', 'mapping', 'account_choice', 'collision', 'acknowledge_other_account', 'expires', 'preview_token'])(
  'confirmation rejects changed %s without writes',
  async (field) => {
    const response = await preview(generic, { mapping: JSON.stringify(mapping) });
    expect(response.status).toBe(200);
    const body = confirmForm(await response.text());
    const before = await inventory();
    const replacements: Record<string, string> = {
      csv: btoa(generic.replace('-12.50', '-13.50')),
      mapping: JSON.stringify({ ...mapping, currency: { kind: 'default', currency: 'USD' } }),
      account_choice: JSON.stringify({ kind: 'existing', id: 'race' }),
      collision: 'additional',
      acknowledge_other_account: 'yes',
      expires: '1',
      preview_token: 'invalid',
    };
    body.set(field, replacements[field]!);
    expect((await confirm(body)).status).toBe(409);
    expect(await inventory()).toEqual(before);
  },
);

test('an expired preview requires another preview without writing', async () => {
  const response = await preview();
  expect(response.status).toBe(200);
  const body = confirmForm(await response.text());
  const before = await inventory();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 24 * 60 * 60 * 1000);
  try {
    expect((await confirm(body)).status).toBe(409);
  } finally {
    clock.mockRestore();
  }
  expect(await inventory()).toEqual(before);
});

test('a new account exists only after its signed preview is confirmed', async () => {
  const before = await inventory();
  const response = await preview(holvi, {
    account_action: 'new',
    account_label: 'Synthetic savings',
    bank_name: 'Fake Bank',
    account_currency: 'EUR',
  });
  expect(response.status).toBe(200);
  const body = confirmForm(await response.text());
  expect(await inventory()).toEqual(before);
  expect((await confirm(body)).status).toBe(303);
  const account = await env.DB.prepare(
    "SELECT id,label,bank_name FROM accounts WHERE label='Synthetic savings'",
  ).first();
  expect(account).toMatchObject({ label: 'Synthetic savings', bank_name: 'Fake Bank' });
  expect(await env.DB.prepare('SELECT account_key FROM bank_transactions').first('account_key')).toBe(account?.id);
  expect((await confirm(body)).status).toBe(303);
  expect(await env.DB.prepare("SELECT count(*) FROM accounts WHERE label='Synthetic savings'").first('count(*)')).toBe(
    1,
  );
});

test('a file imported in another account after preview invalidates confirmation', async () => {
  const first = await preview(holvi, { account: 'holvi' });
  const second = await preview(holvi, { account: 'race' });
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  const firstBody = confirmForm(await first.text()),
    secondBody = confirmForm(await second.text());
  expect((await confirm(firstBody)).status).toBe(303);
  const before = await inventory();
  expect((await confirm(secondBody)).status).toBe(409);
  expect(await inventory()).toEqual(before);
  expect((await preview(holvi, { account: 'race' })).status).toBe(409);
});

test('no-ID overlap requires a newly previewed keep or additional decision', async () => {
  const values = { mapping: JSON.stringify(mapping) };
  const first = await preview(generic, values);
  expect((await confirm(confirmForm(await first.text()))).status).toBe(303);
  const changedBytes = generic.replace('-12.50', '-12.5');
  const before = await inventory();
  const unresolved = await preview(changedBytes, values);
  expect(unresolved.status).toBe(422);
  expect(await inventory()).toEqual(before);
  const keep = await preview(changedBytes, { ...values, collision: 'keep_existing' });
  expect(keep.status).toBe(200);
  expect((await confirm(confirmForm(await keep.text()))).status).toBe(303);
  expect(await env.DB.prepare('SELECT count(*) n FROM bank_transactions').first('n')).toBe(1);
  const additional = await preview(changedBytes + '\n', {
    ...values,
    collision: 'additional',
    mapping: JSON.stringify({ ...mapping, trailingRecords: 1 }),
  });
  expect(additional.status).toBe(200);
  expect((await confirm(confirmForm(await additional.text()))).status).toBe(303);
  expect(await env.DB.prepare('SELECT count(*) n FROM bank_transactions').first('n')).toBe(2);
});

test('a layout that cannot be saved never fails the import', async () => {
  const response = await preview(),
    body = confirmForm(await response.text());
  const prepare = env.DB.prepare.bind(env.DB),
    spy = vi.spyOn(env.DB, 'prepare').mockImplementation((sql) => {
      if (sql.startsWith('INSERT INTO bank_presets')) throw new Error('Synthetic D1 failure');
      return prepare(sql);
    });
  try {
    const result = await confirm(body);
    expect(result.status).toBe(303);
  } finally {
    spy.mockRestore();
  }
  expect(await env.DB.prepare('SELECT status FROM imports').first('status')).toBe('complete');
  expect(await env.DB.prepare('SELECT count(*) n FROM bank_transactions').first('n')).toBe(1);
});

test('confirmation reports inserted, skipped and replayed counts', async () => {
  const first = await preview(),
    body = confirmForm(await first.text());
  const inserted = await confirm(body);
  expect(inserted.headers.get('Location')).toContain('done=imported');
  expect(inserted.headers.get('Location')).toContain('inserted=1');
  expect(inserted.headers.get('Location')).toContain('skipped=0');
  const replay = await confirm(body);
  expect(replay.headers.get('Location')).toContain('replayed=1');
  expect(replay.headers.get('Location')).toContain('inserted=0');
  expect(await (await request(inserted.headers.get('Location')!)).text()).toContain('Added 1 payment.');
});

test('file ownership is checked even when the second account has not mapped its headers', async () => {
  const first = await preview(generic, { mapping: JSON.stringify(mapping) });
  expect((await confirm(confirmForm(await first.text()))).status).toBe(303);
  const before = await inventory();
  expect((await preview(generic, { account: 'race' })).status).toBe(409);
  expect(await inventory()).toEqual(before);
});

test('changed editor settings on confirmation require a fresh preview', async () => {
  const initial = await preview(generic, { mapping: JSON.stringify(mapping) }),
    body = confirmForm(await initial.text());
  body.set('signed_outgoing', 'positive');
  const before = await inventory();
  expect((await confirm(body)).status).toBe(409);
  expect(await inventory()).toEqual(before);
});

test('an interrupted new-account import resumes by choosing that now-existing account', async () => {
  const initial = await preview(holvi, {
    account_action: 'new',
    account_label: 'Resume account',
    bank_name: 'Fake Bank',
    account_currency: 'EUR',
  });
  const body = confirmForm(await initial.text()),
    prepare = env.DB.prepare.bind(env.DB);
  const spy = vi.spyOn(env.DB, 'prepare').mockImplementation((sql) => {
    if (sql.startsWith("UPDATE imports SET status='complete'")) throw new Error('Synthetic interrupted confirmation');
    return prepare(sql);
  });
  try {
    expect((await confirm(body)).status).toBe(500);
  } finally {
    spy.mockRestore();
  }
  const account = await env.DB.prepare("SELECT id FROM accounts WHERE label='Resume account'").first<string>('id');
  expect(account).toBeTruthy();
  const fresh = await preview(holvi, { account: account! });
  expect(fresh.status).toBe(200);
  expect((await confirm(confirmForm(await fresh.text()))).status).toBe(303);
  expect(await env.DB.prepare('SELECT status FROM imports').first('status')).toBe('complete');
  expect(await env.DB.prepare('SELECT count(*) n FROM bank_transactions').first('n')).toBe(1);
});

test('a single matching built-in layout is shown as the chosen preset', async () => {
  const sample =
    'Transaction ID;Booking date;Amount;Currency;Payee;Reference\nS-1;2026-09-07;-125,50;EUR;Sample Oy;R-1\n';
  const html = await (await preview(sample)).text();
  expect(html).toMatch(/<option value="builtin-holvi" selected>/);
  expect(html).toContain('name="current_preset" value="builtin-holvi"');
  expect(html).not.toContain('Several presets match');
});
