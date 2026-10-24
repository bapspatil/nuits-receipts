import { env } from 'cloudflare:workers';
import { expect, test, vi } from 'vitest';
import { importBankCsv, parsePreset, importIdentity, reconcile } from '../src/banking';

async function account(id: string) {
  await env.DB.prepare('INSERT INTO accounts(id,label,bank_name,default_currency,created_at) VALUES (?,?,?,?,?)')
    .bind(id, id, 'Synthetic bank', 'EUR', '2026-10-20')
    .run();
}
const csv = 'Transaction ID;Date;Amount;Currency;Payee\na;2026-09-07;-12,50;EUR;Fake Merchant\n';
function input(text = csv, key = 'test-account', collision = '') {
  return { bytes: new TextEncoder().encode(text), parsed: parsePreset(text, key, 'EUR'), collision };
}
async function count(table: 'imports' | 'bank_transactions') {
  return env.DB.prepare(`SELECT count(*) n FROM ${table}`).first('n');
}

test('same bytes in another account are blocked before loser rows are written', async () => {
  await account('test-account');
  await account('other-account');
  await importBankCsv(env, input());
  await expect(importBankCsv(env, input(csv, 'other-account'))).rejects.toThrow(/different account/i);
  expect(await count('imports')).toBe(1);
  expect(await count('bank_transactions')).toBe(1);
});

test('pending imports freeze collision decisions and reject changed replay', async () => {
  await account('test-account');
  const noId = 'Date;Amount;Payee\n2026-09-01;-10,00;Fake Merchant\n';
  await importBankCsv(env, input(noId));
  const overlapping = noId.replace('-10,00', '-10.00');
  const prepare = env.DB.prepare.bind(env.DB);
  const spy = vi.spyOn(env.DB, 'prepare').mockImplementation((sql) => {
    if (sql.startsWith("UPDATE imports SET status='complete'")) throw new Error('interrupted');
    return prepare(sql);
  });
  await expect(importBankCsv(env, input(overlapping, 'test-account', 'additional'))).rejects.toThrow('interrupted');
  spy.mockRestore();
  await expect(importBankCsv(env, input(overlapping, 'test-account', 'keep_existing'))).rejects.toThrow(
    /didn't finish/i,
  );
  await importBankCsv(env, input(overlapping, 'test-account', 'additional'));
  expect(await count('bank_transactions')).toBe(2);
});

test('a conflicting external-ID insert race cannot complete an import', async () => {
  await account('test-account');
  const prepare = env.DB.prepare.bind(env.DB),
    batch = env.DB.batch.bind(env.DB);
  let insertingRows = false,
    injected = false;
  const prepareSpy = vi.spyOn(env.DB, 'prepare').mockImplementation((sql) => {
    if (sql.startsWith('INSERT INTO bank_transactions')) insertingRows = true;
    return prepare(sql);
  });
  const batchSpy = vi.spyOn(env.DB, 'batch').mockImplementation(async (statements) => {
    if (insertingRows && !injected) {
      injected = true;
      await importBankCsv(env, input(csv.replace('-12,50', '-13,50')));
    }
    return batch(statements);
  });
  try {
    await expect(importBankCsv(env, input())).rejects.toThrow(/doesn't match what you imported/i);
  } finally {
    prepareSpy.mockRestore();
    batchSpy.mockRestore();
  }
  expect(injected).toBe(true);
  const first = await importIdentity('test-account', input().bytes);
  expect(await env.DB.prepare('SELECT status FROM imports WHERE id=?').bind(first.id).first('status')).toBe('pending');
  expect(await count('bank_transactions')).toBe(1);
});

test('pending rows do not appear in export valuations or reconciliation', async () => {
  await account('test-account');
  const id = await importBankCsv(env, input());
  await env.DB.prepare("UPDATE imports SET status='pending' WHERE id=?").bind(id).run();
  await reconcile(env);
  const stored = await env.DB.prepare('SELECT receipt_id FROM bank_transactions').first('receipt_id');
  expect(stored).toBeNull();
});

test('an R2-only upload is repaired and complete replay preserves exemptions', async () => {
  await account('test-account');
  const value = input();
  const identity = await importIdentity('test-account', value.bytes);
  await env.ORIGINALS.put(identity.key, value.bytes);
  await importBankCsv(env, value);
  await env.DB.prepare('UPDATE bank_transactions SET receipt_required=0').run();
  await importBankCsv(env, value);
  expect(await count('imports')).toBe(1);
  expect(await env.DB.prepare('SELECT receipt_required FROM bank_transactions').first('receipt_required')).toBe(0);
});
