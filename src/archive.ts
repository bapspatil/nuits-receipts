// The archive on Home: every finance document, newest first by its own date, in folders that build
// themselves (a year, a month, a seller, a client, a kind, a tag, Starred, Recent) and a search
// over their fields and words (src/search.ts). One row per document, whatever table it lives in:
// receipts and sales invoices, mail waiting on an unknown sender, other documents, bank statements
// and the month packages that were sent. A row opens in the preview pane beside the list.
import type { Env } from './env';
import { STATUS, type StatusKey } from './status';
import { button, buttonLink, statusMark } from './actions';
import { icon, type IconName } from './icons';
import { DISCARD_REASONS, type DiscardReason, requireInput } from './domain';
import { needsReview, needsReviewSql, readySql } from './flags';
import { restoreForm } from './discard';
import { bulkBar, bulkCheck, bulkTools, RECEIPT_ACTIONS, type BulkList } from './bulk';
import { invoiceName } from './invoices';
import { FOLDER_PARAM, listParams, listUrl, RECEIPTS_TODO, receiptUrl, type ListState } from './worklist';
import { DOC_KINDS, normaliseTag, parseQuery, searchSql, type DocKind, type Search } from './search';
import { viewer } from './viewer';
import { amount, chipRow, day, emptyState, escape, monthName, shortDay } from './ui';
import { row, rowList } from './row';

export const PAGE_SIZE = 50;
export const SHOW = {
  ready: STATUS.ready.word,
  needs: STATUS.needs.word,
  reading: STATUS.reading.word,
  duplicate: STATUS.duplicate.word,
  discarded: STATUS.discarded.word,
  sales: 'Sales invoices',
  unknown: STATUS.newSender.word,
} as const;
export type Show = keyof typeof SHOW;
const CHIPS = ['reading', 'duplicate', 'discarded'] as const;

// ---------- Kinds and items ----------

export const KINDS: Record<DocKind, { label: string; plural: string; icon: IconName }> = {
  expense: { label: 'Receipt', plural: 'Receipts', icon: 'receipt-text' },
  sales: { label: 'Sales invoice', plural: 'Sales invoices', icon: 'file-plus' },
  statement: { label: 'Bank statement', plural: 'Bank statements', icon: 'landmark' },
  package: { label: 'Month package', plural: 'Month packages', icon: 'archive' },
  other: { label: 'Document', plural: 'Other documents', icon: 'file-text' },
};

// The drawer's fixed folders, each with its icon.
export const FOLDER_ICONS = {
  all: 'files',
  starred: 'star',
  recent: 'clock',
  saved: 'bookmark',
} as const satisfies Record<string, IconName>;

// A row's #row- anchor: a receipt's bare id, the one every list action lands on; any other key
// with its punctuation made safe for an id and a fragment.
export const rowKey = (r: Pick<ArchiveRow, 'type' | 'id' | 'item'>) =>
  r.type === 'receipt' ? r.id : r.item.replace(/[^\w-]/g, '-');
const cursorParam = (c: Cursor | null) => (c ? `${c.day}_${c.at}_${c.item}` : null);

// An item key names one archive row across tables: r:<receipt id>, m:<held mail id>,
// d:<document id>, s:<import id>, p:<month>@<sent at>.
export type Item =
  | { type: 'receipt'; id: string }
  | { type: 'mail'; id: string }
  | { type: 'document'; id: string }
  | { type: 'statement'; id: string }
  | { type: 'package'; month: string; sentAt: string };
const ITEM = /^(?:([rmds]):([A-Za-z0-9_-]{1,80})|p:(\d{4}-\d{2})@([0-9T:.Z+-]{10,40}))$/;
export function parseItem(text: string | null): Item | null {
  const m = (text ?? '').match(ITEM);
  if (!m) return null;
  if (m[3]) return { type: 'package', month: m[3], sentAt: m[4]! };
  const type = ({ r: 'receipt', m: 'mail', d: 'document', s: 'statement' } as const)[m[1] as 'r' | 'm' | 'd' | 's'];
  return { type, id: m[2]! };
}
export function itemKey(item: Item): string {
  return item.type === 'package'
    ? `p:${item.month}@${item.sentAt}`
    : `${({ receipt: 'r', mail: 'm', document: 'd', statement: 's' } as const)[item.type]}:${item.id}`;
}
// The full page of an item: a receipt's own page, the To do row of held mail, or /files/<key>.
export function itemPath(item: Item, state?: ListState): string {
  if (item.type === 'receipt') return state ? receiptUrl(item.id, state) : `/receipts/${item.id}`;
  if (item.type === 'mail') return `${listUrl(RECEIPTS_TODO)}#mail-${item.id}`;
  return `/files/${encodeURIComponent(itemKey(item))}`;
}

// ---------- Folders ----------

export type Folder =
  | { type: 'all' }
  | { type: 'year'; year: number }
  | { type: 'vendor'; name: string }
  | { type: 'client'; name: string }
  | { type: 'kind'; kind: DocKind }
  | { type: 'tag'; tag: string }
  | { type: 'starred' }
  | { type: 'recent' };
