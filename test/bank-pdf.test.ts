import { env } from 'cloudflare:workers';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { expect, test, vi } from 'vitest';
import worker from '../src/index';
import { importPreview } from '../src/imports';
import type { Env } from '../src/env';
import { checkedRow, holviStatement, isPdf, pdfLines, pdfToCsv, plainAmount, statementBlocks } from '../src/pdf';
import { authorization, confirmationForm, request } from './helpers';

// Synthetic PDFs drawn with pdf-lib. The Holvi one copies the positions of
// Holvi's "EUR - ACCOUNT STATEMENT"; every name, IBAN, ID and amount is invented.
type Text = { x: number; y: number; text: string };
async function pdf(pages: Text[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date('2026-10-01T00:00:00Z'));
  doc.setModificationDate(new Date('2026-10-01T00:00:00Z'));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const texts of pages) {
    const page = doc.addPage([595, 841]);
    for (const t of texts) page.drawText(t.text, { x: t.x, y: t.y, size: 9, font });
  }
  return doc.save({ useObjectStreams: false });
}
type Payment = { booked: string; no: number; amount: string; info: string[] };
const id = (n: number) => `f${String(n).padStart(31, '0')}`;
const card = (no: number, day: string, amount: string, shop: string, extra: string[] = []): Payment => ({
  booked: day,
  no,
  amount,
  info: [
    `Value date: ${day}`,
    'Filing ID:',
    id(no),
    shop,
    `Message: Payment sent to ${shop}`,
    'Reserved: Sept. 3, 2026, 4:15',
    'p.m.',
    'Card payment',
    ...extra,
  ],
});
const PAYMENTS: Payment[] = [
  card(1, '01/09/2026', '- 12.50', 'Fake Cafe'),
  card(2, '02/09/2026', '- 1,204.00', 'Synthetic Cloud', ['Currency and amount: USD 1,400.00', 'Exchange rate: 0.86']),
  {
    booked: '03/09/2026',
    no: 3,
    amount: '+ 2,500.25',
    info: [
      'Value date: 03/09/2026',
      'Filing ID:',
      id(3),
      'FI00 1234 5678 9012 34',
      'Example Client Oy',
      'Message: Invoice 7 for',
      'September work',
      'Reference: RF18 1234',
      'Bank transfer',
    ],
  },
  card(4, '04/09/2026', '- 7.00', 'Fake Kiosk'),
];
type Stated = { opening: string; closing: string; deposits: [string, string]; withdrawals: [string, string] };
const STATED: Stated = {
  opening: '+ 1,000.00',
  closing: '+ 2,276.75',
  deposits: ['1', '2,500.25'],
  withdrawals: ['3', '1,223.50'],
};
const footer = (n: number, of: number): Text[] => [
  { x: 107.9, y: 49.6, text: 'Synthetic Bank Ltd. Legal text for this test only.' },
  { x: 159.6, y: 34.9, text: 'Fake Street 1, 00100 Nowhere. Business ID 0000000-0.' },
  { x: 525.8, y: 19.4, text: `${n} / ${of}` },
];
const tableHead = (y: number): Text[] => [
  { x: 50.8, y, text: 'Booking date' },
  { x: 213.8, y, text: 'Payment information' },
  { x: 386.2, y, text: 'Transaction no.' },
  { x: 500.3, y, text: 'Amount EUR' },
];
// Two payments to a page, the opening balance first and the totals last.
function holviPages(payments = PAYMENTS, stated = STATED, stray = false): Text[][] {
  const pages: Text[][] = [];
  let page: Text[] = [],
    y = 0;
  const open = () => {
    page = pages.length
      ? tableHead(758)
      : [
          { x: 43.3, y: 749.2, text: 'EUR - ACCOUNT STATEMENT' },
          { x: 44, y: 727.2, text: 'Period' },
          { x: 107.4, y: 727.2, text: '01/09/2026 - 30/09/2026 Europe/Helsinki' },
          { x: 44, y: 672.4, text: 'IBAN' },
          { x: 107.4, y: 672.4, text: 'FI00 0000 0000 0000 00' },
          { x: 442.5, y: 749.2, text: 'Fake Person' },
          ...tableHead(628.2),
        ];
    y = pages.length ? 740 : 610;
    pages.push(page);
  };
  open();
  page.push({ x: 50.8, y, text: 'BALANCE 01/09/2026' }, { x: 500.3, y, text: stated.opening });
  y -= 18;
  payments.forEach((p, i) => {
    if (i && i % 2 === 0) open();
    page.push(
      { x: 50.8, y, text: p.booked },
      { x: 449.2 - 4.5 * (String(p.no).length - 1), y, text: String(p.no) },
      { x: 545.3 - 4.5 * p.amount.length, y, text: p.amount },
    );
    p.info.forEach((line, j) => page.push({ x: 213.8, y: y - j * 10.2, text: line }));
    y -= p.info.length * 10.2 + 8;
  });
  if (stray) page.push({ x: 386.2, y: y + 4, text: 'Unexpected' });
  page.push(
    { x: 50.8, y, text: 'BALANCE 30/09/2026' },
    { x: 500.3, y, text: stated.closing },
    { x: 213.8, y: y - 36, text: 'FUNDS AVAILABLE 30/09/2026' },
    { x: 509.3, y: y - 36, text: '2,276.75' },
    { x: 213.8, y: y - 54, text: 'TOTAL NUMBER OF DEPOSITS' },
    { x: 444.7, y: y - 54, text: stated.deposits[0] },
    { x: 504.8, y: y - 54, text: stated.deposits[1] },
    { x: 213.8, y: y - 72, text: 'TOTAL NUMBER OF WITHDRAWALS' },
    { x: 444.7, y: y - 72, text: stated.withdrawals[0] },
    { x: 504.8, y: y - 72, text: stated.withdrawals[1] },
  );
  return pages.map((texts, n) => [...texts, ...footer(n + 1, pages.length)]);
}

