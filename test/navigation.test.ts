import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { htmlForm, locationOf, request, signed } from './helpers';
import { missingPayment, seed } from './package-helpers';

const open = (month: string) => `${month}-12`;
const home = async (path = '/') => (await request(path)).text();
const markSent = async (month: string) => {
  const html = await home(`/?month=${month}`);
  return request('/month/sent', { method: 'POST', body: htmlForm(html, '/month/sent') });
};

test('Home opens on the oldest month that is not sent, and says why', async () => {
  await seed({ bytes: 'march', issue_date: open('2020-03'), vendor: 'March Co' });
  await seed({ bytes: 'april', issue_date: open('2020-04'), vendor: 'April Co' });
  let html = await home();
  expect(html).toContain('<h1>March 2020</h1>');
  expect(html).toContain("<strong>March isn't sent yet.</strong> It needs its bank statement.");
  expect(html).toMatch(/· <a href="\/\?month=\d{4}-\d{2}">Go to [A-Z][a-z]+<\/a>/);
  // A month named in the address is never replaced, and gets no reason line.
  expect(await home('/?month=2020-04')).not.toContain("isn't sent yet");

  expect((await markSent('2020-03')).status).toBe(303);
  html = await home();
  expect(html).toContain('<h1>April 2020</h1>');
  await markSent('2020-04');
  html = await home();
  expect(html).not.toContain("isn't sent yet");
  expect(html).toContain(
    `<h1>${new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h1>`,
  );

  await env.DB.prepare("UPDATE receipts SET revision=revision+1 WHERE vendor='March Co'").run();
  html = await home();
  expect(html).toContain('<h1>March 2020</h1>');
  expect(html).toContain('<strong>March changed since you sent it.</strong> <a href="#send">See what changed.</a>');
});

test('a flagged month names what needs you, and Bank opens on the same month', async () => {
  await seed({
    bytes: 'flag',
    issue_date: open('2020-03'),
    status: 'needs_review',
    review_reasons_json: '["missing_total"]',
  });
  expect(await home()).toContain("March isn't sent yet.</strong> 1 receipt needs you.");
  // An undated receipt waits in the same Review, so the count names it too.
  await seed({
    bytes: 'undated',
    issue_date: null,
    status: 'needs_review',
    review_reasons_json: '["missing_issue_date"]',
  });
  expect(await home()).toContain("March isn't sent yet.</strong> 1 receipt needs you, plus 1 undated receipt.");
  const bank = await home('/payments');
  expect(bank).toContain('<title>Bank · March 2020 ·');
  await missingPayment('2019-12');
  expect(await home('/payments')).toContain('<title>Bank · December 2019 ·');
});

test('a later step that is done shows done, even before an earlier one is', async () => {
  await seed({
    bytes: 'flag',
    issue_date: open('2020-03'),
    status: 'needs_review',
    review_reasons_json: '["missing_total"]',
  });
  // Money in only: the statement is there and nothing is missing a receipt.
  await missingPayment('2020-03', 'Client Oy', 4200);
  const html = await home('/?month=2020-03');
  expect(html).toContain('<li class="step now" aria-current="step"><a href="/review">');
  expect(html).toContain('<li class="step done"><a href="/payments?month=2020-03">');
});

test('Mark as sent can be undone, and only the latest send', async () => {
  await seed({ bytes: 'one', issue_date: open('2020-03') });
  const sent = await markSent('2020-03');
  const location = locationOf(sent);
  const at = new URL(location, 'http://localhost').searchParams.get('at')!;
  const banner = await home(await signed(location.replace(/#send$/, '')));
  expect(banner).toContain('Marked March 2020 as sent.');
  const undo = htmlForm(banner, '/month/sent/undo');
  expect(Object.fromEntries(undo)).toEqual({ month: '2020-03', at });

  await env.DB.prepare(
    "INSERT INTO month_sends (month,sent_at,method,file_count,total_minor,receipts_hash,receipts_json) VALUES ('2020-03','2099-01-01T00:00:00.000Z','download',1,0,'x','[]')",
  ).run();
  expect((await request('/month/sent/undo', { method: 'POST', body: undo })).status).toBe(422);
  await env.DB.prepare("DELETE FROM month_sends WHERE sent_at LIKE '2099%'").run();

  const undone = await request('/month/sent/undo', { method: 'POST', body: undo });
  expect(undone.status).toBe(303);
  expect(await env.DB.prepare('SELECT count(*) n FROM month_sends').first('n')).toBe(0);
  expect(await home('/?month=2020-03')).toContain('Mark March as sent');
});

test('the Send step downloads first, then asks whether it was sent', async () => {
  await seed({ bytes: 'ready', issue_date: open('2020-03') });
  await env.DB.prepare("UPDATE receipts SET status='ready'").run();
  await missingPayment('2020-03');
  await env.DB.prepare('UPDATE bank_transactions SET receipt_id=(SELECT id FROM receipts LIMIT 1)').run();
  const html = await home('/?month=2020-03');
  expect(html).toMatch(/<a class="btn primary" href="\/month\/package.zip\?month=2020-03">Download ZIP/);
  expect(html).toContain('<h3>Did you send it?</h3>');
  expect(html).toContain('Mark March as sent</button>');
  expect(html.match(/class="[^"]*\bbtn primary\b/g)).toHaveLength(1);
  const bank = await home('/payments?month=2020-03');
  expect(bank).toContain('Every payment has a receipt.');
  expect(bank).toContain('Send March</a>');
  await markSent('2020-03');
  const after = await home('/payments?month=2020-03');
  // The bulk bar stays hidden until a row is picked.
  expect(after.replace(/<form id="[^"]*" class="bulkbar"[\s\S]*?<\/form>/g, '')).not.toContain('btn primary');
  expect(after).toContain('March is sent');
});

test('step markers carry the same three words everywhere', async () => {
  await seed({ bytes: 'x', issue_date: open('2020-03') });
  const html = await home('/?month=2020-03');
  const words = [...html.matchAll(/<li class="step (\w+)"[^>]*><a[^>]*><span class="vh">([^<]+)<\/span>/g)].map(
    (m) => `${m[1]} ${m[2]}`,
  );
  expect(words.every((w) => /^(done Done|now Next|todo To do): $/.test(w))).toBe(true);
  expect((await home('/import')).match(/<span class="vh">(Done|Next|To do): <\/span>/g)).toHaveLength(3);
});

test('Receipts has one Add button that follows the open tab', async () => {
  await seed({ bytes: 'r', issue_date: open('2020-03') });
  await seed({ bytes: 'i', issue_date: open('2020-03'), kind: 'sales', client: 'Client Oy', invoice_number: 'I-1' });
  const receipts = await home('/receipts?month=2020-03');
  expect(receipts).toContain('Receipts <span class="num">1</span>');
  expect(receipts).toContain('Invoices <span class="num">1</span>');
  expect(receipts).toContain('<a class="btn primary" href="/add">Add receipt</a>');
  expect(receipts).not.toContain('Add invoice');
  const invoices = await home('/invoices?month=2020-03');
  expect(invoices).toContain('<a class="btn primary" href="/add?kind=sales">Add invoice</a>');
  expect(invoices).not.toContain('>Add receipt<');
});