export function parseFolder(text: string | null): Folder {
  const raw = (text ?? '').trim();
  if (!FOLDER_PARAM.test(raw)) return { type: 'all' };
  if (raw === 'starred' || raw === 'recent') return { type: raw };
  const [type, value] = raw.split(/:(.*)/s) as [string, string];
  if (type === 'year') return { type: 'year', year: Number(value) };
  if (type === 'vendor' || type === 'client') return { type, name: value };
  if (type === 'tag') return { type: 'tag', tag: normaliseTag(value) };
  return (DOC_KINDS as readonly string[]).includes(value) ? { type: 'kind', kind: value as DocKind } : { type: 'all' };
}
export function folderParam(f: Folder): string | null {
  switch (f.type) {
    case 'all':
      return null;
    case 'year':
      return `year:${f.year}`;
    case 'vendor':
    case 'client':
      return `${f.type}:${f.name}`;
    case 'kind':
      return `kind:${f.kind}`;
    case 'tag':
      return `tag:${f.tag}`;
    default:
      return f.type;
  }
}
export function folderName(f: Folder): string {
  switch (f.type) {
    case 'all':
      return 'Everything';
    case 'year':
      return String(f.year);
    case 'vendor':
    case 'client':
      return f.name;
    case 'kind':
      return KINDS[f.kind].plural;
    case 'tag':
      return `#${f.tag}`;
    case 'starred':
      return 'Starred';
    case 'recent':
      return 'Recently opened';
  }
}

// ---------- The query ----------

// Every archive row with the same columns. hay is what a search's words match: the fields, lower
// case, then the document's own words. day orders the archive and files it under a month.
const RECEIPT_HAY =
  "lower(coalesce(vendor,'')||' '||coalesce(client,'')||' '||coalesce(invoice_number,'')||' '||filename||' '||coalesce(reference_number,'')||' '||coalesce(product,'')||' '||coalesce(expense_type,'')||' '||coalesce(line_items_json,''))||' '||coalesce(search_text,'')";
const SOURCES = {
  receipts: `SELECT 'r:'||id AS item,'receipt' AS type,id,kind,status,duplicate_of,discarded_at,discard_reason,coalesce(issue_date,substr(received_at,1,10)) AS day,received_at AS at,vendor,client,invoice_number,filename,media_type,total_minor,currency,issue_date,NULL AS sender,NULL AS subject,review_reasons_json,${RECEIPT_HAY} AS hay FROM receipts`,
  mail: `SELECT 'm:'||id,'mail',id,'mail','held',NULL,NULL,NULL,substr(received_at,1,10),received_at,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,sender,subject,'[]',lower(coalesce(sender,'')||' '||coalesce(subject,'')) FROM inbound_mail WHERE state='held'`,
  documents: `SELECT 'd:'||id,'document',id,'other','ready',NULL,NULL,NULL,coalesce(doc_date,substr(received_at,1,10)),received_at,title,NULL,NULL,filename,media_type,NULL,NULL,doc_date,NULL,NULL,'[]',lower(title||' '||filename)||' '||coalesce(search_text,'') FROM documents`,
  statements: `SELECT 's:'||i.id,'statement',i.id,'statement','ready',NULL,NULL,NULL,coalesce((SELECT max(booking_date) FROM bank_transactions t WHERE t.import_id=i.id),substr(i.imported_at,1,10)),i.imported_at,a.label,a.bank_name,NULL,i.original_key,'text/csv',NULL,a.default_currency,NULL,NULL,NULL,'[]',lower(a.label||' '||a.bank_name)||' bank statement' FROM imports i JOIN accounts a ON a.id=i.account_key WHERE i.status='complete'`,
  packages: `SELECT 'p:'||month||'@'||sent_at,'package',month,'package','sent',NULL,NULL,NULL,date(month||'-01','+1 month','-1 day'),sent_at,NULL,NULL,NULL,NULL,'application/zip',total_minor,'EUR',NULL,NULL,NULL,'[]','month package '||month FROM month_sends`,
};
export const ARCHIVE_SOURCE = `SELECT x.*,(SELECT group_concat(tag,' ') FROM tags g WHERE g.item=x.item) AS tags,(SELECT starred_at FROM marks k WHERE k.item=x.item) AS starred_at FROM (${Object.values(SOURCES).join(' UNION ALL ')}) x`;

export type ArchiveRow = {
  item: string;
  type: Item['type'];
  id: string;
  kind: DocKind | 'mail';
  status: string;
  duplicate_of: string | null;
  discarded_at: string | null;
  discard_reason: DiscardReason | null;
  day: string;
  at: string;
  vendor: string | null;
  client: string | null;
  invoice_number: string | null;
  filename: string | null;
  media_type: string | null;
  total_minor: number | null;
  currency: string | null;
  issue_date: string | null;
  sender: string | null;
  subject: string | null;
  review_reasons_json: string;
  tags: string | null;
  starred_at: string | null;
};

const WHERE: Record<Show, string> = {
  ready: `type='receipt' AND ${readySql()} AND duplicate_of IS NULL AND discarded_at IS NULL`,
  needs: `type='receipt' AND ${needsReviewSql()} AND duplicate_of IS NULL AND discarded_at IS NULL`,
  reading: "type='receipt' AND status IN ('pending','processing') AND duplicate_of IS NULL AND discarded_at IS NULL",
  duplicate: "type='receipt' AND duplicate_of IS NOT NULL AND discarded_at IS NULL",
  discarded: "type='receipt' AND discarded_at IS NOT NULL",
  sales: "type='receipt' AND kind='sales' AND discarded_at IS NULL",
  unknown: "type='mail'",
};

