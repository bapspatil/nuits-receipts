import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const upgradeName = '0004_csv_accounts.sql';

async function legacyDatabase() {
  await env.DB.batch(
    [
      'PRAGMA defer_foreign_keys = ON',
      ...[
        'internal_transfers',
        'bank_transactions',
        'imports',
        'receipts',
        'bank_presets',
        'accounts',
        'vendor_rules',
        'fx_rates',
        'd1_migrations',
      ].map((table) => `DROP TABLE IF EXISTS ${table}`),
      'PRAGMA defer_foreign_keys = OFF',
    ].map((sql) => env.DB.prepare(sql)),
  );
  await applyD1Migrations(
    env.DB,
    env.TEST_UPGRADE_MIGRATIONS.filter((migration) => migration.name < upgradeName),
  );
}

async function upgrade() {
  const migration = env.TEST_UPGRADE_MIGRATIONS.find((item) => item.name === upgradeName);
  if (!migration) throw new Error('0004_csv_accounts.sql migration is missing');
  await applyD1Migrations(env.DB, [migration]);
}

async function rows(sql: string) {
  return (await env.DB.prepare(sql).all()).results;
}

async function healthyDatabase() {
  expect(await rows('PRAGMA foreign_key_check')).toEqual([]);
  // D1 authorizes quick_check but rejects integrity_check with SQLITE_AUTH.
  expect(await rows('PRAGMA quick_check')).toEqual([{ quick_check: 'ok' }]);
  expect(await env.DB.prepare('PRAGMA foreign_keys').first('foreign_keys')).toBe(1);
}

