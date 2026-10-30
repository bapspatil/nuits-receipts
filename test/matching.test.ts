import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { importBankCsv, parsePreset } from '../src/banking';
import { feedback } from '../src/events';
import { matchAllLabel } from '../src/match';
import { STATUS } from '../src/status';
import { confirmationForm, htmlForm, idFrom, locationOf, request, uploadPdf } from './helpers';
import { statusMark } from '../src/actions';

const post = (path: string, body: URLSearchParams | FormData) => request(path, { method: 'POST', body });
const rowOf = (html: string, merchant: string) =>
  [...html.matchAll(/<li class="row"[^>]*>[\s\S]*?<\/li>(?=<li class="row"|<\/ul>)/g)]
    .map((m) => m[0])
    .find((r) => r.includes(merchant))!;

// The mock receipt is Sample Cloud Lantern Oy, EUR 125.50, 4 Sep. Two payments on one day
// fit it equally under two alike names, so nothing matches on its own and the page offers it to both.
async function seedTwoPayments() {
  const id = idFrom(await uploadPdf());
  const csv =
    'Transaction ID;Date;Amount;Currency;Payee\na;2026-09-05;-125,50;EUR;Sample Cloud Lantern Oy\nb;2026-09-05;-125,50;EUR;Sample Cloud Lantern Helsinki\n';
  await importBankCsv(env, {
    bytes: new TextEncoder().encode(csv),
    parsed: parsePreset(csv, 'race', 'EUR'),
    collision: '',
  });
  const txs = (await env.DB.prepare('SELECT id FROM bank_transactions ORDER BY merchant DESC').all<{ id: string }>())
    .results;
  return { id, a: txs[0]!.id, b: txs[1]!.id };
}
const bank = async () => (await request('/payments?month=2026-09&view=all')).text();

test('the copy of Match all pluralises', () => {
  expect(matchAllLabel(1)).toBe('Match the likely one');
  expect(matchAllLabel(2)).toBe('Match all 2 likely');
  expect(matchAllLabel(3)).toBe('Match all 3 likely');
});

test('a likely pair is compared in words, with one Match button and no exception box', async () => {
  const { id, a, b } = await seedTwoPayments();
  const html = await bank();
  const row = rowOf(html, 'Sample Cloud Lantern Oy');
  expect(row).toContain(`<strong id="lk-${a}">Likely: Sample Cloud Lantern Oy, 4 Sep, EUR 125.50</strong>`);
  for (const word of ['Name', 'Date', 'Amount', '1 day apart', 'Same']) expect(row, word).toContain(word);
  expect(row).toContain('<span>Match</span></button>');
  expect(row).not.toContain('confirm_exception');
  expect(html).not.toContain('Not exact, still this');
  expect(html).not.toContain('Receipt ID');
  // One receipt cannot go to two payments: Match all lists it once, for the first payment.
  expect(html).toContain('Match the likely one');
  expect(html).toContain('Will match 1 payment');
  const bulk = htmlForm(html, '/matches/bulk');
  expect(bulk.getAll('transaction_id')).toEqual([a]);
  expect(bulk.getAll('receipt_id')).toEqual([id]);
  expect(html).toContain('Name the same, date 1 day apart, amount the same.');
  expect(b).not.toBe(a);
});