export type Cursor = { day: string; at: string; item: string };
const CURSOR = /^(\d{4}-\d{2}-\d{2})_([0-9T:.Z+-]{10,40})_(\S{3,140})$/;
export type ArchiveQuery = {
  folder: Folder;
  month: string | null;
  show: Show | null;
  q: string;
  search: Search;
  before: Cursor | null;
  open: Item | null;
};
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function archiveQuery(params: Pick<URLSearchParams, 'get'>): ArchiveQuery {
  const show = params.get('show') ?? '';
  const month = params.get('month') ?? '';
  requireInput(!month || MONTH.test(month), 'Choose a month like 2026-10');
  const q = (params.get('q') ?? '').trim().slice(0, 100);
  const before = (params.get('before') ?? '').match(CURSOR);
  return {
    folder: parseFolder(params.get('in')),
    month: month || null,
    show: Object.hasOwn(SHOW, show) ? (show as Show) : null,
    q,
    search: parseQuery(q),
    before: before && parseItem(before[3]!) ? { day: before[1]!, at: before[2]!, item: before[3]! } : null,
    open: parseItem(params.get('open')),
  };
}
// The list state of a query, the shape every list action returns to.
export function stateOf(q: ArchiveQuery): ListState {
  return { ...RECEIPTS_TODO, view: 'all', show: q.show, month: q.month, q: q.q, folder: folderParam(q.folder) };
}

// The filter as SQL over ARCHIVE, shared by the page and its bulk actions.
export function archiveWhere(q: Omit<ArchiveQuery, 'before' | 'open'>): { where: string; binds: unknown[] } {
  const where: string[] = [],
    binds: unknown[] = [];
  // Discarded receipts show only under their own chip.
  where.push(q.show ? WHERE[q.show] : "(type<>'receipt' OR discarded_at IS NULL)");
  const f = q.folder;
  if (f.type === 'year') {
    where.push('substr(day,1,4)=?');
    binds.push(String(f.year));
  } else if (f.type === 'vendor') {
    where.push("type='receipt' AND kind='expense' AND vendor=?");
    binds.push(f.name);
  } else if (f.type === 'client') {
    where.push("type='receipt' AND kind='sales' AND client=?");
    binds.push(f.name);
  } else if (f.type === 'kind') {
    where.push('kind=?');
    binds.push(f.kind);
  } else if (f.type === 'tag') {
    where.push('EXISTS(SELECT 1 FROM tags t WHERE t.item=x.item AND t.tag=?)');
    binds.push(f.tag);
  } else if (f.type === 'starred') where.push('starred_at IS NOT NULL');
  else if (f.type === 'recent') where.push('x.item IN (SELECT item FROM recent_views)');
  if (q.month) {
    where.push('substr(day,1,7)=?');
    binds.push(q.month);
  }
  const s = searchSql(q.search, { hay: 'hay', date: 'day', amount: 'total_minor', kind: 'kind', item: 'x.item' });
  where.push(...s.where);
  binds.push(...s.binds);
  return { where: where.join(' AND '), binds };
}

export async function archiveRows(env: Env, q: ArchiveQuery): Promise<ArchiveRow[]> {
  const { where, binds } = archiveWhere(q);
  const after = q.before ? ' AND (day,at,item)<(?,?,?)' : '';
  const cursor = q.before ? [q.before.day, q.before.at, q.before.item] : [];
  return (
    await env.DB.prepare(
      `SELECT * FROM (${ARCHIVE_SOURCE}) x WHERE ${where}${after} ORDER BY day DESC,at DESC,item DESC LIMIT ?`,
    )
      .bind(...binds, ...cursor, PAGE_SIZE + 1)
      .all<ArchiveRow>()
  ).results;
}
// The receipt rows (never anything else) the filter matches, across pages: their count for the
// bulk bar, or up to limit ids for a bulk action on all of them.
export async function filterCount(env: Env, q: Omit<ArchiveQuery, 'before' | 'open'>): Promise<number> {
  const { where, binds } = archiveWhere(q);
  return (
    (await env.DB.prepare(`SELECT count(*) n FROM (${ARCHIVE_SOURCE}) x WHERE type='receipt' AND ${where}`)
      .bind(...binds)
      .first<number>('n')) ?? 0
  );
}
export async function filterIds(env: Env, q: Omit<ArchiveQuery, 'before' | 'open'>, limit: number): Promise<string[]> {
  const { where, binds } = archiveWhere(q);
  return (
    await env.DB.prepare(
      `SELECT id FROM (${ARCHIVE_SOURCE}) x WHERE type='receipt' AND ${where} ORDER BY day DESC,at DESC,item DESC LIMIT ?`,
    )
      .bind(...binds, limit)
      .all<{ id: string }>()
  ).results.map((r) => r.id);
}
// A list state's archive query, for the bulk bar posted from Home.
export function stateQuery(s: ListState): Omit<ArchiveQuery, 'before' | 'open'> {
  const q = archiveQuery(new URLSearchParams({ show: s.show ?? '', month: s.month ?? '', q: s.q, in: s.folder ?? '' }));
  return q;
}

// ---------- One row ----------

