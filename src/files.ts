// The archive's files that are not receipts: other documents, bank statements and the month
// packages that were sent, each with a page at /files/<item key> and its download. Also the ZIP of
// a Home folder, the snapshot a sent package keeps, and the quick-find lookup.
import Papa from 'papaparse';
import { makeZip } from 'client-zip';
import type { Env } from './env';
import { hash, requireInput } from './domain';
import { withDone } from './events';
import { button, buttonLink } from './actions';
import { detect, documentText, preserveDocument } from './receipts';
import {
  ARCHIVE_SOURCE,
  archiveQuery,
  archiveWhere,
  itemKey,
  KINDS,
  parseItem,
  rowKey,
  rowName,
  type ArchiveRow,
  type Item,
} from './archive';
import { fileName, packageTexts, planPackage } from './package';
import { searchText } from './search';
import { viewer, VIEWER_CSS, VIEWER_SCRIPT } from './viewer';
import { day, escape, monthName, page, pageHead, plural, VIEW_TRANSITION_CSS } from './ui';
import { fileResponse } from './serve';
import { recordView } from './marks';

export const MAX_FOLDER_FILES = 900;

// ---------- Other documents ----------

// A document that is not a receipt: stored and dated, its words indexed, never matched or counted.
export async function addDocument(env: Env, form: FormData): Promise<string> {
  const file = form.get('file');
  requireInput(file instanceof File && file.size > 0, 'Choose a file', 400, 'file');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const media = detect(bytes);
  const title =
    String(form.get('title') ?? '')
      .trim()
      .slice(0, 200) || file.name.replace(/\.[a-z0-9]{2,5}$/i, '');
  const date = String(form.get('doc_date') ?? '').trim();
  requireInput(!date || /^\d{4}-\d{2}-\d{2}$/.test(date), 'Choose a date like 2026-10-31', 400, 'doc_date');
  let words = '';
  try {
    words = await documentText(bytes, media);
  } catch {
    // A scan without a text layer is still kept; it is found by its title.
  }
  const id = await preserveDocument(env, {
    bytes,
    media,
    filename: file.name,
    title,
    date: date || null,
    words: searchText(words),
  });
  return withDone('documentAdded', `/files/${encodeURIComponent(`d:${id}`)}`);
}
export async function saveDocument(env: Env, id: string, form: FormData): Promise<string> {
  const title = String(form.get('title') ?? '')
    .trim()
    .slice(0, 200);
  const date = String(form.get('doc_date') ?? '').trim();
  requireInput(title, 'Give it a title', 400, 'title');
  requireInput(!date || /^\d{4}-\d{2}-\d{2}$/.test(date), 'Choose a date like 2026-10-31', 400, 'doc_date');
  const changed = await env.DB.prepare('UPDATE documents SET title=?,doc_date=? WHERE id=?')
    .bind(title, date || null, id)
    .run();
  requireInput(changed.meta.changes, 'Document not found', 404);
  return withDone('saved', `/files/${encodeURIComponent(`d:${id}`)}`);
}

// ---------- Statements ----------

// A PDF statement is read into a CSV, which is what gets imported. The PDF is kept beside it,
// named by the CSV's hash, so the import's file finds it without a column for it.
export function statementPdfKey(csvKey: string): string {
  return csvKey.replace(/(\.[a-z0-9-]+)?\.csv$/, '.pdf');
}
export async function keepStatementPdf(env: Env, pdf: Uint8Array, csv: Uint8Array): Promise<void> {
  await env.ORIGINALS.put(`imports/${await hash(csv)}.pdf`, pdf, { httpMetadata: { contentType: 'application/pdf' } });
}

// ---------- Packages ----------

