import { getDocumentProxy } from 'unpdf';
import type { Env } from './env';
import { date, EXPONENTS, InputError, requireInput } from './domain';
import { cleanText } from './receipts';
import { readStatementBlocks, type StatementAnswer } from './ai';
import { rowsToCsv } from './xlsx';
import { MONTHS } from './csv';
import { PDF_HEADER } from './presets';

// Bank statement PDFs become the same CSV a spreadsheet becomes, so a PDF takes
// the same checks and storage path as a bank CSV. Holvi's account statement is
// read by its layout with no model call. Any other layout is cut into one block
// per payment (a line that starts with a date), Clairic reads each block's
// fields, and every value it returns is checked against the block's own text.
// Balances and totals the PDF prints go above the column names, where the
// import compares them with the rows.
export const MAX_STATEMENT_PAGES = 400;
type Item = { x: number; y: number; text: string };
export type Line = { y: number; items: Item[] };

export function isPdf(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';
}

// Each page's text as lines, top to bottom, every piece of text kept with its x.
export async function pdfLines(bytes: Uint8Array): Promise<Line[][]> {
  let proxy: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    proxy = await getDocumentProxy(bytes.slice(), { useSystemFonts: false, disableFontFace: true });
  } catch {
    throw new InputError('PDF statement unreadable');
  }
  try {
    requireInput(proxy.numPages <= MAX_STATEMENT_PAGES, 'PDF statement too long');
    const pages: Line[][] = [];
    for (let n = 1; n <= proxy.numPages; n++) {
      const page = await proxy.getPage(n);
      const items: Item[] = [];
      for (const item of (await page.getTextContent()).items)
        if ('str' in item && item.str.trim())
          items.push({ x: item.transform[4], y: item.transform[5], text: cleanText(item.str).trim() });
      page.cleanup();
      pages.push(lines(items));
    }
    return pages;
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('PDF statement unreadable');
  } finally {
    if ('destroy' in proxy && typeof proxy.destroy === 'function') await proxy.destroy();
  }
}
function lines(items: Item[]): Line[] {
  const found: Line[] = [];
  for (const item of items.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = found.at(-1);
    if (line && Math.abs(line.y - item.y) <= 2) line.items.push(item);
    else found.push({ y: item.y, items: [item] });
  }
  for (const line of found) line.items.sort((a, b) => a.x - b.x);
  return found;
}
const lineText = (line: Line) => line.items.map((item) => item.text).join(' ');

export type StatementRow = {
  date: string | null;
  valueDate?: string | null;
  amount: string | null;
  currency: string | null;
  counterparty: string;
  description: string;
  reference: string;
  message?: string;
  id: string;
};
type Side = { count: number | null; sum: string | null };
export type Statement = {
  layout: 'holvi' | 'other';
  rows: StatementRow[];
  opening: string | null;
  closing: string | null;
  credit: Side | null;
  debit: Side | null;
};

