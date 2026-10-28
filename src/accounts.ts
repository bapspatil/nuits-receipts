import { EXPONENTS, InputError, object, requireInput } from './domain';

export type AccountId = string & { readonly __brand: 'AccountId' };
export type Account = {
  id: AccountId;
  label: string;
  bank_name: string;
  default_currency: string;
  is_default: 0 | 1;
  archived_at: string | null;
  created_at: string;
};
export type AccountChoice =
  | { kind: 'existing'; id: AccountId }
  | { kind: 'new'; id: AccountId; label: string; bank_name: string; default_currency: string };

function isAccountId(value: unknown): value is AccountId {
  return typeof value === 'string' && value.length > 0 && value.length <= 100 && !/[\x00-\x1f\x7f]/.test(value);
}
function text(value: unknown, label: string, max: number, blank = false): string {
  requireInput(typeof value === 'string', `${label} required`);
  const result = value.trim();
  requireInput(
    (blank || result.length > 0) && result.length <= max && !/[\x00-\x1f\x7f]/.test(result),
    `Invalid ${label}`,
  );
  return result;
}
export async function listAccounts(db: D1Database): Promise<Account[]> {
  return (
    await db
      .prepare('SELECT * FROM accounts WHERE archived_at IS NULL ORDER BY is_default DESC,label COLLATE NOCASE,id')
      .all<Account>()
  ).results;
}
export async function defaultAccount(db: D1Database): Promise<Account> {
  const account = await db
    .prepare('SELECT * FROM accounts WHERE is_default=1 AND archived_at IS NULL')
    .first<Account>();
  requireInput(account, 'Default account unavailable', 409);
  return account;
}
export async function validateAccountChoice(db: D1Database, input: unknown): Promise<AccountChoice> {
  const value = object(input);
  requireInput(value.kind === 'existing' || value.kind === 'new', 'Choose an account');
  const id = value.kind === 'new' && value.id === undefined ? crypto.randomUUID() : value.id;
  requireInput(isAccountId(id), 'Invalid account ID');
  const existing = await db.prepare('SELECT * FROM accounts WHERE id=?').bind(id).first<Account>();
  if (value.kind === 'existing') {
    requireInput(existing && existing.archived_at === null, 'Account unavailable; preview again', 409);
    return { kind: 'existing', id };
  }
  requireInput(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
    'Invalid new account ID',
  );
  const label = text(value.label, 'account label', 100),
    bank_name = text(value.bank_name, 'bank name', 100, true),
    default_currency = text(value.default_currency, 'account currency', 3).toUpperCase();
  requireInput(Object.hasOwn(EXPONENTS, default_currency), 'Unsupported account currency');
  requireInput(
    !existing ||
      (existing.archived_at === null &&
        existing.label === label &&
        existing.bank_name === bank_name &&
        existing.default_currency === default_currency),
    'Account changed; preview again',
    409,
  );
  const duplicate = await db
    .prepare('SELECT id FROM accounts WHERE label=? COLLATE NOCASE AND id<>?')
    .bind(label, id)
    .first();
  requireInput(!duplicate, 'Account label already exists', 409);
  return { kind: 'new', id, label, bank_name, default_currency };
}
export function accountInsertStatement(
  db: D1Database,
  choice: Extract<AccountChoice, { kind: 'new' }>,
): D1PreparedStatement {
  return db
    .prepare(
      'INSERT INTO accounts(id,label,bank_name,default_currency,created_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
    )
    .bind(choice.id, choice.label, choice.bank_name, choice.default_currency, new Date().toISOString());
}
export async function persistAccountChoice(db: D1Database, choice: AccountChoice): Promise<Account> {
  if (choice.kind === 'new') {
    try {
      await accountInsertStatement(db, choice).run();
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed: accounts.label'))
        throw new InputError('Account label already exists', 409);
      throw error;
    }
  }
  const account = await db.prepare('SELECT * FROM accounts WHERE id=?').bind(choice.id).first<Account>();
  requireInput(account, 'Account unavailable', 409);
  return account;
}
export async function createAccount(db: D1Database, input: unknown): Promise<Account> {
  const value = object(input);
  return persistAccountChoice(db, await validateAccountChoice(db, { ...value, kind: 'new' }));
}
export async function renameAccount(db: D1Database, id: string, input: unknown): Promise<Account> {
  const label = text(input, 'account label', 100);
  try {
    const account = await db
      .prepare('UPDATE accounts SET label=? WHERE id=? RETURNING *')
      .bind(label, id)
      .first<Account>();
    requireInput(account, 'Account unavailable', 409);
    return account;
  } catch (error) {
    if (String(error).includes('UNIQUE constraint failed: accounts.label'))
      throw new InputError('Account label already exists', 409);
    throw error;
  }
}