export function chipOf(r: ArchiveRow): { key: StatusKey; after?: string } | null {
  if (r.type === 'mail') return { key: 'newSender' };
  if (r.type === 'package') return { key: 'sent', after: day(r.at, false) };
  if (r.type !== 'receipt') return null;
  if (r.discarded_at) return { key: 'discarded', after: r.discard_reason ? DISCARD_REASONS[r.discard_reason] : '' };
  if (r.duplicate_of) return { key: 'duplicate' };
  if (r.status === 'pending' || r.status === 'processing') return { key: 'reading' };
  if (needsReview(r)) return { key: 'needs' };
  return null;
}
export function rowName(
  r: Pick<
    ArchiveRow,
    'type' | 'kind' | 'vendor' | 'client' | 'invoice_number' | 'filename' | 'sender' | 'id' | 'issue_date'
  >,
): string {
  switch (r.type) {
    case 'mail':
      return r.sender ?? 'Unknown sender';
    case 'document':
      return r.vendor ?? r.filename ?? 'Document';
    case 'statement':
      return `${r.vendor ?? 'Bank'} statement`;
    case 'package':
      return `${monthName(r.id)} package`;
    default:
      return r.kind === 'sales' ? invoiceName(r) : (r.vendor ?? r.filename ?? 'Receipt');
  }
}
const kindOf = (r: ArchiveRow): DocKind =>
  r.type === 'receipt' ? (r.kind === 'sales' ? 'sales' : 'expense') : r.kind === 'mail' ? 'expense' : r.kind;
const tagsOf = (r: Pick<ArchiveRow, 'tags'>) => (r.tags ? r.tags.split(' ').filter(Boolean) : []);

// ---------- The page's parts ----------

export type Drawer = {
  months: { m: string; n: number }[];
  kinds: { kind: string; n: number }[];
  vendors: { name: string; n: number }[];
  clients: { name: string; n: number }[];
  tags: { tag: string; n: number }[];
  starred: number;
  recent: { item: string; name: string }[];
  saved: { id: number; name: string; query: string }[];
};
export async function drawerData(env: Env): Promise<Drawer> {
  const all = (sql: string) =>
    env.DB.prepare(sql)
      .all<never>()
      .then((r) => r.results);
  const LIVE = `(${ARCHIVE_SOURCE}) x WHERE (type<>'receipt' OR (duplicate_of IS NULL AND discarded_at IS NULL)) AND type<>'mail'`;
  const [months, kinds, vendors, clients, tags, starred, recent, saved] = await Promise.all([
    all(`SELECT substr(day,1,7) m,count(*) n FROM ${LIVE} GROUP BY m ORDER BY m DESC`),
    all(`SELECT kind,count(*) n FROM ${LIVE} GROUP BY kind`),
    all(
      "SELECT vendor name,count(*) n FROM receipts WHERE kind='expense' AND vendor IS NOT NULL AND duplicate_of IS NULL AND discarded_at IS NULL GROUP BY vendor ORDER BY n DESC,vendor LIMIT 20",
    ),
    all(
      "SELECT client name,count(*) n FROM receipts WHERE kind='sales' AND client IS NOT NULL AND duplicate_of IS NULL AND discarded_at IS NULL GROUP BY client ORDER BY n DESC,client LIMIT 12",
    ),
    all('SELECT tag,count(*) n FROM tags GROUP BY tag ORDER BY tag LIMIT 60'),
    env.DB.prepare('SELECT count(*) n FROM marks WHERE starred_at IS NOT NULL').first<number>('n'),
    all(
      `SELECT x.item,x.type,x.kind,x.vendor,x.client,x.invoice_number,x.filename,x.sender,x.id,x.issue_date FROM recent_views v JOIN (${ARCHIVE_SOURCE}) x ON x.item=v.item ORDER BY v.viewed_at DESC LIMIT 8`,
    ),
    all('SELECT id,name,query FROM saved_searches ORDER BY name LIMIT 30'),
  ]);
  return {
    months,
    kinds,
    vendors,
    clients,
    tags,
    starred: starred ?? 0,
    recent: (recent as ArchiveRow[]).map((r) => ({ item: r.item, name: rowName(r) })),
    saved,
  };
}

// Home's address for a folder, a month, a search, a page and an open item. Empty values are left out.
export function homeUrl(o: {
  in?: string | null;
  month?: string | null;
  show?: string | null;
  q?: string;
  before?: string | null;
  open?: string | null;
}): string {
  const p = new URLSearchParams();
  for (const k of ['in', 'month', 'show', 'q', 'before', 'open'] as const) {
    const v = o[k];
    if (v) p.set(k, v);
  }
  const text = p.toString();
  return text ? `/?${text}` : '/';
}

