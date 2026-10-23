import { env } from 'cloudflare:workers';
import { expect, test, vi } from 'vitest';
import worker from '../src/index';
import { importBankCsv, parsePreset } from '../src/banking';
import { getReceipt, preserve } from '../src/receipts';
import { FONT_FILES } from '../src/fonts';
import { APP_NOTICE } from '../src/ui';
import type { Env } from '../src/env';
import { authorization, htmlForm, request, uploadPdf } from './helpers';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
// INVOICES_ADDRESS is set in wrangler.local.jsonc, so the Invoices tab shows.
const NAV = ['/', '/review', '/payments', '/invoices', '/month', '/settings'];
const TABS = ['/', '/review', '/payments', '/month', '/more'];

async function flaggedImage(variant = 0) {
  const bytes = variant ? new Uint8Array([...PNG, variant]) : PNG;
  const row = await preserve(env, { bytes, media: 'image/png', filename: 'photo.png', source: 'upload' });
  await env.DB.prepare(
    `UPDATE receipts SET status='needs_review',review_reasons_json='["uncertain_vendor","missing_vendor","missing_issue_date","missing_net","missing_vat","uncertain_total"]',currency='EUR',total_minor=8207 WHERE id=?`,
  )
    .bind(row.id)
    .run();
  return getReceipt(env, row.id);
}
async function readyPdf() {
  const response = await uploadPdf();
  return getReceipt(env, response.headers.get('Location')!.split('/').at(-1)!);
}
async function bankRows() {
  const text =
    'Transaction ID;Date;Amount;Currency;Payee\na;2026-09-07;-125,50;EUR;Sample Cloud Lantern Oy\nb;2026-09-12;-40,00;EUR;Fake Unmatched Shop\nc;2026-09-14;300,00;EUR;Fake Customer\n';
  await importBankCsv(env, {
    bytes: new TextEncoder().encode(text),
    parsed: parsePreset(text, 'holvi', 'EUR'),
    collision: '',
    crossAccountAcknowledged: true,
  });
}
async function seed() {
  const ready = await readyPdf();
  await bankRows();
  const flagged = await flaggedImage();
  return { ready, flagged };
}
function navOf(html: string) {
  const nav = html.match(/<nav class="main" aria-label="Main">([\s\S]*?)<\/nav>/)?.[1] ?? '';
  return {
    links: [...nav.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]),
    current: nav.match(/<a href="([^"]*)" aria-current="page"/)?.[1] ?? null,
  };
}
function tabsOf(html: string) {
  const nav = html.match(/<nav class="tabs" aria-label="Main">([\s\S]*?)<\/nav>/)?.[1] ?? '';
  return {
    links: [...nav.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]),
    current: [...nav.matchAll(/<a href="([^"]*)" aria-current="page"/g)].map((m) => m[1]),
    nav,
  };
}
function primaries(html: string) {
  return [...html.matchAll(/class="[^"]*\bbtn primary\b[^"]*"/g)].length;
}
function visible(html: string) {
  return html
    .replace(/<details class="tech">[\s\S]*?<\/details>/g, '')
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]*>/g, ' ');
}
// The phone tab for each desktop nav item: Invoices and Settings live behind More.
const TAB_FOR: Record<string, string> = { '/invoices': '/more', '/settings': '/more' };
function expectShell(html: string, current: string | null, tab = current && (TAB_FOR[current] ?? current)) {
  expect(navOf(html)).toEqual({ links: NAV, current });
  const { links, current: currentTabs } = tabsOf(html);
  expect(links).toEqual(TABS);
  expect(currentTabs).toEqual(tab ? [tab] : []);
  expect(html).toContain('viewport-fit=cover');
  expect(html).toContain('<a class="skip" href="#main">Skip to content</a>');
  expect(html).toContain('<main id="main">');
  expect(html).toContain(APP_NOTICE);
  expect(html.match(/<h1\b/g)).toHaveLength(1);
  expect(html).not.toMatch(new RegExp('[\\u2013\\u2014]'));
  expect(html).not.toContain('/cdn-cgi/access/logout');
}

