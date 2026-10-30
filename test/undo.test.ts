// One Undo for every action that resolves a row: each action runs the app's
// own write with its snapshot in the same batch, and Undo puts every column it
// changed back exactly, unless the row changed again since.
import { env } from 'cloudflare:workers';
import { beforeEach, expect, test } from 'vitest';
import { arrivalMonth } from '../src/arrival';
import { SET_REQUIRED_SQL } from '../src/banking';
import { receiptsBulk } from '../src/batch';
import { discardReceipts } from '../src/discard';
import { hash, InputError } from '../src/domain';
import { unlinkMatches } from '../src/match';
import { parseUndo, undo, undoAt, withUndo, type UndoAction, type UndoAt, type UndoOp } from '../src/undo';
import { htmlForm, locationOf, request } from './helpers';

const id = (n: number) => n.toString(16).padStart(64, '0');
const caller = { who: 'owner', ctx: { waitUntil: () => {} } };

async function receipt(n: number, o: { status?: string; kind?: string; issue?: string; currency?: string } = {}) {
  await env.DB.prepare(
    `INSERT INTO receipts (id,kind,original_key,filename,media_type,source,received_at,status,revision,vendor,invoice_number,issue_date,currency,total_minor,net_minor,vat_minor,vat_rate_bps,client,manual_fields_json,review_reasons_json)
     VALUES (?1,?2,'receipts/'||?1,'r.pdf','application/pdf','upload','2026-10-20T10:00:00Z',?3,?4,'Vendor '||?4,'00123',?5,?11,?6,?7,?8,2550,?9,'{"vendor":"typed"}',?10)`,
  )
    .bind(
      id(n),
      o.kind ?? 'expense',
      o.status ?? 'needs_review',
      n,
      o.issue ?? '2026-10-20',
      123456789012 + n,
      98385330000 + n,
      25071459012,
      o.kind === 'sales' ? 'Client Oy' : null,
      o.status === 'ready' ? '[]' : '["vat_rate_mismatch"]',
      o.currency ?? 'EUR',
    )
    .run();
}
async function payment(tx: string, receiptId: string | null, o: { required?: 0 | 1; by?: string | null } = {}) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO imports(id,account_key,original_key,status,row_count,imported_at,snapshot_json) VALUES ('imp','default-account','imp-file','complete',1,'2026-10-21','{}')",
  ).run();
  await env.DB.prepare(
    `INSERT INTO bank_transactions(id,account_key,import_id,booking_date,amount_minor,currency,merchant,reference,raw_json,receipt_required,exempt_by,receipt_id,match_method,matched_at)
     VALUES (?,'default-account','imp','2026-10-20',-4200,'EUR','Vendor','ref','{}',?,?,?,?,?)`,
  )
    .bind(
      tx,
      o.required ?? 1,
      o.by ?? null,
      receiptId,
      receiptId ? 'manual' : null,
      receiptId ? '2026-10-21T09:00:00.000Z' : null,
    )
    .run();
}
const rows = async (table: string, ids: readonly (string | number)[]) =>
  (
    await env.DB.prepare(`SELECT * FROM ${table} WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id`)
      .bind(JSON.stringify(ids))
      .all()
  ).results;
const logged = async () =>
  (await env.DB.prepare('SELECT op,tbl,row_id FROM undo_log ORDER BY tbl,row_id').all()).results;

// How many rows an Undo put back.
const undone = async (at: UndoAt, op: UndoOp) => (await undo(env, at, op)).ids.length;
const action = (op: UndoOp, ids: readonly (string | number)[], at = undoAt()): UndoAction => ({ at, op, ids });

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM undo_log').run();
});

// USD with a cached rate, so approval's cacheFx writes the EUR value after the
// batch without a revision bump, and Undo must still apply.
test('bulk approve of 10 receipts, then Undo puts every column back', async () => {
  const ids = Array.from({ length: 10 }, (_, i) => id(i + 1));
  for (let n = 1; n <= 10; n++) await receipt(n, { currency: 'USD' });
  await env.DB.prepare(
    "INSERT INTO fx_rates VALUES ('USD','2026-10-20','2026-10-20','0.9','ecb','2026-10-20T16:00:00Z')",
  ).run();
  const before = await rows('receipts', ids);
  const form = new FormData();
  form.set('op', 'approve');
  form.set('approval_reason', 'Checked against the PDF');
  for (const [k, v] of Object.entries({ list: 'receipts', view: 'todo', month: '', show: '', q: '' })) form.set(k, v);
  for (const one of ids) form.append('id', one);
  const done = await receiptsBulk(env, form, caller);
  expect(done.n).toBe(10);
  const a = { at: new URL(done.location, 'https://x.example').searchParams.get('at') as UndoAt };
  expect((await rows('receipts', ids)).every((r) => r.status === 'ready' && r.fx_eur_minor !== null)).toBe(true);

  expect(await undone(a.at, 'approve')).toBe(10);
  const after = await rows('receipts', ids);
  expect(after).toEqual(before);
  expect(after.every((r) => Number.isInteger(r.total_minor) && r.invoice_number === '00123')).toBe(true);
  expect(await logged()).toEqual([]);
  expect(await undone(a.at, 'approve')).toBe(0);
});

