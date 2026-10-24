import Papa from 'papaparse';
import { env } from 'cloudflare:workers';
import { afterEach, expect, test, vi } from 'vitest';
import worker from '../src/index';
import { fileName, folderName, placement, safeName, segment } from '../src/package';
import { EXPORT_COLUMNS } from '../src/ui';
import type { Receipt } from '../src/domain';
import type { Env } from '../src/env';
import { authorization, locationOf, request, signed } from './helpers';
import { missingPayment, seed, unzip, zipOf } from './package-helpers';

const ALLOWED = /^[A-Za-z0-9._-]+$/;
const base = { id: 'abcdef0123456789', media_type: 'application/pdf', currency: 'EUR', total_minor: 8207 };

test('file names fold, sanitise, cap and stay unique-ready', () => {
  expect(fileName({ ...base, issue_date: '2026-10-03', vendor: 'OpenAI Ireland Ltd' })).toBe(
    '2026-10-03_OpenAI-Ireland-Ltd_EUR-82.07_abcdef.pdf',
  );
  expect(fileName({ ...base, issue_date: '2026-10-03', vendor: 'Äänekosken Sähkö Öy' })).toBe(
    '2026-10-03_Aanekosken-Sahko-Oy_EUR-82.07_abcdef.pdf',
  );
  expect(fileName({ ...base, issue_date: '2026-10-03', vendor: 'Straße Ærø Łódź café' })).toContain(
    'Strasse-AEro-Lodz-cafe',
  );
  expect(fileName({ ...base, issue_date: null, vendor: null, total_minor: null, media_type: 'image/png' })).toBe(
    'undated_Unknown-vendor_no-amount_abcdef.png',
  );
  expect(fileName({ ...base, issue_date: '2026-10-03', vendor: 'Refund', total_minor: -500 })).toContain(
    '_EUR-minus-5.00_',
  );
  expect(fileName({ ...base, issue_date: '2026-10-03', vendor: 'x', currency: 'JPY', total_minor: 1200 })).toContain(
    '_JPY-1200_',
  );
  for (const media of ['text/html', 'text/plain', 'message/rfc822', 'image/jpeg', 'image/webp', 'application/x-odd'])
    expect(fileName({ ...base, issue_date: '2026-10-03', vendor: 'v', media_type: media })).toMatch(
      /\.(html|txt|eml|jpg|webp|bin)$/,
    );
  const nasty = [
    'a/b\\c:d*e?f"g<h>i|j#k%l',
    '../../etc/passwd',
    '..',
    '.hidden.',
    '🧾🔥 Emoji Shop 🛒',
    '   spaced   out   ',
    'x'.repeat(300),
    'CON',
    'trailing dots...',
    '\u0000control\u001f',
    '日本語ショップ',
  ];
  for (const vendor of nasty) {
    const name = fileName({ ...base, issue_date: '2026-10-03', vendor, currency: 'E/U R', total_minor: 2 ** 52 });
    expect(name, vendor).toMatch(ALLOWED);
    expect(name.length, vendor).toBeLessThanOrEqual(120);
    expect(name, vendor).not.toMatch(/\.\.|^[.\s-]|[.\s]$|--/);
    expect(name.split('_')[1]!.length, vendor).toBeLessThanOrEqual(40);
  }
  expect(fileName({ ...base, issue_date: '2026-10-03', vendor: '日本語ショップ' })).toContain('_Unknown-vendor_');
  expect(fileName({ ...base, issue_date: '2026-10-03', vendor: '../../etc/passwd' })).toContain('_etc-passwd_');
  expect(segment('..a..b..', 40)).toBe('a.b');
  expect(segment('x'.repeat(50), 40)).toHaveLength(40);
  for (const reserved of ['CON', 'con.pdf', 'NUL', 'com1.txt', 'LPT9', 'aux'])
    expect(safeName(reserved)).toBe('_' + reserved);
  expect(safeName('CONSOLE.pdf')).toBe('CONSOLE.pdf');
  expect(fileName({ ...base, issue_date: '2026-10-03', vendor: 'v' }, 10)).toContain('_abcdef0123.pdf');
  expect(folderName({ ...env, EXPORT_PREFIX: 'books' } as Env, '2026-10')).toBe('books-2026-10');
  expect(folderName({ ...env, EXPORT_PREFIX: 'CON' } as Env, '2026-10')).toBe('CON-2026-10');
});

