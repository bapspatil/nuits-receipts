import { expect, test } from 'vitest';
import { decodeCsv, headerFingerprint, inspectCsv, parseCsv, validateMapping, type CsvMapping } from '../src/csv';
import { holviMapping, suggestMappings } from '../src/presets';
import holvi from './fixtures/banks/holvi.csv?raw';
import nordea from './fixtures/banks/nordea.csv?raw';
import op from './fixtures/banks/op.csv.b64?raw';
import revolut from './fixtures/banks/revolut.csv?raw';
import wise from './fixtures/banks/wise.csv?raw';
import n26 from './fixtures/banks/n26.csv?raw';
import us from './fixtures/banks/us.csv?raw';
import le from './fixtures/banks/utf16le.csv.b64?raw';
import be from './fixtures/banks/utf16be.csv.b64?raw';

const bytes = (text: string) => new TextEncoder().encode(text);
const binary = (text: string) => Uint8Array.from(atob(text.trim()), (character) => character.charCodeAt(0));
const mapping = (changes: Partial<CsvMapping> = {}): CsvMapping => ({
  version: 1,
  encoding: 'utf-8',
  delimiter: ';',
  headerRecord: 0,
  trailingRecords: 0,
  date: { column: 0, format: 'ISO', time: 'none' },
  number: { decimal: '.', grouping: '' },
  amount: { kind: 'signed', column: 2, outgoing: 'negative' },
  currency: { kind: 'default', currency: 'EUR' },
  merchant: 1,
  reference: null,
  externalId: null,
  original: null,
  ...changes,
});
const preview = (row: string, changes: Partial<CsvMapping> = {}) =>
  parseCsv(bytes('Date;Merchant;Amount;Currency;Original amount;Original currency\n' + row + '\n'), mapping(changes));

test('workerd TextDecoder supports fatal UTF encodings and the ISO-8859-1 Windows-1252 alias', () => {
  expect(
    new TextDecoder('windows-1252', { fatal: true, ignoreBOM: false }).decode(new Uint8Array([0xe4, 0xf6, 0x80])),
  ).toBe('äö€');
  expect(new TextDecoder('iso-8859-1').decode(new Uint8Array([0x80]))).toBe('€');
  expect(new TextDecoder('utf-16le', { fatal: true, ignoreBOM: false }).decode(new Uint8Array([0xe4, 0]))).toBe('ä');
  expect(new TextDecoder('utf-16be', { fatal: true, ignoreBOM: false }).decode(new Uint8Array([0, 0xf6]))).toBe('ö');
  expect(() => new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(new Uint8Array([0xff]))).toThrow();
});

test('decoding detects BOMs, requires explicit legacy selection, and rejects NULs and invalid bytes', () => {
  expect(decodeCsv(bytes('\ufeffDate;Amount')).encoding).toBe('utf-8');
  expect(decodeCsv(binary(le)).encoding).toBe('utf-16le');
  expect(decodeCsv(binary(be)).encoding).toBe('utf-16be');
  expect(decodeCsv(binary(op), 'windows-1252').text).toContain('Päivätyö');
  expect(() => decodeCsv(binary(op))).toThrow();
  expect(() => decodeCsv(new Uint8Array([0xff]))).toThrow();
  expect(() => decodeCsv(bytes('Date\0Amount'))).toThrow();
  expect(() => decodeCsv(new Uint8Array([0x61]), 'utf-16le')).toThrow();
});

test('inspection returns delimiter ties for confirmation and handles multiline CSV records', () => {
  expect(inspectCsv(bytes('Date;Merchant;Amount\n2026-09-01;Synthetic;-1.00\n')).delimiter).toBe(';');
  expect(inspectCsv(bytes('Date,Merchant;Amount\n2026-09-01,Synthetic;-1.00\n')).delimiterChoices).toEqual([',', ';']);
  const inspected = inspectCsv(bytes('Preamble\nDate|Merchant|Amount\n2026-09-01|"Synthetic\nStore"|-1.00\n'), {
    delimiter: '|',
    headerRecord: 1,
  });
  expect(inspected.headers).toEqual(['Date', 'Merchant', 'Amount']);
  expect(inspected.records).toHaveLength(3);
});