test('Undo restores revision, so a month sent before the approval reads as sent again', async () => {
  await receipt(1);
  await receipt(2, { status: 'ready' });
  const docs = (await rows('receipts', [id(1), id(2)])).map((r) => `${r.id}:${r.revision}`).sort();
  await env.DB.prepare("INSERT INTO month_sends VALUES ('2026-10','2026-11-01T10:00:00Z','download',2,0,?,'[]')")
    .bind(await hash(docs.join('\n')))
    .run();
  const now = new Date('2026-11-15T12:00:00Z');
  expect((await arrivalMonth(env, now)).why).toBeNull();

  const a = action('approve', [id(1)]);
  await withUndo(env, a, [
    env.DB.prepare(
      "UPDATE receipts SET status='ready',review_reasons_json='[]',reviewed_at=?,revision=revision+1 WHERE id=?",
    ).bind(a.at, id(1)),
  ]);
  expect(await arrivalMonth(env, now)).toMatchObject({ month: '2026-10', why: 'changed' });

  await undo(env, a.at, 'approve');
  expect((await arrivalMonth(env, now)).why).toBeNull();
});

test('discard of a matched receipt, then Undo brings back the receipt and its match', async () => {
  await receipt(1, { status: 'ready' });
  await payment('tx1', id(1));
  const before = { r: await rows('receipts', [id(1)]), t: await rows('bank_transactions', ['tx1']) };
  const a = await discardReceipts(env, [id(1)]);
  expect((await rows('bank_transactions', ['tx1']))[0]).toMatchObject({ receipt_id: null });

  expect(await undone(a.at, 'discard')).toBe(1);
  expect(await rows('receipts', [id(1)])).toEqual(before.r);
  expect(await rows('bank_transactions', ['tx1'])).toEqual(before.t);
});

test('discard, then the payment is matched to another receipt: Undo restores the receipt and leaves the match', async () => {
  await receipt(1, { status: 'ready' });
  await receipt(2, { status: 'ready' });
  await payment('tx1', id(1));
  const before = await rows('receipts', [id(1)]);
  const a = await discardReceipts(env, [id(1)]);
  await env.DB.prepare("UPDATE bank_transactions SET receipt_id=?,match_method='manual' WHERE id='tx1'")
    .bind(id(2))
    .run();
  const taken = await rows('bank_transactions', ['tx1']);

  expect(await undone(a.at, 'discard')).toBe(1);
  expect(await rows('receipts', [id(1)])).toEqual(before);
  expect(await rows('bank_transactions', ['tx1'])).toEqual(taken);
});

test('Not a purchase, then Undo restores receipt_required, exempt_by and the match it dropped', async () => {
  await receipt(1, { status: 'ready' });
  await payment('tx1', null);
  await payment('tx2', id(1));
  const before = await rows('bank_transactions', ['tx1', 'tx2']);
  const a = action('exempt', ['tx1', 'tx2']);
  await withUndo(env, a, [
    env.DB.prepare(
      `${SET_REQUIRED_SQL} AND id IN (SELECT value FROM json_each(?)) AND amount_minor<0 AND receipt_required=?`,
    ).bind(0, JSON.stringify(a.ids), 1),
  ]);
  expect(await rows('bank_transactions', ['tx1', 'tx2'])).toMatchObject([
    { receipt_required: 0, exempt_by: 'owner' },
    { receipt_required: 0, exempt_by: 'owner', receipt_id: null },
  ]);

  expect(await undone(a.at, 'exempt')).toBe(2);
  expect(await rows('bank_transactions', ['tx1', 'tx2'])).toEqual(before);
});