test('Match all matches the pairs that still fit, says so once, and its Undo takes them all back', async () => {
  const { id, a, b } = await seedTwoPayments();
  const form = new URLSearchParams();
  form.set('month', '2026-09');
  // The second pair asks for the same receipt: it is skipped, not matched twice.
  for (const tx of [a, b]) {
    form.append('transaction_id', tx);
    form.append('receipt_id', id);
  }
  const done = await post('/matches/bulk', form);
  expect(done.status).toBe(303);
  const location = done.headers.get('Location')!;
  expect(locationOf(done)).toMatch(/^\/payments\?month=2026-09&view=todo&done=matchedMany&n=1&skipped=1#row-/);
  const page = await (await request(location)).text();
  expect(page).toContain('Matched 1 payment. 1 payment changed since you opened the page and was left alone.');
  expect(page).toContain('<form method="post" action="/undo">');
  const rows = await env.DB.prepare(
    'SELECT id,receipt_id,match_method FROM bank_transactions ORDER BY booking_date',
  ).all();
  expect(rows.results[0]).toMatchObject({ receipt_id: id, match_method: 'manual' });
  expect(rows.results[1]).toMatchObject({ receipt_id: null });
  // A by-you match says so in words.
  expect(await bank()).toContain(statusMark('matched'));
  const undo = await post('/undo', htmlForm(page, '/undo'));
  expect(undo.status).toBe(303);
  expect(await (await request(undo.headers.get('Location')!)).text()).toContain('Match undone for 1 payment.');
  expect(await env.DB.prepare('SELECT count(*) n FROM bank_transactions WHERE receipt_id IS NOT NULL').first('n')).toBe(
    0,
  );
});

test('Match all re-checks each pair on the server and never accepts an exception', async () => {
  const { id, a } = await seedTwoPayments();
  await env.DB.prepare('UPDATE bank_transactions SET amount_minor=-9900 WHERE id=?').bind(a).run();
  const form = new URLSearchParams({ month: '2026-09' });
  form.append('transaction_id', a);
  form.append('receipt_id', id);
  form.append('confirm_exception', 'yes');
  const done = await post('/matches/bulk', form);
  expect(locationOf(done)).toMatch(/done=matchedMany&n=0&skipped=1(#row-[0-9a-f]{64})?$/);
  expect(await env.DB.prepare('SELECT count(*) n FROM bank_transactions WHERE receipt_id IS NOT NULL').first('n')).toBe(
    0,
  );
  expect((await post('/matches/bulk', new URLSearchParams({ month: '2026-09' }))).status).toBe(422);
  expect((await post('/undo', new URLSearchParams({ at: 'x', op: 'match' }))).status).toBe(400);
});

test('a forged Undo for Match all gets no form', () => {
  const p = (extra: Record<string, string>) => new URLSearchParams({ done: 'matchedMany', n: '2', ...extra });
  const at = '2026-09-03T10:00:00.000Z';
  expect(feedback(p({ at, op: 'match', month: '2026-09' }))?.undo).toEqual({
    action: '/undo',
    fields: { at, op: 'match', month: '2026-09' },
  });
  expect(feedback(p({ at: 'now', op: 'match' }))?.undo).toBeNull();
  expect(feedback(p({ at }))?.undo).toBeNull();
  expect(feedback(new URLSearchParams({ done: 'matchedMany', n: '0', at, op: 'match' }))?.undo).toBeNull();
});

test('a receipt still in Review is matched, and the payment says the receipt needs you', async () => {
  const id = idFrom(await uploadPdf());
  await env.DB.prepare(`UPDATE receipts SET status='needs_review',review_reasons_json='["low_confidence"]' WHERE id=?`)
    .bind(id)
    .run();
  const csv = 'Transaction ID;Date;Amount;Currency;Payee\na;2026-09-05;-125,50;EUR;Sample Cloud Lantern Oy\n';
  await importBankCsv(env, {
    bytes: new TextEncoder().encode(csv),
    parsed: parsePreset(csv, 'race', 'EUR'),
    collision: '',
  });
  const row = rowOf(await bank(), 'Sample Cloud Lantern Oy');
  expect(row).toContain('Matched');
  expect(row).not.toContain('Matched automatically');
  expect(row).not.toContain('tag ok auto');
  // One stamp per row: Matched, and the link to the receipt says it still needs checking.
  expect(row).toContain(`${statusMark('matched')} <a class="tag" href="/receipts/${id}">Check the receipt</a>`);
  expect(row).not.toContain('Missing');
  expect(await bank()).toContain('1 out, 1 matched, 0 not a purchase, <span>0 missing</span>, 1 needs you');
  // A real gap next to it still says Missing.
  await importBankCsv(env, {
    bytes: new TextEncoder().encode(csv + 'b;2026-09-06;-7,00;EUR;Nothing Like It Oy\n'),
    parsed: parsePreset(csv + 'b;2026-09-06;-7,00;EUR;Nothing Like It Oy\n', 'race', 'EUR'),
    collision: 'keep_existing',
  });
  const both = await bank();
  expect(rowOf(both, 'Nothing Like It Oy')).toContain(statusMark('missing'));
  expect(both).toContain('2 out, 1 matched, 0 not a purchase, <span class="red">1 missing</span>, 1 needs you');
  expect(both).toContain('>To do (1)<');
  // Approving it keeps the match and the stamp goes.
  await env.DB.prepare(`UPDATE receipts SET status='ready',review_reasons_json='[]' WHERE id=?`).bind(id).run();
  expect(rowOf(await bank(), 'Sample Cloud Lantern Oy')).not.toContain('Needs you');
});

test('a payment with nothing like it says so, and the search box resolves a typed date or amount', async () => {
  const id = idFrom(await uploadPdf());
  const csv = 'Transaction ID;Date;Amount;Currency;Payee\na;2026-09-20;-9,99;EUR;Unrelated Shop\n';
  await importBankCsv(env, {
    bytes: new TextEncoder().encode(csv),
    parsed: parsePreset(csv, 'race', 'EUR'),
    collision: '',
  });
  const tx = (await env.DB.prepare('SELECT id FROM bank_transactions').first<{ id: string }>())!.id;
  const row = rowOf(await bank(), 'Unrelated Shop');
  expect(row).toContain('No receipt fits.');
  expect(row).not.toContain('Likely:');
  // Text that only one label contains is enough; an exception is still asked for.
  const refused = await post(
    '/matches',
    new URLSearchParams({ transaction_id: tx, receipt_id: '125.50', action: 'link' }),
  );
  expect(refused.status).toBe(422);
  expect(await refused.text()).toContain('This pair isn&#39;t exact');
  const ok = new URLSearchParams({
    transaction_id: tx,
    receipt_id: '125.50',
    action: 'link',
    confirm_exception: 'yes',
  });
  expect((await post('/matches', ok)).status).toBe(303);
  expect(await env.DB.prepare('SELECT receipt_id FROM bank_transactions WHERE id=?').bind(tx).first('receipt_id')).toBe(
    id,
  );
});

test('an import banner counts the payments matched for you and links to them', async () => {
  await uploadPdf();
  const csv =
    'Transaction ID;Date;Amount;Currency;Payee\na;2026-09-05;-125,50;EUR;Sample Cloud Lantern Oy\nb;2026-09-20;-9,99;EUR;Unrelated Shop\n';
  const body = new FormData();
  body.set('account', 'holvi');
  body.set('file', new File([csv], 'statement.csv', { type: 'text/csv' }));
  const preview = await post('/imports/csv', body);
  const done = await post('/imports/csv/confirm', confirmationForm(await preview.text()));
  const location = locationOf(done);
  expect(location).toContain('done=imported&inserted=2');
  expect(location).toContain('auto=1');
  const said = feedback(new URL(location, 'https://x.example').searchParams)!;
  expect(said.text).toBe('Added 2 payments. Paid out: 1 matched, 0 not a purchase, 1 missing.');
  expect(said.undo).toBeNull();
  expect(said.link).toEqual({ href: '/payments?month=2026-09&view=all', label: 'See them' });
  // All lists the matched row as Matched; To do keeps only the missing one.
  const all = await (await request('/payments?month=2026-09&view=all')).text();
  expect(rowOf(all, 'Sample Cloud Lantern Oy')).toContain('Matched');
  expect(all).not.toContain('Matched automatically');
  const todo = await (await request('/payments?month=2026-09')).text();
  expect(todo).not.toContain('Sample Cloud Lantern Oy');
  expect(todo).toContain('Unrelated Shop');
});

test('one registry holds the words for a state', () => {
  expect(Object.values(STATUS).map((s) => s.word)).toEqual([
    'Needs you',
    'Reading',
    'New sender',
    'Overdue',
    'Missing',
    'Ready',
    'Matched',
    'Not a purchase',
    'Sent',
    'Discarded',
    'Duplicate',
    'Paid',
    'Unpaid',
  ]);
});
