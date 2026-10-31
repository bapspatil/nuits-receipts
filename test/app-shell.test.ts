import { env } from 'cloudflare:workers';
import { expect, test, vi } from 'vitest';
import worker from '../src/index';
import { importBankCsv, parsePreset } from '../src/banking';
import { getReceipt, preserve } from '../src/receipts';
import { FONT_FILES } from '../src/fonts';
import { EXPORT_LINE, FOOTER_NOTICE } from '../src/ui';
import type { Env } from '../src/env';
import { authorization, htmlForm, idFrom, locationOf, request, signed, uploadPdf } from './helpers';
import { icon } from '../src/icons';
import { button, buttonLink, statusMark } from '../src/actions';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
// The same four destinations in the header and the phone tab bar, on every page.
const NAV = ['/', '/receipts', '/payments', '/settings'];
const LABELS = ['Home', 'Receipts', 'Bank', 'Settings'];
// The phone's tab bar has Add in the middle; the sidebar has it above the four places.
const TABS = ['/', '/receipts', '/add', '/payments', '/settings'];
const TAB_LABELS = ['Home', 'Receipts', 'Add', 'Bank', 'Settings'];
// Wording Legal never allows on a page. "any bank" is allowed only inside the footer sentence.
const BANNED =
  /vat[- ]compliant|tax[- ]ready|100\s*% accurate|\bany[- ]bank\b|never leaves your account|no access to your data/i;
const banned = (html: string) => html.replaceAll(FOOTER_NOTICE, '').match(BANNED);

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
  return getReceipt(env, idFrom(response));
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
    add: nav.match(/^<a class="navadd" href="([^"]*)"/)?.[1] ?? null,
    current: nav.match(/<a (?:class="navadd" )?href="([^"]*)" aria-current="page"/)?.[1] ?? null,
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
// The bulk bar stays hidden until a row is picked, so its buttons don't count.
function primaries(html: string) {
  const shown = html.replace(/<form id="[^"]*" class="bulkbar"[\s\S]*?<\/form>/g, '');
  return [...shown.matchAll(/class="[^"]*\bbtn primary\b[^"]*"/g)].length;
}
function visible(html: string) {
  return html
    .replace(/<details class="more">[\s\S]*?<\/details>/g, '')
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]*>/g, ' ');
}
function expectShell(html: string, current: string | null) {
  expect(navOf(html)).toEqual({ links: NAV, add: expect.stringMatching(/^\/add/), current });
  const { links, current: currentTabs } = tabsOf(html);
  expect(links.map((l) => l!.replace(/\?.*/, ''))).toEqual(TABS);
  expect(links[2]).toBe(navOf(html).add);
  expect(currentTabs).toEqual(current ? [current] : []);
  expect(html).not.toContain('href="/more"');
  expect(banned(html)).toBeNull();
  expect(html).toContain('viewport-fit=cover');
  expect(html).toContain('<a class="skip" href="#main">Skip to content</a>');
  expect(html).toContain('<main id="main" tabindex="-1">');
  expect(html).toContain(`<footer class="foot"><p class="notice">${FOOTER_NOTICE}</p>`);
  expect(html.split(FOOTER_NOTICE)).toHaveLength(2);
  expect(html).not.toContain('class="kicker"');
  expect(html).not.toContain('class="sub"');
  expect(html.match(/<h1\b/g)).toHaveLength(1);
  expect(html).not.toMatch(new RegExp('[\\u2013\\u2014]'));
  expect(html).not.toContain('/cdn-cgi/access/logout');
}

test('every page, including error pages, has the same four-item nav', async () => {
  const { ready, flagged } = await seed();
  const pages: [string, string | null][] = [
    ['/', '/'],
    ['/?month=2026-09', '/'],
    ['/?month=2026-09&offset=100', '/'],
    ['/receipts?view=todo', '/receipts'],
    ['/receipts?view=todo&month=2026-09', '/receipts'],
    ['/?in=year:2026&q=a', '/'],
    ['/receipts', '/receipts'],
    ['/?show=needs&month=2026-09&q=a', '/'],
    ['/payments?month=2026-09', '/payments'],
    ['/payments?month=2026-09&view=todo', '/payments'],
    ['/settings', '/settings'],
    ['/import', '/payments'],
    ['/receipts?view=all&kind=sales&month=2026-09', '/receipts'],
    ['/receipts?view=all&kind=sales&month=2026-09&show=overdue', '/receipts'],
    ['/add', '/add'],
    ['/add?kind=other', '/add'],
    [`/receipts/${ready.id}`, '/receipts'],
    [`/receipts/${flagged.id}`, '/receipts'],
  ];
  for (const [path, current] of pages) {
    const response = await request(path);
    expect(response.status, path).toBe(200);
    expectShell(await response.text(), current);
  }
  // Errors keep their status and message, now inside the layout with a way back.
  const missing = await request('/nope', { headers: { Referer: 'http://localhost/receipts?view=todo' } });
  expect(missing.status).toBe(404);
  expect(missing.headers.get('Content-Type')).toContain('text/html');
  const missingHtml = await missing.text();
  expectShell(missingHtml, null);
  expect(missingHtml).toContain(
    '<div class="alert" role="alert"><p><strong>We couldn&#39;t find that page.</strong></p></div>',
  );
  expect(missingHtml).toContain(buttonLink('back', '/receipts?view=todo', { tone: 'primary' }));
  const body = htmlForm(await (await request(`/receipts/${flagged.id}`)).text(), `/receipts/${flagged.id}`);
  body.set('action', 'approve');
  const refused = await request(`/receipts/${flagged.id}`, {
    method: 'POST',
    body,
    headers: { Referer: `http://evil.example/receipts/${flagged.id}` },
  });
  expect(refused.status).toBe(422);
  const refusedHtml = await refused.text();
  // The refused form comes back in place: the receipt page, what was typed, and the message at the field.
  expectShell(refusedHtml, '/receipts');
  expect(refusedHtml).toContain(
    'role="alert"><p><strong>Nothing was saved.</strong> Fill in the seller, date, currency, total, amount before VAT and VAT, then approve. <a href="#f-',
  );
  expect(refusedHtml).toMatch(/aria-invalid="true" aria-describedby="e-receipt"/);
  expect(refusedHtml).toMatch(/<p class="ferr" id="e-receipt">Fill in the seller/);
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
    '/receipts?view=todo',
    '/payments?month=2026-09',
    '/import',
    '/?month=2026-09',
    '/receipts?view=all&kind=sales&month=2026-09',
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
  expect(unverified).toContain(`<button class="btn primary" form="fix" formaction="/receipts/${email.id}/retry">`);
  expect(primaries(await (await request('/receipts?view=todo&month=2026-09')).text())).toBe(1);
  // All matched: the month close is the next step.
  await env.DB.prepare('UPDATE bank_transactions SET receipt_required=0 WHERE receipt_id IS NULL').run();
  const matched = await (await request('/payments?month=2026-09')).text();
  expect(primaries(matched)).toBe(1);
  expect(matched).toContain('Every payment has a receipt.');
  // Settings is five sections and one Save, which is the page's one filled button.
  expect(primaries(await (await request('/settings')).text())).toBe(1);
});