test('Needs a receipt, then Undo puts back the rule that had exempted it', async () => {
  await payment('tx1', null, { required: 0, by: 'tax' });
  const before = await rows('bank_transactions', ['tx1']);
  const a = action('require', ['tx1']);
  await withUndo(env, a, [
    env.DB.prepare(
      `${SET_REQUIRED_SQL} AND id IN (SELECT value FROM json_each(?)) AND amount_minor<0 AND receipt_required=?`,
    ).bind(1, JSON.stringify(a.ids), 0),
  ]);
  expect(await undone(a.at, 'require')).toBe(1);
  expect(await rows('bank_transactions', ['tx1'])).toEqual(before);
});

test('a re-link is skipped, without an error, when the receipt was matched to another payment since', async () => {
  await receipt(1, { status: 'ready' });
  await payment('tx1', id(1));
  await payment('tx2', null);
  const a = action('exempt', ['tx1']);
  await withUndo(env, a, [
    env.DB.prepare(`${SET_REQUIRED_SQL} AND id=? AND amount_minor<0 AND receipt_required=?`).bind(0, 'tx1', 1),
  ]);
  await env.DB.prepare("UPDATE bank_transactions SET receipt_id=?,match_method='manual' WHERE id='tx2'")
    .bind(id(1))
    .run();
  const now = await rows('bank_transactions', ['tx1', 'tx2']);

  expect(await undone(a.at, 'exempt')).toBe(0);
  expect(await rows('bank_transactions', ['tx1', 'tx2'])).toEqual(now);
});

test('unmatch, then Undo links the payment to its receipt again', async () => {
  await receipt(1, { status: 'ready' });
  await payment('tx1', id(1));
  const before = await rows('bank_transactions', ['tx1']);
  const a = action('unmatch', ['tx1']);
  expect(await unlinkMatches(env, ['tx1'], a.at)).toBe(1);
  expect(await undone(a.at, 'unmatch')).toBe(1);
  expect(await rows('bank_transactions', ['tx1'])).toEqual(before);
});

test('mark paid, then Undo puts back the NULLs', async () => {
  await receipt(1, { status: 'ready', kind: 'sales' });
  const before = await rows('receipts', [id(1)]);
  const a = action('paid', [id(1)]);
  await withUndo(env, a, [
    env.DB.prepare(
      "UPDATE receipts SET paid_outside_on=?,paid_outside_note=? WHERE kind='sales' AND id IN (SELECT value FROM json_each(?))",
    ).bind('2026-10-25', 'Stripe payout', JSON.stringify(a.ids)),
  ]);
  expect(await undone(a.at, 'paid')).toBe(1);
  expect(await rows('receipts', [id(1)])).toEqual(before);
});

test('delete rule, then Undo inserts it back as it was', async () => {
  const rule = await env.DB.prepare(
    "INSERT INTO vendor_rules(priority,vendor_contains,context_contains,bank_alias,product,expense_type) VALUES (7,'hetzner',NULL,'HETZNER ONLINE','general','infra') RETURNING id",
  ).first<{ id: number }>();
  const before = await rows('vendor_rules', [rule!.id]);
  const a = action('deleteRule', [rule!.id]);
  await withUndo(env, a, [env.DB.prepare('DELETE FROM vendor_rules WHERE id=?').bind(rule!.id)]);
  expect(await rows('vendor_rules', [rule!.id])).toEqual([]);

  expect(await undone(a.at, 'deleteRule')).toBe(1);
  expect(await rows('vendor_rules', [rule!.id])).toEqual(before);
});

test('Undo leaves a row that changed again since, and never brings back one deleted since', async () => {
  await receipt(1);
  await receipt(2);
  const a = action('approve', [id(1), id(2)]);
  await withUndo(
    env,
    a,
    [id(1), id(2)].map((one) =>
      env.DB.prepare("UPDATE receipts SET status='ready',revision=revision+1 WHERE id=?").bind(one),
    ),
  );
  await env.DB.prepare("UPDATE receipts SET vendor='Edited',revision=revision+1 WHERE id=?").bind(id(1)).run();
  await env.DB.prepare('DELETE FROM receipts WHERE id=?').bind(id(2)).run();
  const edited = await rows('receipts', [id(1)]);

  expect(await undone(a.at, 'approve')).toBe(0);
  expect(await rows('receipts', [id(1)])).toEqual(edited);
  expect(await rows('receipts', [id(2)])).toEqual([]);
});