async function seedLegacy() {
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO receipts (
      id,original_key,filename,media_type,source,email_key,received_at,status,
      attempt_id,lease_until,revision,vendor,invoice_number,issue_date,due_date,
      currency,total_minor,net_minor,vat_minor,vat_rate_bps,line_items_json,
      product,expense_type,classification_json,ai_json,manual_fields_json,
      review_reasons_json,reviewed_at,fx_eur_minor,fx_requested_date,
      eur_override_minor,eur_override_reason,duplicate_of
    ) VALUES (
      'receipt-original','originals/synthetic-one.pdf','synthetic-one.pdf','application/pdf',
      'email','emails/synthetic.eml','2026-10-01T12:01:00Z','ready',
      'attempt-old','2026-10-01T12:02:00Z',7,'Synthetic Cloud Merchant','FAKE-001',
      '2026-10-01','2026-10-15','USD',12345,10000,2345,2345,'["Synthetic hosting"]',
      'Nuits general','infra','{"rule":9}','{"model":"synthetic"}',
      '{"vendor":true,"total_minor":true}','[]','2026-10-02T09:00:00Z',
      11001,'2026-10-01',11111,'Accountant supplied rate',NULL
    )`),
    env.DB.prepare(`INSERT INTO receipts (
      id,original_key,filename,media_type,source,received_at,status,revision,
      vendor,issue_date,currency,total_minor,duplicate_of
    ) VALUES
      ('receipt-duplicate','originals/synthetic-copy.png','synthetic-copy.png','image/png',
       'upload','2026-10-02T12:00:00Z','needs_review',2,'Synthetic Cloud Merchant',
       '2026-10-01','USD',12345,'receipt-original'),
      ('receipt-manual','originals/synthetic-two.pdf','synthetic-two.pdf','application/pdf',
       'upload','2026-10-03T12:00:00Z','ready',3,'Synthetic Office Shop',
       '2026-10-03','EUR',4500,NULL),
      ('receipt-pending','originals/synthetic-three.pdf','synthetic-three.pdf','application/pdf',
       'upload','2026-10-04T12:00:00Z','pending',0,NULL,NULL,NULL,NULL,NULL)`),
    env.DB.prepare(`INSERT INTO imports VALUES
      ('import-complete','legacy-eur','imports/synthetic-a.csv','complete',4,'2026-10-05T01:00:00Z'),
      ('import-pending','legacy-eur','imports/synthetic-b.csv','pending',1,'2026-10-06T01:00:00Z')`),
    env.DB.prepare(`INSERT INTO bank_transactions VALUES
      ('tx-automatic','legacy-eur','FAKE-EXT-001','import-complete','2026-10-02',-11001,'EUR',
       -12345,'USD','Synthetic Cloud Merchant','FAKE-001','{"source":"synthetic","row":1}',
       1,'receipt-original','automatic','2026-10-05T02:00:00Z'),
      ('tx-manual','legacy-eur','FAKE-EXT-002','import-complete','2026-10-04',-4500,'EUR',
       NULL,NULL,'Synthetic Office Shop',NULL,'{"source":"synthetic","row":2}',
       1,'receipt-manual','manual','2026-10-05T03:00:00Z'),
      ('tx-exempt','legacy-eur',NULL,'import-complete','2026-10-04',-250,'EUR',
       NULL,NULL,'Synthetic Bank Fee','FAKE-FEE','{"source":"synthetic","row":3}',
       0,NULL,NULL,NULL),
      ('tx-no-id','legacy-eur',NULL,'import-complete','2026-10-04',1000,'EUR',
       NULL,NULL,'Synthetic Transfer',NULL,'{"source":"synthetic","row":4}',
       1,NULL,NULL,NULL),
      ('tx-pending','legacy-eur','FAKE-EXT-003','import-pending','2026-10-05',-300,'EUR',
       NULL,NULL,'Synthetic Pending Merchant',NULL,'{"source":"synthetic","row":1}',
       1,NULL,NULL,NULL)`),
    env.DB.prepare(`INSERT INTO vendor_rules
      (id,priority,vendor_contains,context_contains,bank_alias,product,expense_type)
      VALUES (99,7,'synthetic','hosting','Synthetic Cloud Merchant','Nuits general','infra')`),
    env.DB.prepare(`INSERT INTO fx_rates VALUES
      ('USD','2026-10-01','2026-09-30','0.891129','synthetic fixture','2026-10-02T00:00:00Z')`),
  ]);
}

describe('0004 CSV accounts migration on local D1', () => {
  it('upgrades an empty database and enforces account and preset constraints', async () => {
    await legacyDatabase();
    await upgrade();
    expect(await rows('SELECT id,label,bank_name,default_currency,is_default,archived_at FROM accounts')).toEqual([
      {
        id: 'default-account',
        label: 'Bank account',
        bank_name: '',
        default_currency: 'EUR',
        is_default: 1,
        archived_at: null,
      },
    ]);
    expect(await rows('SELECT * FROM internal_transfers')).toEqual([]);
    expect(await rows('SELECT * FROM bank_presets')).toEqual([]);
    await expect(
      env.DB.prepare(`INSERT INTO accounts VALUES ('other','Other','','EUR',1,NULL,'now')`).run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(`INSERT INTO accounts VALUES ('other','BANK ACCOUNT','','EUR',0,NULL,'now')`).run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        `INSERT INTO bank_presets VALUES ('preset','Synthetic','Saved','fingerprint','invalid JSON',0,'now','now')`,
      ).run(),
    ).rejects.toThrow();
    await healthyDatabase();
  });

  it('preserves every populated legacy value, link and constraint while allowing custom products', async () => {
    await legacyDatabase();
    await seedLegacy();
    const tables = ['receipts', 'imports', 'bank_transactions', 'vendor_rules', 'fx_rates'];
    const before = new Map<string, Awaited<ReturnType<typeof rows>>>();
    for (const table of tables) before.set(table, await rows(`SELECT * FROM ${table} ORDER BY 1`));
    const receiptColumns = await rows('PRAGMA table_info(receipts)');
    await upgrade();
    expect((await rows('PRAGMA table_info(receipts)')).map((column) => column.name)).toEqual(
      receiptColumns.map((column) => column.name),
    );
    for (const table of tables) {
      const after = await rows(`SELECT * FROM ${table} ORDER BY 1`);
      if (table === 'imports') {
        expect(
          after.map(({ snapshot_json, ...legacy }) => {
            expect(JSON.parse(String(snapshot_json))).toEqual({ version: 1, preset: 'holvi-legacy' });
            return legacy;
          }),
        ).toEqual(before.get(table));
      } else expect(after).toEqual(before.get(table));
    }
    expect(await rows('SELECT id,label,bank_name,default_currency,is_default FROM accounts')).toEqual([
      { id: 'legacy-eur', label: 'Holvi EUR', bank_name: 'Holvi', default_currency: 'EUR', is_default: 1 },
    ]);
    await env.DB.prepare("UPDATE receipts SET product='custom-project-2026' WHERE id='receipt-manual'").run();
    await expect(env.DB.prepare("UPDATE receipts SET product='' WHERE id='receipt-manual'").run()).rejects.toThrow();
    await expect(
      env.DB.prepare("UPDATE receipts SET product=? WHERE id='receipt-manual'").bind('x'.repeat(101)).run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare("UPDATE receipts SET duplicate_of='receipt-duplicate' WHERE id='receipt-manual'").run(),
    ).rejects.toThrow('duplicate_chain');
    await expect(
      env.DB.prepare("UPDATE receipts SET duplicate_of='receipt-manual' WHERE id='receipt-original'").run(),
    ).rejects.toThrow('duplicate_chain');
    await expect(
      env.DB.prepare(
        `INSERT INTO receipts (id,original_key,filename,media_type,source,received_at,status,duplicate_of)
      VALUES ('chain','originals/chain.pdf','chain.pdf','application/pdf','upload','now','ready','receipt-duplicate')`,
      ).run(),
    ).rejects.toThrow('duplicate_chain');
    await expect(
      env.DB.prepare("UPDATE receipts SET duplicate_of=id WHERE id='receipt-manual'").run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare("UPDATE receipts SET duplicate_of='missing' WHERE id='receipt-manual'").run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare("UPDATE bank_transactions SET receipt_id='receipt-original' WHERE id='tx-exempt'").run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare("UPDATE bank_transactions SET external_id='FAKE-EXT-001' WHERE id='tx-exempt'").run(),
    ).rejects.toThrow();

    await env.DB.prepare(
      "INSERT INTO accounts VALUES ('second-account','Synthetic second bank','Synthetic','USD',0,NULL,'now')",
    ).run();
    await expect(
      env.DB.prepare(
        `INSERT INTO imports VALUES ('same-file','second-account','imports/synthetic-a.csv','pending',1,'now','{}')`,
      ).run(),
    ).rejects.toThrow();
    await env.DB.prepare(
      `INSERT INTO imports VALUES ('second-import','second-account','imports/synthetic-second.csv','complete',1,'now','{}')`,
    ).run();
    await expect(
      env.DB.prepare("UPDATE bank_transactions SET account_key='second-account' WHERE id='tx-exempt'").run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        `INSERT INTO imports VALUES ('bad-account','missing','imports/missing.csv','pending',1,'now','{}')`,
      ).run(),
    ).rejects.toThrow();
    await env.DB.prepare(
      `INSERT INTO bank_transactions
      (id,account_key,external_id,import_id,booking_date,amount_minor,currency,merchant,raw_json)
      VALUES ('second-external','second-account','FAKE-EXT-001','second-import','2026-10-02',-11001,'EUR','Synthetic other merchant','{}')`,
    ).run();
    await expect(env.DB.prepare("DELETE FROM accounts WHERE id='legacy-eur'").run()).rejects.toThrow();
    await healthyDatabase();
  });

  it('rolls back rather than merging legacy accounts that need reviewed seed mapping', async () => {
    await legacyDatabase();
    await seedLegacy();
    await env.DB.prepare(
      `INSERT INTO imports VALUES
      ('other-legacy','other-key','imports/other-legacy.csv','complete',0,'now')`,
    ).run();
    const receipts = await rows('SELECT * FROM receipts ORDER BY id');
    const imports = await rows('SELECT * FROM imports ORDER BY id');
    const transactions = await rows('SELECT * FROM bank_transactions ORDER BY id');
    await expect(upgrade()).rejects.toThrow();
    expect(await rows('SELECT * FROM receipts ORDER BY id')).toEqual(receipts);
    expect(await rows('SELECT * FROM imports ORDER BY id')).toEqual(imports);
    expect(await rows('SELECT * FROM bank_transactions ORDER BY id')).toEqual(transactions);
    expect(
      await rows(
        "SELECT name FROM sqlite_schema WHERE name IN ('accounts','receipts_v02','imports_v02','bank_transactions_v02')",
      ),
    ).toEqual([]);
    expect(await rows(`SELECT name FROM d1_migrations WHERE name='${upgradeName}'`)).toEqual([]);
    await env.DB.prepare("DELETE FROM imports WHERE id='other-legacy'").run();
    await upgrade();
    await healthyDatabase();
  });
});
