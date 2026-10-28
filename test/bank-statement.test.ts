import { env } from 'cloudflare:workers';
import { expect, test, vi } from 'vitest';
import worker from '../src/index';
import { importPreview } from '../src/imports';
import type { Env } from '../src/env';
import { detectHeaderRecord, inspectCsv, parseCsv, statedTotals, validateMapping } from '../src/csv';
import { suggestMappings } from '../src/presets';
import { columnSample, columnsMapping } from '../src/ai';
import { numberText, readXlsx, xlsxToCsv } from '../src/xlsx';
import { authorization, confirmationForm, request } from './helpers';

// Synthetic statement in the shape of a Holvi export: an account line and
// stated totals above the column names. Names, IBAN and amounts are invented.
const HEADER = [
  'Value date',
  'Booking date',
  'Amount',
  'Currency',
  'Counterparty',
  'Description',
  'Reference',
  'Message',
  'Filing ID',
];
const ROWS = [
  [
    '31 Aug 2026',
    '1 Sept 2026',
    '-12.5',
    'EUR',
    'Synthetic Cloud',
    'Synthetic Cloud card',
    '',
    'Plan',
    'f0000000000000000000000000000001',
  ],
  [
    '2 Sept 2026',
    '2 Sept 2026',
    '-7',
    'EUR',
    'Fake Cafe',
    'Fake Cafe card',
    'RF00 1234',
    '',
    'f0000000000000000000000000000002',
  ],
  [
    '3 Sept 2026',
    '3 Sept 2026',
    '100.25',
    'EUR',
    'Example Client',
    'Example Client',
    '',
    'Invoice 7',
    'f0000000000000000000000000000003',
  ],
];
function preamble(credits = ['100.25', '1'], debits = ['-19.5', '2']): string[][] {
  return [
    ['IBAN', 'FI00 0000 0000 0000 00', 'Account type', 'debit'],
    [],
    ['Total credits', 'Total volume of credits', 'Total count of credits'],
    ['', ...credits],
    ['Total debits', 'Total volume of debits', 'Total count of debits'],
    ['', ...debits],
    [],
  ];
}
const csvText = (rows: string[][]) =>
  rows.map((r) => r.map((c) => (/[",]/.test(c) ? `"${c}"` : c)).join(',')).join('\r\n') + '\r\n';
const statementCsv = (...args: Parameters<typeof preamble>) => csvText([...preamble(...args), HEADER, ...ROWS]);
const bytes = (text: string) => new TextEncoder().encode(text);

// A minimal .xlsx: a ZIP of a workbook, its relationships and one sheet.
let crcTable: number[] | undefined;
function crc32(data: Uint8Array): number {
  crcTable ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const b of data) crc = crcTable[(crc ^ b) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
async function deflate(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer(),
  );
}
async function zip(files: Record<string, string>, store = false): Promise<Uint8Array> {
  const local: Uint8Array[] = [],
    central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = bytes(content),
      data = store ? raw : await deflate(raw),
      path = bytes(name),
      crc = crc32(raw);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(8, store ? 0 : 8, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, data.length, true);
    head.setUint32(22, raw.length, true);
    head.setUint16(26, path.length, true);
    local.push(new Uint8Array(head.buffer), path, data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(10, store ? 0 : 8, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, raw.length, true);
    entry.setUint16(28, path.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), path);
    offset += 30 + path.length + data.length;
  }
  const size = central.reduce((n, part) => n + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, central.length / 2, true);
  end.setUint16(10, central.length / 2, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Uint8Array(await new Blob([...local, ...central, new Uint8Array(end.buffer)]).arrayBuffer());
}
const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const letter = (i: number) => String.fromCharCode(65 + i);
// Text cells inline (as Holvi writes them) or shared; number-looking cells as numbers.
async function xlsx(rows: string[][], options: { shared?: boolean; store?: boolean; extra?: string } = {}) {
  const strings: string[] = [];
  const cell = (value: string, r: number, c: number) => {
    const ref = `${letter(c)}${r + 1}`;
    if (value === '') return '';
    if (/^-?\d+(\.\d+)?$/.test(value))
      return `<c r="${ref}" t="n"><v>${value === '-7' ? '-6.999999999999999' : value}</v></c>`;
    if (options.shared) {
      strings.push(value);
      return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
    }
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  };
  const sheetRows = rows
    .map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, r, c)).join('')}</row>`)
    .join('');
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const files: Record<string, string> = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet 1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${ns}"><sheetData>${sheetRows}${options.extra ?? ''}</sheetData></worksheet>`,
  };
  if (options.shared)
    files['xl/sharedStrings.xml'] =
      `<sst xmlns="${ns}">${strings.map((s) => `<si><t>${escapeXml(s)}</t></si>`).join('')}</sst>`;
  return zip(files, options.store);
}