test('every page, including error pages, has the same six-item nav', async () => {
  const { ready, flagged } = await seed();
  const pages: [string, string | null][] = [
    ['/', '/'],
    ['/?month=2026-09', '/'],
    ['/review', '/review'],
    ['/review?reason=sender', '/review'],
    ['/payments?month=2026-09', '/payments'],
    ['/payments?month=2026-09&show=missing', '/payments'],
    ['/month?month=2026-09', '/month'],
    ['/settings', '/settings'],
    ['/import', '/payments'],
    ['/invoices?month=2026-09', '/invoices'],
    ['/invoices?month=2026-09&show=overdue', '/invoices'],
    ['/add', '/'],
    ['/add?kind=sales', '/invoices'],
    [`/receipts/${ready.id}`, '/review'],
    [`/receipts/${flagged.id}`, '/review'],
  ];
  for (const [path, current] of pages) {
    const response = await request(path);
    expect(response.status, path).toBe(200);
    expectShell(await response.text(), current);
  }
  const more = await request('/more');
  expect(more.status).toBe(200);
  expectShell(await more.text(), null, '/more');
  // Errors keep their status and message, now inside the layout with a way back.
  const missing = await request('/nope', { headers: { Referer: 'http://localhost/review' } });
  expect(missing.status).toBe(404);
  expect(missing.headers.get('Content-Type')).toContain('text/html');
  const missingHtml = await missing.text();
  expectShell(missingHtml, null);
  expect(missingHtml).toContain('<div class="alert" role="alert"><p><strong>Not found</strong></p></div>');
  expect(missingHtml).toContain('<a class="btn primary" href="/review">Go back</a>');
  const body = htmlForm(await (await request(`/receipts/${flagged.id}`)).text(), `/receipts/${flagged.id}`);
  body.set('action', 'approve');
  const refused = await request(`/receipts/${flagged.id}`, {
    method: 'POST',
    body,
    headers: { Referer: `http://evil.example/receipts/${flagged.id}` },
  });
  expect(refused.status).toBe(422);
  const refusedHtml = await refused.text();
  expectShell(refusedHtml, null);
  expect(refusedHtml).toContain('role="alert"><p><strong>Complete required facts before approval</strong>');
  expect(refusedHtml).toContain('href="/">Go back</a>');
  // A server failure renders the same way with the same message.
  const prepare = env.DB.prepare.bind(env.DB);
  const spy = vi.spyOn(env.DB, 'prepare').mockImplementation((sql) => {
    if (sql.startsWith('SELECT * FROM vendor_rules')) throw new Error('Synthetic outage');
    return prepare(sql);
  });
  try {
    const failed = await request('/payments?month=2026-09');
    expect(failed.status).toBe(500);
    const failedHtml = await failed.text();
    expectShell(failedHtml, null);
    expect(failedHtml).toContain('Request failed. Saved documents can be retried.');
  } finally {
    spy.mockRestore();
  }
});

