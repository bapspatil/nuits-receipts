import { env } from 'cloudflare:workers';
import { expect, test, vi } from 'vitest';
import { hash } from '../src/domain';
import { getReceipt } from '../src/receipts';
import { cacheFx, eurValue, importBankCsv, parsePreset, reconcile } from '../src/banking';
import { request, uploadPdf } from './helpers';

async function seed(two = false) {
  const response = await uploadPdf(),
    id = response.headers.get('Location')!.split('/').at(-1)!;
  const csv =
    'Transaction ID;Date;Amount;Currency;Payee\na;2026-09-07;-125,50;EUR;Sample Cloud Lantern Oy\n' +
    (two ? 'b;2026-09-08;-125,50;EUR;Sample Cloud Lantern Oy\n' : '');
  await importBankCsv(env, {
    bytes: new TextEncoder().encode(csv),
    parsed: parsePreset(csv, 'race', 'EUR'),
    collision: '',
  });
  return { id, transaction: await hash('race:id:a') };
}
function beforeUpdate(prefix: string, mutate: () => Promise<unknown>) {
  const prepare = env.DB.prepare.bind(env.DB);
  let intercepted = false;
  return vi.spyOn(env.DB, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql);
    if (sql.startsWith(prefix) && !intercepted) {
      const bind = statement.bind.bind(statement);
      statement.bind = (...values: unknown[]) => {
        const bound = bind(...values),
          run = bound.run.bind(bound);
        bound.run = async <T = Record<string, unknown>>() => {
          intercepted = true;
          await mutate();
          return run<T>();
        };
        return bound;
      };
    }
    return statement;
  });
}
test('manual match rejects a receipt corrected after the form was read', async () => {
  const { id, transaction } = await seed(true);
  const spy = beforeUpdate("UPDATE bank_transactions SET receipt_id=?,match_method='manual'", () =>
    env.DB.prepare("UPDATE receipts SET status='needs_review',revision=revision+1 WHERE id=?").bind(id).run(),
  );
  const response = await request('/matches', {
    method: 'POST',
    body: new URLSearchParams({
      transaction_id: transaction,
      receipt_id: id,
      action: 'link',
    }),
  });
  spy.mockRestore();
  expect(response.status).toBe(409);
  expect(
    await env.DB.prepare('SELECT receipt_id FROM bank_transactions WHERE id=?').bind(transaction).first('receipt_id'),
  ).toBeNull();
});
test('reconciliation cannot relink a payment exempted after candidate selection', async () => {
  const { transaction } = await seed();
  await env.DB.prepare('UPDATE bank_transactions SET receipt_id=NULL,match_method=NULL,matched_at=NULL WHERE id=?')
    .bind(transaction)
    .run();
  const spy = beforeUpdate("UPDATE bank_transactions SET receipt_id=?,match_method='automatic'", () =>
    env.DB.prepare('UPDATE bank_transactions SET receipt_required=0 WHERE id=?').bind(transaction).run(),
  );
  await reconcile(env);
  spy.mockRestore();
  expect(
    await env.DB.prepare('SELECT receipt_id FROM bank_transactions WHERE id=?').bind(transaction).first('receipt_id'),
  ).toBeNull();
});
test('two simultaneous manual matches cannot claim the same receipt', async () => {
  const { id, transaction } = await seed(true),
    second = await hash('race:id:b');
  const responses = await Promise.all(
    [transaction, second].map((transaction_id) =>
      request('/matches', {
        method: 'POST',
        body: new URLSearchParams({
          transaction_id,
          receipt_id: id,
          action: 'link',
        }),
      }),
    ),
  );
  expect(responses.map((r) => r.status).sort()).toEqual([303, 409]);
  expect(
    await env.DB.prepare('SELECT count(*) AS n FROM bank_transactions WHERE receipt_id=?').bind(id).first('n'),
  ).toBe(1);
});
test('missing FX still allows exact foreign bank matching, and successful FX recovery restores ready', async () => {
  const { id } = await seed();
  await env.DB.prepare('DELETE FROM bank_transactions').run();
  await env.DB.prepare(
    "UPDATE receipts SET currency='USD',total_minor=2000,net_minor=2000,vat_minor=0,vat_rate_bps=0,issue_date='2026-09-06' WHERE id=?",
  )
    .bind(id)
    .run();
  await cacheFx(env, await getReceipt(env, id));
  expect((await getReceipt(env, id)).status).toBe('needs_review');
  const csv =
    'Transaction ID;Date;Amount;Currency;Payee;Original amount;Original currency\nf;2026-09-08;-18,42;EUR;Sample Cloud Lantern Oy;-20,00;USD\n';
  await importBankCsv(env, {
    bytes: new TextEncoder().encode(csv),
    parsed: parsePreset(csv, 'foreign-recovery', 'EUR'),
    collision: '',
  });
  expect((await eurValue(env, await getReceipt(env, id))).source).toBe('bank');
  expect((await getReceipt(env, id)).status).toBe('ready');
  await env.DB.prepare('DELETE FROM bank_transactions').run();
  await env.DB.prepare(
    "UPDATE receipts SET status='needs_review',review_reasons_json='[\"missing_eur\"]',issue_date='2026-09-05' WHERE id=?",
  )
    .bind(id)
    .run();
  await cacheFx(env, await getReceipt(env, id));
  expect((await getReceipt(env, id)).status).toBe('ready');
});