test('Holvi preset retains aliases, dotted dates, comma decimals, foreign facts, and raw header JSON', () => {
  const headers = inspectCsv(bytes(holvi)).headers;
  const result = parseCsv(bytes(holvi), { ...holviMapping(headers, 'EUR'), delimiter: ';' });
  expect(result.issues).toEqual([]);
  expect(result.rows.map((row) => [row.value.booking_date, row.value.amount_minor])).toEqual([
    ['2026-09-01', -1250],
    ['2026-09-02', -1842],
  ]);
  expect(result.rows[1]?.value).toMatchObject({
    original_amount_minor: -2000,
    original_currency: 'USD',
    external_id: 'holvi-fake-2',
  });
  expect(JSON.parse(result.rows[0]!.value.raw_json)).toMatchObject({ Payee: 'Synthetic Cloud' });
  expect(() => holviMapping(['Date', 'Booking Date', 'Payee', 'Amount'], 'EUR')).toThrow(/Ambiguous/);
  expect(holviMapping(['Date', 'Booking Date', 'Payee', 'Amount'], 'EUR', { booking_date: 'Date' }).date.column).toBe(
    0,
  );
  expect(
    preview('2026-09-01;Synthetic;1.234,56;;;', { number: { decimal: 'dot-or-comma', grouping: '' } }).issues,
  ).toHaveLength(1);
});

test('synthetic EU styles and explicit US debit/credit mappings produce exact cents', () => {
  const cases = [
    { text: nordea, bank: 'Nordea', options: { headerRecord: 1, trailingRecords: 1 }, expected: [-123456, 1200] },
    { text: revolut, bank: 'Revolut', options: {}, expected: [-450] },
    { text: wise, bank: 'Wise', options: {}, expected: [-2000] },
    { text: n26, bank: 'N26', options: {}, expected: [-725] },
  ];
  for (const entry of cases) {
    const inspected = inspectCsv(bytes(entry.text), entry.options);
    const preset = suggestMappings(inspected.headers, 'EUR').find((candidate) => candidate.bank_name === entry.bank);
    expect(preset, entry.bank).toBeDefined();
    const result = parseCsv(bytes(entry.text), {
      ...preset!.mapping,
      delimiter: inspected.delimiter,
      ...entry.options,
    });
    expect(result.issues, entry.bank).toEqual([]);
    expect(result.rows.map((row) => row.value.amount_minor)).toEqual(entry.expected);
  }
  const result = parseCsv(
    bytes(us),
    mapping({
      delimiter: ',',
      date: { column: 0, format: 'MM/DD/YYYY', time: 'none' },
      amount: { kind: 'split', debit: 2, credit: 3 },
      currency: { kind: 'default', currency: 'USD' },
      number: { decimal: '.', grouping: ',' },
    }),
  );
  expect(result.issues).toEqual([]);
  expect(result.rows.map((row) => [row.value.booking_date, row.value.amount_minor])).toEqual([
    ['2026-03-04', -123456],
    ['2026-03-05', 2500],
  ]);
});

test('OP and UTF-16 LE/BE binary fixtures parse accented headers and merchants', () => {
  for (const [content, encoding, expected] of [
    [op, 'windows-1252', -4560],
    [le, 'utf-16le', -890],
    [be, 'utf-16be', -900],
  ] as const) {
    const raw = binary(content),
      inspected = inspectCsv(raw, { encoding });
    const preset = suggestMappings(inspected.headers, 'EUR').find((candidate) => candidate.bank_name === 'OP')!;
    const result = parseCsv(raw, { ...preset.mapping, encoding, delimiter: ';' });
    expect(result.issues).toEqual([]);
    expect(result.rows[0]?.value).toMatchObject({ amount_minor: expected, merchant: 'Synthetic Päivätyö' });
  }
});