test('each work screen has exactly one primary button, empty or busy', async () => {
  const screens = [
    '/',
    '/review',
    '/payments?month=2026-09',
    '/import',
    '/month?month=2026-09',
    '/invoices?month=2026-09',
    '/add',
    '/add?kind=sales',
  ];
  for (const path of screens) expect(primaries(await (await request(path)).text()), `empty ${path}`).toBe(1);
  const { ready, flagged } = await seed();
  for (const path of [...screens, `/receipts/${ready.id}`, `/receipts/${flagged.id}`])
    expect(primaries(await (await request(path)).text()), `busy ${path}`).toBe(1);
  // Unverified email: reading it is the primary action, approving is not.
  const email = await preserve(env, {
    bytes: new TextEncoder().encode('From: someone@example.net\r\n\r\nhello'),
    media: 'message/rfc822',
    filename: 'source.eml',
    source: 'email',
  });
  await env.DB.prepare(
    `UPDATE receipts SET status='needs_review',review_reasons_json='["sender_unverified"]' WHERE id=?`,
  )
    .bind(email.id)
    .run();
  const unverified = await (await request(`/receipts/${email.id}`)).text();
  expect(primaries(unverified)).toBe(1);
  expect(unverified).toContain(`<button class="btn primary" formaction="/receipts/${email.id}/retry">`);
  expect(primaries(await (await request('/review?reason=sender')).text())).toBe(1);
  // All matched: the month close is the next step.
  await env.DB.prepare('UPDATE bank_transactions SET receipt_required=0 WHERE receipt_id IS NULL').run();
  const matched = await (await request('/payments?month=2026-09')).text();
  expect(primaries(matched)).toBe(1);
  expect(matched).toContain('All matched');
  // Settings is a list of sections with no filled button.
  expect(primaries(await (await request('/settings')).text())).toBe(0);
});

test('empty screens say what is missing and offer one next step', async () => {
  for (const path of ['/review', '/payments?month=2026-09', '/invoices?month=2026-09']) {
    const html = await (await request(path)).text();
    const empty = html.match(/<div class="card empty">([\s\S]*?)<\/main>/)?.[1] ?? '';
    expect(empty, path).toMatch(/<h2>[^<]+/);
    expect(primaries(empty), path).toBe(1);
  }
  await seed();
  await env.DB.prepare('UPDATE bank_transactions SET receipt_required=0 WHERE receipt_id IS NULL').run();
  const matched = await (await request('/payments?month=2026-09')).text();
  expect(matched).toContain('<div class="card empty"><span class="stamp ready">All matched</span><h2>');
});

test('phones get a bottom tab bar with icons, labels and counts', async () => {
  await seed();
  const html = await (await request('/')).text();
  const { nav } = tabsOf(html);
  expect([...nav.matchAll(/<\/span>([A-Za-z]+)<\/a>/g)].map((m) => m[1])).toEqual([
    'Home',
    'Review',
    'Payments',
    'Month',
    'More',
  ]);
  expect(nav.match(/<svg [^>]*aria-hidden="true"/g)).toHaveLength(5);
  expect(nav).toMatch(/href="\/review">.*?<span class="count">\d+<span class="vh"> waiting<\/span><\/span>/);
  expect(nav).toMatch(/href="\/payments">.*?<span class="count">1<span class="vh"> missing a receipt<\/span>/);
  const phone = html.match(/@media \(max-width:879px\)\{([\s\S]*?)\n\}/)?.[1] ?? '';
  expect(phone).toContain('nav.main,.sign-out{display:none}');
  expect(phone).toMatch(/nav\.tabs\{display:block;position:fixed;[^}]*bottom:0/);
  expect(phone).toMatch(/nav\.tabs a\{[^}]*min-height:3\.5rem/);
  expect(phone).toContain('env(safe-area-inset-bottom)');
  expect(phone).toContain('body{padding-bottom:var(--tabs)}');
  expect(phone).toContain('html{scroll-padding-bottom:');
  expect(phone).toContain('textarea:focus) nav.tabs{display:none}');
  expect(phone).not.toContain(':hover');
  expect(html).toContain('nav.tabs{display:none}');
});

test('More lists Invoices only when the Invoices tab shows', async () => {
  const shown = await (await request('/more')).text();
  expect(shown).toContain('<a href="/invoices">');
  expect(shown).toContain('<a href="/settings">');
  expect(shown).not.toContain('/cdn-cgi/access/logout');
  const plain = { ...env, INVOICES_ADDRESS: '' } as Env;
  const hidden = await (
    await worker.fetch(new Request('http://localhost/more', { headers: { Authorization: authorization } }), plain)
  ).text();
  expect(navOf(hidden).links).not.toContain('/invoices');
  expect(hidden).not.toContain('href="/invoices"');
  expect(hidden).toContain('<a href="/settings">');
  expect((await worker.fetch(new Request('http://localhost/more'), env)).status).toBe(401);
});

