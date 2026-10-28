import { EXPONENTS, normalize, requireInput } from './domain';
import type { CsvMapping } from './csv';

export type BankPreset = {
  id: string;
  bank_name: string;
  name: string;
  header_fingerprint: string;
  mapping: CsvMapping;
  revision: number;
};
export const aliases: Record<string, string[]> = {
  external_id: ['transaction id', 'transaction number', 'tapahtumatunnus', 'tapahtuma id'],
  booking_date: ['booking date', 'date', 'kirjauspaiva', 'tapahtumapaiva'],
  amount: ['amount', 'summa', 'maara'],
  currency: ['currency', 'valuutta'],
  merchant: ['payee', 'recipient', 'counterparty', 'name', 'saaja', 'maksaja', 'nimi'],
  reference: ['reference', 'message', 'description', 'viite', 'viitenumero', 'viesti', 'selite'],
  original_amount: ['original amount'],
  original_currency: ['original currency'],
  debit: ['debit'],
  credit: ['credit'],
};
export function holviMapping(headers: string[], currency: string, selected: Record<string, string> = {}): CsvMapping {
  requireInput(Object.hasOwn(EXPONENTS, currency), 'Confirm supported account currency');
  const mapped: Record<string, number | null> = {};
  for (const [key, names] of Object.entries(aliases)) {
    const candidates =
      key in selected
        ? headers.filter((header) => header === selected[key])
        : headers.filter((header) => names.includes(normalize(header)));
    requireInput(!(key in selected) || !selected[key] || candidates.length > 0, `Unknown mapping for ${key}`);
    requireInput(candidates.length < 2, `Ambiguous ${key}`);
    mapped[key] = candidates[0] === undefined ? null : headers.indexOf(candidates[0]);
  }
  requireInput(
    (mapped.original_amount === null) === (mapped.original_currency === null),
    'Original amount and currency columns must be paired',
  );
  requireInput(mapped.booking_date !== null, 'Map booking_date');
  requireInput(mapped.merchant !== null, 'Map merchant');
  requireInput(
    mapped.amount !== null || (mapped.debit !== null && mapped.credit !== null),
    'Map amount or debit and credit',
  );
  requireInput(mapped.booking_date !== undefined && mapped.merchant !== undefined, 'Required mapping missing');
  const amount = mapped.amount;
  const debit = mapped.debit,
    credit = mapped.credit;
  requireInput(amount !== undefined && debit !== undefined && credit !== undefined, 'Required mapping missing');
  return {
    version: 1,
    encoding: 'utf-8',
    delimiter: ';',
    headerRecord: 0,
    trailingRecords: 0,
    date: { column: mapped.booking_date, format: 'ISO_OR_DOTTED', time: 'none' },
    number: { decimal: 'dot-or-comma', grouping: '' },
    amount:
      amount === null
        ? { kind: 'split', debit: debit!, credit: credit! }
        : { kind: 'signed', column: amount, outgoing: 'negative' },
    currency:
      mapped.currency === null || mapped.currency === undefined
        ? { kind: 'default', currency }
        : { kind: 'column', column: mapped.currency, blankDefault: currency },
    merchant: mapped.merchant,
    reference: mapped.reference ?? null,
    externalId: mapped.external_id ?? null,
    original:
      mapped.original_amount !== null &&
      mapped.original_amount !== undefined &&
      mapped.original_currency !== null &&
      mapped.original_currency !== undefined
        ? { amount: mapped.original_amount, currency: mapped.original_currency }
        : null,
  };
}
export function suggestMappings(
  headers: string[],
  currency: string,
): { id: string; bank_name: string; name: string; mapping: CsvMapping }[] {
  const suggestions: ReturnType<typeof suggestMappings> = [];
  const normalized = headers.map(normalize),
    find = (name: string) => normalized.indexOf(normalize(name));
  const add = (id: string, bank_name: string, mapping: CsvMapping) =>
    suggestions.push({ id, bank_name, name: 'Built-in synthetic-tested layout', mapping });
  const has = (...names: string[]) =>
    names.every((name) => find(name) >= 0 && normalized.filter((header) => header === normalize(name)).length === 1);
  // Holvi's account statement (XLSX or CSV): booked date, signed amounts, and a
  // Filing ID per transaction. The value date is left unused.
  if (has('Value date', 'Booking date', 'Amount', 'Currency', 'Counterparty', 'Description', 'Filing ID'))
    add('builtin-holvi-statement', 'Holvi', {
      version: 1,
      encoding: 'utf-8',
      delimiter: ',',
      headerRecord: 0,
      trailingRecords: 0,
      date: { column: find('Booking date'), format: 'D MMM YYYY', time: 'optional' },
      number: { decimal: '.', grouping: '' },
      amount: { kind: 'signed', column: find('Amount'), outgoing: 'negative' },
      currency: { kind: 'column', column: find('Currency'), blankDefault: currency },
      merchant: find('Counterparty'),
      reference: find('Reference') < 0 ? null : find('Reference'),
      moreReferences: [find('Description'), find('Message')].filter((column) => column >= 0),
      externalId: find('Filing ID'),
      original: null,
    });
  else
    try {
      add('builtin-holvi', 'Holvi', holviMapping(headers, currency));
    } catch {}
  const build = (
    date: string,
    merchant: string,
    amount: string,
    currencyColumn: string,
    format: CsvMapping['date']['format'],
    decimal: '.' | ',',
    grouping: CsvMapping['number']['grouping'],
    delimiter: CsvMapping['delimiter'],
  ): CsvMapping => ({
    version: 1,
    encoding: 'utf-8',
    delimiter,
    headerRecord: 0,
    trailingRecords: 0,
    date: { column: find(date), format, time: 'optional' },
    number: { decimal, grouping },
    amount: { kind: 'signed', column: find(amount), outgoing: 'negative' },
    currency:
      find(currencyColumn) < 0
        ? { kind: 'default', currency }
        : { kind: 'column', column: find(currencyColumn), blankDefault: null },
    merchant: find(merchant),
    reference: find('Reference') < 0 ? null : find('Reference'),
    externalId: find('ID') < 0 ? null : find('ID'),
    original: null,
  });
  if (has('Kirjauspäivä', 'Saaja', 'Summa', 'Valuutta', 'Viite')) {
    const mapping = {
      ...build('Kirjauspäivä', 'Saaja', 'Summa', 'Valuutta', 'DD.MM.YYYY', ',', 'space', ';'),
      reference: find('Viite'),
    };
    add('builtin-nordea', 'Nordea', mapping);
    add('builtin-op', 'OP', mapping);
  }
  if (has('Started Date', 'Completed Date', 'Description', 'Amount', 'Currency', 'ID'))
    add(
      'builtin-revolut',
      'Revolut',
      build('Completed Date', 'Description', 'Amount', 'Currency', 'ISO', '.', '', ','),
    );
  if (has('ID', 'Date', 'Amount', 'Currency', 'Description', 'Reference'))
    add('builtin-wise', 'Wise', build('Date', 'Description', 'Amount', 'Currency', 'ISO', '.', '', ','));
  if (has('Date', 'Payee', 'Payment reference', 'Amount (EUR)', 'Currency'))
    add('builtin-n26', 'N26', {
      ...build('Date', 'Payee', 'Amount (EUR)', 'Currency', 'ISO', '.', '', ','),
      reference: find('Payment reference'),
    });
  return suggestions;
}