test('inclusion matrix: ready in main, unchecked only anyway, undated only when asked, duplicates never', () => {
  const r = (fields: Partial<Receipt>) =>
    ({
      status: 'ready',
      media_type: 'application/pdf',
      issue_date: '2026-10-01',
      duplicate_of: null,
      ...fields,
    }) as Receipt;
  const off = { anyway: false, undated: false },
    anyway = { anyway: true, undated: false },
    all = { anyway: true, undated: true },
    undatedOnly = { anyway: false, undated: true };
  const cases: [Partial<Receipt>, (string | null)[]][] = [
    [{}, ['main', 'main', 'main', 'main']],
    [{ status: 'needs_review' }, [null, 'check-these', 'check-these', null]],
    [{ status: 'pending' }, [null, 'check-these', 'check-these', null]],
    [{ status: 'needs_review', issue_date: null }, [null, null, 'check-these', 'check-these']],
    [{ duplicate_of: 'x' }, [null, null, null, null]],
    [{ duplicate_of: 'x', issue_date: null }, [null, null, null, null]],
    [{ media_type: 'message/rfc822', status: 'needs_review' }, [null, 'check-these', 'check-these', null]],
    [{ media_type: 'message/rfc822', status: 'ready' }, [null, 'check-these', 'check-these', null]],
    [{ media_type: 'message/rfc822', status: 'needs_review', issue_date: null }, [null, null, 'check-these', null]],
    [{ media_type: 'text/html' }, ['main', 'main', 'main', 'main']],
  ];
  for (const [fields, expected] of cases)
    expect(
      [off, anyway, all, undatedOnly].map((o) => placement(r(fields), o)),
      JSON.stringify(fields),
    ).toEqual(expected);
});

async function seedMonth() {
  const pdf = await seed({
    bytes: '%PDF-1.4 synthetic hetzner',
    vendor: 'Hetzner Online GmbH',
    issue_date: '2026-10-02',
  });
  const html = await seed({
    bytes: '<html><body>Synthetic Stripe receipt</body></html>',
    media_type: 'text/html',
    filename: 'email.html',
    source: 'email',
    vendor: 'Stripé/Payments',
    issue_date: '2026-10-09',
    currency: 'USD',
    total_minor: 2000,
  });
  const text = await seed({
    bytes: 'Synthetic plain receipt',
    media_type: 'text/plain',
    vendor: 'Plain',
    issue_date: '2026-10-10',
  });
  const flagged = await seed({
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
    media_type: 'image/png',
    vendor: '=HYPERLINK("x")',
    issue_date: '2026-10-14',
    status: 'needs_review',
    review_reasons_json: '["missing_vat"]',
  });
  const email = await seed({
    bytes: 'From: someone@example.net\r\n\r\nSynthetic held email',
    media_type: 'message/rfc822',
    source: 'email',
    vendor: null,
    issue_date: '2026-10-15',
    status: 'needs_review',
    review_reasons_json: '["sender_unverified"]',
  });
  const undated = await seed({
    bytes: 'undated synthetic',
    issue_date: null,
    status: 'needs_review',
    vendor: 'No Date Co',
  });
  const duplicate = await seed({ bytes: 'duplicate synthetic', duplicate_of: pdf.id, issue_date: '2026-10-02' });
  const otherMonth = await seed({ bytes: 'september synthetic', issue_date: '2026-09-30' });
  return { pdf, html, text, flagged, email, undated, duplicate, otherMonth };
}

