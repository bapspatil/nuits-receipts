import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { expect, test } from 'bun:test';

function apply(dir: string, through = '\uffff'): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const file of readdirSync(dir)
    .filter((file) => file.endsWith('.sql') && file <= through)
    .sort()) {
    db.transaction(() => db.exec(readFileSync(`${dir}/${file}`, 'utf8')))();
  }
  return db;
}

function healthy(db: Database) {
  expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  expect(db.query('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
  expect(db.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
}

function shape(db: Database) {
  const objects = db
    .query<
      { type: string; name: string; tbl_name: string; sql: string | null },
      []
    >("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")
    .all();
  return objects.map((object) => ({
    ...object,
    sql: (object.sql ?? '')
      .replace(/"([a-z_][a-z_0-9]*)"/gi, '$1')
      .replace(/\s+/g, ' ')
      .replace(/\s*([(),=])\s*/g, '$1')
      .trim(),
    ...(object.type === 'table'
      ? {
          columns: db.query(`PRAGMA table_info('${object.name}')`).all(),
          foreignKeys: db.query(`PRAGMA foreign_key_list('${object.name}')`).all(),
          indexes: db
            .query<{ name: string; unique: number; origin: string; partial: number }, []>(
              `PRAGMA index_list('${object.name}')`,
            )
            .all()
            .map(({ name, unique, origin, partial }) => ({
              name,
              unique,
              origin,
              partial,
              columns: db.query(`PRAGMA index_info('${name}')`).all(),
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        }
      : {}),
  }));
}

function seedLegacy(db: Database) {
  db.exec(`
    INSERT INTO receipts (id,original_key,filename,media_type,source,received_at,status,revision,vendor,issue_date,currency,total_minor,duplicate_of)
    VALUES ('receipt-original','originals/synthetic-one.pdf','synthetic-one.pdf','application/pdf','email','2026-10-01','ready',7,'Synthetic Cloud Merchant','2026-10-01','USD',12345,NULL),
      ('receipt-copy','originals/synthetic-copy.png','synthetic-copy.png','image/png','upload','2026-10-02','needs_review',2,'Synthetic Cloud Merchant','2026-10-01','USD',12345,'receipt-original'),
      ('receipt-manual','originals/synthetic-two.pdf','synthetic-two.pdf','application/pdf','upload','2026-10-03','ready',3,'Synthetic Office Shop','2026-10-03','EUR',4500,NULL);
    INSERT INTO imports VALUES
      ('import-complete','legacy-eur','imports/synthetic-complete.csv','complete',3,'2026-10-05'),
      ('import-pending','legacy-eur','imports/synthetic-pending.csv','pending',1,'2026-10-06');
    INSERT INTO bank_transactions VALUES
      ('tx-automatic','legacy-eur','FAKE-EXT-001','import-complete','2026-10-02',-11001,'EUR',-12345,'USD','Synthetic Cloud Merchant','FAKE-001','{"synthetic":true}',1,'receipt-original','automatic','2026-10-05'),
      ('tx-manual','legacy-eur','FAKE-EXT-002','import-complete','2026-10-04',-4500,'EUR',NULL,NULL,'Synthetic Office Shop',NULL,'{"synthetic":true}',1,'receipt-manual','manual','2026-10-05'),
      ('tx-exempt','legacy-eur',NULL,'import-complete','2026-10-04',-250,'EUR',NULL,NULL,'Synthetic Bank Fee','FAKE-FEE','{"synthetic":true}',0,NULL,NULL,NULL),
      ('tx-pending','legacy-eur','FAKE-EXT-003','import-pending','2026-10-05',-300,'EUR',NULL,NULL,'Synthetic Pending Merchant',NULL,'{"synthetic":true}',1,NULL,NULL,NULL);
    INSERT INTO fx_rates VALUES ('USD','2026-10-01','2026-09-30','0.891129','synthetic fixture','2026-10-02');
  `);
}

function accountConstraints(db: Database) {
  expect(() => db.exec("INSERT INTO accounts VALUES ('second','Second','','EUR',1,NULL,'now')")).toThrow();
  expect(() => db.exec("INSERT INTO accounts VALUES ('second','BANK ACCOUNT','','EUR',0,NULL,'now')")).toThrow();
  expect(() =>
    db.exec(
      "INSERT INTO bank_presets VALUES ('preset','Synthetic','Saved','fingerprint','invalid JSON',0,'now','now')",
    ),
  ).toThrow();
  db.exec("INSERT INTO imports VALUES ('import','default-account','imports/synthetic.csv','complete',1,'now','{}')");
  expect(() =>
    db.exec(
      "INSERT INTO imports VALUES ('repeated','default-account','imports/synthetic.csv','complete',1,'now','{}')",
    ),
  ).toThrow();
  expect(() =>
    db.exec("INSERT INTO imports VALUES ('missing','unknown-account','imports/missing.csv','complete',1,'now','{}')"),
  ).toThrow();
  db.exec("INSERT INTO accounts VALUES ('other','Other','','EUR',0,NULL,'now')");
  expect(() =>
    db.exec(
      "INSERT INTO bank_transactions (id,account_key,import_id,booking_date,amount_minor,currency,merchant,raw_json) VALUES ('wrong-account','other','import','2026-10-01',-100,'EUR','Synthetic merchant','{}')",
    ),
  ).toThrow();
  expect(() =>
    db.exec("INSERT INTO internal_transfers VALUES ('missing-debit','missing-credit','Synthetic transfer','now')"),
  ).toThrow();
}

test('schema/ alone installs accounts, presets, transfers and import constraints with a healthy database', () => {
  using db = apply('schema');
  expect(db.query('SELECT id,label,bank_name,default_currency,is_default FROM accounts').all()).toEqual([
    { id: 'default-account', label: 'Bank account', bank_name: '', default_currency: 'EUR', is_default: 1 },
  ]);
  expect(db.query('SELECT * FROM bank_presets').all()).toEqual([]);
  expect(db.query('SELECT * FROM internal_transfers').all()).toEqual([]);
  accountConstraints(db);
  healthy(db);
});

test('schema/ accepts configured products and rejects invalid product lengths', () => {
  using db = apply('schema');
  const insert = db.prepare(
    "INSERT INTO receipts (id,original_key,filename,media_type,source,received_at,status,product) VALUES (?,?,'synthetic.pdf','application/pdf','upload','2026-01-01','pending',?)",
  );
  insert.run('a', 'receipts/a', 'my-custom-product');
  expect(() => insert.run('b', 'receipts/b', '')).toThrow();
  expect(() => insert.run('c', 'receipts/c', 'x'.repeat(101))).toThrow();
  expect(db.query('SELECT DISTINCT product FROM vendor_rules').all()).toEqual([{ product: 'general' }]);
  healthy(db);
});

test.skipIf(!existsSync('migrations'))(
  'populated migrations/0001..0010 preserve every legacy value, link and constraint',
  () => {
    using db = apply('migrations', '0003_duplicate_integrity.sql');
    seedLegacy(db);
    const tables = ['receipts', 'imports', 'bank_transactions', 'vendor_rules', 'fx_rates'];
    const before = new Map(tables.map((table) => [table, db.query(`SELECT * FROM ${table} ORDER BY 1`).all()]));
    db.transaction(() => db.exec(readFileSync('migrations/0004_csv_accounts.sql', 'utf8')))();
    for (const table of tables) {
      const after = db.prepare<Record<string, unknown>, []>(`SELECT * FROM ${table} ORDER BY 1`).all();
      expect(
        table === 'imports'
          ? after.map(({ snapshot_json, ...legacy }) => {
              expect(JSON.parse(String(snapshot_json))).toEqual({ version: 1, preset: 'holvi-legacy' });
              return legacy;
            })
          : after,
      ).toEqual(before.get(table));
    }
    expect(db.query('SELECT id,is_default FROM accounts').all()).toEqual([{ id: 'legacy-eur', is_default: 1 }]);
    expect(() => db.exec("UPDATE receipts SET duplicate_of='receipt-copy' WHERE id='receipt-manual'")).toThrow(
      'duplicate_chain',
    );
    expect(() => db.exec("UPDATE receipts SET duplicate_of='receipt-manual' WHERE id='receipt-original'")).toThrow(
      'duplicate_chain',
    );
    expect(() => db.exec("UPDATE bank_transactions SET receipt_id='receipt-original' WHERE id='tx-exempt'")).toThrow();
    expect(() => db.exec("UPDATE bank_transactions SET external_id='FAKE-EXT-001' WHERE id='tx-exempt'")).toThrow();
    db.exec("UPDATE receipts SET product='custom-project' WHERE id='receipt-manual'");
    expect(() => db.exec("UPDATE receipts SET product='' WHERE id='receipt-manual'")).toThrow();
    db.transaction(() => db.exec(readFileSync('migrations/0005_month_package.sql', 'utf8')))();
    expect(db.query('SELECT count(*) n FROM receipts').get()).toEqual({ n: 3 });
    expect(() => db.exec("INSERT INTO month_sends VALUES ('2026-10','now','email',1,0,'h','[]')")).toThrow();
    expect(() =>
      db.exec(
        "INSERT INTO onedrive_connection (id,account_name,account_email,refresh_token_enc,connected_at) VALUES (2,'a','b','c','now')",
      ),
    ).toThrow();
    // 0006: sales invoices share the table; every existing row is an expense.
    db.transaction(() => db.exec(readFileSync('migrations/0006_sales_invoices.sql', 'utf8')))();
    expect(db.query('SELECT DISTINCT kind FROM receipts').all()).toEqual([{ kind: 'expense' }]);
    expect(() => db.exec("UPDATE receipts SET kind='income' WHERE id='receipt-manual'")).toThrow();
    expect(() => db.exec("UPDATE receipts SET vat_treatment='zero' WHERE id='receipt-manual'")).toThrow();
    // 0007: in-app settings start empty, so Worker vars stay the source.
    db.transaction(() => db.exec(readFileSync('migrations/0007_settings.sql', 'utf8')))();
    expect(db.query('SELECT count(*) AS n FROM settings').get()).toEqual({ n: 0 });
    expect(() => db.exec("INSERT INTO settings VALUES ('APP_NAME','not json','now','x')")).toThrow();
    expect(() => db.exec("INSERT INTO settings VALUES ('','\"x\"','now','x')")).toThrow();
    // 0008: the mail log and ignored senders start empty; receipts are untouched.
    db.transaction(() => db.exec(readFileSync('migrations/0008_inbound_mail.sql', 'utf8')))();
    expect(db.query('SELECT count(*) n FROM receipts').get()).toEqual({ n: 3 });
    expect(db.query('SELECT count(*) AS n FROM inbound_mail').get()).toEqual({ n: 0 });
    const mail = db.prepare(
      "INSERT INTO inbound_mail (id,received_at,sender,message_id,state,reason) VALUES (?,'now','a@b.c',?,?,?)",
    );
    mail.run('m1', '<x@y>', 'held', 'sender_not_allowed');
    expect(() => mail.run('m2', '<x@y>', 'held', 'sender_not_allowed')).toThrow();
    mail.run('m3', '<x@y>', 'dropped', 'duplicate');
    expect(() => mail.run('m4', null, 'waiting', 'x')).toThrow();
    expect(() => mail.run('m5', null, 'held', '')).toThrow();
    db.exec('DELETE FROM inbound_mail');
    // 0009: discard is additive; nothing starts discarded, reasons are checked.
    db.transaction(() => db.exec(readFileSync('migrations/0009_discard.sql', 'utf8')))();
    expect(db.query('SELECT count(*) n FROM receipts WHERE discarded_at IS NULL').get()).toEqual({ n: 3 });
    db.exec("UPDATE receipts SET discarded_at='now',discard_reason='personal' WHERE id='receipt-manual'");
    expect(() => db.exec("UPDATE receipts SET discard_reason='food' WHERE id='receipt-manual'")).toThrow();
    db.exec("UPDATE receipts SET discarded_at=NULL,discard_reason=NULL WHERE id='receipt-manual'");
    // 0010: nothing is decided yet on existing payments; only known deciders are accepted.
    db.transaction(() => db.exec(readFileSync('migrations/0010_auto_match.sql', 'utf8')))();
    expect(db.query('SELECT count(*) n FROM bank_transactions WHERE exempt_by IS NOT NULL').get()).toEqual({ n: 0 });
    db.exec("UPDATE bank_transactions SET exempt_by='tax' WHERE id='tx-exempt'");
    db.exec("UPDATE bank_transactions SET exempt_by='delivery' WHERE id='tx-exempt'");
    expect(() => db.exec("UPDATE bank_transactions SET exempt_by='guess' WHERE id='tx-exempt'")).toThrow();
    db.exec("UPDATE bank_transactions SET exempt_by=NULL WHERE id='tx-exempt'");
    expect(db.query('SELECT count(*) n FROM match_rejections').get()).toEqual({ n: 0 });
    healthy(db);
    using fresh = apply('schema');
    expect(shape(fresh)).toEqual(shape(db));
    healthy(fresh);
  },
);

test.skipIf(!existsSync('migrations'))(
  'schema/ and empty migrations/0001..0010 have identical tables, columns, indexes, triggers and foreign keys',
  () => {
    using fresh = apply('schema');
    using upgraded = apply('migrations');
    expect(shape(fresh)).toEqual(shape(upgraded));
    healthy(fresh);
    healthy(upgraded);
  },
);