test('empty screens say what is missing and offer one next step', async () => {
  for (const path of [
    '/receipts?view=todo',
    '/payments?month=2026-09',
    '/receipts?view=all&kind=sales&month=2026-09',
  ]) {
    const html = await (await request(path)).text();
    const empty = html.match(/<div class="card empty">([\s\S]*?)<\/main>/)?.[1] ?? '';
    expect(empty, path).toMatch(/<h2>[^<]+/);
    expect(primaries(empty), path).toBe(1);
  }
  // One line and one action: no hint paragraph, no badge.
  for (const path of [
    '/receipts?view=todo',
    '/payments?month=2026-09',
    '/receipts?view=all&kind=sales&month=2026-09',
  ]) {
    const empty = (await (await request(path)).text()).match(/<div class="card empty">([\s\S]*?)<\/div>/)?.[1] ?? '';
    expect(empty, path).toMatch(
      /^<h2>[^]*<\/h2><a class="btn primary" href="[^"]+"><svg[^>]*><use href="#i-[a-z-]+"\/><\/svg><span>[^<]+<\/span><\/a>$/,
    );
  }
  expect(await (await request('/receipts?view=todo')).text()).toContain(
    `<div class="card empty"><h2>Nothing to do.</h2>${buttonLink('seeReceipts', '/', { tone: 'primary' })}</div>`,
  );
  // No statement yet: Bank has no transfer or import sections to show.
  expect(await (await request('/payments?month=2026-09')).text()).not.toContain('id="transfers"');
  const plain = { ...env, INVOICES_ADDRESS: '' } as Env;
  const invoices = await (
    await worker.fetch(
      new Request('http://localhost/receipts?view=all&kind=sales', { headers: { Authorization: authorization } }),
      plain,
    )
  ).text();
  expect(invoices).toContain('Set an invoice address in <a href="/settings#setup-email">Settings</a>.');
  // Home with nothing dated this month still offers the next step.
  await uploadPdf();
  const quiet = await (await request('/?month=2030-01')).text();
  expect(quiet).toContain('<b>Check</b><span>Nothing yet</span>');
  expect(quiet).toContain(buttonLink('addReceipt', '/add', { tone: 'primary' }));
  expect(primaries(quiet)).toBe(1);
  await seed();
  await env.DB.prepare('UPDATE bank_transactions SET receipt_required=0 WHERE receipt_id IS NULL').run();
  const matched = await (await request('/payments?month=2026-09')).text();
  expect(matched).toContain('<div class="card empty"><h2>Every payment has a receipt.</h2>');
});

