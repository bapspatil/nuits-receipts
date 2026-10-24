// Emails with only an HTML or text body, shaped like real forwards (YouTube,
// Finnkino, Amazon, Aalto Energia, Helen, a Cloudflare invoice). Synthetic:
// names of public companies only, no personal data, no account numbers.
import { expect, test } from 'vitest';
import { parseExtraction } from '../src/ai';
import { parseDocument } from '../src/parse';
import { visibleText } from '../src/receipts';
import { cleanVendor, forwardedSender, isOwnName, senderName } from '../src/vendor';
import { modelResponse } from './model';

const none = (type: string) => ({ type, value: null, confidence: 0.2, p_null: 0.95 });
// The model read nothing: what the body-only rows in production looked like.
const blank = {
  vendor: none('text'),
  invoice_number: none('text'),
  issue_date: none('date'),
  currency: none('text'),
  total: none('number'),
  net: none('number'),
  vat_amount: none('number'),
  vat_rate: none('number'),
  line_items: none('list'),
};

test('vendor labels, copyright lines and years are stripped', () => {
  expect(cleanVendor('Maksun saaja: Aalto Energia Oy')).toBe('Aalto Energia Oy');
  expect(cleanVendor('Saaja: Helen Sähköverkko Oy')).toBe('Helen Sähköverkko Oy');
  expect(cleanVendor('2026 Daily Blooms Pty Ltd')).toBe('Daily Blooms Pty Ltd');
  expect(cleanVendor('© 2026 Daily Blooms Pty Ltd. All rights reserved.')).toBe('Daily Blooms Pty Ltd');
  expect(cleanVendor('Receipt from Cognition AI Inc.')).toBe('Cognition AI Inc.');
  expect(cleanVendor('Seller: Amazon EU S.à r.l.')).toBe('Amazon EU S.à r.l.');
  expect(cleanVendor('  Hetzner Online GmbH ')).toBe('Hetzner Online GmbH');
  expect(cleanVendor('Maksun saaja:')).toBeNull();
  expect(cleanVendor('')).toBeNull();
  expect(cleanVendor(null)).toBeNull();
});

test("the user's own business names are never a vendor", () => {
  const own = ['Nuits', 'Bapusaheb Patil'];
  expect(isOwnName('Nuits', own)).toBe(true);
  expect(isOwnName('NUITS', own)).toBe(true);
  expect(isOwnName('Bapusaheb Patil', own)).toBe(true);
  expect(isOwnName('Nuits / Bapusaheb Patil', own)).toBe(true);
  expect(isOwnName('Cloudflare, Inc.', own)).toBe(false);
  expect(isOwnName('Nuitsware Ltd', own)).toBe(false);
  expect(isOwnName('Anything', [])).toBe(false);
});

test('the original sender is read from a forwarded header', () => {
  const gmail = [
    'Some note',
    '---------- Forwarded message ---------',
    'From: YouTube <noreply-purchases@youtube.com>',
    'Date: Sat, Oct 3, 2026 at 10:12 AM',
    'Subject: Your YouTube receipt',
  ].join('\n');
  expect(forwardedSender(gmail)).toBe('YouTube');
  expect(forwardedSender('Begin forwarded message:\n\nFrom: "Finnkino" <kuitti@finnkino.fi>\n')).toBe('Finnkino');
  expect(forwardedSender('---------- Forwarded message ---------\nFrom: <order-update@amazon.com.au>\n')).toBe(
    'amazon.com.au',
  );
  expect(forwardedSender('Lähettäjä: Aalto Energia <laskutus@aaltoenergia.fi>')).toBe('Aalto Energia');
  expect(forwardedSender('No header here')).toBeNull();
  expect(senderName({ name: 'Cloudflare via Billing', address: 'billing@cloudflare.com' })).toBe('Cloudflare');
  expect(senderName({ name: '', address: 'noreply@mail.finnkino.fi' })).toBe('finnkino.fi');
});