async function upload(bytes: Uint8Array, testEnv?: Env) {
  const body = new FormData();
  body.set('account', 'holvi');
  body.set('file', new File([bytes], 'statement.pdf', { type: 'application/pdf' }));
  if (testEnv) return importPreview(testEnv, body);
  return worker.fetch(
    new Request('http://localhost/imports/csv', {
      method: 'POST',
      body,
      headers: { Authorization: authorization, Origin: 'http://localhost' },
    }),
    env,
  );
}

test('amounts are read as printed: signs, spaces and thousands', () => {
  expect(plainAmount('+ 1,234.56')).toBe('1234.56');
  expect(plainAmount('- 75.70')).toBe('-75.70');
  expect(plainAmount('-1 234,56')).toBe('-1234.56');
  expect(plainAmount('12')).toBe('12.00');
  expect(plainAmount('Card payment')).toBeNull();
});

test('a Holvi statement PDF is read by layout: parts of each cell, balances and totals', async () => {
  const bytes = await pdf(holviPages());
  expect(isPdf(bytes)).toBe(true);
  const statement = holviStatement(await pdfLines(bytes))!;
  expect(statement).toMatchObject({
    layout: 'holvi',
    opening: '1000.00',
    closing: '2276.75',
    credit: { count: 1, sum: '2500.25' },
    debit: { count: 3, sum: '-1223.50' },
  });
  expect(statement.rows.map((r) => [r.date, r.amount, r.id, r.description])).toEqual([
    ['2026-09-01', '-12.50', id(1), 'Card payment'],
    ['2026-09-02', '-1204.00', id(2), 'Card payment'],
    ['2026-09-03', '2500.25', id(3), 'Bank transfer'],
    ['2026-09-04', '-7.00', id(4), 'Card payment'],
  ]);
  expect(statement.rows[0]).toMatchObject({ counterparty: 'Fake Cafe', message: 'Payment sent to Fake Cafe' });
  // The IBAN is left out of the payer; a wrapped message is joined; the reference is its own part.
  expect(statement.rows[2]).toMatchObject({
    counterparty: 'Example Client Oy',
    message: 'Invoice 7 for September work',
    reference: 'RF18 1234',
  });
  // A line in no known place stops the read rather than being skipped.
  await expect(pdfToCsv(env, await pdf(holviPages(PAYMENTS, STATED, true)))).rejects.toThrow(/don't fit the statement/);
});

test('a Holvi PDF uploads as downloaded and imports with no mapping and no model call', async () => {
  const run = vi.fn();
  const response = await upload(await pdf(holviPages()), { ...env, AI_MODE: 'live', AI: { run } } as Env);
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(run).not.toHaveBeenCalled();
  expect(html).toContain('We recognised a Holvi export. 4 payments');
  expect(html).toContain('No problems found.');
  expect((await request('/imports/csv/confirm', { method: 'POST', body: confirmationForm(html) })).status).toBe(303);
  const stored = await env.DB.prepare(
    'SELECT count(*) n, sum(amount_minor) total, count(DISTINCT external_id) ids FROM bank_transactions',
  ).first();
  expect(stored).toEqual({ n: 4, total: 127675, ids: 4 });
});

test('printed totals and balances that the rows do not add up to stop the import', async () => {
  const bad = await upload(
    await pdf(
      holviPages(PAYMENTS, {
        opening: '+ 1,000.00',
        closing: '+ 2,300.00',
        deposits: ['2', '2,500.25'],
        withdrawals: ['3', '1,223.60'],
      }),
    ),
  );
  const html = await bad.text();
  expect(bad.status).toBe(422);
  expect(html).toContain('The file lists 2 money in payments, but 1 were read.');
  expect(html).toContain('The file totals money out at -1223.60 EUR, but the rows add up to -1223.50 EUR.');
  expect(html).toContain(
    'The file&#39;s balance goes from 1000.00 to 2300.00 EUR, but the rows add up to 1276.75 EUR.',
  );
  expect(html).not.toContain('formaction="/imports/csv/confirm"');
});

// Another bank's layout: one line per payment, a repeated page header and footer.
function otherPages(): Text[][] {
  const pages = [
    [
      ['Opening balance 01.09.2026', '500.00'],
      ['01.09.2026 Fake Shop Card', '-4.20 EUR'],
    ],
    [['02.09.2026 Example Client Oy Invoice 7', '1,250.00 EUR']],
    [
      ['03.09.2026 Synthetic Telecom', '-30.00 EUR'],
      ['Closing balance 03.09.2026', '1,715.80'],
    ],
  ];
  return pages.map((lines, n) => [
    { x: 40, y: 800, text: 'Synthetic Savings Bank account statement' },
    ...lines.flatMap(([text, amount], i) => [
      { x: 40, y: 700 - i * 20, text: text! },
      { x: 480, y: 700 - i * 20, text: amount! },
    ]),
    { x: 40, y: 30, text: `Page ${n + 1} of 3` },
  ]);
}

test('another layout is read by the mock model block by block and checked against the PDF', async () => {
  const { blocks, stated } = statementBlocks(await pdfLines(await pdf(otherPages())));
  // The header and footer repeat on every page and are left out of the blocks.
  expect(blocks).toEqual([
    '01.09.2026 Fake Shop Card -4.20 EUR',
    '02.09.2026 Example Client Oy Invoice 7 1,250.00 EUR',
    '03.09.2026 Synthetic Telecom -30.00 EUR',
  ]);
  expect(stated).toMatchObject({ opening: '500.00', closing: '1715.80' });
  const response = await upload(await pdf(otherPages()));
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(html).toContain('We recognised a PDF statement export. 3 payments');
  expect(html).toContain('No problems found.');
});

test('model values the block does not print are dropped, so the row shows as a problem', () => {
  const block = '03/04/2026 Fake Shop -4.20 EUR';
  const answer = {
    date: '2026-04-03',
    amount: -4.2,
    currency: 'EUR',
    counterparty: 'Fake Shop',
    description: null,
    reference: null,
    external_id: null,
  };
  expect(checkedRow(block, answer, null)).toMatchObject({ date: '2026-04-03', amount: '-4.20', currency: 'EUR' });
  // 3 April or 4 March are both readings of the printed date; 5 April is neither.
  expect(checkedRow(block, { ...answer, date: '2026-03-04' }, null).date).toBe('2026-03-04');
  expect(checkedRow(block, { ...answer, date: '2026-04-05', amount: -42 }, null)).toMatchObject({
    date: null,
    amount: null,
  });
  expect(checkedRow(block, { ...answer, counterparty: 'Invented Name', currency: 'XXX' }, 'EUR')).toMatchObject({
    counterparty: '',
    currency: 'EUR',
  });
});

test('the live model reads blocks in calls of 20, and an unsure value stops the import', async () => {
  const lines = Array.from({ length: 25 }, (_, i) => [
    { x: 40, y: 780 - i * 20, text: `2026-09-${String(i + 1).padStart(2, '0')} Fake Shop ${i + 1}` },
    { x: 480, y: 780 - i * 20, text: `-${i + 1}.00` },
  ]);
  const bytes = await pdf([lines.flat()]);
  const run = vi.fn(async (model: string, input: Record<string, unknown>) => {
    expect(model).toBe('@cf/cloudflare/clairic');
    const state = String(input.state),
      fields = input.fields as Record<string, { type: string; instructions: string }>;
    expect(fields.r1_amount).toMatchObject({ type: 'number' });
    expect(fields.r1_amount!.instructions).toMatch(/^Payment \[r1\] only\./);
    const answers: Record<string, unknown> = {};
    for (const [n, block] of state.split('\n\n').entries()) {
      const day = block.match(/\d{4}-\d{2}-(\d{2})/)!,
        i = Number(day[1]);
      const value = (key: string, v: unknown, confidence = 0.99) =>
        (answers[`r${n + 1}_${key}`] = { type: 'text', value: v, confidence, p_null: 0 });
      value('date', day[0]);
      value('amount', -i, i === 25 ? 0.4 : 0.99);
      value('counterparty', `Fake Shop ${i}`);
    }
    return { model: 'clairic-fixture', answers, truncated: false, usage: { input_tokens: 100, output_tokens: 0 } };
  });
  const response = await upload(bytes, { ...env, AI_MODE: 'live', AI: { run } } as Env);
  expect(run).toHaveBeenCalledTimes(2);
  expect(Object.keys(run.mock.calls[0]![1].fields as object)).toHaveLength(20 * 7);
  expect(response.status).toBe(422);
  expect(await response.text()).toContain('Row 26, amount');
  const failing = vi.fn(async () => {
    throw new Error('model unavailable');
  });
  const refused = await upload(bytes, { ...env, AI_MODE: 'live', AI: { run: failing } } as Env).catch((e) => e);
  expect(String(refused.message)).toMatch(/couldn't read payments from that PDF/);
});