test('stacked tables label every cell for phones and keep column headers', async () => {
  await seed();
  for (const path of ['/month?month=2026-09', '/invoices?month=2026-09']) {
    const html = await (await request(path)).text();
    const tables = [...html.matchAll(/<table class="stack">([\s\S]*?)<\/table>/g)].map((m) => m[1]!);
    if (path.startsWith('/month')) expect(tables.length, path).toBeGreaterThan(0);
    for (const table of tables) {
      expect(table, path).toMatch(/<caption[^>]*>[^<]+<\/caption>/);
      expect(table, path).toMatch(/<th scope="col"/);
      for (const cell of table.match(/<td\b[^>]*>/g) ?? []) expect(cell, path).toMatch(/class="lead"|data-label="/);
    }
  }
});

test('flagged fields are one compact row: the question labels the input it describes', async () => {
  const { flagged } = await seed();
  const html = await (await request(`/receipts/${flagged.id}`)).text();
  expect(html).toContain(
    '<label class="flabel" for="f-vendor">Who is this from?</label><span class="meta" id="flag-1">',
  );
  expect(html).toMatch(
    /<input name="vendor" value="" type="text" autocomplete="off" id="f-vendor" aria-describedby="flag-1" aria-invalid="true">/,
  );
  expect(html).not.toContain('>Who you paid<');
  // Every row label points at a control, and the approve bar never floats over fields.
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const [, target] of html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)) expect(ids.has(target), target).toBe(true);
  expect(html).not.toMatch(/\.actions\{[^}]*position:sticky/);
});

test('home lists what needs you, counting undated receipts', async () => {
  const { flagged } = await seed();
  await env.DB.prepare('UPDATE receipts SET issue_date=NULL WHERE id=?').bind(flagged.id).run();
  await flaggedImage(1);
  const html = await (await request('/?month=2026-09')).text();
  expect(html).toContain('<b>2</b> receipts need a quick check');
  expect(html).toContain('<b>1</b> payment has no receipt yet');
  expect(html).toContain('href="/payments?month=2026-09&show=missing"');
  expect(html).toMatch(/Review <span class="count">2<span class="vh"> waiting<\/span><\/span>/);
  expect(html).toMatch(/Payments <span class="count">1<span class="vh"> missing a receipt<\/span><\/span>/);
  expect(html).toContain('photo.png: Who is this from?');
  // The month slip never reads 0 beside the card: undated flagged receipts
  // (in no month) get their own row with the same total as the card.
  const slip = html.match(/<div class="slip">[\s\S]*?<\/div>/)?.[0] ?? '';
  const needYou = Number(slip.match(/<dt>Need you<\/dt><dd[^>]*>(\d+)<\/dd>/)?.[1]);
  const undated = Number(slip.match(/No date yet, need you<\/a><\/dt><dd class="red">(\d+)<\/dd>/)?.[1] ?? 0);
  expect(undated).toBe(2);
  expect(needYou + undated).toBe(2);
  const undatedRow = await (await request('/?month=2026-09')).text();
  expect(undatedRow).toContain('<a href="/review">No date yet, need you</a>');
  // Once dated in the month, it moves to the month's own count.
  await env.DB.prepare("UPDATE receipts SET issue_date='2026-09-20' WHERE status='needs_review'").run();
  const dated = await (await request('/?month=2026-09')).text();
  expect(dated).toMatch(/<dt>Need you<\/dt><dd class="red">2<\/dd>/);
  expect(dated).not.toContain('No date yet, need you');
  // First run says what to do next instead of showing zeros.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM bank_transactions'),
    env.DB.prepare('DELETE FROM imports'),
    env.DB.prepare('DELETE FROM receipts'),
  ]);
  const first = await (await request('/')).text();
  expect(first).toContain("Let's get your first receipt in");
  expect(first).toContain('receipts@example.com');
});

