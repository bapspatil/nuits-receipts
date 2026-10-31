// Home's search: what a typed query means, and that meaning as SQL over the archive's rows.
// Words match the row's fields and the document's own words (search_text); an amount, a range,
// a year, a month or a date becomes a filter, so "hetzner 42,50 march 2026" finds one receipt.
// instr, not LIKE: D1 refuses a LIKE pattern over 50 bytes.

export const DOC_KINDS = ['expense', 'sales', 'other', 'statement', 'package'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

// The cap on a document's indexed words. A receipt is a page; a 25-page statement still fits.
export const SEARCH_TEXT_CHARS = 32_000;
export const MAX_QUERY = 100;

export type Search = {
  words: string[];
  kinds: DocKind[];
  tags: string[];
  // Inclusive, in minor units of the document's own currency.
  amount: { min: number; max: number } | null;
  year: number | null;
  // YYYY-MM, or MM for a month name without a year.
  month: string | null;
  date: string | null;
};

const KIND_WORDS: Record<string, DocKind> = {
  receipt: 'expense',
  receipts: 'expense',
  expense: 'expense',
  invoice: 'sales',
  invoices: 'sales',
  sales: 'sales',
  statement: 'statement',
  statements: 'statement',
  bank: 'statement',
  package: 'package',
  packages: 'package',
  other: 'other',
  document: 'other',
  documents: 'other',
};
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES = [
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
const NUMBER = String.raw`\d{1,7}(?:[.,]\d{1,2})?`;
const AMOUNT = new RegExp(String.raw`^[€$£]?(\d{1,7}[.,]\d{1,2}|\d{1,7})$`);
const CURRENCY = /^[€$£]/;
const RANGE = new RegExp(`^(${NUMBER})-(${NUMBER})$`);
const BOUND = new RegExp(`^([<>]=?)(${NUMBER})$`);

const minor = (text: string) => Math.round(Number(text.replace(',', '.')) * 100);
const monthIndex = (word: string) => {
  const i = MONTH_NAMES.indexOf(word);
  return i >= 0 ? i : word.length === 3 ? MONTHS.indexOf(word) : -1;
};

// A query as typed, into words and filters. Anything that is not a filter stays a word.
export function parseQuery(input: string): Search {
  const s: Search = { words: [], kinds: [], tags: [], amount: null, year: null, month: null, date: null };
  const text = input.trim().slice(0, MAX_QUERY).toLowerCase();
  const parts = [...text.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => ({
    phrase: m[1] !== undefined,
    value: m[1] ?? m[2]!,
  }));
  let monthName = -1;
  for (const { phrase, value } of parts) {
    if (phrase) {
      const words = value.trim().replace(/\s+/g, ' ');
      if (words) s.words.push(words);
      continue;
    }
    const [prefix, rest] = value.split(/:(.*)/s) as [string, string | undefined];
    if (rest !== undefined && prefix === 'kind' && KIND_WORDS[rest]) {
      s.kinds.push(KIND_WORDS[rest]);
      continue;
    }
    if (rest && prefix === 'tag') {
      s.tags.push(normaliseTag(rest));
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = value.match(/^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/))) s.date = value;
    else if ((m = value.match(/^(0?[1-9]|[12]\d|3[01])\.(0?[1-9]|1[0-2])\.(\d{4})$/)))
      s.date = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
    else if ((m = value.match(/^(\d{4})-(0[1-9]|1[0-2])$/))) s.month = value;
    else if (/^(19|20)\d{2}$/.test(value)) s.year = Number(value);
    else if (monthIndex(value) >= 0) monthName = monthIndex(value);
    else if ((m = value.match(RANGE))) {
      const [a, b] = [minor(m[1]!), minor(m[2]!)];
      s.amount = { min: Math.min(a, b), max: Math.max(a, b) };
    } else if ((m = value.match(BOUND))) {
      const n = minor(m[2]!);
      const strict = m[1]!.length === 1;
      s.amount = m[1]!.startsWith('>')
        ? { min: strict ? n + 1 : n, max: Number.MAX_SAFE_INTEGER }
        : { min: 0, max: strict ? n - 1 : n };
    } else if ((m = value.match(AMOUNT)) && (CURRENCY.test(value) || /[.,]/.test(m[1]!))) {
      const n = minor(m[1]!);
      s.amount = { min: n, max: n };
    } else s.words.push(value);
  }
  if (monthName >= 0) {
    const mm = String(monthName + 1).padStart(2, '0');
    s.month = s.year ? `${s.year}-${mm}` : mm;
    if (s.year) s.year = null;
  }
  return s;
}

export const emptySearch = (s: Search) =>
  !s.words.length && !s.kinds.length && !s.tags.length && !s.amount && !s.year && !s.month && !s.date;

export function normaliseTag(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40);
}

// The archive row columns a search reads. hay is the row's fields and words, lower case.
export type SearchColumns = { hay: string; date: string; amount: string; kind: string; item: string };

// The search as SQL conditions ANDed together, with their binds in order.
export function searchSql(s: Search, c: SearchColumns): { where: string[]; binds: unknown[] } {
  const where: string[] = [],
    binds: unknown[] = [];
  for (const word of s.words) {
    where.push(`instr(${c.hay},?)>0`);
    binds.push(word);
  }
  if (s.kinds.length) {
    where.push(`${c.kind} IN (${s.kinds.map(() => '?').join(',')})`);
    binds.push(...s.kinds);
  }
  for (const tag of s.tags) {
    where.push(`EXISTS(SELECT 1 FROM tags t WHERE t.item=${c.item} AND t.tag=?)`);
    binds.push(tag);
  }
  if (s.amount) {
    where.push(`${c.amount} BETWEEN ? AND ?`);
    binds.push(s.amount.min, s.amount.max);
  }
  if (s.date) {
    where.push(`${c.date}=?`);
    binds.push(s.date);
  } else if (s.month?.length === 7) {
    where.push(`substr(${c.date},1,7)=?`);
    binds.push(s.month);
  } else if (s.month) {
    where.push(`substr(${c.date},6,2)=?`);
    binds.push(s.month);
  }
  if (s.year) {
    where.push(`substr(${c.date},1,4)=?`);
    binds.push(String(s.year));
  }
  return { where, binds };
}

// A document's words as search reads them: lower case, one space between words, capped.
export function searchText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, SEARCH_TEXT_CHARS);
}
