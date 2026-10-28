import Papa from 'papaparse';
import {
  date,
  EXPONENTS,
  hash,
  InputError,
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
  minor,
  normalize,
  object,
  requireInput,
} from './domain';
import type { Transaction } from './banking';
export type AmountColumns =
  | { kind: 'signed'; column: number; outgoing: 'negative' | 'positive' }
  | { kind: 'split'; debit: number; credit: number }
  | { kind: 'direction'; amount: number; direction: number; debit: string[]; credit: string[] };
export type CurrencyColumns =
  | { kind: 'default'; currency: string }
  | { kind: 'column'; column: number; blankDefault: string | null };
export const DATE_FORMATS = ['ISO', 'DD.MM.YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'ISO_OR_DOTTED', 'D MMM YYYY'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
export type CsvMapping = {
  version: 1;
  encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';
  delimiter: ',' | ';' | '\t' | '|';
  headerRecord: number;
  trailingRecords: number;
  date: {
    column: number;
    format: DateFormat;
    time: 'none' | 'optional';
  };
  number: { decimal: '.' | ',' | 'dot-or-comma'; grouping: '' | '.' | ',' | 'space' | "'" };
  amount: AmountColumns;
  currency: CurrencyColumns;
  merchant: number;
  reference: number | null;
  // Further text columns joined onto the reference, such as a message or description.
  moreReferences?: number[];
  externalId: number | null;
  original: { amount: number; currency: number } | null;
  // A text column that may say "Currency and amount: USD 10.46", as Holvi's
  // Description does for a card payment abroad. Used when original is null.
  originalText?: number;
};
export type RowIssue = { record: number; field: string; code: string; message: string };
export type NormalizedRow = Pick<
  Transaction,
  | 'booking_date'
  | 'amount_minor'
  | 'currency'
  | 'merchant'
  | 'reference'
  | 'external_id'
  | 'original_amount_minor'
  | 'original_currency'
  | 'raw_json'
>;
export type CsvPreview = {
  headers: string[];
  mapping: CsvMapping;
  rows: { record: number; value: NormalizedRow }[];
  issues: RowIssue[];
  excludedRecords: number[];
};

const delimiters: CsvMapping['delimiter'][] = [',', ';', '\t', '|'];
const encoder = new TextEncoder();
const byteLength = (value: string) => encoder.encode(value).length;

function choice<T extends string>(value: unknown, choices: readonly T[], field: string): T {
  const found = choices.find((candidate) => candidate === value);
  requireInput(found !== undefined, `Invalid ${field}`);
  return found;
}
function index(value: unknown): number {
  requireInput(
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 100,
    'Invalid column index',
  );
  return value;
}
function currency(value: unknown): string {
  requireInput(typeof value === 'string' && Object.hasOwn(EXPONENTS, value), 'Unsupported currency');
  return value;
}
function labels(value: unknown): string[] {
  requireInput(Array.isArray(value) && value.length > 0 && value.length <= 100, 'Direction labels required');
  return value.map((item) => {
    requireInput(typeof item === 'string' && item.trim().length > 0 && item.length <= 100, 'Invalid direction label');
    return item.trim();
  });
}
export function validateMapping(input: unknown): CsvMapping {
  const root = object(input);
  requireInput(byteLength(JSON.stringify(root)) <= 32 * 1024, 'Mapping exceeds 32 KiB');
  requireInput(root.version === 1, 'Unsupported mapping version');
  for (const key of ['headerRecord', 'trailingRecords'])
    requireInput(
      typeof root[key] === 'number' && Number.isInteger(root[key]) && root[key] >= 0 && root[key] <= 100,
      `Invalid ${key}`,
    );
  const d = object(root.date),
    n = object(root.number),
    a = object(root.amount),
    c = object(root.currency);
  const number: CsvMapping['number'] = {
    decimal: choice(n.decimal, ['.', ',', 'dot-or-comma'], 'decimal'),
    grouping: choice(n.grouping, ['', '.', ',', 'space', "'"], 'grouping'),
  };
  requireInput(
    number.decimal !== number.grouping && (number.decimal !== 'dot-or-comma' || number.grouping === ''),
    'Conflicting number separators',
  );
  let amount: AmountColumns;
  switch (a.kind) {
    case 'signed':
      amount = {
        kind: 'signed',
        column: index(a.column),
        outgoing: choice(a.outgoing, ['negative', 'positive'], 'outgoing sign'),
      };
      break;
    case 'split':
      amount = { kind: 'split', debit: index(a.debit), credit: index(a.credit) };
      requireInput(amount.debit !== amount.credit, 'Debit and credit columns must differ');
      break;
    case 'direction': {
      const debit = labels(a.debit),
        credit = labels(a.credit);
      requireInput(!debit.some((label) => credit.includes(label)), 'Conflicting direction labels');
      amount = { kind: 'direction', amount: index(a.amount), direction: index(a.direction), debit, credit };
      requireInput(amount.amount !== amount.direction, 'Amount and direction columns must differ');
      break;
    }
    default:
      throw new InputError('Invalid amount mode');
  }
  let columns: CurrencyColumns;
  if (c.kind === 'default') columns = { kind: 'default', currency: currency(c.currency) };
  else {
    requireInput(c.kind === 'column', 'Invalid currency mode');
    columns = {
      kind: 'column',
      column: index(c.column),
      blankDefault: c.blankDefault === null ? null : currency(c.blankDefault),
    };
  }
  const original = root.original === null ? null : object(root.original);
  const more = root.moreReferences ?? [];
  requireInput(Array.isArray(more) && more.length <= 5, 'Invalid reference columns');
  const headerRecord = root.headerRecord,
    trailingRecords = root.trailingRecords;
  requireInput(typeof headerRecord === 'number' && typeof trailingRecords === 'number', 'Invalid record range');
  return {
    version: 1,
    encoding: choice(root.encoding, ['utf-8', 'utf-16le', 'utf-16be', 'windows-1252'], 'encoding'),
    delimiter: choice(root.delimiter, delimiters, 'delimiter'),
    headerRecord,
    trailingRecords,
    date: {
      column: index(d.column),
      format: choice(d.format, DATE_FORMATS, 'date format'),
      time: choice(d.time, ['none', 'optional'], 'date time'),
    },
    number,
    amount,
    currency: columns,
    merchant: index(root.merchant),
    reference: root.reference === null ? null : index(root.reference),
    ...(more.length ? { moreReferences: more.map(index) } : {}),
    externalId: root.externalId === null ? null : index(root.externalId),
    original: original ? { amount: index(original.amount), currency: index(original.currency) } : null,
    ...(root.originalText === undefined ? {} : { originalText: index(root.originalText) }),
  };
}

export function decodeCsv(
  bytes: Uint8Array,
  encoding?: CsvMapping['encoding'],
): { text: string; encoding: CsvMapping['encoding'] } {
  requireInput(bytes.byteLength <= MAX_CSV_BYTES, 'CSV exceeds 2 MiB');
  const detected =
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? 'utf-8'
      : bytes[0] === 0xff && bytes[1] === 0xfe
        ? 'utf-16le'
        : bytes[0] === 0xfe && bytes[1] === 0xff
          ? 'utf-16be'
          : null;
  const selected = detected ?? encoding ?? 'utf-8';
  let text: string;
  try {
    text = new TextDecoder(selected, { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new InputError(
      'Invalid bytes for selected encoding. Select Windows-1252 / ISO-8859-1 or BOM-less UTF-16 explicitly.',
    );
  }
  requireInput(!text.includes('\0') && !text.includes('\ufffd'), 'CSV contains invalid bytes or NULs');
  return { text, encoding: selected };
}
function records(text: string, delimiter: CsvMapping['delimiter']) {
  const result = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: false });
  if (/(?:\r\n|\r|\n)$/.test(text) && result.data.at(-1)?.every((cell) => cell === '')) result.data.pop();
  return result;
}
function checkBounds(data: string[][]): void {
  for (const record of data) {
    requireInput(record.length <= 100, 'CSV exceeds 100 columns');
    requireInput(
      record.every((cell) => byteLength(cell) <= 64 * 1024),
      'CSV cell exceeds 64 KiB',
    );
  }
}
const filled = (row: string[]) => row.filter((cell) => cell.trim()).length;
const lastFilled = (row: string[]) => {
  let i = row.length - 1;
  while (i >= 0 && !row[i]!.trim()) i--;
  return i;
};
const numberLike = (cell: string) => /^[+-]?[\d\s.,'\u00a0\u202f]+$/.test(cell.trim());
const dateLike = (cell: string) => /^\d{1,4}[-./ ]\d{1,2}[-./ ]\d{1,4}\b/.test(cell.trim());
// The first row that reads as column names: two or more names with no gaps, no
// numbers or dates among them, and the rows below it fitting under them. Bank
// statements often open with an account line and stated totals before it.
export function detectHeaderRecord(data: string[][]): number | null {
  for (let i = 0; i < Math.min(data.length, 100); i++) {
    const row = data[i]!,
      width = lastFilled(row) + 1,
      names = filled(row);
    if (names < 2 || names !== width || row.slice(0, width).some((cell) => numberLike(cell) || dateLike(cell)))
      continue;
    const below = data
      .slice(i + 1)
      .filter((r) => filled(r) > 0)
      .slice(0, 10);
    const fits = below.filter((r) => lastFilled(r) < width && filled(r) * 2 >= names).length;
    if (below.length && fits >= below.length * 0.8) return i;
  }
  return null;
}
export function inspectCsv(
  bytes: Uint8Array,
  options: { encoding?: CsvMapping['encoding']; delimiter?: CsvMapping['delimiter']; headerRecord?: number } = {},
): {
  headers: string[];
  headerRecord: number;
  encoding: CsvMapping['encoding'];
  delimiter: CsvMapping['delimiter'];
  delimiterChoices: CsvMapping['delimiter'][];
  records: string[][];
} {
  const decoded = decodeCsv(bytes, options.encoding);
  requireInput(
    options.headerRecord === undefined ||
      (Number.isInteger(options.headerRecord) && options.headerRecord >= 0 && options.headerRecord <= 100),
    'Invalid header record',
  );
  const candidates = (options.delimiter ? [options.delimiter] : delimiters).map((delimiter) => {
    const parsed = records(decoded.text, delimiter),
      header = options.headerRecord ?? detectHeaderRecord(parsed.data) ?? 0,
      width = parsed.data[header]?.length ?? 0;
    const matching = parsed.data.slice(header + 1).filter((row) => row.length === width).length;
    return { delimiter, parsed, header, score: width > 1 ? matching : -1 };
  });
  const best = Math.max(...candidates.map((candidate) => candidate.score));
  const choices = candidates
    .filter((candidate) => candidate.score === best && candidate.score >= 0)
    .map((candidate) => candidate.delimiter);
  const selected = candidates.find((candidate) => candidate.delimiter === (options.delimiter ?? choices[0] ?? ';'))!;
  checkBounds(selected.parsed.data);
  return {
    headers: selected.parsed.data[selected.header] ?? [],
    headerRecord: selected.header,
    encoding: decoded.encoding,
    delimiter: selected.delimiter,
    delimiterChoices: choices,
    records: selected.parsed.data,
  };
}

class FieldError extends Error {
  constructor(
    public field: string,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
function field<T>(name: string, parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    throw new FieldError(name, 'invalid_' + name, error instanceof Error ? error.message : 'Invalid value');
  }
}
export const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
// "31 May 2026", "1 Sept 2026", "02-Jan-2026": English month names, abbreviated or not.
function monthDate(text: string): { calendar: string; tail: string } {
  const found = text.match(/^(\d{1,2})[ .-]([a-z]{3,9})\.?[ .-](\d{4})(.*)$/i);
  const month = found ? MONTHS.findIndex((name) => name.startsWith(found[2]!.toLowerCase())) : -1;
  requireInput(found && month >= 0, 'Date does not match selected format');
  return {
    calendar: `${found[3]}-${String(month + 1).padStart(2, '0')}-${found[1]!.padStart(2, '0')}`,
    tail: found[4] ?? '',
  };
}
function bankDate(text: string, mapping: CsvMapping['date']): string {
  if (mapping.format === 'D MMM YYYY') {
    const { calendar, tail } = monthDate(text);
    timeTail(tail, mapping);
    return date(calendar);
  }
  const iso = mapping.format === 'ISO' || (mapping.format === 'ISO_OR_DOTTED' && /^\d{4}-/.test(text));
  const dotted = mapping.format === 'DD.MM.YYYY' || mapping.format === 'ISO_OR_DOTTED';
  const pattern = iso
    ? /^(\d{4})-(\d{2})-(\d{2})(.*)$/
    : dotted
      ? /^(\d{2})\.(\d{2})\.(\d{4})(.*)$/
      : /^(\d{2})\/(\d{2})\/(\d{4})(.*)$/;
  const found = text.match(pattern);
  requireInput(found, 'Date does not match selected format');
  const calendar = iso
    ? `${found[1]}-${found[2]}-${found[3]}`
    : mapping.format === 'MM/DD/YYYY'
      ? `${found[3]}-${found[1]}-${found[2]}`
      : `${found[3]}-${found[2]}-${found[1]}`;
  timeTail(found[4] ?? '', mapping);
  return date(calendar);
}
function timeTail(tail: string, mapping: CsvMapping['date']): void {
  if (tail) {
    requireInput(mapping.time === 'optional', 'Time not permitted by mapping');
    const time = tail.match(/^[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|([+-])(\d{2}):(\d{2}))?$/);
    requireInput(
      time &&
        Number(time[1]) < 24 &&
        Number(time[2]) < 60 &&
        Number(time[3] ?? 0) < 60 &&
        Number(time[5] ?? 0) < 24 &&
        Number(time[6] ?? 0) < 60,
      'Invalid time or offset',
    );
  }
}
function amount(text: string, currencyCode: string, rule: CsvMapping['number']): number {
  let clean = text.trim(),
    decimal = rule.decimal;
  if (decimal === 'dot-or-comma') {
    requireInput(!(clean.includes(',') && clean.includes('.')), 'Ambiguous amount separators');
    clean = clean.replace(/[ \u00a0\u202f]/g, '');
    decimal = clean.includes(',') ? ',' : '.';
  }
  const sign = /^[+-]/.test(clean) ? clean[0]! : '';
  const unsigned = sign ? clean.slice(1) : clean;
  const parts = unsigned.split(decimal);
  requireInput(parts.length <= 2, 'Multiple decimal separators');
  let whole = parts[0] ?? '';
  const fraction = parts[1];
  if (rule.grouping) {
    const separator = rule.grouping === 'space' ? /[ \u00a0\u202f]/ : rule.grouping;
    const groups = whole.split(separator);
    requireInput(
      groups.length === 1 ||
        (/^\d{1,3}$/.test(groups[0] ?? '') && groups.slice(1).every((group) => /^\d{3}$/.test(group))),
      'Invalid thousands grouping',
    );
    whole = groups.join('');
  }
  requireInput(/^\d+$/.test(whole) && (fraction === undefined || /^\d+$/.test(fraction)), 'Invalid amount');
  return minor(sign + whole + (fraction === undefined ? '' : '.' + fraction), currencyCode);
}
function signedAmount(cells: string[], mapping: CsvMapping, currencyCode: string): number {
  const mode = mapping.amount;
  const value = (column: number) => cells[column]?.trim() ?? '';
  const parse = (column: number) => amount(value(column), currencyCode, mapping.number);
  switch (mode.kind) {
    case 'signed':
      return parse(mode.column) * (mode.outgoing === 'positive' ? -1 : 1);
    case 'split': {
      requireInput(value(mode.debit) || value(mode.credit), 'Debit and credit both blank');
      const debit = value(mode.debit) ? parse(mode.debit) : 0,
        credit = value(mode.credit) ? parse(mode.credit) : 0;
      requireInput(debit >= 0 && credit >= 0 && !(debit && credit), 'Invalid debit and credit');
      return credit - debit;
    }
    case 'direction': {
      const direction = value(mode.direction),
        debit = mode.debit.includes(direction),
        credit = mode.credit.includes(direction),
        number = parse(mode.amount);
      requireInput(debit || credit, 'Unknown direction label');
      requireInput(
        (!credit || number >= 0) && (!debit || !value(mode.amount).startsWith('+')),
        'Amount sign conflicts with direction',
      );
      return Math.abs(number) * (debit ? -1 : 1);
    }
  }
}
function usedColumns(mapping: CsvMapping): number[] {
  const a = mapping.amount;
  return [
    mapping.date.column,
    mapping.merchant,
    ...[mapping.reference, mapping.externalId].filter((column) => column !== null),
    ...(mapping.moreReferences ?? []),
    ...(a.kind === 'signed' ? [a.column] : a.kind === 'split' ? [a.debit, a.credit] : [a.amount, a.direction]),
    ...(mapping.currency.kind === 'column' ? [mapping.currency.column] : []),
    ...(mapping.original ? [mapping.original.amount, mapping.original.currency] : []),
    ...(mapping.originalText === undefined ? [] : [mapping.originalText]),
  ];
}
// The reference and any further text columns, each kept once.
function reference(cells: string[], mapping: CsvMapping): string | null {
  const kept: string[] = [];
  for (const column of [mapping.reference, ...(mapping.moreReferences ?? [])]) {
    const text = column === null ? '' : (cells[column]?.trim() ?? '');
    if (text && !kept.some((k) => k.toLowerCase().includes(text.toLowerCase()))) kept.push(text);
  }
  return kept.join(' / ') || null;
}
export function parseCsv(bytes: Uint8Array, mapping: CsvMapping): CsvPreview {
  const decoded = decodeCsv(bytes, mapping.encoding),
    parsed = records(decoded.text, mapping.delimiter);
  checkBounds(parsed.data);
  const headers = parsed.data[mapping.headerRecord] ?? [],
    end = parsed.data.length - mapping.trailingRecords;
  const count = end - mapping.headerRecord - 1;
  requireInput(count >= 1 && count <= MAX_CSV_ROWS, 'CSV requires 1 to 5000 rows');
  const preview: CsvPreview = { headers, mapping, rows: [], issues: [], excludedRecords: [] };
  for (let i = 0; i < parsed.data.length; i++)
    if (i < mapping.headerRecord || i >= end) preview.excludedRecords.push(i + 1);
  for (const error of parsed.errors)
    preview.issues.push({
      record: (error.row ?? mapping.headerRecord) + 1,
      field: 'csv',
      code: 'csv_syntax',
      message: error.message,
    });
  if (usedColumns(mapping).some((column) => column >= headers.length)) {
    preview.issues.push({
      record: mapping.headerRecord + 1,
      field: 'mapping',
      code: 'mapping_column',
      message: "One of the columns you chose isn't in the file. Choose the columns again.",
    });
    return preview;
  }
  for (let i = mapping.headerRecord + 1; i < end; i++) {
    const cells = parsed.data[i]!;
    const raw_json = JSON.stringify(
      new Set(headers).size === headers.length
        ? Object.fromEntries(headers.map((header, column) => [header, cells[column] ?? '']))
        : { headers, cells },
    );
    requireInput(byteLength(raw_json) <= 256 * 1024, 'CSV raw row exceeds 256 KiB');
    if (preview.issues.some((issue) => issue.record === i + 1 && issue.code === 'csv_syntax')) continue;
    if (cells.length !== headers.length) {
      preview.issues.push({
        record: i + 1,
        field: 'row',
        code: 'column_count',
        message: 'This row has a different number of columns from the header row.',
      });
      continue;
    }
    const value = (column: number) => cells[column]?.trim() ?? '';
    try {
      const booking_date = field('date', () => bankDate(value(mapping.date.column), mapping.date));
      const merchant = field('merchant', () => {
        const merchant = value(mapping.merchant);
        requireInput(merchant, 'Merchant missing');
        return merchant;
      });
      const currencyCode = field('currency', () =>
        currency(
          mapping.currency.kind === 'default'
            ? mapping.currency.currency
            : value(mapping.currency.column).toUpperCase() || mapping.currency.blankDefault,
        ),
      );
      const amount_minor = field('amount', () => signedAmount(cells, mapping, currencyCode));
      let original_amount_minor: number | null = null,
        original_currency: string | null = null;
      if (mapping.original && (value(mapping.original.amount) || value(mapping.original.currency))) {
        const original = mapping.original;
        original_currency = field('original_currency', () => currency(value(original.currency).toUpperCase()));
        original_amount_minor = field('original_amount', () => {
          let originalAmount = amount(value(original.amount), original_currency!, mapping.number);
          if (mapping.amount.kind === 'signed' && mapping.amount.outgoing === 'positive') originalAmount *= -1;
          requireInput(Math.sign(originalAmount) === Math.sign(amount_minor), 'Original amount direction differs');
          return originalAmount;
        });
      } else if (mapping.originalText !== undefined) {
        const found = originalFromText(value(mapping.originalText), currencyCode, amount_minor);
        if (found) {
          original_amount_minor = found.amount;
          original_currency = found.currency;
        }
      }
      preview.rows.push({
        record: i + 1,
        value: {
          booking_date,
          merchant,
          amount_minor,
          currency: currencyCode,
          original_amount_minor,
          original_currency,
          external_id: mapping.externalId === null ? null : value(mapping.externalId) || null,
          reference: reference(cells, mapping),
          raw_json,
        },
      });
    } catch (error) {
      if (!(error instanceof FieldError)) throw error;
      preview.issues.push({ record: i + 1, field: error.field, code: error.code, message: error.message });
    }
  }
  return preview;
}
// "Currency and amount: USD 10.46" in a statement's text: the amount in the
// currency the card was charged in, signed like the bank amount. Unsupported
// currencies and the account's own currency give null.
export function originalFromText(
  text: string,
  bankCurrency: string,
  signedAmount: number,
): { amount: number; currency: string } | null {
  const found = /Currency and amount:\s*([A-Z]{3})\s+(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?=\s|$)/.exec(text);
  const code = found?.[1];
  if (!code || code === bankCurrency || EXPONENTS[code] === undefined || signedAmount === 0) return null;
  const whole = found[2]!.replace(/,/g, ''),
    fraction = found[3] ?? '';
  const exponent = EXPONENTS[code]!;
  if (fraction.length > exponent) return null;
  const minor = Number(whole + fraction.padEnd(exponent, '0'));
  if (!Number.isSafeInteger(minor) || minor === 0) return null;
  return { amount: signedAmount < 0 ? -minor : minor, currency: code };
}
export async function headerFingerprint(headers: string[]): Promise<string> {
  const occurrences = new Map<string, number>();
  return hash(
    JSON.stringify({
      version: 1,
      count: headers.length,
      headers: headers.map((header) => {
        const label = normalize(header),
          occurrence = (occurrences.get(label) ?? 0) + 1;
        occurrences.set(label, occurrence);
        return [label, occurrence];
      }),
    }),
  );
}

export type StatedTotals = Partial<Record<'credit' | 'debit', { count: number | null; sum: string | null }>> & {
  balance?: { opening: string | null; closing: string | null };
};
// Totals a statement states above its column names, as in Holvi's
// "Total credits | Total volume of credits | Total count of credits" with the
// figures on the next row, and "Opening balance | Closing balance" the same
// way. Only labelled figures count.
export function statedTotals(data: string[][], headerRecord: number): StatedTotals {
  const stated: StatedTotals = {};
  for (let i = 0; i + 1 < headerRecord; i++)
    data[i]!.forEach((label, column) => {
      const figure = data[i + 1]![column]?.trim() ?? '';
      if (!/^[+-]?\d+(\.\d+)?$/.test(figure)) return;
      const balance = label.match(/^\s*(opening|closing) balance\s*$/i);
      if (balance) {
        stated.balance ??= { opening: null, closing: null };
        stated.balance[balance[1]!.toLowerCase() as 'opening' | 'closing'] = figure;
        return;
      }
      const found = label.match(/\b(volume|sum|amount|count|number)\b.*\b(credit|debit)s?\b/i);
      if (!found) return;
      const side = (stated[found[2]!.toLowerCase() as 'credit' | 'debit'] ??= { count: null, sum: null });
      if (/count|number/i.test(found[1]!)) side.count = Number(figure);
      else side.sum = figure;
    });
  return stated;
}
// The first date format every sample reads in, for a mapping proposed without a preset.
export function dateFormatFor(values: string[]): DateFormat | null {
  const samples = values.map((v) => v.trim()).filter(Boolean);
  if (!samples.length) return null;
  const order: DateFormat[] = ['ISO', 'DD.MM.YYYY', 'D MMM YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY'];
  return (
    order.find((format) =>
      samples.every((sample) => {
        try {
          bankDate(sample, { column: 0, format, time: 'optional' });
          return true;
        } catch {
          return false;
        }
      }),
    ) ?? null
  );
}
// The first decimal mark and grouping every sample amount reads with.
export function numberFormatFor(values: string[]): CsvMapping['number'] {
  const samples = values.map((v) => v.trim()).filter(Boolean);
  const rules: CsvMapping['number'][] = [
    { decimal: '.', grouping: '' },
    { decimal: ',', grouping: '' },
    { decimal: '.', grouping: ',' },
    { decimal: ',', grouping: '.' },
    { decimal: ',', grouping: 'space' },
    { decimal: '.', grouping: 'space' },
    { decimal: '.', grouping: "'" },
  ];
  return (
    rules.find((rule) =>
      samples.every((sample) => {
        try {
          amount(sample, 'EUR', rule);
          return true;
        } catch {
          return false;
        }
      }),
    ) ?? rules[0]!
  );
}