test.each([',', ';', '\t', '|'] as const)(
  'parses %j delimiter, quoted CRLF, escaped quotes, and original record numbers',
  (delimiter) => {
    const text = [
      'Preamble',
      ['Date', 'Merchant', 'Amount'].join(delimiter),
      ['2026-09-01', '"Synthetic ""Shop""\r\nOy"', '-12.50'].join(delimiter),
      'Footer',
    ].join('\r\n');
    const result = parseCsv(bytes(text), mapping({ delimiter, headerRecord: 1, trailingRecords: 1 }));
    expect(result.issues).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      record: 3,
      value: { merchant: 'Synthetic "Shop"\r\nOy', amount_minor: -1250 },
    });
    expect(result.excludedRecords).toEqual([1, 4]);
  },
);

test('invalid rows are never silently excluded as summaries and all errors retain record and field', () => {
  const result = parseCsv(
    bytes(
      'Date;Merchant;Amount\n2026-09-01;Synthetic;-1\nTotal;;bad\n2026-02-30;Synthetic;-2\n2026-09-02;Synthetic;-3\n',
    ),
    mapping(),
  );
  expect(result.rows.map((row) => row.record)).toEqual([2, 5]);
  expect(result.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ record: 3, field: 'date' }),
      expect.objectContaining({ record: 4, field: 'date' }),
    ]),
  );
  expect(result.excludedRecords).toEqual([]);
});

test.each([
  ['2024-02-29', 'ISO', '2024-02-29'],
  ['29.02.2024', 'DD.MM.YYYY', '2024-02-29'],
  ['03/04/2026', 'DD/MM/YYYY', '2026-04-03'],
  ['03/04/2026', 'MM/DD/YYYY', '2026-03-04'],
  ['2026-09-01T23:59:59.123+03:00', 'ISO', '2026-09-01'],
  ['01.09.2026 00:01Z', 'DD.MM.YYYY', '2026-09-01'],
] as const)('validates date %s under explicit %s policy and preserves printed date', (input, format, expected) => {
  const result = preview(`${input};Synthetic;-1;;;`, { date: { column: 0, format, time: 'optional' } });
  expect(result.issues).toEqual([]);
  expect(result.rows[0]?.value.booking_date).toBe(expected);
});

test.each([
  '2026-02-29',
  '2026-09-01T24:00',
  '2026-09-01 12:60',
  '2026-09-01T12:00:60Z',
  '2026-09-01T12:00+24:00',
  '2026-09-01T12:00+01:60',
  '2026-09-01x',
  '03/04/2026',
])('rejects malformed or unselected date/time %s', (input) => {
  expect(
    preview(`${input};Synthetic;-1;;;`, { date: { column: 0, format: 'ISO', time: 'optional' } }).issues[0],
  ).toMatchObject({ field: 'date' });
});

test('time none rejects even a valid optional time', () => {
  expect(preview('2026-09-01T12:00Z;Synthetic;-1;;;').issues[0]?.field).toBe('date');
});

test.each([
  ['-1.234,56', ',', '.', -123456],
  ['+1,234.56', '.', ',', 123456],
  ['-1 234,56', ',', 'space', -123456],
  ['-1\u00a0234,56', ',', 'space', -123456],
  ['-1\u202f234,56', ',', 'space', -123456],
  ["-1'234.56", '.', "'", -123456],
  ['0', '.', '', 0],
] as const)(
  'converts %s with selected decimal/grouping into integer minor units',
  (input, decimal, grouping, expected) => {
    const result = preview(`2026-09-01;Synthetic;${input};;;`, { number: { decimal, grouping } });
    expect(result.issues).toEqual([]);
    expect(result.rows[0]?.value.amount_minor).toBe(expected);
  },
);

test.each([
  '1,23,4.56',
  '12,34.56',
  '1,,234.56',
  '--1',
  '1-',
  '(1)',
  '€1',
  '1e3',
  'NaN',
  '',
  '1.001',
  '9007199254740992',
])('rejects malformed, unsafe or sub-minor amount %s', (input) => {
  expect(
    preview(`2026-09-01;Synthetic;${input};;;`, { number: { decimal: '.', grouping: ',' } }).issues[0],
  ).toMatchObject({ field: 'amount' });
});