test('raw reason codes and payment IDs appear only in technical details', async () => {
  const { flagged } = await seed();
  const receipt = await (await request(`/receipts/${flagged.id}`)).text();
  expect(receipt).toContain('<details class="tech">');
  expect(receipt).toContain('uncertain_vendor');
  expect(receipt).toContain('Who is this from?');
  expect(receipt).toContain('No date on it.');
  expect(receipt.match(/Who is this from\?/g)).toHaveLength(1);
  for (const path of ['/', '/review', '/month?month=2026-09', `/receipts/${flagged.id}`, '/payments?month=2026-09']) {
    const html = await (await request(path)).text();
    expect(visible(html), path).not.toMatch(/\b(uncertain|missing)_[a-z_]+\b/);
    expect(visible(html), path).not.toMatch(/\bneeds_review\b/);
  }
  const payments = await (await request('/payments?month=2026-09')).text();
  expect(payments).toMatch(/value="[a-f0-9]{64}"/);
  expect(visible(payments)).not.toMatch(/[a-f0-9]{64}/);
  expect(payments).toContain('Sample Cloud Lantern Oy');
  expect(payments).toContain('Missing receipt');
});

test('Approve receipt posts the prefilled note and keeps every field name', async () => {
  const { flagged } = await seed();
  const html = await (await request(`/receipts/${flagged.id}`)).text();
  const form = htmlForm(html, `/receipts/${flagged.id}`);
  expect([...form.keys()].sort()).toEqual(
    [
      'approval_reason',
      'currency',
      'due_date',
      'duplicate_of',
      'eur_override',
      'eur_override_reason',
      'expense_type',
      'invoice_number',
      'issue_date',
      'net',
      'product',
      'revision',
      'total',
      'vat',
      'vat_rate',
      'vendor',
    ].sort(),
  );
  expect(form.get('approval_reason')).toBe('Checked against the original');
  expect(html).toContain('<button class="btn primary" name="action" value="approve">Approve receipt</button>');
  expect(html).toContain('name="action" value="save">Save, decide later</button>');
  for (const [k, v] of Object.entries({ vendor: 'Fake Shop', issue_date: '2026-09-03', net: '66.40', vat: '15.67' }))
    form.set(k, v);
  form.set('action', 'approve');
  expect((await request(`/receipts/${flagged.id}`, { method: 'POST', body: form })).status).toBe(303);
  const saved = await getReceipt(env, flagged.id);
  expect(saved.status).toBe('ready');
  expect(JSON.parse(saved.manual_fields_json).approval_reason).toBe('Checked against the original');
});