test('ZIP streams originals byte for byte with index, headers and exact length', async () => {
  const r = await seedMonth();
  await missingPayment();
  const { response, bytes, entries } = await zipOf('/month/package.zip?month=2026-10');
  expect(response.headers.get('Content-Type')).toBe('application/zip');
  expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="receipts-2026-10.zip"');
  expect(response.headers.get('Content-Length')).toBe(String(bytes.length));
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  const names = entries.map((e) => e.name);
  expect(names).toEqual([
    'receipts-2026-10/00-index-2026-10.csv',
    'receipts-2026-10/00-missing-receipts-2026-10.csv',
    `receipts-2026-10/2026-10-02_Hetzner-Online-GmbH_EUR-12.50_${r.pdf.id.slice(0, 6)}.pdf`,
    `receipts-2026-10/2026-10-09_Stripe-Payments_USD-20.00_${r.html.id.slice(0, 6)}.html`,
    `receipts-2026-10/2026-10-10_Plain_EUR-12.50_${r.text.id.slice(0, 6)}.txt`,
  ]);
  for (const e of entries) {
    expect(e.method).toBe(0);
    expect(e.utf8).toBe(true);
  }
  for (const [receipt, entry] of [
    [r.pdf, entries[2]!],
    [r.html, entries[3]!],
    [r.text, entries[4]!],
  ] as const) {
    const original = new Uint8Array(await (await env.ORIGINALS.get(receipt.original_key))!.arrayBuffer());
    expect(entry.data).toEqual(original);
  }
  const index = Papa.parse<Record<string, string>>(new TextDecoder().decode(entries[0]!.data).replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: true,
  });
  expect(index.meta.fields).toEqual([...EXPORT_COLUMNS, 'file_name', 'folder']);
  expect(index.data.map((row) => [row.original_id, row.folder, row.needs_review])).toEqual([
    [r.pdf.id, 'main', 'false'],
    [r.html.id, 'main', 'false'],
    [r.text.id, 'main', 'false'],
  ]);
  expect(index.data[0]!.file_name).toBe(names[2]!.split('/')[1]);
  expect(index.data[0]!.original_link).toBe(`http://localhost/originals/${r.pdf.id}`);
  const missing = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(entries[1]!.data);
  expect(missing).toMatch(
    /^﻿date,paid_to,amount,currency,account,reference\r?\n2026-10-09,Synthetic Shop,42.00,EUR,holvi,/,
  );
  // The CSV export itself is unchanged.
  const exported = Papa.parse<Record<string, string>>(
    (await (await request('/export.csv?month=2026-10')).text()).replace(/^﻿/, ''),
    { header: true, skipEmptyLines: true },
  );
  expect(exported.meta.fields).toEqual([...EXPORT_COLUMNS]);
  expect(exported.data).toHaveLength(5);
});

test('Download anyway adds unchecked receipts and held emails in check-these, undated only when asked', async () => {
  const r = await seedMonth();
  const anyway = (await zipOf('/month/package.zip?month=2026-10&anyway=1')).entries.map((e) => e.name);
  expect(anyway).toContain(
    `receipts-2026-10/check-these/2026-10-14_HYPERLINK-x_EUR-12.50_${r.flagged.id.slice(0, 6)}.png`,
  );
  expect(anyway).toContain(
    `receipts-2026-10/check-these/2026-10-15_Unknown-vendor_EUR-12.50_${r.email.id.slice(0, 6)}.eml`,
  );
  expect(anyway.some((n) => n.includes('undated_'))).toBe(false);
  expect(anyway.some((n) => n.includes(r.duplicate.id.slice(0, 6)) || n.includes(r.otherMonth.id.slice(0, 6)))).toBe(
    false,
  );
  const { entries } = await zipOf('/month/package.zip?month=2026-10&anyway=1&undated=1');
  expect(entries.map((e) => e.name)).toContain(
    `receipts-2026-10/check-these/undated_No-Date-Co_EUR-12.50_${r.undated.id.slice(0, 6)}.pdf`,
  );
  const index = Papa.parse<Record<string, string>>(new TextDecoder().decode(entries[0]!.data).replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: true,
  }).data;
  const flagged = index.find((row) => row.original_id === r.flagged.id)!;
  expect(flagged).toMatchObject({ folder: 'check-these', needs_review: 'true', vendor: `'=HYPERLINK("x")` });
  expect(flagged.file_name).toMatch(/^check-these\//);
  expect(index.find((row) => row.original_id === r.undated.id)).toMatchObject({ date: '', folder: 'check-these' });
});