test('phones get a bottom tab bar with icons, labels and counts', async () => {
  await seed();
  const html = await (await request('/')).text();
  const { nav } = tabsOf(html);
  expect([...nav.matchAll(/<\/span><span>([A-Za-z]+)<\/span><\/a>/g)].map((m) => m[1])).toEqual(TAB_LABELS);
  const header = html.match(/<nav class="main" aria-label="Main">([\s\S]*?)<\/nav>/)?.[1] ?? '';
  expect([...header.matchAll(/<a href="[^"]*"[^>]*><svg[\s\S]*?<\/svg>([A-Za-z]+)/g)].map((m) => m[1])).toEqual(LABELS);
  expect(header).toMatch(/Receipts <span class="count">\d+<span class="vh"> to do<\/span><\/span>/);
  expect(header).toMatch(/Bank <span class="count">1<span class="vh"> missing a receipt<\/span><\/span>/);
  expect(nav.match(/<svg [^>]*aria-hidden="true"/g)).toHaveLength(5);
  expect(header).toMatch(/^<a class="navadd" href="\/add"><svg[^>]*><use href="#i-plus"\/><\/svg>Add<\/a>/);
  expect(nav).toMatch(/href="\/receipts">.*?<span class="count">\d+<span class="vh"> to do<\/span><\/span>/);
  expect(nav).toMatch(/href="\/payments">.*?<span class="count">1<span class="vh"> missing a receipt<\/span>/);
  const phone = html.match(/@media \(max-width:879px\)\{([\s\S]*?)\n\}/)?.[1] ?? '';
  expect(phone).toContain('nav.main,.sign-out{display:none}');
  // A floating capsule above the home indicator: the installed app has no browser chrome under it.
  expect(phone).toMatch(
    /nav\.tabs\{display:block;position:fixed;[^}]*bottom:calc\(10px \+ env\(safe-area-inset-bottom\)\)/,
  );
  expect(phone).toMatch(/nav\.tabs a\{[^}]*min-height:64px/);
  expect(phone).toContain('env(safe-area-inset-bottom)');
  expect(phone).toContain('body{padding-bottom:var(--tabbar-height)}');
  expect(phone).toContain('html{scroll-padding-bottom:');
  expect(phone).toContain('textarea:focus) :is(nav.tabs,.sbar){display:none}');
  expect(phone).not.toContain(':hover');
  expect(html).toContain('nav.tabs{display:none}');
});

test('empty Settings sections say what to add', async () => {
  // Settings sections say what to do when empty.
  await env.DB.batch([env.DB.prepare('DELETE FROM vendor_rules'), env.DB.prepare('DELETE FROM accounts')]);
  const settings = await (await request('/settings')).text();
  expect(settings).toContain('No bank accounts yet. Importing a statement creates one.');
  expect(settings).toContain('No rules yet.');
});

test('Receipts and Invoices are two tabs on Invoices, with counts, and never in To do', async () => {
  const segment = (html: string) =>
    html.match(/<nav class="seg" aria-label="Receipts and invoices">([\s\S]*?)<\/nav>/)?.[1];
  // Receipts, all of them, are a folder on Home, which has no tabs of its own.
  expect(segment(await (await request('/')).text())).toBeUndefined();
  const invoices = await (await request('/receipts?view=all&kind=sales')).text();
  expect(segment(invoices)).toMatch(
    /<a href="\/\?in=kind:expense&amp;month=\d{4}-\d{2}">Receipts <span class="num">0<\/span><\/a><\/li><li><a href="\/receipts\?view=all&amp;kind=sales&amp;month=\d{4}-\d{2}" aria-current="page">Invoices <span class="num">0<\/span><\/a>/,
  );
  // The month carries across the tabs.
  expect(segment(await (await request('/receipts?view=all&kind=sales&month=2026-09')).text())).toContain(
    '<a href="/?in=kind:expense&amp;month=2026-09">Receipts <span class="num">0</span></a>',
  );
  // To do has the view switch only: never two stacked switches, and no month arrows.
  const todo = await (await request('/receipts?view=todo&month=2026-09')).text();
  expect(segment(todo)).toBeUndefined();
  expect(todo).not.toContain('class="months"');
  expect(todo).toContain('<nav class="seg" aria-label="View">');
});

test('Home lists every file, Needs you included, with the rarer filters behind More filters', async () => {
  const { ready } = await seed();
  const html = await (await request('/')).text();
  expect(html).toContain('photo.png');
  expect(html).toContain(`open=r%3A${ready.id}`);
  // One search field, no month input.
  expect(html.split('</main>')[0]!.match(/<input [^>]*type="search"/g)).toHaveLength(1);
  expect(html).not.toContain('type="month"');
  await env.DB.prepare('UPDATE receipts SET duplicate_of=? WHERE id<>?').bind(ready.id, ready.id).run();
  const chips =
    (await (await request('/')).text()).match(/<ul class="chips" aria-label="Show">([\s\S]*?)<\/ul>/)?.[1] ?? '';
  expect([...chips.matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1])).toEqual(['All', 'Duplicate (1)']);
  await env.DB.prepare('UPDATE receipts SET duplicate_of=NULL').run();
  // Old filter links still filter.
  const needs = await (await request('/?show=needs')).text();
  expect(needs).toContain('photo.png');
  expect(needs).not.toContain(`open=r%3A${ready.id}`);
});

test('a receipt links back to where it lives', async () => {
  const { ready, flagged } = await seed();
  expect(await (await request(`/receipts/${flagged.id}`)).text()).toContain(
    '<a href="/receipts?view=todo">‹ To do</a>',
  );
  expect(await (await request(`/receipts/${ready.id}`)).text()).toContain('<a href="/">‹ Home</a>');
});

test('old Month and More addresses redirect, keeping the query exactly', async () => {
  const query = '?month=2026-09&offset=100&anyway=1&undated=1&changes=1&sent=1&upload=more&wait=7&x=a%2Fb+c';
  for (const method of ['GET', 'HEAD']) {
    const month = await request('/month' + query, { method });
    expect(month.status, method).toBe(302);
    expect(month.headers.get('Location'), method).toBe('/' + query);
    const more = await request('/more', { method });
    expect(more.status, method).toBe(302);
    expect(more.headers.get('Location'), method).toBe('/settings');
  }
  expect(locationOf(await request('/month'))).toBe('/');
  const based = { ...env, APP_BASE_PATH: '/app' } as Env;
  const at = (path: string) =>
    worker.fetch(new Request('http://localhost' + path, { headers: { Authorization: authorization } }), based);
  expect(locationOf(await at('/app/month' + query))).toBe('/app/' + query);
  expect(locationOf(await at('/app/more'))).toBe('/app/settings');
  // Sign-in comes first: no redirect without it.
  for (const path of ['/month?month=2026-09', '/more']) {
    const anonymous = await worker.fetch(new Request('http://localhost' + path), env);
    expect(anonymous.status, path).toBe(401);
    expect(anonymous.headers.get('Location'), path).toBeNull();
  }
  // Downloads and form actions under /month keep their addresses.
  expect((await request('/month/package.zip?month=2026-09')).status).not.toBe(302);
});

test('Invoices is a list like Receipts: one summary line, one status word, CSV with the export line', async () => {
  await seed();
  await env.DB.prepare('UPDATE bank_transactions SET receipt_id=NULL').run();
  // Home has no tables any more.
  expect(await (await request('/?month=2026-09')).text()).not.toContain('<table class="stack">');
  const sales = await env.DB.prepare(
    "UPDATE receipts SET kind='sales',status='ready',review_reasons_json='[]',client='Example Client Oy',invoice_number='INV-7',issue_date='2026-09-04',total_minor=12550,currency='EUR' WHERE id=(SELECT id FROM receipts WHERE status='ready' LIMIT 1) RETURNING id",
  ).first<string>('id');
  const html = await (await request('/receipts?view=all&kind=sales&month=2026-09')).text();
  expect(html).not.toContain('<table');
  expect(html.match(/<p class="summary">.*?<\/p>/)?.[0]).toBe(
    '<p class="summary">Invoiced EUR 125.50, received EUR 0.00</p>',
  );
  expect(html).toContain(
    `<li class="row"><label class="pick"><input type="checkbox" name="id" value="${sales}" form="bulk-invoices"><span class="vh">Select Invoice to Example Client Oy</span></label><span class="date">4 Sep</span><div class="rb"><p class="rt"><a href="/receipts/${sales}?from=all&amp;month=2026-09">Example Client Oy</a></p><p class="meta">INV-7</p></div><span class="rs">${statusMark('overdue', { after: '18 Sep' })}</span><span class="amt">EUR 125.50</span></li>`,
  );
  expect(html).toContain(`<p class="small">${EXPORT_LINE}</p>`);
  expect(html).not.toContain('What counts as paid?');
  expect(html).not.toContain('Spreadsheet');
});

test('flagged fields are one compact row: the question labels the input, its sentence is a tooltip', async () => {
  const { flagged } = await seed();
  const html = await (await request(`/receipts/${flagged.id}`)).text();
  expect(html).toContain(
    `<label class="flabel" for="f-vendor" title="We couldn&#39;t read the seller&#39;s name.">Who is this from?</label>`,
  );
  expect(html).toMatch(
    /<input name="vendor" value="" type="text" autocomplete="off" id="f-vendor" aria-invalid="true">/,
  );
  expect(html).not.toContain("We couldn't read the seller's name.</span>");
  expect(html).not.toContain('>Seller<');
  // Every row label points at a control.
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const [, target] of html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)) expect(ids.has(target), target).toBe(true);
  // One sticky bar on every width. Phones keep it above the tab bar (and on a receipt in Review the
  // tab bar goes, so only one fixed bar remains), never over the focused field: it hides while typing,
  // and scrolling into view leaves room for it.
  const phone = html.match(/@media \(max-width:879px\)\{([\s\S]*?)\n\}/)?.[1] ?? '';
  expect(phone).toContain('.sbar{position:sticky;bottom:var(--tabbar-height);');
  expect(phone).toContain('body.p-reviewItem nav.tabs{display:none}');
  expect(html).toContain('<body class="p-reviewItem">');
  expect(phone).toContain('html{scroll-padding-bottom:calc(var(--tabbar-height) + 88px)}');
  expect(html).toMatch(/\n\.sbar\{position:sticky;bottom:var\(--space-4\);/);
});