type Snapshot = {
  folder: string;
  files: { path: string; key: string; at: string }[];
  texts: { name: string; text: string }[];
};
const snapshotKey = (month: string, at: string) => `packages/${month}/${at}.json`;
// What a send carried, kept when it is marked sent: every file's path and original, and the
// index files as written then. The originals never change (they are named by their hash), so the
// ZIP rebuilt from this is the one that was sent.
export async function snapshotPackage(env: Env, month: string, at: string, origin: string): Promise<void> {
  const plan = await planPackage(env, month, { anyway: true, undated: false, changes: false });
  const texts = await packageTexts(env, plan, origin);
  const snapshot: Snapshot = {
    folder: plan.folder,
    files: plan.files.map((f) => ({ path: f.path, key: f.receipt.original_key, at: f.receipt.received_at })),
    texts: texts.map((t) => ({ name: t.name, text: new TextDecoder().decode(t.bytes) })),
  };
  await env.ORIGINALS.put(snapshotKey(month, at), JSON.stringify(snapshot), {
    httpMetadata: { contentType: 'application/json' },
  });
}
async function snapshotOf(env: Env, month: string, at: string): Promise<Snapshot | null> {
  const stored = await env.ORIGINALS.get(snapshotKey(month, at));
  return stored ? ((await stored.json()) as Snapshot) : null;
}
export async function sentPackageZip(env: Env, item: Extract<Item, { type: 'package' }>): Promise<Response> {
  const snap = await snapshotOf(env, item.month, item.sentAt);
  requireInput(snap, 'Package copy missing', 404);
  const now = new Date();
  async function* entries() {
    for (const t of snap!.texts) yield { name: `${snap!.folder}/${t.name}`, input: t.text, lastModified: now };
    for (const f of snap!.files) {
      const object = await env.ORIGINALS.get(f.key);
      if (!object) throw new Error('original_missing');
      yield { name: `${snap!.folder}/${f.path}`, input: object.body, size: object.size, lastModified: new Date(f.at) };
    }
  }
  return new Response(makeZip(entries()), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${snap.folder}-sent-${item.sentAt.slice(0, 10)}.zip"`,
    },
  });
}

// ---------- A Home folder as a ZIP ----------

// Every receipt and document a Home folder and search show, under Year/Month folders with the
// package's file names, and an index of them. Statements, packages and held mail stay out.
export async function folderZip(env: Env, params: URLSearchParams, origin: string): Promise<Response> {
  const q = archiveQuery(params);
  const { where, binds } = archiveWhere(q);
  const rows = (
    await env.DB.prepare(
      `SELECT x.*,r.original_key FROM (${ARCHIVE_SOURCE}) x LEFT JOIN (SELECT id,original_key FROM receipts UNION ALL SELECT id,original_key FROM documents) r ON r.id=x.id WHERE x.type IN ('receipt','document') AND ${where} ORDER BY day DESC,at DESC,item DESC LIMIT ?`,
    )
      .bind(...binds, MAX_FOLDER_FILES + 1)
      .all<ArchiveRow & { original_key: string }>()
  ).results;
  requireInput(rows.length, 'Folder empty', 404);
  requireInput(
    rows.length <= MAX_FOLDER_FILES,
    `This folder has more than ${MAX_FOLDER_FILES} files. Open a year or a month, or narrow the search, then download it.`,
    413,
  );
  const used = new Set<string>();
  const files = rows.map((r) => {
    const base =
      r.type === 'document'
        ? `${r.day}_${(r.vendor ?? 'document').replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 60)}_${r.id.slice(0, 6)}.${r.media_type === 'application/pdf' ? 'pdf' : (r.media_type ?? 'bin').split('/')[1]}`
        : fileName({
            id: r.id,
            issue_date: r.issue_date,
            vendor: r.vendor,
            currency: r.currency,
            total_minor: r.total_minor,
            media_type: r.media_type ?? 'application/pdf',
            kind: r.kind === 'sales' ? 'sales' : 'expense',
            invoice_number: r.invoice_number,
            client: r.client,
          });
    let path = `${r.day.slice(0, 4)}/${r.day.slice(0, 7)}/${base}`;
    for (let n = 2; used.has(path.toLowerCase()); n++) path = path.replace(/(\.[a-z0-9]+)$/i, `-${n}$1`);
    used.add(path.toLowerCase());
    return { row: r, path };
  });
  const index = Papa.unparse({
    fields: ['file', 'kind', 'date', 'name', 'total', 'currency', 'number', 'link'],
    data: files.map(({ row: r, path }) => [
      path,
      KINDS[r.type === 'document' ? 'other' : r.kind === 'sales' ? 'sales' : 'expense'].label,
      r.day,
      rowName(r),
      r.total_minor === null ? '' : (r.total_minor / 100).toFixed(2),
      r.currency ?? '',
      r.invoice_number ?? '',
      `${origin}${r.type === 'receipt' ? `/receipts/${r.id}` : `/files/${encodeURIComponent(r.item)}`}`,
    ]),
  });
  const folder = `archive-${new Date().toISOString().slice(0, 10)}`;
  const now = new Date();
  async function* entries() {
    yield { name: `${folder}/00-index.csv`, input: index, lastModified: now };
    for (const f of files) {
      const object = await env.ORIGINALS.get(f.row.original_key);
      if (!object) continue;
      yield { name: `${folder}/${f.path}`, input: object.body, size: object.size, lastModified: new Date(f.row.at) };
    }
  }
  return new Response(makeZip(entries()), {
    headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${folder}.zip"` },
  });
}