test('signed inversion and split/direction variants preserve zeros and reject conflicting facts', () => {
  expect(
    preview('2026-09-01;Synthetic;12.50;;;', { amount: { kind: 'signed', column: 2, outgoing: 'positive' } }).rows[0]
      ?.value.amount_minor,
  ).toBe(-1250);
  const split: Partial<CsvMapping> = { amount: { kind: 'split', debit: 2, credit: 3 } };
  expect(preview('2026-09-01;Synthetic;0;0;;', split).rows[0]?.value.amount_minor).toBe(0);
  for (const cells of ['1;2', ';', '-1;', ';-1'])
    expect(preview(`2026-09-01;Synthetic;${cells};;`, split).issues).not.toEqual([]);
  const direction: Partial<CsvMapping> = {
    amount: { kind: 'direction', amount: 2, direction: 3, debit: ['OUT'], credit: ['IN'] },
  };
  expect(preview('2026-09-01;Synthetic;12.50;OUT;;', direction).rows[0]?.value.amount_minor).toBe(-1250);
  expect(preview('2026-09-01;Synthetic;-12.50;OUT;;', direction).rows[0]?.value.amount_minor).toBe(-1250);
  expect(preview('2026-09-01;Synthetic;12.50;IN;;', direction).rows[0]?.value.amount_minor).toBe(1250);
  for (const cells of ['-12.50;IN', '12.50;UNKNOWN'])
    expect(preview(`2026-09-01;Synthetic;${cells};;`, direction).issues).not.toEqual([]);
});

test('currency fallback, all ten exponents, and paired original facts are validated', () => {
  for (const currency of ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'CAD', 'AUD', 'JPY']) {
    const result = preview(`2026-09-01;Synthetic;-12;${currency};;`, {
      currency: { kind: 'column', column: 3, blankDefault: null },
    });
    expect(result.rows[0]?.value.amount_minor).toBe(currency === 'JPY' ? -12 : -1200);
  }
  const columns: Partial<CsvMapping> = {
    currency: { kind: 'column', column: 3, blankDefault: 'USD' },
    original: { amount: 4, currency: 5 },
  };
  expect(preview('2026-09-01;Synthetic;-12;;;', columns).rows[0]?.value.currency).toBe('USD');
  expect(preview('2026-09-01;Synthetic;-12;EUR;-15;USD', columns).rows[0]?.value.original_amount_minor).toBe(-1500);
  for (const cells of ['XYZ;;', 'EUR;12;USD', 'EUR;-12;', 'EUR;;USD', ';-12;USD']) {
    const changes = cells.startsWith(';')
      ? { ...columns, currency: { kind: 'column' as const, column: 3, blankDefault: null } }
      : columns;
    expect(preview(`2026-09-01;Synthetic;-12;${cells}`, changes).issues).not.toEqual([]);
  }
});

test('mapping JSON is parsed at the boundary, bounded, and rejects ambiguous modes or unchecked indices', () => {
  expect(validateMapping(mapping())).toEqual(mapping());
  for (const invalid of [
    null,
    [],
    { ...mapping(), version: 2 },
    { ...mapping(), merchant: -1 },
    { ...mapping(), merchant: 100 },
    { ...mapping(), headerRecord: 101 },
    { ...mapping(), trailingRecords: 101 },
    { ...mapping(), encoding: 'iso-8859-1' },
    { ...mapping(), date: { column: 0, time: 'none' } },
    { ...mapping(), number: { decimal: ',', grouping: ',' } },
    { ...mapping(), currency: { kind: 'default', currency: 'XYZ' } },
    { ...mapping(), amount: { kind: 'split', debit: 2, credit: 2 } },
    { ...mapping(), amount: { kind: 'direction', amount: 2, direction: 3, debit: ['OUT'], credit: ['OUT'] } },
  ]) {
    expect(() => validateMapping(invalid)).toThrow();
  }
  expect(() =>
    validateMapping({
      ...mapping(),
      amount: { kind: 'direction', amount: 2, direction: 3, debit: ['x'.repeat(33000)], credit: ['IN'] },
    }),
  ).toThrow();
});