test('ZIP refuses empty months, too many files and bad input with plain messages', async () => {
  const empty = await request('/month/package.zip?month=2026-01');
  expect(empty.status).toBe(422);
  expect(await empty.text()).toContain('There are no receipts to put in the package');
  expect((await request('/month/package.zip?month=2026-13')).status).toBe(422);
  const statements = [];
  for (let i = 0; i < 901; i++)
    statements.push(
      env.DB.prepare(
        "INSERT INTO receipts (id,original_key,filename,media_type,source,received_at,status,issue_date,vendor) VALUES (?,?,'s.pdf','application/pdf','upload','2026-11-01','ready','2026-11-02','Bulk')",
      ).bind(`bulk${String(i).padStart(60, '0')}`, `receipts/bulk${i}`),
    );
  await env.DB.batch(statements);
  const big = await request('/month/package.zip?month=2026-11');
  expect(big.status).toBe(413);
  expect(await big.text()).toContain('901 files, more than the 900');
  const page = await (await request('/?month=2026-11')).text();
  expect(page).toContain('This month is too big for one package');
  expect(page).not.toContain('/month/package.zip');
});

test('the send step offers the ZIP, then records the month as sent and spots later changes', async () => {
  const pdf = await seed({ bytes: 'ready one', vendor: 'Alpha', issue_date: '2026-10-02' });
  const second = await seed({ bytes: 'ready two', vendor: 'Beta', issue_date: '2026-10-03' });
  // No bank statement: the month is not ready, so the ZIP is "anyway".
  let html = await (await request('/?month=2026-10')).text();
  expect(html).toContain('<b>Match</b><span class="red">No statement</span>');
  expect(html).toContain('<details class="send"><summary>Download anyway</summary>');
  expect(html).toContain('<form action="/month/package.zip" method="get">');
  expect(html).toContain('Download anyway</button>');
  expect(html).toContain('>CSV</a>');
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO imports (id,account_key,original_key,status,row_count,imported_at,snapshot_json) VALUES ('i','holvi','imports/i','complete',1,'2026-10-21','{}')",
    ),
    env.DB.prepare(
      "INSERT INTO bank_transactions (id,account_key,import_id,booking_date,amount_minor,currency,merchant,raw_json,receipt_id) VALUES ('t','holvi','i','2026-10-02',-1250,'EUR','Alpha','{}',?)",
    ).bind(pdf.id),
  ]);
  html = await (await request('/?month=2026-10')).text();
  expect(html).toContain('<b>Send</b><span>Ready</span>');
  expect(html).toMatch(
    /<a class="btn primary" href="\/month\/package.zip\?month=2026-10">Download ZIP \(\d+ KB\)<\/a>/,
  );
  expect(html).toContain('<button class="btn secondary">Mark October as sent</button>');
  expect(html).toContain('<ul class="manifest" aria-label="Files in the package"><li>receipts-2026-10/</li>');
  expect(html.match(/class="[^"]*\bbtn primary\b/g)).toHaveLength(1);
  const shownHash = html.match(/name="receipts_hash" value="([a-f0-9]{64})"/)![1]!;

  const post = (fields: Record<string, string>, headers: Record<string, string> = {}) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return request('/month/sent', { method: 'POST', body: form, headers });
  };
  expect((await post({ month: '2026-10', receipts_hash: shownHash }, { Origin: 'https://evil.example' })).status).toBe(
    403,
  );
  const stale = await post({ month: '2026-10', receipts_hash: '0'.repeat(64) });
  expect(stale.status).toBe(409);
  expect(await stale.text()).toContain('This month changed since you opened the page');
  expect((await post({ month: '2026-01', receipts_hash: shownHash })).status).toBe(422);
  expect(await env.DB.prepare('SELECT count(*) n FROM month_sends').first('n')).toBe(0);
  const sent = await post({ month: '2026-10', receipts_hash: shownHash });
  expect(sent.status).toBe(303);
  expect(locationOf(sent)).toMatch(/^\/\?month=2026-10&done=sent&at=[^&#]+#send$/);
  const sentLocation = locationOf(sent);
  expect(
    await env.DB.prepare('SELECT month,method,file_count,total_minor,receipts_hash FROM month_sends').first(),
  ).toEqual({ month: '2026-10', method: 'download', file_count: 2, total_minor: 2500, receipts_hash: shownHash });

  html = await (await request(await signed(sentLocation.replace(/#send$/, '')))).text();
  expect(html).toContain('<form method="post" action="/month/sent/undo">');
  const today = new Date();
  const short = `${today.getUTCDate()} ${today.toUTCString().slice(8, 11)}`;
  expect(html).toContain(`<b>Send</b><span>Sent ${short}</span>`);
  expect(html).toContain('Marked October 2026 as sent.');
  expect(html).toContain('<a href="/?month=2026-11">On to November ›</a>');
  expect(html).toContain('<li class="step done"><a href="#send">');
  expect(html).not.toContain('action="/month/sent"');
  const home = await (await request('/?month=2026-10')).text();
  expect(home).toContain(`<b>Send</b><span>Sent ${short}</span>`);
  expect(home).toContain('<li class="step done"><a href="#send">');

  // Nothing changed yet, so there is no "changes" ZIP.
  const unchanged = await request('/month/package.zip?month=2026-10&changes=1');
  expect(unchanged.status).toBe(409);
  expect(await unchanged.text()).toContain('Nothing has changed since you sent this month.');

  // A correction and a new receipt make it "changed"; only those two go in.
  await env.DB.prepare('UPDATE receipts SET revision=revision+1 WHERE id=?').bind(second.id).run();
  const added = await seed({ bytes: 'late arrival', vendor: 'Gamma', issue_date: '2026-10-20' });
  html = await (await request('/?month=2026-10')).text();
  expect(html).toContain(`Changed since you sent it on ${short}: 1 added and 1 corrected.`);
  expect(html).toContain('Download changes (2 files)');
  const { response, entries } = await zipOf('/month/package.zip?month=2026-10&changes=1&anyway=1');
  expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="receipts-2026-10-changes.zip"');
  expect(entries.map((e) => e.name.split('_').at(-1))).toEqual([
    'receipts-2026-10/00-index-2026-10-changes.csv'.split('_').at(-1),
    `${second.id.slice(0, 6)}.pdf`,
    `${added.id.slice(0, 6)}.pdf`,
  ]);
});

test('changes ZIP before any send explains itself', async () => {
  await seed({ bytes: 'only', issue_date: '2026-10-02' });
  const response = await request('/month/package.zip?month=2026-10&changes=1');
  expect(response.status).toBe(409);
  expect(await response.text()).toContain('You haven&#39;t marked this month as sent yet');
});

test('package links and the sent form carry the base path; Access mode guards the ZIP', async () => {
  await seed({ bytes: 'based', vendor: 'Based', issue_date: '2026-10-02' });
  const based = { ...env, APP_BASE_PATH: '/app' } as Env;
  const at = (path: string, init: RequestInit = {}) =>
    worker.fetch(
      new Request('http://localhost' + path, {
        ...init,
        headers: { Authorization: authorization, Origin: 'http://localhost' },
      }),
      based,
    );
  const html = await (await at('/app/?month=2026-10')).text();
  expect(html).toContain('action="/app/month/package.zip"');
  expect(html).toContain('action="/app/month/sent"');
  expect(html).toContain('href="/app/export.csv?month=2026-10"');
  const zip = await at('/app/month/package.zip?month=2026-10&anyway=1');
  expect(zip.status).toBe(200);
  const entries = unzip(new Uint8Array(await zip.arrayBuffer()));
  expect(new TextDecoder().decode(entries[0]!.data)).toContain('http://localhost/app/originals/');
  expect((await worker.fetch(new Request('http://localhost/month/package.zip?month=2026-10'), based)).status).toBe(404);
  const hash = html.match(/name="receipts_hash" value="([a-f0-9]{64})"/)![1]!;
  const form = new FormData();
  form.set('month', '2026-10');
  form.set('receipts_hash', hash);
  const sent = await at('/app/month/sent', { method: 'POST', body: form });
  expect(locationOf(sent)).toMatch(/^\/app\/\?month=2026-10&done=sent&at=[\d\-T:.%A-Za-z]+#send$/);

  const accessEnv = {
    ...env,
    ACCESS_TEAM_DOMAIN: 'example-team.cloudflareaccess.com',
    ACCESS_AUD: 'a'.repeat(64),
    ACCESS_ALLOWED_EMAILS: 'owner@example.com',
  } as Env;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ keys: [] }));
  const denied = await worker.fetch(
    new Request('https://receipts.example.com/month/package.zip?month=2026-10', {
      headers: { Authorization: authorization },
    }),
    accessEnv,
  );
  expect(denied.status).toBe(403);
});
afterEach(() => vi.restoreAllMocks());