// ---------- Quick find ----------

// The first matches of a search, for the quick-find box: a name, a line under it and where it opens.
export async function quickFind(env: Env, text: string): Promise<Response> {
  const q = archiveQuery(new URLSearchParams({ q: text }));
  const found = q.q
    ? (
        await env.DB.prepare(
          `SELECT * FROM (${ARCHIVE_SOURCE}) x WHERE x.type<>'mail' AND ${archiveWhere(q).where} ORDER BY day DESC,at DESC,item DESC LIMIT 8`,
        )
          .bind(...archiveWhere(q).binds)
          .all<ArchiveRow>()
      ).results
    : [];
  return Response.json(
    found.map((r) => ({
      name: rowName(r),
      line: [
        KINDS[r.type === 'receipt' ? (r.kind === 'sales' ? 'sales' : 'expense') : (r.kind as keyof typeof KINDS)]
          ?.label,
        day(r.day),
        r.total_minor === null ? '' : `${r.currency ?? ''} ${(r.total_minor / 100).toFixed(2)}`,
      ]
        .filter(Boolean)
        .join(' · '),
      href: `/?q=${encodeURIComponent(q.q)}&open=${encodeURIComponent(r.item)}#row-${rowKey(r)}`,
    })),
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

// ---------- A file's own page ----------

function csvTable(text: string, caption: string, limit = 300): string {
  const parsed = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true });
  const [head = [], ...body] = parsed.data;
  const shown = body.slice(0, limit);
  return `<div class="scroll"><table class="csv"><caption>${escape(caption)}</caption><thead><tr>${head.map((h) => `<th scope="col">${escape(h)}</th>`).join('')}</tr></thead><tbody>${shown
    .map((r) => `<tr>${r.map((c) => `<td>${escape(c)}</td>`).join('')}</tr>`)
    .join(
      '',
    )}</tbody></table></div>${body.length > limit ? `<p class="small">The first ${limit} of ${plural(body.length, 'row')}. Download it for the rest.</p>` : ''}`;
}

export async function filePage(env: Env, key: string, ctx?: Pick<ExecutionContext, 'waitUntil'>): Promise<Response> {
  const item = parseItem(key);
  requireInput(item && item.type !== 'mail' && item.type !== 'receipt', 'File not found', 404);
  const found = await env.DB.prepare(`SELECT * FROM (${ARCHIVE_SOURCE}) x WHERE x.item=?`)
    .bind(itemKey(item))
    .first<ArchiveRow & { original_key?: string }>();
  requireInput(found, 'File not found', 404);
  ctx?.waitUntil(recordView(env, item).catch(() => undefined));
  const name = rowName(found);
  const enc = encodeURIComponent(itemKey(item));
  const head = pageHead(escape(name), '', { href: `/?open=${enc}#preview`, label: 'Home' });
  let body = '';
  let style = VIEW_TRANSITION_CSS;
  if (item.type === 'document') {
    const doc = await env.DB.prepare('SELECT * FROM documents WHERE id=?')
      .bind(item.id)
      .first<{ id: string; media_type: string; filename: string; title: string; doc_date: string | null }>();
    requireInput(doc, 'File not found', 404);
    const drawable = doc.media_type === 'application/pdf' || doc.media_type.startsWith('image/');
    const words =
      doc.media_type === 'application/pdf'
        ? ((await env.DB.prepare('SELECT search_text FROM documents WHERE id=?')
            .bind(item.id)
            .first<string>('search_text')) ?? '')
        : '';
    const fallback = doc.media_type.startsWith('image/')
      ? `<img src="/files/${enc}/original?view=inline" alt="${escape(doc.title)}">`
      : words
        ? `<p class="small">As text:</p><pre class="paper" tabindex="0">${escape(words.slice(0, 20000))}</pre>`
        : '';
    const edit = `<form method="post" action="/files/${enc}"><div class="fields"><label>Title<input name="title" required maxlength="200" value="${escape(doc.title)}"></label><label>Date<input name="doc_date" type="date" value="${escape(doc.doc_date ?? '')}"></label></div>${button('save')}</form>`;
    body = `<div class="work"><section class="doc" aria-label="Original"><h2 class="doch">${escape(KINDS.other.label)}</h2>${drawable ? viewer({ id: doc.id, media_type: doc.media_type, filename: doc.filename }, fallback, { raw: `/files/${enc}/original?view=raw` }) : fallback}<p>${buttonLink('original', `/files/${enc}/original`, { label: 'Download', attrs: ' download' })}</p></section><section class="fixes" aria-label="Details"><dl class="ledger"><div><dt>File</dt><dd>${escape(doc.filename)}</dd></div><div><dt>Date</dt><dd>${doc.doc_date ? escape(day(doc.doc_date)) : 'Undated'}</dd></div></dl>${edit}</section></div>${drawable ? VIEWER_SCRIPT : ''}`;
    if (drawable) style += VIEWER_CSS;
  } else if (item.type === 'statement') {
    const csvKey = found.filename ?? '';
    const [csv, pdf] = await Promise.all([env.ORIGINALS.get(csvKey), env.ORIGINALS.head(statementPdfKey(csvKey))]);
    const table = csv ? csvTable(await csv.text(), `Rows of ${name}`) : '<p>The statement file is missing.</p>';
    body = `${pdf ? viewer({ id: item.id, media_type: 'application/pdf' }, '', { label: name, raw: `/files/${enc}/original?view=raw` }) : '<p class="small">Imported before PDFs were kept, or imported as a spreadsheet: this is the CSV it was read into.</p>'}<h2>The rows imported</h2>${table}<p>${buttonLink('original', `/files/${enc}/original`, { label: pdf ? 'Download PDF' : 'Download CSV', attrs: ' download' })}</p>${pdf ? VIEWER_SCRIPT : ''}`;
    if (pdf) style += VIEWER_CSS;
  } else {
    const snap = await snapshotOf(env, item.month, item.sentAt);
    const index = snap?.texts.find((t) => /^00-index/.test(t.name));
    body = snap
      ? `<p>${escape(monthName(item.month))}, sent ${escape(day(item.sentAt))}: ${plural(snap.files.length, 'file')}.</p><div class="btns">${buttonLink('zip', `/files/${enc}/package.zip`, { label: 'Download the ZIP as sent', attrs: ' download' })}</div>${index ? `<h2>The index as sent</h2>${csvTable(index.text, index.name)}` : ''}`
      : `<p>Sent ${escape(day(item.sentAt))}, before copies of packages were kept.</p><div class="btns">${buttonLink('zip', `/month/package.zip?month=${item.month}&anyway=1`, { label: 'Download the month as it is now', attrs: ' download' })}</div>`;
  }
  return page('file', body, 200, env, { detail: name, head, style });
}