export function drawer(d: Drawer, q: ArchiveQuery): string {
  const at = folderParam(q.folder);
  const link = (folder: string | null, label: string, n?: number, ico?: IconName, month: string | null = null) => {
    const current = folder === at && month === q.month;
    return `<li><a href="${escape(homeUrl({ in: folder, month }))}"${current ? ' aria-current="page"' : ''}>${ico ? icon(ico) : ''}<span>${escape(label)}</span>${n === undefined ? '' : `<span class="n">${n}</span>`}</a></li>`;
  };
  const group = (title: string, items: string) =>
    items ? `<section class="dgroup"><h3>${title}</h3><ul>${items}</ul></section>` : '';
  const years = new Map<string, { m: string; n: number }[]>();
  for (const row of d.months) years.set(row.m.slice(0, 4), [...(years.get(row.m.slice(0, 4)) ?? []), row]);
  const openYear = q.month?.slice(0, 4) ?? (q.folder.type === 'year' ? String(q.folder.year) : [...years.keys()][0]);
  const cards = [...years]
    .map(([year, months]) => {
      const total = months.reduce((n, m) => n + m.n, 0);
      return `<details class="divider"${year === openYear ? ' open' : ''}><summary><span class="tab">${year}</span><span class="n">${total}</span></summary><ul>${link(`year:${year}`, `All of ${year}`, total)}${months.map((m) => link(null, monthName(m.m, false), m.n, undefined, m.m)).join('')}</ul></details>`;
    })
    .join('');
  const kindCount = (k: string) => d.kinds.find((x) => x.kind === k)?.n ?? 0;
  return `<nav class="drawer" id="folders" aria-label="Folders"><h2 class="vh">Folders</h2><ul class="dtop">${link(null, 'Everything', undefined, FOLDER_ICONS.all)}${link('starred', 'Starred', d.starred, FOLDER_ICONS.starred)}${link('recent', 'Recently opened', undefined, FOLDER_ICONS.recent)}</ul>${
    d.saved.length
      ? group(
          'Saved searches',
          d.saved
            .map(
              (s) =>
                `<li><a href="${escape(s.query)}">${icon(FOLDER_ICONS.saved)}<span>${escape(s.name)}</span></a></li>`,
            )
            .join(''),
        )
      : ''
  }${cards ? `<section class="dgroup years"><h3>Years</h3>${cards}</section>` : ''}${group(
    'Kinds',
    DOC_KINDS.filter((k) => kindCount(k))
      .map((k) => link(`kind:${k}`, KINDS[k].plural, kindCount(k), KINDS[k].icon))
      .join(''),
  )}${group('Sellers', d.vendors.map((v) => link(`vendor:${v.name}`, v.name, v.n)).join(''))}${group(
    'Clients',
    d.clients.map((c) => link(`client:${c.name}`, c.name, c.n)).join(''),
  )}${group('Tags', d.tags.map((t) => link(`tag:${t.tag}`, `#${t.tag}`, t.n)).join(''))}${
    d.recent.length
      ? group(
          'Opened lately',
          d.recent
            .map(
              (r) =>
                `<li><a href="${escape(homeUrl({ in: at, month: q.month, q: q.q, open: r.item }))}"><span>${escape(r.name)}</span></a></li>`,
            )
            .join(''),
        )
      : ''
  }</nav>`;
}

// The list of a query: chips, the rows with their bulk bar, and the Older and Newest links.
export function archiveList(
  q: ArchiveQuery,
  rows: ArchiveRow[],
  o: {
    total: number;
    tally: Record<'reading' | 'duplicate' | 'discarded', number> | null;
    receiptAddress: string;
    empty: string;
  },
): string {
  const state = stateOf(q);
  const more = rows.length > PAGE_SIZE;
  const shown = rows.slice(0, PAGE_SIZE);
  const base = { in: folderParam(q.folder), month: q.month, show: q.show, q: q.q };
  const bulk: BulkList = {
    form: 'bulk-receipts',
    action: '/receipts/bulk',
    noun: ['receipt', 'receipts'],
    total: o.total,
    scope: listParams(state),
    actions:
      q.show === 'discarded'
        ? [RECEIPT_ACTIONS.restore]
        : [
            RECEIPT_ACTIONS.discard,
            RECEIPT_ACTIONS.retry,
            RECEIPT_ACTIONS.kind(q.show === 'sales' ? 'sales' : 'expense'),
          ],
  };
  const picks = shown.filter((r) => r.type === 'receipt').length;
  const back = listUrl(state);
  const ul = rowList(
    shown.map((r) => {
      const chip = chipOf(r);
      const kind = KINDS[kindOf(r)];
      const href = escape(
        r.type === 'mail'
          ? itemPath({ type: 'mail', id: r.id })
          : // The page and the row stay: the list keeps its place beside the preview.
            homeUrl({ ...base, before: cursorParam(q.before), open: r.item }) + `#row-${rowKey(r)}`,
      );
      const reading = r.status === 'pending' || r.status === 'processing';
      const name = rowName(r);
      const tags = tagsOf(r);
      return row({
        key: rowKey(r),
        pick: r.type === 'receipt' ? bulkCheck(bulk, r.id, name) : '',
        date: r.type === 'mail' ? '' : r.type === 'receipt' && !r.issue_date ? 'Undated' : escape(shortDay(r.day)),
        title: `<a href="${href}"${q.open && itemKey(q.open) === r.item ? ' aria-current="true"' : ''}>${icon(kind.icon)}<span>${escape(name)}</span></a>${r.starred_at ? `<span class="starred" title="Starred">${icon('star')}<span class="vh">Starred</span></span>` : ''}`,
        meta: `${r.type === 'receipt' || r.type === 'mail' ? '' : escape(kind.label)}${tags.map((t) => `<span class="tagchip">#${escape(t)}</span>`).join('')}`,
        status: chip ? statusMark(chip.key, { after: chip.after ? escape(chip.after) : undefined }) : '',
        amount: r.total_minor === null || r.type === 'mail' ? '' : amount(r.total_minor, r.currency),
        actions: `${reading ? `<a class="refresh" href="${escape(back)}">Refresh</a>` : ''}${r.discarded_at ? restoreForm(r.id, back) : ''}`,
      });
    }),
    'Documents',
  );
  const last = shown[shown.length - 1];
  const pages =
    q.before || more
      ? `<nav class="btns" aria-label="Pages">${q.before ? buttonLink('newest', homeUrl(base)) : ''}${more && last ? buttonLink('older', homeUrl({ ...base, before: `${last.day}_${last.at}_${last.item}` })) : ''}</nav>`
      : '';
  const chipList = chipRow('Show', [
    { href: escape(homeUrl({ ...base, show: null })), label: 'All', current: !q.show },
    ...CHIPS.map((k) => ({
      href: escape(homeUrl({ ...base, show: k })),
      label: SHOW[k],
      count: o.tally?.[k] ?? 0,
      current: k === q.show,
    })),
  ]);
  const chips = chipList
    ? `<details class="filters"${q.show && (CHIPS as readonly string[]).includes(q.show) ? ' open' : ''}><summary>More filters</summary><div class="body">${chipList}</div></details>`
    : '';
  const everything = homeUrl({});
  // Home's one primary is the month's next step, so the list's ways out are secondary.
  const list = shown.length
    ? `${picks ? `<div data-bulk-list="${bulk.form}">${bulkTools(bulk, picks)}${ul}</div>${bulkBar(bulk)}` : ul}${pages}`
    : q.q
      ? emptyState(
          `Nothing matches &#8220;${escape(q.q)}&#8221;.`,
          buttonLink('clearSearch', homeUrl({ ...base, q: '' }), { tone: 'secondary' }),
        )
      : q.show === 'discarded'
        ? emptyState('Nothing discarded.', buttonLink('showAll', everything, { tone: 'secondary' }))
        : q.folder.type !== 'all' || q.show || q.before || q.month
          ? emptyState('Nothing here.', buttonLink('showAll', everything, { tone: 'secondary' }))
          : emptyState(o.empty);
  return `${chips}<div data-list="receipts-all" data-total="${o.total}">${list}</div>`;
}

