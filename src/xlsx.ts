import { InputError, MAX_CSV_BYTES, MAX_CSV_ROWS, requireInput } from './domain';

// Reads the first sheet of an .xlsx workbook into rows of cell text, with no
// dependencies: the ZIP container through DecompressionStream and the sheet XML
// through a single left-to-right element scan. The rows become a plain CSV
// file, so a spreadsheet takes the same checks and storage path as a bank CSV.
// All parts together may inflate to at most 16 MiB: a 5,000-row statement
// needs a few MiB, and the cap holds a ZIP bomb to a bounded amount of work.
const MAX_INFLATED_BYTES = 16 * 1024 * 1024;
const MAX_ROWS = MAX_CSV_ROWS + 200;
const MAX_COLUMNS = 100;

export function isXlsx(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

type Entry = { method: number; flags: number; size: number; inflated: number; offset: number };
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
      inflated: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true),
    });
    at += 46 + nameLength + extra + comment;
  }
  return found;
}
type Budget = { left: number };
async function part(bytes: Uint8Array, all: Map<string, Entry>, name: string, budget: Budget): Promise<string | null> {
  const entry = all.get(name);
  if (!entry) return null;
  requireInput(entry.inflated <= budget.left, 'CSV too large', 413);
  requireInput(!(entry.flags & 1), 'Spreadsheet password protected');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  requireInput(view.getUint32(entry.offset, true) === 0x04034b50, 'Spreadsheet unreadable');
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
  const data = bytes.subarray(start, start + entry.size);
  requireInput(data.length === entry.size, 'Spreadsheet unreadable');
  if (entry.method === 0) {
    budget.left -= data.length;
    requireInput(budget.left >= 0, 'CSV too large', 413);
    return new TextDecoder().decode(data);
  }
  requireInput(entry.method === 8, 'Spreadsheet unreadable');
  // The declared size can lie, so the inflated bytes are counted as they arrive.
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const decoder = new TextDecoder(),
    pieces: string[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      budget.left -= value.length;
      if (budget.left < 0) {
        await reader.cancel();
        throw new InputError('CSV too large', 413);
      }
      pieces.push(decoder.decode(value, { stream: true }));
    }
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('Spreadsheet unreadable');
  }
  pieces.push(decoder.decode());
  return pieces.join('');
}

// Each <name ...>body</name> or <name .../> in order, found with one forward
// pass: the opening tag cannot run past the next "<", and the closing tag is
// looked up with indexOf from there. A missing closing tag is refused.
type Element = { attrs: string; body: string; start: number; end: number };
function* elements(xml: string, name: string): Generator<Element> {
  const open = new RegExp(`<((?:\\w+:)?${name})\\b([^<>]*)>`, 'g');
  for (let m = open.exec(xml); m; m = open.exec(xml)) {
    const attrs = m[2]!;
    if (attrs.endsWith('/')) {
      yield { attrs: attrs.slice(0, -1), body: '', start: m.index, end: open.lastIndex };
      continue;
    }
    const close = `</${m[1]}>`,
      at = xml.indexOf(close, open.lastIndex);
    requireInput(at >= 0, 'Spreadsheet unreadable');
    yield { attrs, body: xml.slice(open.lastIndex, at), start: m.index, end: at + close.length };
    open.lastIndex = at + close.length;
  }
}
const first = (xml: string, name: string) => elements(xml, name).next().value as Element | undefined;
const tags = (xml: string, name: string) => xml.match(new RegExp(`<(?:\\w+:)?${name}\\b[^<>]*>`, 'g')) ?? [];

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
  let kept = '',
    from = 0;
  for (const hint of elements(xml, 'rPh')) {
    kept += xml.slice(from, hint.start);
    from = hint.end;
  }
  kept += xml.slice(from);
  return text([...elements(kept, 't')].map((t) => t.body).join(''));
}
function sharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  return [...elements(xml, 'si')].map((si) => runs(si.body));
}
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
// Which cell styles show a number as a date.
function dateStyles(xml: string | null): boolean[] {
  if (!xml) return [];
  const custom = new Map<number, boolean>();
  for (const tag of tags(xml, 'numFmt')) {
    const code = text(attribute(tag, 'formatCode') ?? '')
      .replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')
      .toLowerCase();
    custom.set(Number(attribute(tag, 'numFmtId')), /[dy]/.test(code));
  }
  return tags(first(xml, 'cellXfs')?.body ?? '', 'xf').map((tag) => {
    const id = Number(attribute(tag, 'numFmtId') ?? 0);
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
  const sheet = tags(workbook ?? '', 'sheet')[0];
  const rid = sheet ? attribute(sheet, 'id') : null;
  const target = rid ? tags(rels ?? '', 'Relationship').find((r) => attribute(r, 'Id') === rid) : undefined;
  const path = target ? attribute(target, 'Target') : null;
  if (!path) return 'xl/worksheets/sheet1.xml';
  return path.startsWith('/') ? path.slice(1) : 'xl/' + path.replace(/^\.\//, '');
}

export async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  requireInput(bytes.byteLength <= MAX_CSV_BYTES, 'CSV too large', 413);
  const all = entries(bytes),
    budget = { left: MAX_INFLATED_BYTES },
    read = (name: string) => part(bytes, all, name, budget);
  const workbook = await read('xl/workbook.xml');
  const sheet = await read(sheetPath(workbook, await read('xl/_rels/workbook.xml.rels')));
  requireInput(sheet, 'Spreadsheet unreadable');
  const strings = sharedStrings(await read('xl/sharedStrings.xml'));
  const dates = dateStyles(await read('xl/styles.xml'));
  const settings = tags(workbook ?? '', 'workbookPr')[0];
  const date1904 = ['1', 'true'].includes(settings ? (attribute(settings, 'date1904') ?? '') : '');
  const rows: string[][] = [];
  for (const row of elements(first(sheet, 'sheetData')?.body ?? '', 'row')) {
    const number = Number(attribute(row.attrs, 'r'));
    const index = Number.isInteger(number) && number > 0 ? number - 1 : rows.length;
    requireInput(index >= rows.length && index < MAX_ROWS, 'CSV requires 1 to 5000 rows');
    while (rows.length < index) rows.push([]);
    const cells: string[] = [];
    for (const cell of elements(row.body, 'c')) {
      const tag = cell.attrs,
        body = cell.body,
        type = attribute(tag, 't') ?? 'n',
        at = column(attribute(tag, 'r')) ?? cells.length;
      requireInput(at < MAX_COLUMNS, 'CSV exceeds 100 columns');
      const raw = first(body, 'v')?.body;
      let value = '';
      if (type === 'inlineStr') value = runs(first(body, 'is')?.body ?? '');
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
