import { env } from 'cloudflare:workers';
import { afterEach, expect, test } from 'vitest';
import {
  createAccount,
  defaultAccount,
  listAccounts,
  renameAccount,
  validateAccountChoice,
  confirmTransfer,
  undoTransfer,
  listTransfers,
} from '../src/accounts';

afterEach(async () => {
  await env.DB.prepare('DELETE FROM internal_transfers').run();
});

test('new account preview is read-only and preserves its frozen random ID', async () => {
  const before = await listAccounts(env.DB);
  const choice = await validateAccountChoice(env.DB, {
    kind: 'new',
    label: '  Synthetic bank  ',
    bank_name: ' Example ',
    default_currency: 'usd',
  });
  expect(choice).toMatchObject({ kind: 'new', label: 'Synthetic bank', bank_name: 'Example', default_currency: 'USD' });
  expect(choice.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(await validateAccountChoice(env.DB, choice)).toEqual(choice);
  expect(await listAccounts(env.DB)).toEqual(before);
});

test('creates and renames accounts without changing IDs or the default', async () => {
  const initialDefault = await defaultAccount(env.DB);
  const created = await createAccount(env.DB, {
    label: 'Synthetic EUR',
    bank_name: 'Example',
    default_currency: 'EUR',
  });
  expect(created.id).not.toBe(initialDefault.id);
  expect(created.is_default).toBe(0);
  const renamed = await renameAccount(env.DB, created.id, ' Synthetic renamed ');
  expect(renamed).toMatchObject({ ...created, label: 'Synthetic renamed' });
  expect(await defaultAccount(env.DB)).toEqual(initialDefault);
  expect(await validateAccountChoice(env.DB, { kind: 'existing', id: created.id })).toEqual({
    kind: 'existing',
    id: created.id,
  });
});

test('duplicate labels are case-insensitive and invalid account intents write nothing', async () => {
  const account = await createAccount(env.DB, { label: 'Synthetic unique', bank_name: '', default_currency: 'EUR' });
  await expect(
    createAccount(env.DB, { label: 'synthetic UNIQUE', bank_name: '', default_currency: 'EUR' }),
  ).rejects.toMatchObject({ status: 409 });
  const count = (await listAccounts(env.DB)).length;
  for (const input of [
    { label: '', bank_name: '', default_currency: 'EUR' },
    { label: 'a'.repeat(101), bank_name: '', default_currency: 'EUR' },
    { label: 'valid', bank_name: 'a'.repeat(101), default_currency: 'EUR' },
    { label: 'valid', bank_name: '', default_currency: 'ZZZ' },
  ])
    await expect(createAccount(env.DB, input)).rejects.toMatchObject({ status: 422 });
  await expect(validateAccountChoice(env.DB, { kind: 'existing', id: 'missing' })).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    validateAccountChoice(env.DB, {
      kind: 'new',
      id: account.id,
      label: 'Changed',
      bank_name: '',
      default_currency: 'EUR',
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect((await listAccounts(env.DB)).length).toBe(count);
});

test('rename rejects another label and archived accounts cannot be imported', async () => {
  const one = await createAccount(env.DB, { label: 'Synthetic one', bank_name: '', default_currency: 'EUR' });
  const two = await createAccount(env.DB, { label: 'Synthetic two', bank_name: '', default_currency: 'EUR' });
  await expect(renameAccount(env.DB, two.id, 'SYNTHETIC ONE')).rejects.toMatchObject({ status: 409 });
  await env.DB.prepare('UPDATE accounts SET archived_at=? WHERE id=?').bind('2026-10-20', one.id).run();
  await expect(validateAccountChoice(env.DB, { kind: 'existing', id: one.id })).rejects.toMatchObject({ status: 409 });
  expect((await listAccounts(env.DB)).some((a) => a.id === one.id)).toBe(false);
});

async function seedPair() {
  const debit = await createAccount(env.DB, { label: 'Synthetic debit', bank_name: '', default_currency: 'EUR' });
  const credit = await createAccount(env.DB, { label: 'Synthetic credit', bank_name: '', default_currency: 'EUR' });
  for (const [id, account, amount] of [
    ['debit', debit.id, -1000],
    ['credit', credit.id, 1000],
  ] as const) {
    await env.DB.prepare(
      "INSERT INTO imports(id,account_key,original_key,status,row_count,imported_at,snapshot_json) VALUES (?,?,?,'complete',1,'2026-10-20','{}')",
    )
      .bind(id + '-import', account, id + '-file')
      .run();
    await env.DB.prepare(
      "INSERT INTO bank_transactions(id,account_key,import_id,booking_date,amount_minor,currency,merchant,reference,raw_json) VALUES (?,?,?,'2026-10-20',?,'EUR','Synthetic own transfer','fake-ref','{}')",
    )
      .bind(id, account, id + '-import', amount)
      .run();
  }
}
async function legStates() {
  return (await env.DB.prepare('SELECT id,receipt_required,receipt_id FROM bank_transactions ORDER BY id').all())
    .results;
}
const confirmation = { debit_id: 'debit', credit_id: 'credit', reason: 'Own account funding' };

test('pair and undo keep both legs, exempt atomically, and restore receipt requirements', async () => {
  await seedPair();
  await confirmTransfer(env.DB, confirmation);
  expect(await legStates()).toEqual([
    { id: 'credit', receipt_required: 0, receipt_id: null },
    { id: 'debit', receipt_required: 0, receipt_id: null },
  ]);
  expect(await listTransfers(env.DB)).toEqual([expect.objectContaining(confirmation)]);
  await expect(confirmTransfer(env.DB, confirmation)).rejects.toMatchObject({ status: 409 });
  await undoTransfer(env.DB, 'debit');
  expect(await listTransfers(env.DB)).toEqual([]);
  expect((await legStates()).map((row) => row.receipt_required)).toEqual([1, 1]);
  await expect(undoTransfer(env.DB, 'debit')).rejects.toMatchObject({ status: 409 });
});

test.each([
  "UPDATE bank_transactions SET amount_minor=999 WHERE id='credit'",
  "UPDATE bank_transactions SET amount_minor=-1000 WHERE id='credit'",
  "UPDATE bank_transactions SET currency='USD' WHERE id='credit'",
  "UPDATE bank_transactions SET receipt_required=0 WHERE id='credit'",
  "UPDATE imports SET status='pending' WHERE id='credit-import'",
  "UPDATE bank_transactions SET account_key=(SELECT account_key FROM bank_transactions WHERE id='debit'),import_id='debit-import' WHERE id='credit'",
])('rejected transfer preserves all state for %s', async (sql) => {
  await seedPair();
  await env.DB.prepare(sql).run();
  const before = await legStates();
  await expect(confirmTransfer(env.DB, confirmation)).rejects.toMatchObject({ status: 409 });
  expect(await legStates()).toEqual(before);
  expect(await listTransfers(env.DB)).toEqual([]);
});

test('a matched receipt is never unlinked by pairing', async () => {
  await seedPair();
  await env.DB.prepare(
    "INSERT INTO receipts(id,original_key,filename,media_type,source,received_at,status) VALUES ('linked','fake.pdf','fake.pdf','application/pdf','upload','2026-10-20','ready')",
  ).run();
  await env.DB.prepare("UPDATE bank_transactions SET receipt_id='linked',match_method='manual' WHERE id='debit'").run();
  const before = await legStates();
  await expect(confirmTransfer(env.DB, confirmation)).rejects.toMatchObject({ status: 409 });
  expect(await legStates()).toEqual(before);
});

test('concurrent confirmation has one winner and retains two exempt legs', async () => {
  await seedPair();
  const results = await Promise.allSettled([
    confirmTransfer(env.DB, confirmation),
    confirmTransfer(env.DB, confirmation),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(await listTransfers(env.DB)).toHaveLength(1);
  expect((await legStates()).map((row) => row.receipt_required)).toEqual([0, 0]);
});

test('a failed leg update rolls the pair insert back', async () => {
  await seedPair();
  await env.DB.exec(
    "CREATE TRIGGER reject_transfer_update BEFORE UPDATE OF receipt_required ON bank_transactions WHEN NEW.id='credit' BEGIN SELECT RAISE(ABORT,'injected_transfer_failure'); END;",
  );
  try {
    await expect(confirmTransfer(env.DB, confirmation)).rejects.toThrow();
    expect(await listTransfers(env.DB)).toEqual([]);
    expect((await legStates()).map((row) => row.receipt_required)).toEqual([1, 1]);
  } finally {
    await env.DB.exec('DROP TRIGGER reject_transfer_update');
  }
});

test('missing, reversed and blank-reason requests never hide an expense', async () => {
  await seedPair();
  await expect(confirmTransfer(env.DB, { ...confirmation, debit_id: 'missing' })).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    confirmTransfer(env.DB, { ...confirmation, debit_id: 'credit', credit_id: 'debit' }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(confirmTransfer(env.DB, { ...confirmation, reason: ' ' })).rejects.toMatchObject({ status: 422 });
  expect((await legStates()).map((row) => row.receipt_required)).toEqual([1, 1]);
});

test('a silently skipped leg update aborts and rolls the whole confirmation back', async () => {
  await seedPair();
  await env.DB.exec(
    "CREATE TRIGGER skip_transfer_update BEFORE UPDATE OF receipt_required ON bank_transactions WHEN NEW.id='credit' BEGIN SELECT RAISE(IGNORE); END;",
  );
  try {
    await expect(confirmTransfer(env.DB, confirmation)).rejects.toMatchObject({ status: 409 });
    expect(await listTransfers(env.DB)).toEqual([]);
    expect((await legStates()).map((row) => row.receipt_required)).toEqual([1, 1]);
  } finally {
    await env.DB.exec('DROP TRIGGER skip_transfer_update');
  }
});

test('a failed undo rolls back pair deletion and both receipt requirements', async () => {
  await seedPair();
  await confirmTransfer(env.DB, confirmation);
  await env.DB.exec(
    "CREATE TRIGGER skip_transfer_undo BEFORE UPDATE OF receipt_required ON bank_transactions WHEN NEW.id='credit' BEGIN SELECT RAISE(IGNORE); END;",
  );
  try {
    await expect(undoTransfer(env.DB, 'debit')).rejects.toMatchObject({ status: 409 });
    expect(await listTransfers(env.DB)).toHaveLength(1);
    expect((await legStates()).map((row) => row.receipt_required)).toEqual([0, 0]);
  } finally {
    await env.DB.exec('DROP TRIGGER skip_transfer_undo');
  }
});

test('concurrent undo restores requirements exactly once', async () => {
  await seedPair();
  await confirmTransfer(env.DB, confirmation);
  const results = await Promise.allSettled([undoTransfer(env.DB, 'debit'), undoTransfer(env.DB, 'debit')]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(await listTransfers(env.DB)).toEqual([]);
  expect((await legStates()).map((row) => row.receipt_required)).toEqual([1, 1]);
});

test('stale undo leaves the pair and current leg states untouched', async () => {
  await seedPair();
  await confirmTransfer(env.DB, confirmation);
  await env.DB.prepare("UPDATE bank_transactions SET receipt_required=1 WHERE id='credit'").run();
  const before = await legStates();
  await expect(undoTransfer(env.DB, 'debit')).rejects.toMatchObject({ status: 409 });
  expect(await legStates()).toEqual(before);
  expect(await listTransfers(env.DB)).toHaveLength(1);
});