async function upload(file: File, values: Record<string, string> = {}, testEnv?: Env) {
  const body = new FormData();
  body.set('account', 'holvi');
  for (const [k, v] of Object.entries(values)) body.set(k, v);
  body.set('file', file);
  // Live mode needs a production-strength password at the front door, so a live
  // model is tested on the Check step itself.
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

test('the column names are found below an account line and stated totals', () => {
  const layout = inspectCsv(bytes(statementCsv()));
  expect(layout.headerRecord).toBe(7);
  expect(layout.delimiter).toBe(',');
  expect(layout.headers).toEqual(HEADER);
  expect(
    detectHeaderRecord([
      ['Date', 'Amount', 'Payee'],
      ['2026-09-01', '-1.00', 'Shop'],
    ]),
  ).toBe(0);
  expect(detectHeaderRecord([['only'], ['1']])).toBeNull();
  // A file with no preamble still starts at the first row.
  expect(inspectCsv(bytes('Date;Amount;Payee\n2026-09-01;-1.00;Shop\n')).headerRecord).toBe(0);
});

test('the Holvi statement layout reads booked dates, signed amounts, references and Filing IDs', () => {
  const data = bytes(statementCsv()),
    layout = inspectCsv(data);
  const presets = suggestMappings(layout.headers, 'EUR');
  expect(presets.map((p) => p.id)).toEqual(['builtin-holvi-statement']);
  const preview = parseCsv(data, validateMapping({ ...presets[0]!.mapping, headerRecord: layout.headerRecord }));
  expect(preview.issues).toEqual([]);
  expect(preview.excludedRecords).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(preview.rows.map((r) => [r.value.booking_date, r.value.amount_minor, r.value.external_id])).toEqual([
    ['2026-09-01', -1250, 'f0000000000000000000000000000001'],
    ['2026-09-02', -700, 'f0000000000000000000000000000002'],
    ['2026-09-03', 10025, 'f0000000000000000000000000000003'],
  ]);
  expect(preview.rows[1]!.value.reference).toBe('RF00 1234 / Fake Cafe card');
  expect(preview.rows[2]!.value.reference).toBe('Example Client / Invoice 7');
  expect(preview.rows[0]!.value.merchant).toBe('Synthetic Cloud');
  // The older Holvi alias layout still matches its own headers.
  expect(suggestMappings(['Transaction ID', 'Date', 'Amount', 'Currency', 'Payee'], 'EUR').map((p) => p.id)).toEqual([
    'builtin-holvi',
  ]);
});

test('stated totals are read from the preamble', () => {
  const layout = inspectCsv(bytes(statementCsv()));
  expect(statedTotals(layout.records, layout.headerRecord)).toEqual({
    credit: { count: 1, sum: '100.25' },
    debit: { count: 2, sum: '-19.5' },
  });
  expect(statedTotals([['Date', 'Amount']], 0)).toEqual({});
});

test('xlsx cells read as text: inline and shared strings, float noise, dates, gaps and booleans', async () => {
  const rows = [...preamble(), HEADER, ...ROWS];
  for (const options of [{}, { shared: true }, { store: true }]) {
    const read = await readXlsx(await xlsx(rows, options));
    expect(read[7]).toEqual(HEADER);
    expect(read[9]![2]).toBe('-7');
    expect(read[0]).toEqual(preamble()[0]);
    expect(read[3]).toEqual(['', '100.25', '1']);
  }
  expect(numberText('-9.999999999999999')).toBe('-10');
  expect(numberText('-31.17')).toBe('-31.17');
  const styled = await zip({
    'xl/workbook.xml': '<workbook><sheets><sheet r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="rId1" Target="worksheets/data.xml"/></Relationships>',
    'xl/styles.xml':
      '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="d\\.m\\.yyyy"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>',
    'xl/worksheets/data.xml':
      '<worksheet><sheetData><row r="1"><c r="A1" s="1"><v>46266</v></c><c r="C1" s="2"><v>46267.5</v></c><c r="D1" t="b"><v>1</v></c><c r="E1" t="str"><v>a &amp; b</v></c></row><row r="3"><c r="B3"><v>12</v></c></row></sheetData></worksheet>',
  });
  expect(await readXlsx(styled)).toEqual([['2026-09-01', '', '2026-09-02 12:00:00', 'TRUE', 'a & b'], [], ['', '12']]);
  await expect(xlsxToCsv(new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]))).rejects.toThrow(
    /couldn't read that spreadsheet/,
  );
});