test('HTML table cells keep a gap, so "Yhteensä" and its amount stay apart', async () => {
  const text = await visibleText(
    '<table><tr><td>Yhteensä</td><td>15,90&nbsp;€</td></tr><tr><th>Total</th><td>$50.20</td></tr></table>',
  );
  expect(text).toMatch(/Yhteensä\s+15,90/);
  expect(text).toMatch(/Total\s+\$50\.20/);
});

test('Finnish totals and dates in a body: "Laskun summa", 139,79 € and a label on its own line', () => {
  const aalto = parseDocument(
    [
      'Maksun saaja: Aalto Energia Oy',
      'Laskun numero 7262641598',
      'Laskun päivämäärä 22.10.2026',
      'Laskun summa 11,69 €',
      'Eräpäivä 05.11.2026',
    ].join('\n'),
  );
  expect(aalto).toMatchObject({ currency: 'EUR', total: 1169, issueDate: '2026-10-22', dueDate: '2026-11-05' });
  const split = parseDocument(['Lasku 3227', 'Laskun päivämäärä', '14.10.2026', 'Laskun summa', '139,79 €'].join('\n'));
  expect(split).toMatchObject({ currency: 'EUR', total: 13979, issueDate: '2026-10-14' });
});

test('order dates and totals in English bodies: Amazon AUD, USD, €', () => {
  expect(parseDocument('Order placed 21 October 2026\nOrder Total AUD 28.71')).toMatchObject({
    currency: 'AUD',
    total: 2871,
    issueDate: '2026-10-21',
  });
  expect(parseDocument('Ordered on October 14, 2026\nGrand Total €50.99')).toMatchObject({
    currency: 'EUR',
    total: 5099,
    issueDate: '2026-10-14',
  });
  expect(parseDocument('Billing date 2026-09-29\nAmount charged USD 50.20')).toMatchObject({
    currency: 'USD',
    total: 5020,
    issueDate: '2026-09-29',
  });
  expect(parseDocument('Tilauspäivä 10.10.2026\nYhteensä 15,90 €')).toMatchObject({
    total: 1590,
    issueDate: '2026-10-10',
  });
});

test('Aalto Energia body: the vendor loses its "Maksun saaja:" label and the total is read', () => {
  const body = ['Maksun saaja: Aalto Energia Oy', 'Laskun päivämäärä 22.10.2026', 'Laskun summa 11,69 €'].join('\n');
  const result = parseExtraction(
    modelResponse({
      ...blank,
      vendor: { type: 'text', value: 'Maksun saaja: Aalto Energia Oy', confidence: 0.95, p_null: 0.01 },
    }),
    body,
  );
  expect(result.facts).toMatchObject({
    vendor: 'Aalto Energia Oy',
    currency: 'EUR',
    total_minor: 1169,
    issue_date: '2026-10-22',
  });
});

test('Finnkino-style body with nothing read by the model: totals from the body, vendor from the sender', () => {
  const body = ['Kuitti Finnkino+ -tilauksestasi', 'Tilauspäivä 10.10.2026', 'Yhteensä 15,90 €'].join('\n');
  const result = parseExtraction(modelResponse(blank), body, [], undefined, { senderName: 'Finnkino' });
  expect(result.facts).toMatchObject({
    vendor: 'Finnkino',
    currency: 'EUR',
    total_minor: 1590,
    issue_date: '2026-10-10',
  });
  // A name taken from the sender is shown but still checked by a person.
  expect(result.reasons).toContain('uncertain_vendor');
  expect(result.reasons).not.toContain('uncertain_total');
});

test('Amazon order body without a seller line: the From name fills in the vendor', () => {
  const body =
    'Ordered: "Sugarless Confectionery..." and 2 more items\nOrder placed 21 October 2026\nOrder Total AUD 28.71';
  const result = parseExtraction(modelResponse(blank), body, [], undefined, { senderName: 'Amazon.com.au' });
  expect(result.facts).toMatchObject({ vendor: 'Amazon.com.au', currency: 'AUD', total_minor: 2871 });
});