test('a second account completing after candidate selection prevents a stale automatic match', async () => {
  const { id, transaction } = await seed();
  await env.DB.prepare('UPDATE bank_transactions SET receipt_id=NULL,match_method=NULL,matched_at=NULL WHERE id=?')
    .bind(transaction)
    .run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO accounts(id,label,bank_name,default_currency,created_at) VALUES ('second-race','Second race','Fake','EUR','2026-10-20')",
    ),
    env.DB.prepare(
      "INSERT INTO imports(id,account_key,original_key,status,row_count,imported_at,snapshot_json) VALUES ('race-pending','second-race','imports/race-pending.csv','pending',1,'2026-10-20','{}')",
    ),
    env.DB.prepare(
      "INSERT INTO bank_transactions(id,account_key,external_id,import_id,booking_date,amount_minor,currency,merchant,raw_json) VALUES ('second-race-tx','second-race','b','race-pending','2026-09-08',-12550,'EUR','Sample Cloud Lantern Oy','{}')",
    ),
  ]);
  const spy = beforeUpdate("UPDATE bank_transactions SET receipt_id=?,match_method='automatic'", () =>
    env.DB.prepare("UPDATE imports SET status='complete' WHERE id='race-pending'").run(),
  );
  try {
    await reconcile(env);
  } finally {
    spy.mockRestore();
  }
  expect(await env.DB.prepare('SELECT count(*) n FROM bank_transactions WHERE receipt_id=?').bind(id).first('n')).toBe(
    0,
  );
});

test('a competing receipt corrected after candidate selection prevents stale matching', async () => {
  const { id, transaction } = await seed();
  await env.DB.prepare('UPDATE bank_transactions SET receipt_id=NULL,match_method=NULL,matched_at=NULL WHERE id=?')
    .bind(transaction)
    .run();
  const original = await getReceipt(env, id),
    other = {
      ...original,
      id: await hash('competing receipt'),
      original_key: 'receipts/competing',
      vendor: 'Completely unrelated merchant',
    };
  const entries = Object.entries(other);
  await env.DB.prepare(
    `INSERT INTO receipts(${entries.map(([k]) => k).join(',')}) VALUES(${entries.map(() => '?').join(',')})`,
  )
    .bind(...entries.map(([, v]) => v))
    .run();
  const spy = beforeUpdate("UPDATE bank_transactions SET receipt_id=?,match_method='automatic'", () =>
    env.DB.prepare('UPDATE receipts SET vendor=?,revision=revision+1 WHERE id=?').bind(original.vendor, other.id).run(),
  );
  try {
    await reconcile(env);
  } finally {
    spy.mockRestore();
  }
  expect(await env.DB.prepare('SELECT count(*) n FROM bank_transactions WHERE receipt_id IS NOT NULL').first('n')).toBe(
    0,
  );
});