// The search field at the top of Home. It keeps the folder; a new search starts on the first page.
export function searchForm(q: ArchiveQuery, savable: boolean): string {
  const keep = (name: string, value: string | null) =>
    value ? `<input type="hidden" name="${name}" value="${escape(value)}">` : '';
  const base = { in: folderParam(q.folder), month: q.month, show: q.show };
  return `<form class="find hfind" method="get" action="/" role="search">${keep('in', base.in)}${keep('month', base.month)}${keep('show', base.show)}<label class="vh" for="q">Search every document</label><input id="q" name="q" type="search" value="${escape(q.q)}" placeholder="Seller, amount, date or any word" maxlength="100" autocomplete="off">${button('search')}${q.q ? buttonLink('clearSearch', homeUrl({ ...base, q: '' }), { tone: 'ghost', label: 'Clear' }) : ''}</form>${
    savable
      ? `<details class="savesearch"><summary>${icon('bookmark-plus')}<span>Save search</span></summary><div class="body"><form method="post" action="/searches">${keep('query', homeUrl({ ...base, q: q.q }))}<label>Name<input name="name" required maxlength="60" value="${escape(q.q || folderName(q.folder))}"></label>${button('saveSearch', { tone: 'secondary', label: 'Save' })}</form></div></details>`
      : ''
  }`;
}

// ---------- Overview ----------

export type Overview = {
  months: { m: string; eur: number; n: number }[];
  n: number;
  eur: number;
  other: number;
  missing: number | null;
};
// A folder header's numbers: the euro total by month, how many files, and for a year the bank
// payments still waiting on a receipt. Only receipts that count (not discarded or duplicates).
const EUR = "coalesce(eur_override_minor,CASE WHEN currency='EUR' THEN total_minor END,fx_eur_minor)";
export async function overviewData(env: Env, f: Folder): Promise<Overview | null> {
  if (f.type !== 'year' && f.type !== 'vendor' && f.type !== 'client') return null;
  const [filter, bind] =
    f.type === 'year'
      ? ["kind='expense' AND substr(coalesce(issue_date,received_at),1,4)=?", String(f.year)]
      : f.type === 'vendor'
        ? ["kind='expense' AND vendor=?", f.name]
        : ["kind='sales' AND client=?", f.name];
  const [months, missing] = await Promise.all([
    env.DB.prepare(
      `SELECT substr(coalesce(issue_date,received_at),1,7) m,coalesce(sum(${EUR}),0) eur,count(*) n,coalesce(sum(${EUR} IS NULL),0) other FROM receipts WHERE ${filter} AND duplicate_of IS NULL AND discarded_at IS NULL GROUP BY m ORDER BY m`,
    )
      .bind(bind)
      .all<{ m: string; eur: number; n: number; other: number }>(),
    f.type === 'year'
      ? env.DB.prepare(
          'SELECT count(*) n FROM bank_transactions WHERE amount_minor<0 AND receipt_required=1 AND receipt_id IS NULL AND exempt_by IS NULL AND substr(booking_date,1,4)=? AND id NOT IN (SELECT debit_id FROM internal_transfers)',
        )
          .bind(bind)
          .first<number>('n')
      : null,
  ]);
  const rows = months.results;
  return {
    months: rows,
    n: rows.reduce((s, r) => s + r.n, 0),
    eur: rows.reduce((s, r) => s + r.eur, 0),
    other: rows.reduce((s, r) => s + r.other, 0),
    missing: missing ?? null,
  };
}
// The header's bar strip: one labelled bar per month, so nothing rests on the bar's length alone.
// The strip is drawn at its own size (36px a month), so one or two months keep the bar width of
// twelve instead of stretching across the card. Only a narrow screen scales it down.
export function overview(o: Overview, f: Folder): string {
  const year = f.type === 'year' ? f.year : null;
  const span = year
    ? Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
    : o.months.map((m) => m.m).slice(-12);
  const by = new Map(o.months.map((m) => [m.m, m]));
  const top = Math.max(1, ...span.map((m) => by.get(m)?.eur ?? 0));
  const w = 28,
    gap = 8,
    h = 72;
  const bars = span
    .map((m, i) => {
      const v = by.get(m)?.eur ?? 0;
      const bh = v ? Math.max(2, Math.round((v / top) * h)) : 0;
      const x = i * (w + gap);
      return `<rect x="${x}" y="${h - bh + 4}" width="${w}" height="${bh}" rx="3" class="mbar"><title>${escape(monthName(m))}: EUR ${(v / 100).toFixed(2)}</title></rect>`;
    })
    .join('');
  // The month names sit under the bars in a group of their own, never over a bar.
  const labels = span
    .map(
      (m, i) =>
        `<text x="${i * (w + gap) + w / 2}" y="${h + 24}" class="lab">${escape(monthName(m, false).slice(0, 3))}</text>`,
    )
    .join('');
  const width = span.length * (w + gap) - gap;
  const what = f.type === 'client' ? 'Invoiced' : 'Spent';
  return `<section class="overview" aria-label="${escape(folderName(f))} at a glance"><dl class="facts"><div><dt>${what}</dt><dd>EUR ${(o.eur / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd></div><div><dt>Files</dt><dd>${o.n}</dd></div>${o.other ? `<div><dt>Without a euro amount</dt><dd>${o.other}</dd></div>` : ''}${o.missing !== null ? `<div><dt>Payments missing a receipt</dt><dd>${o.missing}</dd></div>` : ''}</dl>${span.length ? `<svg class="bars" viewBox="0 0 ${width} ${h + 30}" width="${width}" height="${h + 30}" role="img" aria-label="${escape(what)} by month"><g>${bars}</g><g>${labels}</g></svg>` : ''}</section>`;
}

