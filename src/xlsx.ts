import { InputError, MAX_CSV_BYTES, MAX_CSV_ROWS, requireInput } from './domain';

// Reads the first sheet of an .xlsx workbook into rows of cell text, with no
// dependencies: the ZIP container through DecompressionStream and the sheet XML
// through a few regular expressions. The rows become a plain CSV file, so a
// spreadsheet takes the same checks and storage path as a bank CSV.
const MAX_PART_BYTES = 32 * 1024 * 1024;
const MAX_ROWS = MAX_CSV_ROWS + 200;
const MAX_COLUMNS = 100;

export function isXlsx(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

type Entry = { method: number; flags: number; size: number; offset: number };
function entries(bytes: Uint8Array): Map<string, Entry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  requireInput(end >= 0, 'Spreadsheet unreadable');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const found = new Map<string, Entry>();
  const names = new TextDecoder();
  for (let n = 0; n < count; n++) {
    requireInput(at + 46 <= bytes.length && view.getUint32(at, true) === 0x02014b50, 'Spreadsheet unreadable');
    const nameLength = view.getUint16(at + 28, true),
      extra = view.getUint16(at + 30, true),
      comment = view.getUint16(at + 32, true);
    found.set(names.decode(bytes.subarray(at + 46, at + 46 + nameLength)), {
      flags: view.getUint16(at + 8, true),
      method: view.getUint16(at + 10, true),
      size: view.getUint32(at + 20, true),
      offset: view.getUint32(at + 42, true),
    });
    at += 46 + nameLength + extra + comment;
  }
  return found;
}
async function part(bytes: Uint8Array, all: Map<string, Entry>, name: string): Promise<string | null> {
  const entry = all.get(name);
  if (!entry) return null;
  requireInput(!(entry.flags & 1), 'Spreadsheet password protected');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  requireInput(view.getUint32(entry.offset, true) === 0x04034b50, 'Spreadsheet unreadable');
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
  const data = bytes.subarray(start, start + entry.size);
  requireInput(data.length === entry.size, 'Spreadsheet unreadable');
  if (entry.method === 0) return new TextDecoder().decode(data);
  requireInput(entry.method === 8, 'Spreadsheet unreadable');
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      requireInput(total <= MAX_PART_BYTES, 'CSV too large', 413);
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('Spreadsheet unreadable');
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(joined);
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
function text(xml: string): string {
  return xml
    .replace(/&(?:#x([0-9a-f]+)|#(\d+)|(\w+));/gi, (whole, hex: string, dec: string, name: string) =>
      hex
        ? String.fromCodePoint(parseInt(hex, 16))
        : dec
          ? String.fromCodePoint(Number(dec))
          : (ENTITIES[name] ?? whole),
    )
    .replace(/_x([0-9A-F]{4})_/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}
function attribute(tag: string, name: string): string | null {
  return tag.match(new RegExp(`\\s(?:\\w+:)?${name}="([^"]*)"`))?.[1] ?? null;
}
// All <t> runs of a string item, without phonetic hints.
function runs(xml: string): string {
  return text(
    [
      ...xml
        .replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '')
        .matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g),
    ]
      .map((m) => m[1])
      .join(''),
  );
}
function sharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g)].map((m) => runs(m[1] ?? ''));
}
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
// Which cell styles show a number as a date.
function dateStyles(xml: string | null): boolean[] {
  if (!xml) return [];
  const custom = new Map<number, boolean>();
  for (const m of xml.matchAll(/<(?:\w+:)?numFmt\b[^>]*>/g)) {
    const code = text(attribute(m[0], 'formatCode') ?? '')
      .replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')
      .toLowerCase();
    custom.set(Number(attribute(m[0], 'numFmtId')), /[dy]/.test(code));
  }
  const xfs = xml.match(/<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/)?.[1] ?? '';
  return [...xfs.matchAll(/<(?:\w+:)?xf\b[^>]*>/g)].map((m) => {
    const id = Number(attribute(m[0], 'numFmtId') ?? 0);
    return custom.get(id) ?? BUILTIN_DATE_FORMATS.has(id);
  });
}
function serialDate(serial: number, date1904: boolean): string {
  const days = Math.floor(serial),
    seconds = Math.round((serial - days) * 86400);
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const at = new Date(epoch + days * 86400000 + seconds * 1000).toISOString();
  return seconds ? `${at.slice(0, 10)} ${at.slice(11, 19)}` : at.slice(0, 10);
}
// Excel stores -10 as -9.999999999999999; fifteen significant digits is what it shows.
export function numberText(value: string): string {
  const n = Number(value);
  return value.trim() && Number.isFinite(n) ? String(Number(n.toPrecision(15))) : value;
}
function column(ref: string | null): number | null {
  const letters = ref?.match(/^([A-Z]+)\d*$/i)?.[1]?.toUpperCase();
  if (!letters) return null;
  let index = 0;
  for (const c of letters) index = index * 26 + c.charCodeAt(0) - 64;
  return index - 1;
}
function sheetPath(workbook: string | null, rels: string | null): string {
  const id = workbook?.match(/<(?:\w+:)?sheet\b[^>]*>/)?.[0];
  const rid = id ? attribute(id, 'id') : null;
  const target = rid
    ? [...(rels ?? '').matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => attribute(r, 'Id') === rid)
    : undefined;
  const path = target ? attribute(target, 'Target') : null;
  if (!path) return 'xl/worksheets/sheet1.xml';
  return path.startsWith('/') ? path.slice(1) : 'xl/' + path.replace(/^\.\//, '');
}

export async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  requireInput(bytes.byteLength <= MAX_CSV_BYTES, 'CSV too large', 413);
  const all = entries(bytes);
  const workbook = await part(bytes, all, 'xl/workbook.xml');
  const sheet = await part(bytes, all, sheetPath(workbook, await part(bytes, all, 'xl/_rels/workbook.xml.rels')));
  requireInput(sheet, 'Spreadsheet unreadable');
  const strings = sharedStrings(await part(bytes, all, 'xl/sharedStrings.xml'));
  const dates = dateStyles(await part(bytes, all, 'xl/styles.xml'));
  const date1904 = /<(?:\w+:)?workbookPr\b[^>]*\sdate1904="(?:1|true)"/.test(workbook ?? '');
  const rows: string[][] = [];
  const data = sheet.match(/<(?:\w+:)?sheetData\b[^>]*>([\s\S]*?)<\/(?:\w+:)?sheetData>/)?.[1] ?? '';
  for (const row of data.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const number = Number(attribute(row[1]!, 'r'));
    const index = Number.isInteger(number) && number > 0 ? number - 1 : rows.length;
    requireInput(index >= rows.length && index < MAX_ROWS, 'CSV requires 1 to 5000 rows');
    while (rows.length < index) rows.push([]);
    const cells: string[] = [];
    for (const cell of (row[2] ?? '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const tag = cell[1]!,
        body = cell[2] ?? '',
        type = attribute(tag, 't') ?? 'n',
        at = column(attribute(tag, 'r')) ?? cells.length;
      requireInput(at < MAX_COLUMNS, 'CSV exceeds 100 columns');
      const raw = body.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
      let value = '';
      if (type === 'inlineStr') value = runs(body.match(/<(?:\w+:)?is\b[^>]*>([\s\S]*?)<\/(?:\w+:)?is>/)?.[1] ?? '');
      else if (raw === undefined) value = '';
      else if (type === 's') value = strings[Number(raw)] ?? '';
      else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
      else if (type === 'str' || type === 'e' || type === 'd') value = text(raw);
      else if (dates[Number(attribute(tag, 's') ?? 0)] && Number.isFinite(Number(raw)))
        value = serialDate(Number(raw), date1904);
      else value = numberText(text(raw));
      while (cells.length < at) cells.push('');
      cells[at] = value;
    }
    rows.push(cells);
  }
  while (rows.length && rows.at(-1)!.every((cell) => !cell.trim())) rows.pop();
  requireInput(rows.length > 0, 'Spreadsheet unreadable');
  return rows;
}
function quote(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}
// Every row padded to the widest one, so the column-count check reads the sheet as a grid.
export function rowsToCsv(rows: string[][]): Uint8Array {
  const width = Math.max(...rows.map((row) => row.length));
  const csv = rows
    .map((row) => Array.from({ length: width }, (_, i) => quote(row[i] ?? '')).join(','))
    .join('\r\n')
    .concat('\r\n');
  const bytes = new TextEncoder().encode(csv);
  requireInput(bytes.byteLength <= MAX_CSV_BYTES, 'CSV too large', 413);
  return bytes;
}
// A damaged ZIP can point outside the file; that is a refusal, not a crash.
export async function xlsxToCsv(bytes: Uint8Array): Promise<Uint8Array> {
  let rows: string[][];
  try {
    rows = await readXlsx(bytes);
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('Spreadsheet unreadable');
  }
  return rowsToCsv(rows);
}