test('home closes the month and lists what needs you, counting undated receipts', async () => {
  const { flagged } = await seed();
  await env.DB.prepare('UPDATE receipts SET issue_date=NULL WHERE id=?').bind(flagged.id).run();
  await flaggedImage(1);
  const html = await (await request('/?month=2026-09')).text();
  expect(html).toContain(
    `<div class="head"><div class="months" role="group" aria-label="Month"><a href="/?month=2026-08">${icon('chevron-left')}Aug<span class="vh"> 2026</span></a><h1>September 2026</h1><a href="/?month=2026-10">Oct<span class="vh"> 2026</span>${icon('chevron-right')}</a></div></div>`,
  );
  // Three status rows, one word each; the current step's action is the one primary.
  const steps = html.match(/<ol class="steps"[^>]*>([\s\S]*?)<\/ol>/)?.[1];
  expect(steps).toBe(
    // Undated receipts wait in To do, so Check is not done while any is left.
    '<li class="step now" aria-current="step"><a href="/receipts?view=todo&amp;month=2026-09"><span class="vh">Next: </span><b>Check</b><span class="red">2 undated</span></a></li>' +
      '<li class="step todo"><a href="/payments?month=2026-09&view=todo"><span class="vh">To do: </span><b>Match</b><span class="red">1 missing</span></a></li>' +
      '<li class="step todo"><a href="#send"><span class="vh">To do: </span><b>Send</b><span>Not ready</span></a></li>',
  );
  expect(html).not.toContain('Done: </span><b>Check</b>');
  expect(html).toContain(
    `<div class="next">${buttonLink('start', '/receipts?view=todo&month=2026-09', { tone: 'primary' })}</div>`,
  );
  expect(primaries(html)).toBe(1);
  expect(html).toMatch(/Receipts <span class="count">2<span class="vh"> to do<\/span><\/span>/);
  expect(html).toMatch(/Bank <span class="count">1<span class="vh"> missing a receipt<\/span><\/span>/);
  // No lists or tables of the month: one link to them instead.
  expect(html).not.toContain('Fake Unmatched Shop');
  expect(html).not.toContain('<table class="stack">');
  expect(html).not.toContain('class="dated"');
  expect(html).not.toContain('dated September');
  // One switcher: no second month field and Go button.
  expect(html).not.toContain('type="month"');
  // Once dated in the month, they count in the month's own step.
  await env.DB.prepare("UPDATE receipts SET issue_date='2026-09-20' WHERE status='needs_review'").run();
  const dated = await (await request('/?month=2026-09')).text();
  expect(dated).toContain(
    '<a href="/receipts?view=todo&amp;month=2026-09"><span class="vh">Next: </span><b>Check</b><span class="red">2 to check</span></a>',
  );
  expect(dated).toContain(buttonLink('start', '/receipts?view=todo&month=2026-09', { tone: 'primary' }));
  expect(dated).not.toContain('undated');
  // First run says what to do next instead of showing zeros.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM bank_transactions'),
    env.DB.prepare('DELETE FROM imports'),
    env.DB.prepare('DELETE FROM receipts'),
  ]);
  const first = await (await request('/')).text();
  expect(first).toContain('<h1>Welcome</h1>');
  // A five-item setup checklist that counts what is done, then the upload.
  const checklist = first.match(/<section class="setup"[\s\S]*?<\/section>/)![0];
  expect(checklist).toMatch(/Finish setting up<\/h2><p id="setup-n">\d of 5 done<\/p>/);
  expect(
    [...checklist.matchAll(/<a href="([^"]+)"><span class="vh">[^<]*<\/span><b>([^<]+)<\/b>/g)].map((m) => m[1]),
  ).toEqual([
    // What is left first, then the finished ones folded below.
    '/settings?routing=1#setup-email',
    '/settings#f-ACCOUNTANT_LABEL',
    '/import',
    '/settings#f-SELLER_NAMES',
    '/settings#accounts',
  ]);
  expect(checklist).toContain('<details class="finished"><summary>2 done</summary>');
  expect(checklist.indexOf('<details class="finished">')).toBeGreaterThan(checklist.indexOf('/import'));
  expect(checklist).toContain('<b>Confirm Email Routing in Cloudflare</b>');
  expect(checklist).toContain('href="/help"');
  expect(first).toContain('receipts@example.com');
  expect(primaries(first)).toBe(1);
});

test('raw reason codes and payment IDs appear nowhere on the receipt page', async () => {
  const { flagged } = await seed();
  const receipt = await (await request(`/receipts/${flagged.id}`)).text();
  expect(receipt).not.toContain('<details class="tech">');
  expect(receipt).not.toContain('uncertain_vendor');
  expect(receipt).toContain('Who is this from?');
  expect(receipt).toContain('What is the date?');
  expect(receipt.match(/Who is this from\?/g)).toHaveLength(1);
  for (const path of [
    '/',
    '/receipts?view=todo',
    '/?month=2026-09',
    `/receipts/${flagged.id}`,
    '/payments?month=2026-09',
  ]) {
    const html = await (await request(path)).text();
    expect(visible(html), path).not.toMatch(/\b(uncertain|missing)_[a-z_]+\b/);
    expect(visible(html), path).not.toMatch(/\bneeds_review\b/);
  }
  const payments = await (await request('/payments?month=2026-09&view=all')).text();
  expect(payments).toMatch(/value="[a-f0-9]{64}"/);
  expect(visible(payments)).not.toMatch(/[a-f0-9]{64}/);
  expect(payments).toContain('Sample Cloud Lantern Oy');
  expect(payments).toContain(statusMark('missing'));
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
      'from',
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
  // Approve sits in the sticky bar, tied to the form; a hidden first button makes Enter approve.
  expect(html).toContain(
    button('approve', {
      tone: 'primary',
      label: 'Approve receipt',
      attrs: ' form="fix" name="action" value="approve"',
    }),
  );
  expect(html).toMatch(
    /<form [^>]*id="fix">\s*<button class="btn secondary vh" name="action" value="approve" tabindex="-1" aria-hidden="true">/,
  );
  // Skip is the only "later"; there is no second save button.
  expect(html).not.toContain('Save, decide later');
  expect(html).not.toContain('Approve again');
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
  expect(pdfPage).toContain(buttonLink('original', `/originals/${ready.id}`));
  expect(pdfPage).not.toMatch(/<img|<iframe|<object|<embed/);
  expect((await request(`/originals/${ready.id}?view=inline`)).status).toBe(404);
  expect((await request(`/originals/${flagged.id}?variant=email&view=inline`)).status).toBe(404);
  // Same sign-in as everything else.
  const anonymous = await worker.fetch(new Request(`http://localhost/originals/${flagged.id}?view=inline`), env);
  expect(anonymous.status).toBe(401);
});