// ---------- The preview pane ----------

export type Opened = {
  row: ArchiveRow;
  note: string | null;
  files: { id: string; filename: string }[];
  facts: Record<string, string | number | null>;
  hasPdf: boolean;
};
export async function openedData(env: Env, item: Item | null): Promise<Opened | null> {
  if (!item) return null;
  const key = itemKey(item);
  const [found, mark, files, facts] = await Promise.all([
    env.DB.prepare(`SELECT * FROM (${ARCHIVE_SOURCE}) x WHERE x.item=?`).bind(key).first<ArchiveRow>(),
    env.DB.prepare('SELECT note FROM marks WHERE item=?').bind(key).first<string>('note'),
    item.type === 'receipt'
      ? env.DB.prepare('SELECT id,filename FROM receipts WHERE duplicate_of=? ORDER BY received_at')
          .bind(item.id)
          .all<{ id: string; filename: string }>()
          .then((r) => r.results)
      : [],
    item.type === 'receipt'
      ? env.DB.prepare(
          'SELECT net_minor,vat_minor,vat_rate_bps,due_date,product,expense_type,source,received_at,reference_number,client_vat_id FROM receipts WHERE id=?',
        )
          .bind(item.id)
          .first<Record<string, string | number | null>>()
      : item.type === 'statement'
        ? env.DB.prepare(
            'SELECT min(booking_date) first,max(booking_date) last,count(*) payments FROM bank_transactions WHERE import_id=?',
          )
            .bind(item.id)
            .first<Record<string, string | number | null>>()
        : item.type === 'package'
          ? env.DB.prepare('SELECT file_count,method FROM month_sends WHERE month=? AND sent_at=?')
              .bind(item.month, item.sentAt)
              .first<Record<string, string | number | null>>()
          : null,
  ]);
  if (!found) return null;
  const hasPdf = item.type === 'statement' ? !!(await env.ORIGINALS.head(`statements/${item.id}.pdf`)) : false;
  return { row: found, note: mark ?? null, files, facts: facts ?? {}, hasPdf };
}