test('a Cloudflare invoice never takes the bill-to business name as the vendor', () => {
  const own = { ownNames: ['Nuits', 'Bapusaheb Patil'] };
  const invoice = [
    'Cloudflare, Inc.',
    '101 Townsend St',
    'Invoice number IN-0000001',
    'Invoice date 2026-10-01',
    'Nuits',
    'Total $20.92 USD',
  ].join('\n');
  const nuits = { type: 'text', value: 'Nuits', confidence: 0.97, p_null: 0.01 };
  const result = parseExtraction(modelResponse({ ...blank, vendor: nuits }), invoice, [], undefined, own);
  expect(result.facts.vendor).toBe('Cloudflare, Inc.');
  // No seller block: the sender's name is used, never the business name.
  const bare = parseExtraction(modelResponse({ ...blank, vendor: nuits }), 'Nuits\nTotal $20.92 USD', [], undefined, {
    ...own,
    senderName: 'Cloudflare',
  });
  expect(bare.facts.vendor).toBe('Cloudflare');
  expect(bare.reasons).toContain('uncertain_vendor');
  const nothing = parseExtraction(modelResponse({ ...blank, vendor: nuits }), 'Nuits', [], undefined, own);
  expect(nothing.facts.vendor).toBeNull();
  // An own name from the sender line is ignored too.
  const self = parseExtraction(modelResponse(blank), 'Nuits', [], undefined, { ...own, senderName: 'Nuits' });
  expect(self.facts.vendor).toBeNull();
});

test('a confident model vendor is still preferred over the sender name', () => {
  const result = parseExtraction(
    modelResponse({ vendor: { type: 'text', value: 'Google Commerce Limited', confidence: 0.95, p_null: 0.01 } }),
    'Total €18.99',
    [],
    undefined,
    { senderName: 'YouTube' },
  );
  expect(result.facts.vendor).toBe('Google Commerce Limited');
});

test('account and seller labels printed before the name are stripped', () => {
  expect(cleanVendor('Account holder HeyGen Technology Inc.')).toBe('HeyGen Technology Inc.');
  expect(cleanVendor('Account holder: HeyGen Technology Inc.')).toBe('HeyGen Technology Inc.');
  expect(cleanVendor('Account name Sample Studio Ltd')).toBe('Sample Studio Ltd');
  expect(cleanVendor('Sold by Amazon EU S.à r.l.')).toBe('Amazon EU S.à r.l.');
  expect(cleanVendor('Billed by Example Cloud Inc')).toBe('Example Cloud Inc');
  expect(cleanVendor('Company name: Example Oy')).toBe('Example Oy');
  // A buyer label means the line names the customer, never the seller.
  expect(cleanVendor('Billed to Example Studio Oy')).toBeNull();
  expect(cleanVendor('Bill to: Example Studio Oy')).toBeNull();
  expect(cleanVendor('Sold to Example Studio Oy')).toBeNull();
  expect(cleanVendor('Ship to Example Studio Oy')).toBeNull();
});

test('a labelled seller line in the document does not override the clean model name ("Read again")', () => {
  const invoice = [
    'Invoice',
    'Invoice number SDAW3TLS-0001',
    'Date of issue October 24, 2026',
    'Account holder HeyGen Technology Inc.',
    '1 Example Street',
    'Bill to',
    'Example Studio Oy',
    'Total $15.00 USD',
  ].join('\n');
  expect(parseDocument(invoice).sellerCandidates).toEqual(['HeyGen Technology Inc.']);
  const result = parseExtraction(
    modelResponse({ vendor: { type: 'text', value: 'HeyGen Technology Inc.', confidence: 0.88, p_null: 0.01 } }),
    invoice,
  );
  expect(result.facts.vendor).toBe('HeyGen Technology Inc.');
  expect(result.reasons).not.toContain('uncertain_vendor');
});