test('images preview inline with locked-down headers; PDFs and emails never do', async () => {
  const { ready, flagged } = await seed();
  const page = await (await request(`/receipts/${flagged.id}`)).text();
  expect(page).toContain(`<img src="/originals/${flagged.id}?view=inline"`);
  const inline = await request(`/originals/${flagged.id}?view=inline`);
  expect(inline.status).toBe(200);
  expect(inline.headers.get('Content-Type')).toBe('image/png');
  expect(inline.headers.get('Content-Disposition')).toBe(`inline; filename="${flagged.id}.png"`);
  expect(inline.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(inline.headers.get('Content-Security-Policy')).toBe(
    "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  expect(inline.headers.get('Cache-Control')).toBe('private, no-store');
  expect(new Uint8Array(await inline.arrayBuffer())).toEqual(PNG);
  // The download stays an attachment.
  expect((await request(`/originals/${flagged.id}`)).headers.get('Content-Disposition')).toContain('attachment');
  // PDF: a link card, never a frame or an inline response.
  const pdfPage = await (await request(`/receipts/${ready.id}`)).text();
  expect(pdfPage).toContain(`<a class="btn secondary" href="/originals/${ready.id}">Open the PDF</a>`);
  expect(pdfPage).not.toMatch(/<img|<iframe|<object|<embed/);
  expect((await request(`/originals/${ready.id}?view=inline`)).status).toBe(404);
  expect((await request(`/originals/${flagged.id}?variant=email&view=inline`)).status).toBe(404);
  // Same sign-in as everything else.
  const anonymous = await worker.fetch(new Request(`http://localhost/originals/${flagged.id}?view=inline`), env);
  expect(anonymous.status).toBe(401);
});

test('fonts are served by the Worker, match the site files and need sign-in', async () => {
  // Drift check against the marketing site's copies, where site/ exists (not in the public template).
  if (env.SITE_FONTS) expect(FONT_FILES).toEqual(JSON.parse(env.SITE_FONTS));
  const html = await (await request('/')).text();
  expect(html).toMatch(/@font-face\{font-family:"Bricolage";src:url\("\/assets\/fonts\/bricolage\.woff2\?v=[\d.]+"\)/);
  expect(html).not.toMatch(/https?:\/\/(?!localhost)/);
  for (const name of Object.keys(FONT_FILES)) {
    const font = await request(`/assets/fonts/${name}`);
    expect(font.status).toBe(200);
    expect(font.headers.get('Content-Type')).toBe('font/woff2');
    expect(font.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
    expect(new Uint8Array(await font.arrayBuffer()).length).toBeGreaterThan(10_000);
  }
  expect((await request('/assets/fonts/other.woff2')).status).toBe(404);
  expect((await worker.fetch(new Request('http://localhost/assets/fonts/bricolage.woff2'), env)).status).toBe(401);
});

test('new pages, fonts, previews and errors carry APP_BASE_PATH', async () => {
  const based = { ...env, APP_BASE_PATH: '/app' } as Env;
  const at = (path: string) =>
    worker.fetch(new Request('http://localhost' + path, { headers: { Authorization: authorization } }), based);
  const { flagged } = await seed();
  for (const path of [
    '/app/',
    '/app/review',
    '/app/month?month=2026-09',
    '/app/settings',
    '/app/more',
    '/app/import',
    '/app/nope',
    `/app/receipts/${flagged.id}`,
    '/app/payments?month=2026-09&show=missing',
  ]) {
    const response = await at(path);
    const html = await response.text();
    const targets = [...html.matchAll(/\b(?:href|action|formaction|src)="(\/[^"]*)"/g)].map((m) => m[1]!);
    expect(targets.length, path).toBeGreaterThan(5);
    for (const target of targets) expect(target.startsWith('/app/'), `${path} ${target}`).toBe(true);
    expect(html).toContain('url("/app/assets/fonts/bricolage.woff2?v=');
    expect(html).toContain('url("/app/assets/fonts/instrument-sans.woff2?v=');
  }
  expect((await at('/app/nope')).status).toBe(404);
  const font = await at('/app/assets/fonts/instrument-sans.woff2');
  expect(font.status).toBe(200);
  expect(font.headers.get('Content-Type')).toBe('font/woff2');
  expect(await (await at(`/app/receipts/${flagged.id}`)).text()).toContain(
    `<img src="/app/originals/${flagged.id}?view=inline"`,
  );
  expect((await at(`/app/originals/${flagged.id}?view=inline`)).headers.get('Content-Type')).toBe('image/png');
  expect((await at('/assets/fonts/bricolage.woff2')).status).toBe(404);
});

test('public template: no deployment names hardcoded in pages', async () => {
  await seed();
  const custom = { ...env, APP_NAME: 'Synthetic Books', ACCOUNTANT_LABEL: 'Example Accounting' } as Env;
  for (const path of ['/', '/review', '/month?month=2026-09', '/settings', '/payments?month=2026-09']) {
    const html = await (
      await worker.fetch(new Request('http://localhost' + path, { headers: { Authorization: authorization } }), custom)
    ).text();
    expect(html).toContain('Synthetic Books');
    expect(html.replace(APP_NOTICE, '')).not.toMatch(/Nuits|Baps/);
  }
});