test('only rows the action changed are logged', async () => {
  await receipt(1);
  await receipt(2, { status: 'ready' });
  const a = action('approve', [id(1), id(2)]);
  await withUndo(env, a, [
    env.DB.prepare(
      "UPDATE receipts SET status='ready',revision=revision+1 WHERE status='needs_review' AND id IN (SELECT value FROM json_each(?))",
    ).bind(JSON.stringify(a.ids)),
  ]);
  expect(await logged()).toEqual([{ op: 'approve', tbl: 'receipts', row_id: id(1) }]);
});

test('each action prunes log entries older than a day', async () => {
  await receipt(1, { status: 'ready', kind: 'sales' });
  await env.DB.prepare(
    "INSERT INTO undo_log VALUES ('2026-10-28T09:59:59.999Z','paid','receipts','old','{}','{}'),('2026-10-29T10:00:00.000Z','paid','receipts','kept','{}','{}')",
  ).run();
  const a = action('paid', [id(1)], undoAt(new Date('2026-10-30T10:00:00.000Z')));
  await withUndo(env, a, [env.DB.prepare("UPDATE receipts SET paid_outside_on='2026-10-25' WHERE id=?").bind(id(1))]);
  expect((await logged()).map((r) => r.row_id)).toEqual([id(1), 'kept']);
});

test('the Undo form is parsed at the boundary', () => {
  expect(parseUndo('2026-10-30T10:00:00.000Z', 'discard')).toEqual({ at: '2026-10-30T10:00:00.000Z', op: 'discard' });
  expect(() => parseUndo('2026-10-30', 'discard')).toThrow(InputError);
  expect(() => parseUndo('2026-10-30T10:00:00.000Z', 'toString')).toThrow(InputError);
});

test('Approve on a receipt page, then its Undo opens that receipt again as it was', async () => {
  await receipt(1);
  await receipt(2);
  const before = await rows('receipts', [id(1)]);
  const form = htmlForm(await (await request(`/receipts/${id(1)}?from=todo`)).text(), `/receipts/${id(1)}`);
  form.set('action', 'approve');
  form.set('approval_reason', 'Checked');
  const approved = await request(`/receipts/${id(1)}`, { method: 'POST', body: form });
  expect(locationOf(approved)).toMatch(`/receipts/${id(2)}?from=todo&done=approved&name=Vendor+1`);
  const page = await (await request(approved.headers.get('Location')!)).text();
  expect(page).toContain('Approved Vendor 1.');
  const back = await request('/undo', { method: 'POST', body: htmlForm(page, '/undo') });
  expect(locationOf(back)).toBe(`/receipts/${id(1)}?from=todo&done=undone&op=approve&n=1`);
  expect((await rows('receipts', [id(1)]))[0]).toMatchObject({
    status: before[0]!.status,
    revision: before[0]!.revision,
    manual_fields_json: before[0]!.manual_fields_json,
  });
});

test('Undo of an approval takes off the automatic match the matcher made after it', async () => {
  await receipt(1);
  await payment('tx1', null);
  const form = new FormData();
  for (const [k, v] of Object.entries({ op: 'approve', approval_reason: 'Checked', list: 'receipts', view: 'todo' }))
    form.set(k, v);
  for (const k of ['month', 'show', 'q']) form.set(k, '');
  form.set('id', id(1));
  const done = await receiptsBulk(env, form, caller);
  const at = new URL(done.location, 'https://x.example').searchParams.get('at') as UndoAt;
  // As reconcile would after the approval.
  await env.DB.prepare("UPDATE bank_transactions SET receipt_id=?,match_method='automatic',matched_at=? WHERE id='tx1'")
    .bind(id(1), new Date(Date.parse(at) + 1).toISOString())
    .run();
  expect(await undone(at, 'approve')).toBe(1);
  expect((await rows('bank_transactions', ['tx1']))[0]).toMatchObject({ receipt_id: null, match_method: null });
});

test('Remove match on Bank, then its Undo links the pair again and lands on Bank', async () => {
  await receipt(1, { status: 'ready' });
  await payment('tx1', id(1));
  const before = await rows('bank_transactions', ['tx1']);
  const removed = await request('/matches', {
    method: 'POST',
    body: new URLSearchParams({ transaction_id: 'tx1', action: 'unlink', view: 'all', month: '2026-10' }),
  });
  const page = await (await request(removed.headers.get('Location')!)).text();
  expect(page).toContain('Removed the match for Vendor.');
  const back = await request('/undo', { method: 'POST', body: htmlForm(page, '/undo') });
  expect(locationOf(back)).toMatch(/^\/payments\?month=2026-10&view=all&done=undone&op=unmatch&n=1/);
  expect(await rows('bank_transactions', ['tx1'])).toEqual(before);
});