export async function fileOriginal(env: Env, request: Request, key: string, view: string | null): Promise<Response> {
  const item = parseItem(key);
  requireInput(item && (item.type === 'document' || item.type === 'statement'), 'File not found', 404);
  if (item.type === 'document') {
    const doc = await env.DB.prepare('SELECT id,original_key,media_type,filename FROM documents WHERE id=?')
      .bind(item.id)
      .first<{ id: string; original_key: string; media_type: string; filename: string }>();
    requireInput(doc, 'File not found', 404);
    const inline = view === 'raw' || view === 'inline';
    requireInput(
      !inline || doc.media_type === 'application/pdf' || doc.media_type.startsWith('image/'),
      'No view for this file type',
      404,
    );
    return fileResponse(request, env, doc.original_key, {
      'Content-Type': doc.media_type,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${doc.filename.replace(/[^\w.-]+/g, '_')}"`,
    });
  }
  const row = await env.DB.prepare('SELECT original_key FROM imports WHERE id=?')
    .bind(item.id)
    .first<string>('original_key');
  requireInput(row, 'File not found', 404);
  const pdfKey = statementPdfKey(row);
  const pdf = await env.ORIGINALS.head(pdfKey);
  requireInput(view !== 'raw' || pdf, 'No PDF for this statement', 404);
  return fileResponse(request, env, pdf ? pdfKey : row, {
    'Content-Type': pdf ? 'application/pdf' : 'text/csv; charset=utf-8',
    'Content-Disposition': `${view === 'raw' ? 'inline' : 'attachment'}; filename="statement-${item.id.slice(0, 8)}.${pdf ? 'pdf' : 'csv'}"`,
  });
}

// The Add page's third choice.
export function documentForm(): string {
  return `<form action="/documents" method="post" enctype="multipart/form-data"><h2>Any other document</h2><p class="small">A contract, a tax return, a letter. It is kept and searchable on Home, and never matched to a payment or put in a month package.</p><div class="fields"><label class="wide">File (PDF or photo)<input type="file" name="file" accept="application/pdf,image/png,image/jpeg,image/webp" required></label><label>Title<input name="title" maxlength="200" placeholder="From the file name"></label><label>Date<input name="doc_date" type="date"></label></div>${button('addDocument')}</form>`;
}
