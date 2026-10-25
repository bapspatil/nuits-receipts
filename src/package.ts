// Month package: one month's receipts as files for the accountant, named by
// date and vendor, plus the index spreadsheet. The ZIP download and the
// optional OneDrive upload both build on planPackage(), so they always carry
// the same files under the same names.
import { makeZip, predictLength } from 'client-zip';
import { hash, money, requireInput, type Receipt } from './domain';
import { eurValues } from './banking';
import type { Env } from './env';
import { config } from './config';
import { csvCell, csvText, documentRows, EXPORT_COLUMNS, exportRow, SALES_COLUMNS, salesRow } from './ui';

// One R2 read per file; Workers allow 1,000 subrequests per request.
export const MAX_PACKAGE_FILES = 900;
// Sizes cost one R2 head each, so they are only looked up for smaller months.
const MAX_SIZED_FILES = 400;
const MAX_NAME = 120;
export const MAIN_FOLDER = 'main';
export const CHECK_FOLDER = 'check-these';
// Sales invoices you sent, checked, in their own subfolder.
export const SALES_FOLDER = 'sales';

export type PackageOptions = { anyway: boolean; undated: boolean; changes: boolean };
// A subfolder inside the month folder, or MAIN_FOLDER for the month folder
// itself. Other kinds of documents (e.g. a future "sales") add their own
// subfolder name here; ZIP and OneDrive both handle any name via folderPath().
export type Folder = typeof MAIN_FOLDER | typeof CHECK_FOLDER | (string & {});
export function folderPath(folder: Folder, name: string): string {
  return folder === MAIN_FOLDER ? name : `${folder}/${name}`;
}
export type PackageFile = {
  receipt: Receipt;
  name: string;
  folder: Folder;
  // Relative to the month folder, as in the index: "check-these/<name>".
  path: string;
  size: number | null;
};
export type TextFile = { name: string; bytes: Uint8Array };
export type LastSend = { sent_at: string; method: string; file_count: number; list: string[] };
export type SendStatus = {
  hash: string;
  list: string[];
  last: LastSend | null;
  changed: boolean;
  added: number;
  corrected: number;
  removed: number;
};
export type Plan = {
  month: string;
  folder: string;
  // The files this package carries: all of them, or only the changed ones.
  files: PackageFile[];
  // Every file of the month's package, whatever the options chose. The same
  // as files unless only the changes were asked for.
  all: PackageFile[];
  send: SendStatus;
  // Receipts the options leave out, for the Send step's wording.
  unchecked: number;
  undated: number;
  changedFiles: number;
};

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'text/html': 'html',
  'text/plain': 'txt',
  'message/rfc822': 'eml',
};
export function extension(media: string): string {
  return EXTENSIONS[media] ?? 'bin';
}

// Letters that NFKD does not split into a base letter and a mark.
const FOLD: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  Æ: 'AE',
  œ: 'oe',
  Œ: 'OE',
  ø: 'o',
  Ø: 'O',
  đ: 'd',
  Đ: 'D',
  ð: 'd',
  Ð: 'D',
  ł: 'l',
  Ł: 'L',
  þ: 'th',
  Þ: 'Th',
  ı: 'i',
};
// One file name part: ASCII letters, digits and single dots; anything else
// becomes "-". Never starts or ends with a dot or dash, so no "..", no hidden
// files and nothing OneDrive or Windows rejects.
export function segment(text: string | null | undefined, max: number): string {
  return (text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[ßæÆœŒøØđĐðÐłŁþÞı]/g, (c) => FOLD[c] ?? '')
    .replace(/[^A-Za-z0-9.]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+/, '')
    .slice(0, Math.max(0, max))
    .replace(/[-.]+$/, '');
}
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
// Windows reserves these names with any extension, so "CON.pdf" is out too.
export function safeName(name: string): string {
  return RESERVED.test(name.split('.')[0] ?? '') ? `_${name}` : name;
}

// <date|undated>_<vendor>_<CUR>-<total>_<id6>.<ext>, at most 120 characters.
// Sales invoices: <date>_<invoice no>_<client>_<CUR>-<total>_<id6>.<ext>.
export function fileName(
  r: Pick<Receipt, 'id' | 'issue_date' | 'vendor' | 'currency' | 'total_minor' | 'media_type'> &
    Partial<Pick<Receipt, 'kind' | 'invoice_number' | 'client'>>,
  idLength = 6,
): string {
  const date = r.issue_date && /^\d{4}-\d{2}-\d{2}$/.test(r.issue_date) ? r.issue_date : 'undated';
  const amount =
    r.total_minor === null
      ? 'no-amount'
      : `${segment(r.currency, 8) || 'XXX'}-${r.total_minor < 0 ? 'minus-' : ''}${money(Math.abs(r.total_minor), r.currency ?? 'EUR')}`;
  const tail = `_${amount}_${r.id.slice(0, idLength)}.${extension(r.media_type)}`;
  if (r.kind === 'sales') {
    const number = segment(r.invoice_number, 24) || 'no-number';
    const client =
      segment(r.client, Math.min(40, MAX_NAME - date.length - number.length - 2 - tail.length)) || 'Unknown-client';
    return safeName(`${date}_${number}_${client}${tail}`);
  }
  const vendor = segment(r.vendor, Math.min(40, MAX_NAME - date.length - 1 - tail.length)) || 'Unknown-vendor';
  return safeName(`${date}_${vendor}${tail}`);
}