test('an xlsx statement uploads as downloaded and imports with no mapping', async () => {
  const file = new File([await xlsx([...preamble(), HEADER, ...ROWS])], 'statement.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const response = await upload(file);
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(html).toContain('We recognised a Holvi export. 3 payments');
  expect(html).toContain('No problems found.');
  const body = confirmationForm(html);
  expect((await request('/imports/csv/confirm', { method: 'POST', body })).status).toBe(303);
  const stored = await env.DB.prepare(
    'SELECT count(*) n, sum(amount_minor) total, count(DISTINCT external_id) ids FROM bank_transactions',
  ).first();
  expect(stored).toEqual({ n: 3, total: 8075, ids: 3 });
});

test('the same statement as CSV imports too, and a total that does not add up stops the import', async () => {
  const good = await upload(new File([statementCsv()], 'statement.csv', { type: 'text/csv' }));
  expect(good.status).toBe(200);
  const bad = await upload(new File([statementCsv(['100.25', '2'], ['-19.6', '2'])], 'statement.csv'));
  const html = await bad.text();
  expect(bad.status).toBe(422);
  expect(html).toContain('The file lists 2 money in payments, but 1 were read.');
  expect(html).toContain('The file totals money out at -19.60 EUR, but the rows add up to -19.50 EUR.');
  expect(html).not.toContain('formaction="/imports/csv/confirm"');
});

test('the picker takes XLSX or CSV', async () => {
  const html = await (await request('/import')).text();
  expect(html).toContain('Bank statement (XLSX or CSV)');
  expect(html).toMatch(/accept="\.xlsx,\.csv/);
});

const UNKNOWN =
  'Posted date,Sum paid,Beneficiary,Details,Bank id\n2026-09-01,-4.20,Fake Shop,Card,x1\n2026-09-02,"1,250.00",Example Client,Invoice,x2\n';
test('an unknown layout is mapped by the mock model and checked against the whole file', async () => {
  const response = await upload(new File([UNKNOWN.replace('Sum paid', 'Amount')], 'other.csv'));
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(html).toContain('Columns read automatically. 2 payments');
  const mapping = JSON.parse(String(confirmationForm(html).get('mapping')));
  expect(mapping).toMatchObject({
    date: { column: 0, format: 'ISO' },
    merchant: 2,
    number: { decimal: '.', grouping: ',' },
  });
  // Columns the mock cannot name fall back to manual mapping.
  const manual = await upload(new File([UNKNOWN], 'other.csv'));
  expect(manual.status).toBe(422);
  expect(await manual.text()).toContain('No preset maps these headers.');
});

test('the live model gets one small call with only the header and a few truncated rows', async () => {
  const rows = Array.from(
    { length: 9 },
    (_, i) => `2026-09-0${i + 1},-${i + 1}.00,${'Fake Shop '.repeat(10)},Card,x${i}`,
  );
  const csv = `Posted date,Sum paid,Beneficiary,Details,Bank id\n${rows.join('\n')}\n`;
  const answer = (choice: string) => ({ type: 'choice', choice, probabilities: { [choice]: 0.9 }, confidence: 0.9 });
  const run = vi.fn(async (model: string, input: Record<string, unknown>) => {
    expect(model).toBe('@cf/cloudflare/clef');
    const state = input.state as { headers: string[]; rows: string[][] };
    expect(state.headers).toEqual(['Posted date', 'Sum paid', 'Beneficiary', 'Details', 'Bank id']);
    expect(state.rows).toHaveLength(5);
    expect(state.rows.flat().every((cell) => cell.length <= 40)).toBe(true);
    expect(Object.keys(input.questions as object)).toContain('date_format');
    return {
      model: 'clef-fixture',
      answers: {
        date: answer('c0'),
        amount: answer('c1'),
        debit: answer('none'),
        credit: answer('none'),
        currency: answer('none'),
        merchant: answer('c2'),
        description: answer('c3'),
        reference: answer('none'),
        external_id: answer('c4'),
        date_format: answer('ISO'),
        sign: answer('negative'),
      },
      usage: { input_tokens: 80, output_tokens: 10 },
    };
  });
  const response = await upload(new File([csv], 'live.csv'), {}, { ...env, AI_MODE: 'live', AI: { run } } as Env);
  expect(response.status).toBe(200);
  expect(run).toHaveBeenCalledTimes(1);
  const mapping = JSON.parse(String(confirmationForm(await response.text()).get('mapping')));
  expect(mapping).toMatchObject({ externalId: 4, moreReferences: [3], currency: { kind: 'default', currency: 'EUR' } });
  // An answer the file contradicts (amounts read as dates) is not applied.
  const wrong = vi.fn(async () => ({
    model: 'clef-fixture',
    answers: { date: answer('c1'), amount: answer('c0'), merchant: answer('c2') },
    usage: { input_tokens: 1, output_tokens: 1 },
  }));
  const refused = await upload(new File([csv], 'live.csv'), {}, { ...env, AI_MODE: 'live', AI: { run: wrong } } as Env);
  expect(refused.status).toBe(422);
  expect(await refused.text()).toContain('No preset maps these headers.');
  const failing = vi.fn(async () => {
    throw new Error('model unavailable');
  });
  expect(
    (await upload(new File([csv], 'live.csv'), {}, { ...env, AI_MODE: 'live', AI: { run: failing } } as Env)).status,
  ).toBe(422);
});

test('a model answer becomes a mapping only with a date, an amount and a payee', () => {
  const sample = columnSample(['When', 'Out', 'In', 'Who'], [['01.09.2026', '4,20', '', 'Fake Shop']]);
  const answer = (choice: string) => ({ type: 'choice', choice, probabilities: { [choice]: 1 }, confidence: 1 });
  const raw = (answers: Record<string, string>) => ({
    answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, answer(v)])),
  });
  expect(
    columnsMapping(raw({ date: 'c0', debit: 'c1', credit: 'c2', merchant: 'c3', date_format: 'ISO' }), sample, 'EUR'),
  ).toMatchObject({
    date: { column: 0, format: 'DD.MM.YYYY' },
    amount: { kind: 'split', debit: 1, credit: 2 },
    number: { decimal: ',', grouping: '' },
  });
  expect(columnsMapping(raw({ date: 'c0', merchant: 'c3' }), sample, 'EUR')).toBeNull();
  expect(columnsMapping(raw({ date: 'c9', amount: 'c1', merchant: 'c3' }), sample, 'EUR')).toBeNull();
});