// "+ 1,234.56", "- 75.70", "-1 234,56", "1.234,56 EUR": a plain "-1234.56", or null.
export function plainAmount(text: string): string | null {
  const found = text
    .trim()
    .replace(/\u2212/g, '-')
    .match(/^([+-])?\s*(\d{1,3}(?:[ ,.'\u00a0\u202f]\d{3})*|\d+)(?:([.,])(\d{2}))?\s*(?:[A-Z]{3}|[€$£])?$/);
  if (!found) return null;
  const whole = found[2]!.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  // "1,234" is a grouped whole number only when no decimals follow.
  return `${found[1] === '-' ? '-' : ''}${whole}.${found[4] ?? '00'}`;
}
const negative = (amount: string) => (amount.startsWith('-') ? amount : `-${amount}`);
const dmy = (text: string) => {
  const found = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!found) return null;
  try {
    return date(`${found[3]}-${found[2]}-${found[1]}`);
  } catch {
    return null;
  }
};

// Holvi "EUR - ACCOUNT STATEMENT": Booking date | Payment information |
// Transaction no. | Amount EUR. A payment opens with its booking date; the
// information cell below holds Value date, Filing ID, the other party, Message,
// Reserved and the payment type on its last line. BALANCE lines open and close
// the table, and the last page states the deposit and withdrawal totals.
export function holviStatement(pages: Line[][]): Statement | null {
  const statement: Statement = { layout: 'holvi', rows: [], opening: null, closing: null, credit: null, debit: null };
  let columns: { date: number; info: number; no: number; amount: number } | null = null,
    currency = '',
    current: { date: string; amount: string; info: string[] } | null = null,
    stray = 0;
  const finish = () => {
    if (current) statement.rows.push(holviRow(current, currency));
    current = null;
  };
  for (const page of pages) {
    const head = page.findIndex((line) => {
      const texts = line.items.map((item) => item.text);
      return (
        texts[0] === 'Booking date' &&
        texts[1] === 'Payment information' &&
        texts[2] === 'Transaction no.' &&
        /^Amount [A-Z]{3}$/.test(texts[3] ?? '')
      );
    });
    if (head < 0) continue;
    const [d, info, no, amount] = page[head]!.items;
    columns = { date: d!.x, info: info!.x, no: no!.x, amount: amount!.x };
    currency = amount!.text.slice(-3);
    const at = (x: number) =>
      x >= columns!.amount - 5 ? 'amount' : x >= columns!.no - 5 ? 'no' : x >= columns!.info - 5 ? 'info' : 'date';
    // The table ends with the last line that starts in its first two columns; the footer follows.
    const inTable = (line: Line) =>
      Math.abs(line.items[0]!.x - columns!.date) <= 3 || Math.abs(line.items[0]!.x - columns!.info) <= 3;
    let end = page.length - 1;
    while (end > head && !inTable(page[end]!)) end--;
    for (const line of page.slice(head + 1, end + 1)) {
      if (!inTable(line)) {
        stray++;
        continue;
      }
      const cell = (name: string) =>
        line.items
          .filter((item) => at(item.x) === name)
          .map((item) => item.text)
          .join(' ');
      const [first, text, number, money] = [cell('date'), cell('info'), cell('no'), cell('amount')];
      if (/^BALANCE \d{2}\/\d{2}\/\d{4}$/.test(first)) {
        finish();
        if (statement.opening === null && !statement.rows.length) statement.opening = plainAmount(money);
        else statement.closing = plainAmount(money);
      } else if (dmy(first) && /^\d+$/.test(number)) {
        finish();
        current = { date: first, amount: money, info: text ? [text] : [] };
      } else if (!first && /^TOTAL NUMBER OF (DEPOSITS|WITHDRAWALS)$/.test(text)) {
        const sum = plainAmount(money);
        const side = { count: /^\d+$/.test(number) ? Number(number) : null, sum };
        if (text.endsWith('DEPOSITS')) statement.credit = side;
        else statement.debit = { ...side, sum: sum && negative(sum) };
      } else if (!first && /^FUNDS AVAILABLE\b/.test(text)) {
        continue;
      } else if (!first && text && !number && !money && current) {
        current.info.push(text);
      } else stray++;
    }
  }
  finish();
  if (!columns || !statement.rows.length) return null;
  requireInput(!stray, 'PDF statement layout changed');
  return statement;
}
const IBAN = /^[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?$/;
const LABEL = /^(Message|Reserved|Reference|Currency and amount|Ex ?change rate):\s*/;
// The cell after Value date and Filing ID: the other party, then labelled parts
// that may wrap (Message, Reserved, whose time can wrap to "p.m."), the payment
// type, and for card payments abroad the original amount and exchange rate.
function holviRow(found: { date: string; amount: string; info: string[] }, currency: string): StatementRow {
  const info = [...found.info];
  const value = info[0]?.match(/^Value date: (\d{2}\/\d{2}\/\d{4})$/)?.[1];
  if (value) info.shift();
  let id = '';
  if (/^Filing ID:/.test(info[0] ?? '')) {
    const inline = info.shift()!.replace(/^Filing ID:\s*/, '');
    id = inline || (info.shift() ?? '');
  }
  while (info.length && /^(Currency and amount|Ex ?change rate):/.test(info.at(-1)!)) info.pop();
  const last = info.at(-1) ?? '';
  const type = info.length > 1 && !LABEL.test(last) && !/^[ap]\.m\.$/.test(last) ? info.pop()! : '';
  const parts: Record<string, string[]> = { party: [] };
  let part = 'party';
  for (const line of info) {
    const label = line.match(LABEL);
    if (label) part = label[1]!.replace(' ', '').toLowerCase();
    (parts[part] ??= []).push(label ? line.slice(label[0].length) : line);
  }
  const joined = (name: string) => (parts[name] ?? []).join(' ').trim();
  return {
    date: dmy(found.date),
    valueDate: value ? dmy(value) : null,
    amount: plainAmount(found.amount),
    currency,
    counterparty: parts.party!.filter((line) => !IBAN.test(line)).join(' '),
    description: type,
    reference: joined('reference'),
    message: joined('message'),
    id: /^[0-9a-f]{32}$/i.test(id) ? id : '',
  };
}

// Any other layout: one block per line that starts with a date, up to the next
// such line, the end of the page or a balance or total line. Lines printed in
// the same place on most pages are page headers and footers and are left out.
const DATE_START = /^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\.? [A-Za-z]{3,9}\.? \d{4})\b/;
const MONEY = /(?<![\d.,])[+\-\u2212]?\s?(?:\d{1,3}(?:[ ,.'\u00a0\u202f]\d{3})+|\d+)[.,]\d{2}\b/g;
const MAX_BLOCK = 800;
export function statementBlocks(pages: Line[][]): { blocks: string[]; stated: Omit<Statement, 'layout' | 'rows'> } {
  const where = (line: Line) => `${Math.round(line.y)}|${lineText(line).replace(/\d/g, '0')}`;
  const seen = new Map<string, number>();
  for (const page of pages) for (const key of new Set(page.map(where))) seen.set(key, (seen.get(key) ?? 0) + 1);
  // A payment line can repeat in shape too, so only lines with no date first and no amount count.
  const repeated = (line: Line) =>
    pages.length >= 3 &&
    (seen.get(where(line)) ?? 0) * 2 >= pages.length &&
    !DATE_START.test(lineText(line)) &&
    !lineText(line).match(MONEY);
  const stated: Omit<Statement, 'layout' | 'rows'> = { opening: null, closing: null, credit: null, debit: null };
  const blocks: string[] = [];
  for (const page of pages) {
    let block: string[] | null = null;
    const close = () => {
      if (block && block.join(' ').match(MONEY)) blocks.push(block.join('\n').slice(0, MAX_BLOCK));
      block = null;
    };
    for (const line of page) {
      if (repeated(line)) continue;
      const text = lineText(line);
      if (statedLine(text, stated, blocks.length + (block ? 1 : 0))) close();
      else if (DATE_START.test(text)) {
        close();
        block = [text];
      } else block?.push(text);
    }
    close();
  }
  return { blocks, stated };
}
const lastMoney = (text: string) => {
  const all = text.match(MONEY);
  return all ? plainAmount(all.at(-1)!.replace(/\s/g, '')) : null;
};
// A line that states a balance or a total, noted in stated. A balance line
// that does not say which is the opening one before any payment, else closing.
function statedLine(text: string, stated: Omit<Statement, 'layout' | 'rows'>, before: number): boolean {
  const lower = text.toLowerCase();
  if (/\bbalance\b/.test(lower) && lastMoney(text) !== null) {
    if (/\b(opening|starting|previous|brought forward)\b/.test(lower)) stated.opening ??= lastMoney(text);
    else if (/\b(closing|ending|new|final|carried forward)\b/.test(lower)) stated.closing = lastMoney(text);
    else if (/^balance\b/.test(lower) && !before) stated.opening ??= lastMoney(text);
    else if (/^balance\b/.test(lower)) stated.closing = lastMoney(text);
    else return false;
    return true;
  }
  const side = /\btotal\b.*\b(credits?|deposits?|money in|paid in|incoming)\b/.test(lower)
    ? 'credit'
    : /\btotal\b.*\b(debits?|withdrawals?|money out|paid out|outgoing)\b/.test(lower)
      ? 'debit'
      : null;
  if (!side) return false;
  const sum = lastMoney(text),
    count = text.replace(MONEY, ' ').match(/\b\d{1,5}\b/);
  stated[side] ??= {
    count: count ? Number(count[0]) : null,
    sum: sum && (side === 'debit' ? negative(sum.replace(/^-/, '')) : sum.replace(/^-/, '')),
  };
  return true;
}
// Every amount the block prints, as plain absolute values, for checking a model answer.
function printedAmounts(block: string): Set<string> {
  return new Set((block.match(MONEY) ?? []).map((m) => plainAmount(m.replace(/\s/g, ''))?.replace(/^-/, '') ?? ''));
}
// The dates the block's leading date can be read as: "03/04/2026" is 3 April or 4 March.
function printedDates(block: string): Set<string> {
  const lead = block.match(DATE_START)?.[1] ?? '',
    found = new Set<string>();
  const add = (y: string, m: string | number, d: string) => {
    try {
      found.add(date(`${y.length === 2 ? `20${y}` : y}-${String(m).padStart(2, '0')}-${d.padStart(2, '0')}`));
    } catch {}
  };
  const iso = lead.match(/^(\d{4})-(\d{2})-(\d{2})$/),
    numeric = lead.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/),
    named = lead.match(/^(\d{1,2})\.? ([A-Za-z]{3,9})\.? (\d{4})$/);
  if (iso) add(iso[1]!, iso[2]!, iso[3]!);
  if (numeric) {
    add(numeric[3]!, numeric[2]!, numeric[1]!);
    add(numeric[3]!, numeric[1]!, numeric[2]!);
  }
  if (named) {
    const month = MONTHS.findIndex((m) => m.startsWith(named[2]!.toLowerCase()));
    if (month >= 0) add(named[3]!, month + 1, named[1]!);
  }
  return found;
}
// A model answer kept only where the block itself bears it out. A value that
// fails is left blank, so the row shows as a problem on the Check step.
export function checkedRow(block: string, answer: StatementAnswer, currency: string | null): StatementRow {
  const amount =
    answer.amount !== null && printedAmounts(block).has(Math.abs(answer.amount).toFixed(2))
      ? answer.amount.toFixed(2)
      : null;
  const day = answer.date && printedDates(block).has(answer.date) ? answer.date : null;
  const code = answer.currency?.toUpperCase().match(/^[A-Z]{3}$/)?.[0];
  const text = (value: string | null) => (value && block.includes(value.split(/\s+/)[0]!) ? value : '');
  return {
    date: day,
    amount,
    currency: code && code in EXPONENTS ? code : currency,
    counterparty: text(answer.counterparty),
    description: text(answer.description),
    reference: text(answer.reference),
    id: text(answer.external_id),
  };
}
// The currency most often printed as a code, for rows that name none.
function printedCurrency(pages: Line[][]): string | null {
  const counts = new Map<string, number>();
  for (const page of pages)
    for (const line of page)
      for (const code of lineText(line).match(/\b[A-Z]{3}\b/g) ?? [])
        if (code in EXPONENTS) counts.set(code, (counts.get(code) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
export async function otherStatement(env: Env, pages: Line[][]): Promise<Statement> {
  const { blocks, stated } = statementBlocks(pages);
  requireInput(blocks.length, 'PDF statement unreadable');
  const answers = await readStatementBlocks(env, blocks);
  const currency = printedCurrency(pages);
  return { layout: 'other', rows: blocks.map((b, i) => checkedRow(b, answers[i]!, currency)), ...stated };
}

const longDate = (iso: string | null | undefined) => {
  const month = iso ? MONTHS[Number(iso.slice(5, 7)) - 1]! : '';
  return iso ? `${Number(iso.slice(8))} ${month[0]!.toUpperCase()}${month.slice(1, 3)} ${iso.slice(0, 4)}` : '';
};
// Holvi rows use Holvi's own statement columns, so its built-in layout reads
// them; other rows use the PDF statement layout. Stated figures come first.
const HOLVI_HEADER = [
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
export function statementRows(statement: Statement): string[][] {
  const preamble: string[][] = [];
  if (statement.opening !== null && statement.closing !== null)
    preamble.push(['Opening balance', 'Closing balance'], [statement.opening, statement.closing], []);
  for (const [side, word] of [
    ['credit', 'credits'],
    ['debit', 'debits'],
  ] as const) {
    const stated = statement[side];
    if (stated)
      preamble.push(
        [`Total ${word}`, `Total volume of ${word}`, `Total count of ${word}`],
        ['', stated.sum ?? '', stated.count === null ? '' : String(stated.count)],
      );
  }
  if (preamble.length) preamble.push([]);
  const rows =
    statement.layout === 'holvi'
      ? [
          HOLVI_HEADER,
          ...statement.rows.map((r) => [
            longDate(r.valueDate),
            longDate(r.date),
            r.amount ?? '',
            r.currency ?? '',
            r.counterparty,
            r.description,
            r.reference,
            r.message ?? '',
            r.id,
          ]),
        ]
      : [
          PDF_HEADER,
          ...statement.rows.map((r) => [
            r.date ?? '',
            r.amount ?? '',
            r.counterparty,
            r.description,
            r.reference,
            r.id,
            r.currency ?? '',
          ]),
        ];
  return [...preamble, ...rows];
}
export async function readStatementPdf(env: Env, bytes: Uint8Array): Promise<Statement> {
  const pages = await pdfLines(bytes);
  return holviStatement(pages) ?? (await otherStatement(env, pages));
}
export async function pdfToCsv(env: Env, bytes: Uint8Array): Promise<Uint8Array> {
  return rowsToCsv(statementRows(await readStatementPdf(env, bytes)));
}