export function folderName(env: Env, month: string): string {
  return safeName(`${segment(config(env).exportPrefix, 40) || 'receipts'}-${month}`);
}

// Where a receipt goes in the package, or null when it stays out. Duplicates
// never go in. Ready receipts go in the main folder. Everything not checked
// (needs review, still being read, an email held for review) only goes in
// with "Download anyway", in check-these/, and undated ones only when asked.
export function placement(r: Receipt, options: Pick<PackageOptions, 'anyway' | 'undated'>): Folder | null {
  if (r.duplicate_of || r.discarded_at) return null;
  if (r.media_type === 'message/rfc822')
    return options.anyway && (r.issue_date || options.undated) ? CHECK_FOLDER : null;
  if (!r.issue_date) return options.undated ? CHECK_FOLDER : null;
  if (r.status === 'ready') return r.kind === 'sales' ? SALES_FOLDER : MAIN_FOLDER;
  return options.anyway ? CHECK_FOLDER : null;
}

export function options(params: URLSearchParams | FormData): PackageOptions {
  const on = (key: string) => params.get(key) === '1';
  return { anyway: on('anyway'), undated: on('undated'), changes: on('changes') };
}
export function query(month: string, o: Partial<PackageOptions>): string {
  return `month=${month}${o.anyway ? '&anyway=1' : ''}${o.undated ? '&undated=1' : ''}${o.changes ? '&changes=1' : ''}`;
}

// "Sent" is tracked over every non-duplicate document dated in the month
// (receipts and sales invoices), by id and revision. A correction bumps the
// revision, so it shows as changed.
// rows may still be loading: the last send is looked up alongside.
export async function sendStatus(env: Env, month: string, rows?: Receipt[] | Promise<Receipt[]>): Promise<SendStatus> {
  const [docs, row] = await Promise.all([
    rows ?? documentRows(env, month),
    env.DB.prepare(
      'SELECT sent_at,method,file_count,receipts_hash,receipts_json FROM month_sends WHERE month=? ORDER BY sent_at DESC LIMIT 1',
    )
      .bind(month)
      .first<{ sent_at: string; method: string; file_count: number; receipts_hash: string; receipts_json: string }>(),
  ]);
  const list = docs.map((r) => `${r.id}:${r.revision}`).sort();
  const digest = await hash(list.join('\n'));
  if (!row) return { hash: digest, list, last: null, changed: false, added: 0, corrected: 0, removed: 0 };
  const last = {
    sent_at: row.sent_at,
    method: row.method,
    file_count: row.file_count,
    list: JSON.parse(row.receipts_json) as string[],
  };
  const before = new Map(last.list.map((key) => key.split(':') as [string, string]));
  const now = new Map(list.map((key) => key.split(':') as [string, string]));
  return {
    hash: digest,
    list,
    last,
    changed: row.receipts_hash !== digest,
    added: [...now.keys()].filter((id) => !before.has(id)).length,
    corrected: [...now].filter(([id, rev]) => before.has(id) && before.get(id) !== rev).length,
    removed: [...before.keys()].filter((id) => !now.has(id)).length,
  };
}