test('fonts are served by the Worker, match the site files and need sign-in', async () => {
  // Drift check against the marketing site's copies, where site/ exists (not in the public template).
  if (env.SITE_FONTS) expect(FONT_FILES).toMatchObject(JSON.parse(env.SITE_FONTS));
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

test('the app has a tab icon, served by the Worker without sign-in', async () => {
  const html = await (await request('/')).text();
  expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
  const icon = await request('/favicon.svg');
  expect(icon.status).toBe(200);
  expect(icon.headers.get('Content-Type')).toBe('image/svg+xml');
  expect(await icon.text()).toMatch(/^<svg /);
  expect((await worker.fetch(new Request('http://localhost/favicon.svg'), env)).status).toBe(200);
  const based = { ...env, APP_BASE_PATH: '/app' } as Env;
  const at = (path: string) =>
    worker.fetch(new Request('http://localhost' + path, { headers: { Authorization: authorization } }), based);
  expect(await (await at('/app/')).text()).toContain('<link rel="icon" href="/app/favicon.svg"');
  expect((await at('/app/favicon.svg')).status).toBe(200);
});

test('pages ask Chrome to fetch the other tabs ahead, from a rules file behind sign-in', async () => {
  const page = await request('/');
  expect(page.headers.get('Speculation-Rules')).toBe('"/assets/speculation-rules.json"');
  const rules = await request('/assets/speculation-rules.json');
  expect(rules.status).toBe(200);
  expect(rules.headers.get('Content-Type')).toBe('application/speculationrules+json');
  const { prefetch } = (await rules.json()) as { prefetch: { where: unknown; eagerness: string }[] };
  expect(prefetch).toEqual([
    {
      where: {
        and: [{ selector_matches: 'nav.main a, nav.tabs a' }, { not: { selector_matches: '[aria-current=page]' } }],
      },
      eagerness: 'moderate',
    },
  ]);
  expect((await worker.fetch(new Request('http://localhost/assets/speculation-rules.json'), env)).status).toBe(401);
  const based = { ...env, APP_BASE_PATH: '/app' } as Env;
  const at = (path: string) =>
    worker.fetch(new Request('http://localhost' + path, { headers: { Authorization: authorization } }), based);
  expect((await at('/app/receipts?view=todo')).headers.get('Speculation-Rules')).toBe(
    '"/app/assets/speculation-rules.json"',
  );
  expect((await at('/app/assets/speculation-rules.json')).status).toBe(200);
});

test('new pages, fonts, previews and errors carry APP_BASE_PATH', async () => {
  const based = { ...env, APP_BASE_PATH: '/app' } as Env;
  const at = (path: string) =>
    worker.fetch(new Request('http://localhost' + path, { headers: { Authorization: authorization } }), based);
  const { flagged } = await seed();
  for (const path of [
    '/app/',
    '/app/receipts?view=todo',
    '/app/?month=2026-09',
    '/app/settings',
    '/app/import',
    '/app/nope',
    `/app/receipts/${flagged.id}`,
    '/app/payments?month=2026-09&view=todo',
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
  for (const path of ['/', '/receipts?view=todo', '/?month=2026-09', '/settings', '/payments?month=2026-09']) {
    const html = await (
      await worker.fetch(new Request('http://localhost' + path, { headers: { Authorization: authorization } }), custom)
    ).text();
    expect(html).toContain('Synthetic Books');
    // Settings > About names the upstream project in its licence and trademark lines, by design.
    const about = /<div class="sectpart" id="about">[\s\S]*?<\/div><\/div><\/details>/;
    expect(html.replace(FOOTER_NOTICE, '').replace(about, '')).not.toMatch(/Nuits|Baps/);
  }
});

test('stamps mark only exceptions; done things are quiet text', async () => {
  const { ready, flagged } = await seed();
  for (const path of [
    '/',
    '/?month=2026-09',
    '/receipts?view=todo',
    '/receipts',
    '/payments?month=2026-09',
    `/receipts/${ready.id}`,
  ]) {
    const html = await (await request(path)).text();
    expect(html, path).not.toMatch(/class="stamp (?:ready|matched)"/);
    for (const [, kind] of html.matchAll(/<(?:span|a) class="stamp (\w+)"/g))
      expect(['warn', 'info', 'ok', 'muted'], path).toContain(kind);
  }
  const bank = await (await request('/payments?month=2026-09&view=all')).text();
  expect(bank).toMatch(
    /<span class="stamp ok"><svg[^>]*><use href="#i-badge-check"\/><\/svg><span>Matched<\/span><\/span> <a class="tag" href="\/receipts\/[0-9a-f]{64}">Receipt<\/a>/,
  );
  expect(bank).toContain(statusMark('missing'));
  expect(bank).toContain('<span class="tag">Money in</span>');
  // A ready receipt has no stamp at all; one that needs you keeps it, tilted on its own page only.
  expect(await (await request(`/receipts/${ready.id}`)).text()).toContain(statusMark('matched'));
  expect(await (await request(`/receipts/${flagged.id}`)).text()).toContain(statusMark('needs'));
  expect(bank).not.toMatch(/\.stamp[^{]*\{[^}]*rotate/);
});

test('filter chips show only when they filter something', async () => {
  const chips = (html: string) =>
    [
      ...(
        html.match(/<(?:ul class="chips"[^>]*|nav class="seg" aria-label="View"><ul)>([\s\S]*?)<\/ul>/)?.[1] ?? ''
      ).matchAll(/>([^<]+)<\/a>/g),
    ].map((m) => m[1]);
  // Filter chips only, not the To do | All switch.
  const filters = (html: string) => chips(html.replace(/<nav class="seg" aria-label="View">[\s\S]*?<\/nav>/, ''));
  await seed();
  // A short queue needs no filters.
  const second = await flaggedImage(1);
  await env.DB.prepare(`UPDATE receipts SET review_reasons_json='["missing_issue_date"]' WHERE id=?`)
    .bind(second.id)
    .run();
  expect(filters(await (await request('/receipts?view=todo')).text())).toEqual([]);
  // Review has no reason chips at any length, and an old ?reason= link just shows the queue.
  for (let i = 2; i < 6; i++) await flaggedImage(i);
  expect(filters(await (await request('/receipts?view=todo')).text())).toEqual([]);
  expect(filters(await (await request('/receipts?view=todo&month=2026-09')).text())).toEqual([]);
  // Bank's To do | All switch always shows both views, counted month-wide.
  expect(chips(await (await request('/payments?month=2026-09')).text())).toEqual(['To do (1)', 'All (3)']);
  await env.DB.prepare('UPDATE bank_transactions SET receipt_required=0 WHERE receipt_id IS NULL').run();
  expect(chips(await (await request('/payments?month=2026-09')).text())).toEqual(['To do (0)', 'All (3)']);
});

test('rarely used things sit behind one More per object, named for screen readers', async () => {
  await seed();
  const bank = await (await request('/payments?month=2026-09&view=all')).text();
  expect(bank).not.toContain('Technical details');
  const more = [...bank.matchAll(/<details class="more"><summary class="btn ghost" aria-label="More for ([^"]+)">/g)];
  // A row has a More only when it has an action to hide; the payment ID is not shown at all.
  expect(more.map((m) => m[1])).toEqual(['Sample Cloud Lantern Oy', 'Fake Unmatched Shop']);
  expect(bank).not.toMatch(/ID <code>/);
  // Remove match waits in More; the row shows only the receipt link.
  const matchedRow = [...bank.matchAll(/<li class="row"[^>]*>[\s\S]*?<\/li>(?=<li class="row"|<\/ul>)/g)]
    .map((m) => m[0])
    .find((r) => r.includes('value="unlink"'))!;
  expect(matchedRow).toMatch(
    /<details class="more">[\s\S]*value="unlink"><svg[^>]*><use href="#i-unlink"\/><\/svg><span>Unmatch<\/span><\/button>/,
  );
  // Bank opens on To do; the footer trio and the Transfers section are gone.
  const missing = await (await request('/payments?month=2026-09')).text();
  expect(missing).toContain(
    '<a href="/payments?month=2026-09&amp;view=todo" data-view="todo" data-count="1" aria-current="page">To do (1)</a>',
  );
  expect(missing).not.toContain('Sample Cloud Lantern Oy');
  expect(missing).toContain(button('exempt', { attrs: ' name="receipt_required" value="0"' }));
  for (const gone of ['What is a missing receipt?', 'Own-account transfers', 'Pair a transfer', 'Statements imported'])
    expect(missing).not.toContain(gone);
  expect(bank).toContain('summary:focus-visible{');
});

test('one type and spacing scale, 44px targets, and a footer clear of the tab bar', async () => {
  const html = await (await request('/')).text();
  const css = html.match(/<style>([\s\S]*?)<\/style>/)![1]!;
  expect(css).toContain('h1{font-family:var(--font-display);font-size:var(--text-2xl);');
  expect(css).toMatch(
    /@media\(max-width:720px\)\{:root\{--text-sm:13\.5px;--text-base:16px;--text-2xl:30px;--btn-height:44px;\}\}/,
  );
  expect(css).toContain('h2{font-size:var(--text-lg);');
  expect(css).toContain('font:400 var(--text-base)/1.5 var(--font-ui)');
  // No text under 12px, in the type tokens or in a raw length.
  for (const [, size] of css.matchAll(/--text-\w+:([\d.]+)rem/g)) expect(Number(size)).toBeGreaterThanOrEqual(0.75);
  for (const [, size] of css.matchAll(/font(?:-size)?:(?:\d+ )?\.(\d+)rem/g))
    expect(Number(`0.${size}`)).toBeGreaterThanOrEqual(0.75);
  // Spacing comes from --space-1..8; the only raw lengths left are a hairline and one negative nudge.
  expect([...css.matchAll(/--space-\d:(\d+)px/g)].map((m) => Number(m[1]))).toEqual([4, 8, 12, 16, 24, 32, 48, 64]);
  const spacing = new Set<number>();
  for (const [, value] of css.matchAll(/(?<![\w-])(?:padding|margin|gap)(?:-(?:top|right|bottom|left))?:([^;}]+)/g))
    for (const [, px] of value!.matchAll(/(?:^|[\s(,-])(\d+)px/g)) spacing.add(Number(px));
  expect([...spacing].sort((a, b) => a - b)).toEqual([1, 12]);
  for (const rule of ['label.check{', '.list a{', '.why>summary{', '.chips a{'])
    expect(css.slice(css.indexOf(rule)).split('}')[0], rule).toContain('min-height:44px');
  // Chip borders reach 3:1 against the page.
  expect(css.slice(css.indexOf('.chips a{')).split('}')[0]).toContain('border:1px solid var(--border-strong)');
  expect(css).not.toContain('.kicker');
});

test('Approve and Skip move through Review; the last approval lands on Review', async () => {
  const { flagged } = await seed();
  const second = await flaggedImage(1);
  const first = await (await request(`/receipts/${flagged.id}`)).text();
  expect(first).toContain('<span class="prog">1 of 2 to check</span>');
  expect(first).toContain(button('skip', { attrs: ' form="fix" name="action" value="skip"' }));
  // Skip saves what was typed and opens the next one.
  const skip = htmlForm(first, `/receipts/${flagged.id}`);
  skip.set('vendor', 'Typed Then Skipped');
  skip.set('action', 'skip');
  const skipped = await request(`/receipts/${flagged.id}`, { method: 'POST', body: skip });
  // The next receipt opens on its first field to fill.
  expect(locationOf(skipped)).toMatch(new RegExp(`^/receipts/${second.id}\\?from=todo&done=skipped#f-[a-z_]+$`));
  expect((await getReceipt(env, flagged.id)).vendor).toBe('Typed Then Skipped');
  expect((await getReceipt(env, flagged.id)).status).toBe('needs_review');
  // Approve opens the next one with a one-word confirmation.
  const approve = htmlForm(await (await request(`/receipts/${second.id}`)).text(), `/receipts/${second.id}`);
  for (const [k, v] of Object.entries({ vendor: 'Fake Shop', issue_date: '2026-09-03', net: '66.40', vat: '15.67' }))
    approve.set(k, v);
  approve.set('action', 'approve');
  const approved = await request(`/receipts/${second.id}`, { method: 'POST', body: approve });
  expect(locationOf(approved)).toMatch(
    new RegExp(`^/receipts/${flagged.id}\\?from=todo&done=approved&name=Fake\\+Shop#f-[a-z_]+$`),
  );
  expect(await (await request(await signed(`/receipts/${flagged.id}?done=approved`))).text()).toContain(
    '<p class="banner" id="banner" role="status">Approved.</p>',
  );
  const last = htmlForm(await (await request(`/receipts/${flagged.id}`)).text(), `/receipts/${flagged.id}`);
  for (const [k, v] of Object.entries({ issue_date: '2026-09-03', net: '66.40', vat: '15.67' })) last.set(k, v);
  last.set('action', 'approve');
  const lastRes = await request(`/receipts/${flagged.id}`, { method: 'POST', body: last });
  expect(locationOf(lastRes)).toMatch(/^\/receipts\?view=todo&done=approvedLast&month=2026-09&step=match&name=/);
  // The empty Review says it is done and points at the next step, for the month the receipt belongs to.
  const empty = await (await request(lastRes.headers.get('Location')!)).text();
  expect(empty).toContain(
    'Every receipt is checked. Next, match September&#39;s payments. <a href="/payments?month=2026-09&amp;view=todo">Open Bank</a>',
  );
  expect(empty).toContain('<form method="post" action="/undo">');
});

test('a ready receipt has one Save; a new problem sends it back to Review', async () => {
  const { ready } = await seed();
  const html = await (await request(`/receipts/${ready.id}`)).text();
  expect(html).toContain(button('save', { tone: 'primary', attrs: ' form="fix" name="action" value="save"' }));
  expect(html).not.toContain('value="approve"');
  // A ready receipt opens as its summary; Edit opens every field.
  expect(html).toContain('<details class="all"><summary>Edit</summary>');
  expect(html).toContain('<dl class="kv sum">');
  const form = htmlForm(html, `/receipts/${ready.id}`);
  form.set('action', 'save');
  expect(locationOf(await request(`/receipts/${ready.id}`, { method: 'POST', body: form }))).toBe(
    `/receipts/${ready.id}?from=all&done=saved`,
  );
  form.set('revision', String((await getReceipt(env, ready.id)).revision));
  form.set('vat', '');
  const moved = await request(`/receipts/${ready.id}`, { method: 'POST', body: form });
  expect(locationOf(moved)).toBe(`/receipts/${ready.id}?from=all&done=movedBack`);
  expect((await getReceipt(env, ready.id)).status).toBe('needs_review');
  expect(await (await request(await signed(`/receipts/${ready.id}?done=movedBack`))).text()).toContain(
    'it moved back to To do.',
  );
});

test('the receipt page: flags first, Other fields closed, rare actions under one More', async () => {
  const { flagged } = await seed();
  const html = await (await request(`/receipts/${flagged.id}`)).text();
  // The count of fields is said once, as work to do; "N of M to check" in the bar is the receipts.
  expect(html).toContain('<h2 id="fix-h">5 fields to fill</h2>');
  expect(html).not.toContain('5 to check');
  expect(html).toContain('<details class="all"><summary>Other fields</summary>');
  expect(html).toContain('<details class="note"><summary>Note</summary>');
  const more =
    html.match(
      /<details class="more"><summary class="btn ghost">[\s\S]*?<\/summary>([\s\S]*?)<\/div><\/section><\/div>/,
    )?.[1] ?? '';
  for (const action of ['Read again', 'Move to invoices', 'Download original', 'Upload a copy', 'Always file as'])
    expect(more, action).toContain(action);
  // Two groups: the document, and the receipt's status and filing.
  const groups = [
    ...more.matchAll(/<div class="mgrp" role="group" aria-label="([^"]+)">([\s\S]*?)(?=<div class="mgrp"|$)/g),
  ];
  expect(groups.map((g) => g[1])).toEqual(['The document', 'This receipt']);
  for (const action of ['Read again', 'Download original', 'Upload a copy'])
    expect(groups[0]![2], action).toContain(action);
  for (const action of ['Move to invoices', 'Always file as']) expect(groups[1]![2], action).toContain(action);
  expect(groups[0]![2]).not.toContain('Move to invoices');
  expect(groups[1]![2]).not.toContain('Read again');
  // Move has no Undo, so it says what it clears before it runs.
  expect(more).toMatch(
    /<details><summary class="btn ghost"><svg[^>]*><use href="#i-folder-input"\/><\/svg><span>Move to invoices<\/span><\/summary><div class="body"><form action="\/receipts\/[0-9a-f]{64}\/kind" method="post">[^]*?<p class="ask">Moving clears the client, VAT details, paid date, your corrections and any match.<\/p><button class="btn ghost" name="kind" value="sales"><svg[^>]*><use href="#i-folder-input"\/><\/svg><span>Move to invoices<\/span><\/button>/,
  );
  expect(more).not.toContain('Technical details');
  for (const gone of [
    'Save, decide later',
    'Approve again',
    'Files it under',
    'What approval needs',
    'Paid in another currency?',
    'This is a duplicate',
    'Everything else we read',
  ])
    expect(html, gone).not.toContain(gone);
  // The original comes first, beside the fields on wide screens and above them on phones, so the
  // reading order matches the page; a skip link jumps past it to the fields.
  expect(html.indexOf('class="doc"')).toBeLessThan(html.indexOf('class="fixes"'));
  expect(html).toContain('<a class="skip" href="#fix">Skip to the fields</a>');
  expect(html).toContain(`<a class="frame" href="/originals/${flagged.id}?view=inline">`);
  // To do rows: name, amount and the first problem as one word, its question as a tooltip.
  const review = await (await request('/receipts?view=todo')).text();
  const todoRow = review.match(new RegExp(`<li class="row" data-row="${flagged.id}"[^>]*>[\\s\\S]*?</li>`))![0];
  expect(todoRow).toContain(
    `id="row-${flagged.id}" tabindex="-1" style="view-transition-name:r-${flagged.id}"><label class="pick"><input type="checkbox" name="id" value="${flagged.id}" form="bulk-todo"><span class="vh">Select photo.png</span></label>`,
  );
  expect(todoRow).toContain(`<a href="/receipts/${flagged.id}?from=todo">photo.png</a>`);
  expect(todoRow).toContain('<span class="kind">Receipt</span> <span title="Who is this from?">Seller +4</span>');
  expect(todoRow).toContain(`<span class="rs">${statusMark('needs')}</span><span class="amt">EUR 82.07</span>`);
  expect(review).not.toContain('arrived');
  expect(review).not.toContain('action="/discard" class="discard"');
  expect(review).toContain('Start checking (1)');
});

test('required flags are red; an optional one is neutral, labelled, and never invalid', async () => {
  const { flagged } = await seed();
  const html = await (await request(`/receipts/${flagged.id}`)).text();
  // Required flags come first, each empty one invalid and labelled "Required".
  expect(html.match(/<li class="flag req">/g)).toHaveLength(5);
  expect(html.match(/<span class="warning">Required<\/span>/g)).toHaveLength(4);
  expect(html.match(/aria-invalid="true"/g)).toHaveLength(4);
  // VAT % is in view, optional and neutral, not hidden in a fold.
  expect(html).toMatch(
    /<li class="flag opt">[\s\S]*?for="f-vat_rate">VAT %<\/label><span class="meta">Optional<\/span>/,
  );
  expect(html).not.toMatch(/id="f-vat_rate"[^>]*aria-invalid/);
  // Only a receipt number is missing: that is optional, so the receipt is not in To do and says so quietly.
  await env.DB.prepare(`UPDATE receipts SET review_reasons_json='["missing_invoice_number"]' WHERE id=?`)
    .bind(flagged.id)
    .run();
  const optional = await (await request(`/receipts/${flagged.id}`)).text();
  expect(optional).toContain('<p class="meta quiet">Not needed to approve: What is the receipt number?</p>');
  expect(optional).not.toContain('aria-invalid="true"');
  expect(optional).not.toContain('class="flag ');
});

test('a refused approve marks only the field that failed', async () => {
  const { flagged } = await seed();
  const form = htmlForm(await (await request(`/receipts/${flagged.id}`)).text(), `/receipts/${flagged.id}`);
  form.set('action', 'approve');
  const refused = await request(`/receipts/${flagged.id}`, { method: 'POST', body: form });
  expect(refused.status).toBe(422);
  const html = await refused.text();
  expect(html.match(/aria-invalid="true"/g)).toHaveLength(1);
  expect(html).toMatch(/id="f-vendor" aria-invalid="true" aria-describedby="e-receipt"/);
});

test('an undated receipt says why the date matters; To do counts it', async () => {
  const { flagged } = await seed();
  const html = await (await request(`/receipts/${flagged.id}`)).text();
  expect(html).toContain(
    '<p class="meta" id="h-issue_date">Which month does this belong to? Your accountant needs a date.</p>',
  );
  expect(html).toContain('id="f-issue_date" aria-invalid="true" aria-describedby="h-issue_date"');
  expect(html).toContain('<p class="meta" id="h-vat">Enter 0 if the receipt has no VAT.</p>');
  expect(html).not.toContain('placeholder="0 if none"');
  expect(await (await request('/receipts?view=todo')).text()).toContain('<p class="listhead">1 to do</p>');
});

test('amounts accept a decimal comma or point, and the hint echoes the document', async () => {
  const { flagged } = await seed();
  const form = htmlForm(await (await request(`/receipts/${flagged.id}`)).text(), `/receipts/${flagged.id}`);
  for (const [k, v] of Object.entries({
    vendor: 'Fake Shop',
    issue_date: '2026-09-03',
    net: '1.234,56',
    vat: '15,67',
    total: '1 250,23',
    vat_rate: '25,5',
  }))
    form.set(k, v);
  form.set('action', 'approve');
  expect((await request(`/receipts/${flagged.id}`, { method: 'POST', body: form })).status).toBe(303);
  const saved = await getReceipt(env, flagged.id);
  expect([saved.net_minor, saved.vat_minor, saved.total_minor, saved.vat_rate_bps]).toEqual([
    123456, 1567, 125023, 2550,
  ]);
  // A document that writes 30,00 gets a comma in its examples, and its text is shown beside the fields.
  const note = await preserve(env, {
    bytes: new TextEncoder().encode('Sample Print Shop\nPosters 18.09.2026\nTotal 30,00 EUR\nVAT 6,10 EUR'),
    media: 'text/plain',
    filename: 'note.txt',
    source: 'upload',
  });
  await env.DB.prepare(`UPDATE receipts SET status='needs_review',review_reasons_json='["missing_total"]' WHERE id=?`)
    .bind(note.id)
    .run();
  const page = await (await request(`/receipts/${note.id}`)).text();
  expect(page).toContain('Type it as on the receipt, for example 30,00.');
  expect(page).toContain('As printed on the receipt, for example 25,5.');
  expect(page).toMatch(/class="doch">The text that was read<\/h2><pre class="paper" tabindex="0">Sample Print Shop/);
  // A PDF opens in the viewer, with its text as the fallback without script.
  const { ready } = await seed();
  expect(await (await request(`/receipts/${ready.id}`)).text()).toMatch(
    /class="doch">The PDF<\/h2><section class="viewer" data-viewer data-type="pdf"[^>]*>[\s\S]*?<div class="vfallback"><p class="small">As text:<\/p><pre class="paper"/,
  );
});

test('Approve stays above the phone keyboard: the receipt page sizes with it and lifts its bar', async () => {
  const { flagged } = await seed();
  const html = await (await request(`/receipts/${flagged.id}`)).text();
  expect(html).toContain('interactive-widget=resizes-content');
  expect(html).toContain('<script src="/assets/keyboard.js" defer></script>');
  // The bar sits above the keyboard height the script writes, on the pages that have a bar of fields.
  expect(html).toContain('body.p-reviewItem .sbar{bottom:calc(var(--kb,0px)');
  const script = await request('/assets/keyboard.js');
  expect(script.headers.get('Content-Type')).toContain('text/javascript');
  expect(await script.text()).toContain("setProperty('--kb'");
  // Other pages carry neither the script nor a reason to.
  expect(await (await request('/settings')).text()).not.toContain('/assets/keyboard.js');
});