const money = (minor: number | null, currency: string | null) => (minor === null ? '' : amount(minor, currency));
export function pane(o: Opened, q: ArchiveQuery, tagSuggestions: string[]): string {
  const r = o.row;
  const item = parseItem(r.item)!;
  const kind = KINDS[kindOf(r)];
  const name = rowName(r);
  const state = stateOf(q);
  const here = homeUrl({
    in: folderParam(q.folder),
    month: q.month,
    show: q.show,
    q: q.q,
    before: cursorParam(q.before),
    open: r.item,
  });
  const close =
    homeUrl({ in: folderParam(q.folder), month: q.month, show: q.show, q: q.q, before: cursorParam(q.before) }) +
    `#row-${rowKey(r)}`;
  const chip = chipOf(r);
  const rowsOf = (pairs: [string, string][]) =>
    pairs
      .filter(([, v]) => v)
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
      .join('');
  const f = o.facts;
  const facts =
    item.type === 'receipt'
      ? rowsOf([
          [r.kind === 'sales' ? 'Client' : 'Seller', escape(r.kind === 'sales' ? (r.client ?? '') : (r.vendor ?? ''))],
          ['Date', r.issue_date ? escape(day(r.issue_date)) : 'Undated'],
          ['Total', money(r.total_minor, r.currency)],
          ['Before VAT', money(f.net_minor as number | null, r.currency)],
          ['VAT', money(f.vat_minor as number | null, r.currency)],
          ['Number', escape(r.invoice_number ?? '')],
          ['Due', f.due_date ? escape(day(String(f.due_date))) : ''],
          ['Part', escape(f.product ?? '')],
          ['Kind', escape(f.expense_type ?? '')],
          ['Arrived', `${escape(day(String(f.received_at ?? r.at)))} by ${f.source === 'email' ? 'email' : 'upload'}`],
        ])
      : item.type === 'statement'
        ? rowsOf([
            ['Account', escape(r.vendor ?? '')],
            ['Bank', escape(r.client ?? '')],
            ['Payments', escape(f.payments ?? '')],
            ['From', f.first ? escape(day(String(f.first))) : ''],
            ['To', f.last ? escape(day(String(f.last))) : ''],
            ['Imported', escape(day(r.at))],
          ])
        : item.type === 'package'
          ? rowsOf([
              ['Month', escape(monthName(r.id))],
              ['Sent', `${escape(day(r.at))}${f.method === 'onedrive' ? ' via OneDrive' : ''}`],
              ['Files', escape(f.file_count ?? '')],
              ['Total', money(r.total_minor, 'EUR')],
            ])
          : rowsOf([
              ['Date', r.issue_date ? escape(day(r.issue_date)) : ''],
              ['File', escape(r.filename ?? '')],
              ['Added', escape(day(r.at))],
            ]);
  const media = r.media_type ?? '';
  const doc =
    item.type === 'receipt' || item.type === 'document'
      ? media === 'application/pdf' || ['image/png', 'image/jpeg', 'image/webp'].includes(media)
        ? viewer(
            { id: r.id, media_type: media, filename: r.filename },
            media === 'application/pdf'
              ? '<p class="small">Open it to read the PDF.</p>'
              : `<img src="${escape(item.type === 'receipt' ? `/originals/${r.id}?view=inline` : `/files/${encodeURIComponent(r.item)}/original?view=inline`)}" alt="The original ${escape(r.filename ?? '')}">`,
            {
              compact: true,
              label: name,
              raw: item.type === 'document' ? `/files/${encodeURIComponent(r.item)}/original?view=raw` : undefined,
            },
          )
        : `<p class="small">This file shows as text on its page.</p>`
      : '';
  const tags = tagsOf(r);
  const formItem = `<input type="hidden" name="item" value="${escape(r.item)}"><input type="hidden" name="back" value="${escape(here)}">`;
  const tagList = `<ul class="tags" aria-label="Tags">${tags
    .map(
      (t) =>
        `<li><a class="tagchip" href="${escape(homeUrl({ in: `tag:${t}` }))}">#${escape(t)}</a><form method="post" action="/marks/untag">${formItem}<input type="hidden" name="tag" value="${escape(t)}"><button class="x" aria-label="Remove tag ${escape(t)}" title="Remove">${icon('x')}</button></form></li>`,
    )
    .join('')}</ul>`;
  const listId = `tags-${r.item.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`;
  const tagForm = `<form class="tagform" method="post" action="/marks/tag">${formItem}<label for="${listId}-f">Add a tag</label><input id="${listId}-f" name="tag" list="${listId}" maxlength="40" required><datalist id="${listId}">${tagSuggestions
    .filter((t) => !tags.includes(t))
    .map((t) => `<option value="${escape(t)}">`)
    .join('')}</datalist>${button('tag', { label: 'Add' })}</form>`;
  const star = `<form method="post" action="/marks/star">${formItem}<input type="hidden" name="on" value="${r.starred_at ? '0' : '1'}">${button(r.starred_at ? 'unstar' : 'star')}</form>`;
  const note = `<details class="note"${o.note ? ' open' : ''}><summary>Note</summary><div class="body"><form method="post" action="/marks/note">${formItem}<label class="vh" for="note-${listId}">Note</label><textarea id="note-${listId}" name="note" rows="3" maxlength="2000">${escape(o.note ?? '')}</textarea>${button('note')}</form></div></details>`;
  const open =
    item.type === 'receipt'
      ? buttonLink('open', itemPath(item, state))
      : item.type === 'mail'
        ? ''
        : buttonLink('open', itemPath(item));
  const download =
    item.type === 'receipt' || item.type === 'document'
      ? buttonLink(
          'original',
          item.type === 'receipt' ? `/originals/${r.id}` : `/files/${encodeURIComponent(r.item)}/original`,
          { tone: 'ghost', label: 'Download', attrs: ' download' },
        )
      : item.type === 'package'
        ? buttonLink('zip', `/files/${encodeURIComponent(r.item)}/package.zip`, { tone: 'ghost', attrs: ' download' })
        : item.type === 'statement'
          ? buttonLink('original', `/files/${encodeURIComponent(r.item)}/original`, {
              tone: 'ghost',
              label: o.hasPdf ? 'Download PDF' : 'Download CSV',
              attrs: ' download',
            })
          : '';
  const files = o.files.length
    ? `<p class="small">Also: ${o.files.map((x) => `<a href="/originals/${escape(x.id)}">${escape(x.filename)}</a>`).join(' · ')}</p>`
    : '';
  return `<aside class="pane" id="preview" aria-label="Preview of ${escape(name)}"><div class="slip"><div class="pcrumbs"><a href="${escape(close)}">‹ Back to the list</a></div><p class="pkind">${icon(kind.icon)}<span>${escape(kind.label)}</span></p><h2>${escape(name)}</h2><div class="ptop">${r.total_minor === null ? '' : `<span class="amt">${money(r.total_minor, r.currency)}</span>`}${chip ? statusMark(chip.key, { after: chip.after ? escape(chip.after) : undefined }) : ''}</div><div class="btns">${open}${download}${item.type === 'mail' ? '' : star}</div>${doc}<dl class="ledger">${facts}</dl>${files}${item.type === 'mail' ? '' : `${tagList}${tagForm}${note}`}</div></aside>`;
}