// Documents with no date yet, which belong to no month.
export async function undatedDocuments(env: Env): Promise<Receipt[]> {
  return (
    await env.DB.prepare(
      'SELECT * FROM receipts WHERE issue_date IS NULL AND duplicate_of IS NULL AND discarded_at IS NULL ORDER BY received_at,id',
    ).all<Receipt>()
  ).results;
}
export async function planPackage(
  env: Env,
  month: string,
  o: PackageOptions,
  // rows and send: the month's documents and send status, when the caller has them already.
  {
    sizes = false,
    rows,
    send: known,
    undated,
  }: { sizes?: boolean; rows?: Receipt[]; send?: SendStatus; undated?: Promise<Receipt[]> } = {},
): Promise<Plan> {
  const undatedQuery = undated ?? undatedDocuments(env);
  rows ??= await documentRows(env, month);
  const [undatedRows, send] = await Promise.all([undatedQuery, known ?? sendStatus(env, month, rows)]);
  const sent = new Set(send.last?.list ?? []);
  const isChanged = (r: Receipt) => !sent.has(`${r.id}:${r.revision}`);
  const candidates = [...rows, ...(o.undated ? undatedRows : [])];
  const placed = candidates
    .map((receipt) => ({ receipt, folder: placement(receipt, o) }))
    .filter((p): p is { receipt: Receipt; folder: Folder } => p.folder !== null);
  const changedFiles = send.last ? placed.filter((p) => isChanged(p.receipt)).length : 0;
  const chosen = new Set(
    (o.changes ? (send.last ? placed.filter((p) => isChanged(p.receipt)) : []) : placed).map((p) => p.receipt.id),
  );
  // Names are unique per folder, ignoring case as Windows and OneDrive do.
  // They are worked out over the whole month, so a file has the same name in
  // a changes package as in the full one.
  const taken = new Set<string>();
  const all = placed.map(({ receipt, folder }) => {
    let name = fileName(receipt);
    for (let length = 8; taken.has(`${folder}/${name}`.toLowerCase()) && length <= 64; length += 2)
      name = fileName(receipt, length);
    taken.add(`${folder}/${name}`.toLowerCase());
    return {
      receipt,
      name,
      folder,
      path: folderPath(folder, name),
      size: null,
    } as PackageFile;
  });
  const files = all.filter((f) => chosen.has(f.receipt.id));
  if (sizes && files.length <= MAX_SIZED_FILES)
    for (let i = 0; i < files.length; i += 50)
      await Promise.all(
        files.slice(i, i + 50).map(async (f) => {
          f.size = (await env.ORIGINALS.head(f.receipt.original_key))?.size ?? null;
        }),
      );
  return {
    month,
    folder: folderName(env, month),
    files,
    all,
    send,
    unchecked: rows.filter((r) => placement(r, { anyway: true, undated: false }) === CHECK_FOLDER).length,
    undated: undatedRows.length,
    changedFiles,
  };
}

const receiptOf = (f: { receipt: Receipt }) => f.receipt;

// Today's export columns unchanged, plus where the file is in the package.
// Receipts only; sales invoices have their own index.
// A changes package lists only its own files, so its index gets its own name
// and never replaces the full one when unzipped over it.
export async function indexCsv(env: Env, plan: Plan, origin: string, partial = false): Promise<TextFile> {
  const files = (partial ? plan.files : plan.all).filter((f) => f.receipt.kind !== 'sales');
  const eurs = await eurValues(env, files.map(receiptOf));
  const data = files.map((f, i) => [...exportRow(f.receipt, eurs[i]!, origin), f.path, f.folder]);
  return {
    name: `00-index-${plan.month}${partial ? '-changes' : ''}.csv`,
    bytes: new TextEncoder().encode(csvText([...EXPORT_COLUMNS, 'file_name', 'folder'], data)),
  };
}

// Sales invoices in the package, when there are any.
export async function salesIndexCsv(env: Env, plan: Plan, origin: string, partial = false): Promise<TextFile | null> {
  const files = (partial ? plan.files : plan.all).filter((f) => f.receipt.kind === 'sales');
  if (!files.length) return null;
  const eurs = await eurValues(env, files.map(receiptOf));
  const data = files.map((f, i) => [...salesRow(f.receipt, eurs[i]!, origin), f.path, f.folder]);
  return {
    name: `00-sales-index-${plan.month}${partial ? '-changes' : ''}.csv`,
    bytes: new TextEncoder().encode(csvText([...SALES_COLUMNS, 'file_name', 'folder'], data)),
  };
}

// Payments out with no receipt, so the gap is visible instead of silent.
export async function missingCsv(env: Env, month: string): Promise<TextFile | null> {
  const rows = (
    await env.DB.prepare(
      "SELECT t.booking_date,t.merchant,t.amount_minor,t.currency,t.reference,a.label AS account FROM bank_transactions t JOIN imports i ON i.id=t.import_id JOIN accounts a ON a.id=t.account_key WHERE i.status='complete' AND t.amount_minor<0 AND t.receipt_required=1 AND t.receipt_id IS NULL AND substr(t.booking_date,1,7)=? ORDER BY t.booking_date,t.account_key,t.id",
    )
      .bind(month)
      .all<{
        booking_date: string;
        merchant: string;
        amount_minor: number;
        currency: string;
        reference: string | null;
        account: string;
      }>()
  ).results;
  if (!rows.length) return null;
  return {
    name: `00-missing-receipts-${month}.csv`,
    bytes: new TextEncoder().encode(
      csvText(
        ['date', 'paid_to', 'amount', 'currency', 'account', 'reference'],
        rows.map((t) => [
          t.booking_date,
          csvCell(t.merchant),
          money(-t.amount_minor, t.currency),
          t.currency,
          csvCell(t.account),
          csvCell(t.reference),
        ]),
      ),
    ),
  };
}