export type Transfer = {
  debit_id: string;
  credit_id: string;
  reason: string;
  confirmed_at: string;
  debit_account_id: string;
  credit_account_id: string;
  debit_account_name: string;
  credit_account_name: string;
  amount_minor: number;
  currency: string;
  debit_date: string;
  credit_date: string;
};
export async function listTransfers(db: D1Database): Promise<Transfer[]> {
  return (
    await db
      .prepare(
        `SELECT p.*,d.account_key AS debit_account_id,c.account_key AS credit_account_id,
    da.label AS debit_account_name,ca.label AS credit_account_name,d.amount_minor,d.currency,
    d.booking_date AS debit_date,c.booking_date AS credit_date
    FROM internal_transfers p JOIN bank_transactions d ON d.id=p.debit_id
    JOIN bank_transactions c ON c.id=p.credit_id JOIN accounts da ON da.id=d.account_key
    JOIN accounts ca ON ca.id=c.account_key JOIN imports di ON di.id=d.import_id
    JOIN imports ci ON ci.id=c.import_id WHERE di.status='complete' AND ci.status='complete'
    ORDER BY p.confirmed_at DESC,p.debit_id`,
      )
      .all<Transfer>()
  ).results;
}
// A SQL error rolls back the whole D1 batch, including the pair mutation.
function assertTwoLegs(db: D1Database): D1PreparedStatement {
  return db.prepare("SELECT CASE WHEN changes()=2 THEN 1 ELSE json('transfer_conflict') END AS valid");
}
function transferError(error: unknown): never {
  if (
    String(error).includes('malformed JSON') ||
    String(error).includes('UNIQUE constraint failed: internal_transfers')
  ) {
    throw new InputError('Transfer changed or unavailable; review both payments', 409);
  }
  throw error;
}
export async function confirmTransfer(db: D1Database, input: unknown): Promise<void> {
  const value = object(input),
    debit = text(value.debit_id, 'debit payment', 100),
    credit = text(value.credit_id, 'credit payment', 100),
    reason = text(value.reason, 'transfer reason', 500);
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO internal_transfers(debit_id,credit_id,reason,confirmed_at)
        SELECT d.id,c.id,?,? FROM bank_transactions d JOIN bank_transactions c
        JOIN imports di ON di.id=d.import_id JOIN imports ci ON ci.id=c.import_id
        WHERE d.id=? AND c.id=? AND di.status='complete' AND ci.status='complete'
        AND d.account_key<>c.account_key AND d.currency=c.currency
        AND d.amount_minor<0 AND c.amount_minor=-d.amount_minor
        AND d.receipt_id IS NULL AND c.receipt_id IS NULL
        AND (d.receipt_required=1 OR d.exempt_by NOT IN ('owner')) AND (c.receipt_required=1 OR c.exempt_by NOT IN ('owner'))
        AND NOT EXISTS (SELECT 1 FROM internal_transfers p
          WHERE p.debit_id IN (d.id,c.id) OR p.credit_id IN (d.id,c.id))`,
        )
        .bind(reason, new Date().toISOString(), debit, credit),
      db
        .prepare('UPDATE bank_transactions SET receipt_required=0 WHERE changes()=1 AND id IN (?,?)')
        .bind(debit, credit),
      assertTwoLegs(db),
    ]);
  } catch (error) {
    transferError(error);
  }
}
export async function undoTransfer(db: D1Database, debitId: string): Promise<void> {
  const pair = await db
    .prepare('SELECT debit_id,credit_id FROM internal_transfers WHERE debit_id=?')
    .bind(debitId)
    .first<{ debit_id: string; credit_id: string }>();
  requireInput(pair, 'Transfer unavailable', 409);
  try {
    await db.batch([
      db
        .prepare(
          `DELETE FROM internal_transfers WHERE debit_id=? AND credit_id=?
        AND EXISTS (SELECT 1 FROM bank_transactions d JOIN bank_transactions c
          JOIN imports di ON di.id=d.import_id JOIN imports ci ON ci.id=c.import_id
          WHERE d.id=? AND c.id=? AND d.receipt_required=0 AND c.receipt_required=0
          AND d.receipt_id IS NULL AND c.receipt_id IS NULL AND di.status='complete' AND ci.status='complete')`,
        )
        .bind(pair.debit_id, pair.credit_id, pair.debit_id, pair.credit_id),
      db
        .prepare('UPDATE bank_transactions SET receipt_required=1 WHERE changes()=1 AND id IN (?,?)')
        .bind(pair.debit_id, pair.credit_id),
      assertTwoLegs(db),
    ]);
  } catch (error) {
    transferError(error);
  }
}