test('header fingerprints include ordered normalized labels, count, and duplicate occurrences', async () => {
  expect(await headerFingerprint(['Päivä', ' Amount '])).toBe(await headerFingerprint(['Paiva', 'amount']));
  expect(await headerFingerprint(['Date', 'Amount'])).not.toBe(await headerFingerprint(['Amount', 'Date']));
  expect(await headerFingerprint(['Date', 'Amount'])).not.toBe(await headerFingerprint(['Date', 'Amount', 'Amount']));
});

test('enforces row, byte, column, cell, raw JSON, and preamble/footer boundaries', () => {
  const header = 'Date;Merchant;Amount\n',
    row = '2026-09-01;Synthetic;-1\n';
  expect(parseCsv(bytes(header + row.repeat(5000)), mapping()).rows).toHaveLength(5000);
  expect(() => parseCsv(bytes(header + row.repeat(5001)), mapping())).toThrow();
  const cell = 'x'.repeat(65536);
  expect(parseCsv(bytes(header + '2026-09-01;' + cell + ';-1'), mapping()).rows).toHaveLength(1);
  expect(() => parseCsv(bytes(header + '2026-09-01;' + cell + 'x;-1'), mapping())).toThrow();
  const columns = Array.from({ length: 100 }, (_, i) => String(i)).join(';');
  expect(parseCsv(bytes(columns + '\n2026-09-01;Synthetic;-1' + ';'.repeat(97)), mapping()).rows).toHaveLength(1);
  expect(() => parseCsv(bytes(columns + ';extra\n' + row), mapping())).toThrow();
  expect(() =>
    parseCsv(bytes(columns + '\n2026-09-01;Synthetic;-1;' + Array(97).fill('x'.repeat(3000)).join(';')), mapping()),
  ).toThrow();
  const paddedRow = '2026-09-01;' + 'x'.repeat(60000) + ';-1\n';
  const almost = header + paddedRow.repeat(34);
  const padding = 2 * 1024 * 1024 - bytes(almost).length - bytes('2026-09-01;;-1\n').length;
  const exact = bytes(almost + '2026-09-01;' + 'x'.repeat(padding) + ';-1\n');
  expect(exact.byteLength).toBe(2 * 1024 * 1024);
  expect(parseCsv(exact, mapping()).rows).toHaveLength(35);
  expect(() => parseCsv(new Uint8Array(2 * 1024 * 1024 + 1), mapping())).toThrow();
  const preamble = 'Preamble\n'.repeat(100),
    footer = 'Footer\n'.repeat(100);
  expect(
    parseCsv(bytes(preamble + header + row + footer), mapping({ headerRecord: 100, trailingRecords: 100 }))
      .excludedRecords,
  ).toHaveLength(200);
});

test('empty files, missing columns, malformed quotes, and duplicated empty header mappings fail safely', () => {
  expect(() => parseCsv(bytes('Date;Merchant;Amount\n'), mapping())).toThrow();
  expect(preview('2026-09-01;;-1;;;').issues[0]?.field).toBe('merchant');
  expect(parseCsv(bytes('Date;Merchant;Amount\n2026-09-01;Synthetic\n'), mapping()).issues[0]?.code).toBe(
    'column_count',
  );
  expect(parseCsv(bytes('Date;Merchant;Amount\n2026-09-01;"Synthetic;-1\n'), mapping()).issues[0]?.code).toBe(
    'csv_syntax',
  );
  expect(
    parseCsv(bytes('Date;Merchant;Amount\n2026-09-01;Synthetic;-1\n'), mapping({ merchant: 5 })).issues[0]?.code,
  ).toBe('mapping_column');
});