// Spreadsheets at the top of the month folder. Another document kind adds
// its own index here (and its files to plan.files under its own folder);
// the ZIP, the OneDrive upload and the manifest all pick it up.
// A OneDrive upload always carries the full indexes, since it replaces the ones
// in the folder; only a changes ZIP (`partial`) lists just its own files.
export async function packageTexts(env: Env, plan: Plan, origin: string, partial = false): Promise<TextFile[]> {
  const texts: Array<TextFile | null> = [
    await indexCsv(env, plan, origin, partial),
    await salesIndexCsv(env, plan, origin, partial),
    await missingCsv(env, plan.month),
  ];
  return texts.filter((t): t is TextFile => t !== null);
}

export function requirePackable(plan: Plan, o: PackageOptions): void {
  requireInput(
    plan.files.length <= MAX_PACKAGE_FILES,
    `This month has ${plan.files.length} files, more than the ${MAX_PACKAGE_FILES} one package can hold. Download the spreadsheet instead and fetch the originals from the app.`,
    413,
  );
  requireInput(
    plan.files.length > 0,
    o.changes
      ? plan.send.last
        ? 'Nothing has changed since you sent this month.'
        : "You haven't marked this month as sent yet, so there is nothing to compare with."
      : 'There are no receipts to put in the package for this month.',
    o.changes ? 409 : 422,
  );
}

// The exact ZIP size, so the browser can show progress. A missing original
// fails here, before anything is streamed.
function knownLength(plan: Plan, texts: TextFile[]): bigint {
  return predictLength([
    ...texts.map((t) => ({ name: `${plan.folder}/${t.name}`, size: t.bytes.length })),
    ...plan.files.map((f) => {
      requireInput(f.size !== null, `The original of ${f.name} is missing`, 404);
      return { name: `${plan.folder}/${f.path}`, size: f.size };
    }),
  ]);
}

export async function packageZip(env: Env, month: string, o: PackageOptions, origin: string): Promise<Response> {
  const plan = await planPackage(env, month, o, { sizes: true });
  requirePackable(plan, o);
  const texts = await packageTexts(env, plan, origin, o.changes);
  const now = new Date();
  const length = plan.files.length <= MAX_SIZED_FILES ? knownLength(plan, texts) : null;
  async function* files() {
    for (const t of texts) yield { name: `${plan.folder}/${t.name}`, input: t.bytes, lastModified: now };
    for (const f of plan.files) {
      const object = await env.ORIGINALS.get(f.receipt.original_key);
      if (!object) throw new Error('original_missing');
      yield {
        name: `${plan.folder}/${f.path}`,
        input: object.body,
        size: object.size,
        lastModified: new Date(f.receipt.received_at),
      };
    }
  }
  const zip = makeZip(files());
  return new Response(length === null ? zip : zip.pipeThrough(new FixedLengthStream(length)), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${plan.folder}${o.changes ? '-changes' : ''}.zip"`,
      ...(length === null ? {} : { 'Content-Length': String(length) }),
    },
  });
}

// What the owner sent: every document dated in the month, by id and revision.
// The total stays costs only (receipts); sales invoices are money in.
// The form carries the hash it showed, so a month that changed in between
// is not silently marked as sent.
export async function markSent(
  env: Env,
  month: string,
  shownHash: string,
  method: 'download' | 'onedrive',
): Promise<string> {
  const rows = await documentRows(env, month);
  requireInput(rows.length > 0, 'There are no receipts dated in this month to send.');
  const status = await sendStatus(env, month, rows);
  requireInput(
    shownHash === status.hash,
    'This month changed since you opened the page. Reload it, check what you send, then mark it as sent.',
    409,
  );
  let total = 0;
  const expenses = rows.filter((r) => r.kind !== 'sales');
  for (const eur of await eurValues(env, expenses)) total += eur.minor ?? 0;
  const at = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO month_sends (month,sent_at,method,file_count,total_minor,receipts_hash,receipts_json) VALUES (?,?,?,?,?,?,?)',
  )
    .bind(month, at, method, rows.length, total, status.hash, JSON.stringify(status.list))
    .run();
  return at;
}

// The inverse of markSent: drop the send stamped at, so the month goes back to the
// state it had before (the send before it, or not sent). Only the latest send can go;
// an older one is history that a later send already replaced.
export async function unmarkSent(env: Env, month: string, at: string): Promise<void> {
  const removed = await env.DB.prepare(
    'DELETE FROM month_sends WHERE month=? AND sent_at=? AND sent_at=(SELECT max(sent_at) FROM month_sends WHERE month=?)',
  )
    .bind(month, at, month)
    .run();
  requireInput(removed.meta.changes > 0, 'Send already replaced');
}
