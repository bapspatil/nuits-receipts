// The PR 3 cuts, seen as the owner sees them. Every name and amount is invented.
import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { hash } from '../src/domain';
import { importBankCsv, parsePreset } from '../src/banking';
import { idFrom, request, uploadPdf } from './helpers';

const post = (path: string, body: URLSearchParams | FormData) => request(path, { method: 'POST', body });

// What a person can act on at first sight: not the contents of a closed fold, not hidden inputs,
// not the bulk bar that waits for a tick.
export function visibleControls(html: string): string[] {
  const main = html.match(/<main\b[\s\S]*?<\/main>/)?.[0] ?? html;
  const open = main
    .replace(/<form id="bulk-[^"]*" class="bulkbar"[\s\S]*?<\/form>/g, '')
    .replace(/<details(?![^>]*\bopen\b)[^>]*>(\s*<summary[\s\S]*?<\/summary>)[\s\S]*?<\/details>/g, '$1');
  const found: string[] = [];
  for (const m of open.matchAll(/<(button|a|summary|select|textarea|input)\b([^>]*)>([\s\S]*?(?=<\/\1>)|)/g)) {
    const [, tag, attrs, inner] = m;
    if (tag === 'input' && /type="hidden"/.test(attrs!)) continue;
    if (/\bhidden\b(?!=)/.test(attrs!) || (tag === 'a' && !/\bhref=/.test(attrs!))) continue;
    found.push(`${tag}:${(inner ?? '').replace(/<[^>]+>/g, '').trim() || (attrs!.match(/name="([^"]+)"/)?.[1] ?? '')}`);
  }
  return found;
}

async function seedMismatch() {
  const id = idFrom(await uploadPdf());
  const csv = 'Transaction ID;Date;Amount;Currency;Payee\na;2026-09-07;-99,00;EUR;Sample Cloud Lantern Oy\n';
  await importBankCsv(env, {
    bytes: new TextEncoder().encode(csv),
    parsed: parsePreset(csv, 'race', 'EUR'),
    collision: '',
  });
  return { id, tx: await hash('race:id:a') };
}
const rowOf = (html: string) => html.match(/<li class="pay[^"]*"[^>]*>[\s\S]*?<\/li>/)![0];

test('a Bank row asks for Match, Not a purchase and More, and keeps the rest under More', async () => {
  idFrom(await uploadPdf());
  const csv = 'Transaction ID;Date;Amount;Currency;Payee\na;2026-09-05;-125,50;EUR;Sample Cloud Lantern Oy\n';
  await importBankCsv(env, {
    bytes: new TextEncoder().encode(csv),
    parsed: parsePreset(csv, 'race', 'EUR'),
    collision: '',
  });
  await env.DB.prepare('UPDATE bank_transactions SET receipt_id=NULL,match_method=NULL').run();
  const html = await (await request('/payments?month=2026-09&show=all')).text();
  const row = rowOf(html);
  const shown = visibleControls(row).filter((c) => !c.startsWith('input:id'));
  expect(shown.sort()).toEqual(['button:Match', 'button:Not a purchase', 'summary:More']);
  expect(row).not.toContain('Match anyway');
  const more = row.match(/<details class="more"[\s\S]*?<\/details>/)![0];
  expect(more).toContain('Pick another receipt');
  expect(more).toContain('Add a receipt');
  expect(row).not.toContain('Add receipt<');
});

test('a Bank row with no likely receipt shows the search and Not a purchase, with Add under More', async () => {
  const id = idFrom(await uploadPdf());
  const csv = 'Transaction ID;Date;Amount;Currency;Payee\na;2026-09-20;-9,99;EUR;Unrelated Shop\n';
  await importBankCsv(env, {
    bytes: new TextEncoder().encode(csv),
    parsed: parsePreset(csv, 'race', 'EUR'),
    collision: '',
  });
  const row = rowOf(await (await request('/payments?month=2026-09&show=all')).text());
  expect(id).toBeTruthy();
  expect(
    visibleControls(row)
      .filter((c) => !c.startsWith('input:id'))
      .sort(),
  ).toEqual(['button:Match', 'button:Not a purchase', 'input:receipt_id', 'summary:More']);
  expect(row.match(/<details class="more"[\s\S]*?<\/details>/)![0]).toContain('Add a receipt');
});

test('automatic and manual matches both say Matched, with no Auto chip', async () => {
  const { id, tx } = await seedMismatch();
  await post(
    '/matches',
    new URLSearchParams({ transaction_id: tx, receipt_id: id, action: 'link', confirm_exception: 'yes' }),
  );
  const bank = await (await request('/payments?month=2026-09&show=all')).text();
  expect(bank).toContain(`<span class="tag ok">Matched</span> <a class="tag" href="/receipts/${id}">Receipt</a>`);
  await env.DB.prepare("UPDATE bank_transactions SET match_method='automatic'").run();
  const auto = await (await request('/payments?month=2026-09&show=all')).text();
  expect(auto).toContain(`<span class="tag ok">Matched</span> <a class="tag" href="/receipts/${id}">Receipt</a>`);
  for (const html of [bank, auto, await (await request(`/receipts/${id}`)).text()]) {
    expect(html).not.toMatch(/Matched (automatically|by you)/);
    expect(html).not.toContain('tag ok auto');
  }
});

test('Bank has no Statements history, only the Import statement button', async () => {
  await seedMismatch();
  const html = await (await request('/payments?month=2026-09&show=all')).text();
  expect(html).not.toContain('Statements (');
  expect(html).toContain('<a class="btn secondary" href="/import">Import statement</a>');
});

test('the receipt page has no Technical details fold', async () => {
  const { id } = await seedMismatch();
  const html = await (await request(`/receipts/${id}`)).text();
  expect(html).not.toContain('Technical details');
  expect(html).not.toContain('class="tech"');
});

test('Receipts keeps Reading, Duplicate and Discarded behind one More filters, and their addresses still work', async () => {
  await env.DB.prepare(
    `INSERT INTO receipts (id,original_key,filename,media_type,source,received_at,status,kind,vendor,issue_date,currency,total_minor,review_reasons_json)
     VALUES (?,?,'a.pdf','application/pdf','upload','2026-09-20T10:00:00Z','ready','expense','Vendor A','2026-09-20','EUR',1000,'[]'),
            (?,?,'b.pdf','application/pdf','upload','2026-09-20T10:00:01Z','processing','expense','Vendor B','2026-09-20','EUR',1000,'[]')`,
  )
    .bind('a'.repeat(64), 'receipts/a', 'b'.repeat(64), 'receipts/b')
    .run();
  const page = await (await request('/receipts')).text();
  expect(page).toMatch(/<details class="filters"><summary>More filters<\/summary>[\s\S]*?Reading \(1\)/);
  const reading = await request('/receipts?show=reading');
  expect(reading.status).toBe(200);
  expect(await reading.text()).toContain('<details class="filters" open>');
  for (const show of ['duplicate', 'discarded']) expect((await request(`/receipts?show=${show}`)).status).toBe(200);
});

test('Home has no "N dated" link; the Check step already leads to the list', async () => {
  await seedMismatch();
  const home = await (await request('/?month=2026-09')).text();
  expect(home).not.toContain('class="dated"');
  expect(home).not.toMatch(/\d+ receipts? dated/);
});