test('Holvi rejects unpaired original headers instead of silently dropping foreign facts', () => {
  expect(() => holviMapping(['Date', 'Amount', 'Payee', 'Original amount'], 'EUR')).toThrow(/original amount/);
  expect(() => holviMapping(['Date', 'Amount', 'Payee', 'Original currency'], 'EUR')).toThrow(/original amount/);
});

test('direction labels reject explicit conflicting plus signs while unsigned magnitudes remain valid', () => {
  const amount: CsvMapping['amount'] = { kind: 'direction', amount: 2, direction: 3, debit: ['OUT'], credit: ['IN'] };
  expect(preview('2026-09-01;Synthetic;+12;OUT;;', { amount }).issues).not.toEqual([]);
  expect(preview('2026-09-01;Synthetic;+12;IN;;', { amount }).rows[0]?.value.amount_minor).toBe(1200);
});

test('booked-date mapping rejects pending rows and never silently filters them', () => {
  const pending = revolut + '2026-09-06 12:00:00,,Synthetic Pending,-5.00,EUR,revolut-fake-pending,0.00\n';
  const headers = inspectCsv(bytes(pending)).headers;
  const preset = suggestMappings(headers, 'EUR').find((entry) => entry.bank_name === 'Revolut')!;
  const result = parseCsv(bytes(pending), preset.mapping);
  expect(result.rows).toHaveLength(1);
  expect(result.issues).toEqual([expect.objectContaining({ record: 3, field: 'date' })]);
  expect(result.excludedRecords).toEqual([]);
});

test('BOM-less UTF-16 requires selection and byte limits count encoded Unicode', () => {
  const content = binary(le).slice(2);
  expect(() => decodeCsv(content)).toThrow();
  expect(decodeCsv(content, 'utf-16le').text).toContain('Päivätyö');
  expect(preview('2026-09-01;' + 'ä'.repeat(32768) + ';-1;;;').rows).toHaveLength(1);
  expect(() => preview('2026-09-01;' + 'ä'.repeat(32769) + ';-1;;;')).toThrow(/cell in this file is too long/);
});

test('duplicate headers remain selectable by index and raw JSON preserves both cells', () => {
  const result = parseCsv(bytes('Date;Merchant;Amount;Amount\n2026-09-01;Synthetic;-12;-99\n'), mapping());
  expect(result.issues).toEqual([]);
  expect(result.rows[0]?.value.amount_minor).toBe(-1200);
  expect(JSON.parse(result.rows[0]!.value.raw_json)).toEqual({
    headers: ['Date', 'Merchant', 'Amount', 'Amount'],
    cells: ['2026-09-01', 'Synthetic', '-12', '-99'],
  });
});

test('all errors after the preview display limit remain available to block confirmation', () => {
  const result = parseCsv(bytes('Date;Merchant;Amount\n' + 'invalid;Synthetic;-1\n'.repeat(150)), mapping());
  expect(result.issues).toHaveLength(150);
  expect(result.issues.at(-1)).toMatchObject({ record: 151, field: 'date', code: 'invalid_date' });
  expect(result.rows).toEqual([]);
});

test('currency names inherited from Object never count as supported currencies', () => {
  expect(() => validateMapping(mapping({ currency: { kind: 'default', currency: 'constructor' } }))).toThrow();
  expect(() => holviMapping(['Date', 'Amount', 'Payee'], 'toString')).toThrow();
  expect(
    preview('2026-09-01;Synthetic;-12;CONSTRUCTOR;;', { currency: { kind: 'column', column: 3, blankDefault: null } })
      .issues[0]?.field,
  ).toBe('currency');
});

test('delimiter guesses do not apply cell bounds to the wrong delimiter candidate', () => {
  const header = Array.from({ length: 100 }, (_, i) => String(i)).join(',');
  const text = header + '\n2026-09-01,Synthetic,-1,' + Array(97).fill('x'.repeat(1000)).join(',');
  expect(inspectCsv(bytes(text)).delimiter).toBe(',');
  expect(inspectCsv(bytes(text), { delimiter: ',' }).records[1]).toHaveLength(100);
});
