// Home as the archive: its folder addresses, the redirect from Receipts All, search over a file's
// words, the marks a file carries, other documents, quick find, folder and package downloads.
import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { folderParam, homeUrl, overview, parseFolder, type Folder, type Overview } from '../src/archive';
import { snapshotPackage } from '../src/files';
import { htmlForm, idFrom, locationOf, request, stylesheet, uploadPdf } from './helpers';

const post = (path: string, fields: Record<string, string | File>) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return request(path, { method: 'POST', body });
};
const page = async (path: string) => (await request(path)).text();

test('every folder address reads back as the same folder, and Home links keep one order', () => {
  const folders: Folder[] = [
    { type: 'all' },
    { type: 'year', year: 2026 },
    { type: 'vendor', name: 'Sample Cloud Lantern Oy' },
    { type: 'client', name: 'Example Client Oy' },
    { type: 'kind', kind: 'statement' },
    { type: 'tag', tag: 'travel' },
    { type: 'starred' },
    { type: 'recent' },
  ];
  for (const f of folders) expect(parseFolder(folderParam(f))).toEqual(f);
  expect(parseFolder('year:12')).toEqual({ type: 'all' });
  expect(parseFolder('kind:mail')).toEqual({ type: 'all' });
  expect(homeUrl({ open: 'r:x', q: 'a b', in: 'year:2026', month: '2026-09' })).toBe(
    '/?in=year%3A2026&month=2026-09&q=a+b&open=r%3Ax',
  );
});

test('an old Receipts All address opens the same list on Home', async () => {
  const moved = await request('/receipts?view=all&month=2026-09&show=ready&q=lantern');
  expect(moved.status).toBe(302);
  expect(moved.headers.get('Location')).toBe('/?month=2026-09&show=ready&q=lantern');
  expect((await request('/receipts?view=all&kind=sales')).status).toBe(200);
});

test('search finds a file by a word that is only inside it, and by its amount', async () => {
  const id = idFrom(await uploadPdf());
  await env.DB.prepare("UPDATE receipts SET search_text=search_text||' zebrafinch' WHERE id=?").bind(id).run();
  expect(await page('/?q=zebrafinch')).toContain(`open=r%3A${id}`);
  expect(await page('/?q=zebrafinch+nowhere')).toContain('Nothing matches');
  const { total_minor } = (await env.DB.prepare('SELECT total_minor FROM receipts WHERE id=?')
    .bind(id)
    .first<{ total_minor: number }>())!;
  expect(await page(`/?q=${(total_minor / 100).toFixed(2)}`)).toContain(`open=r%3A${id}`);
});

test('a star, a tag and a note stay with the file, and the star and the tag have Undo', async () => {
  const id = idFrom(await uploadPdf());
  const item = `r:${id}`;
  const back = homeUrl({ open: item });
  const starred = await post('/marks/star', { item, on: '1', back });
  expect(locationOf(starred)).toMatch(/^\/\?open=r%3A[0-9a-f]{64}&done=starred&/);
  expect(await page('/?in=starred')).toContain(`open=r%3A${id}`);
  // Undo is the same switch the other way.
  const said = await page(starred.headers.get('Location')!);
  await request('/marks/star', { method: 'POST', body: htmlForm(said, '/marks/star') });
  expect(await env.DB.prepare('SELECT starred_at FROM marks WHERE item=?').bind(item).first('starred_at')).toBeNull();

  const tagged = await post('/marks/tag', { item, tag: 'Travel', back });
  expect(await page('/?in=tag:travel')).toContain(`open=r%3A${id}`);
  await request('/marks/untag', {
    method: 'POST',
    body: htmlForm(await page(tagged.headers.get('Location')!), '/marks/untag'),
  });
  expect(await env.DB.prepare('SELECT count(*) n FROM tags').first('n')).toBe(0);
  // Spaces in a tag become hyphens; an empty tag is refused.
  await post('/marks/tag', { item, tag: ' Two  Words ', back });
  await post('/marks/tag', { item, tag: '   ', back });
  expect((await env.DB.prepare('SELECT tag FROM tags').all()).results).toEqual([{ tag: 'two-words' }]);

  await post('/marks/note', { item, note: 'Paid from the old card', back });
  expect(await page(back)).toContain('Paid from the old card');
  // Held mail is not a file yet, so it takes no marks.
  await post('/marks/star', { item: 'm:1', on: '1', back });
  expect(await env.DB.prepare("SELECT count(*) n FROM marks WHERE item='m:1'").first('n')).toBe(0);
});

test('another finance document is kept and found, but never counted, matched or packaged', async () => {
  const receipts = await env.DB.prepare('SELECT count(*) n FROM receipts').first('n');
  const added = await post('/documents', {
    file: new File([Uint8Array.from(atob(env.SAMPLE_PDF), (c) => c.charCodeAt(0))], 'lease.pdf', {
      type: 'application/pdf',
    }),
    title: 'Office lease 2026',
    doc_date: '2026-09-15',
  });
  const to = locationOf(added);
  expect(to).toMatch(/^\/files\/d%3A[0-9a-f]{64}\?done=documentAdded/);
  expect(await env.DB.prepare('SELECT count(*) n FROM receipts').first('n')).toBe(receipts);
  const file = await page(to);
  expect(file).toContain('Office lease 2026');
  expect(file).toContain('data-viewer data-type="pdf"');
  expect(await page('/?in=kind:other')).toContain('Office lease 2026');
  expect(await page('/?q=lease')).toContain('Office lease 2026');
  const zip = new TextDecoder().decode(
    await (await request('/month/package.zip?month=2026-09&anyway=1')).arrayBuffer(),
  );
  expect(zip).not.toContain('lease');
});

test('quick find answers with the first matches and where each one opens', async () => {
  const id = idFrom(await uploadPdf());
  const found = await (await request('/search.json?q=lantern')).json<{ name: string; line: string; href: string }[]>();
  expect(found).toHaveLength(1);
  expect(found[0]!.href).toBe(`/?q=lantern&open=r%3A${id}#row-${id}`);
  expect(found[0]!.line).toContain('Receipt');
  expect(await (await request('/search.json?q=')).json()).toEqual([]);
  expect((await request('/search.json?q=lantern')).headers.get('Cache-Control')).toBe('private, no-store');
});

test('a folder downloads as one ZIP with an index, and an empty one says so', async () => {
  await uploadPdf();
  const zip = await request('/files.zip?in=year:2026');
  expect(zip.status).toBe(200);
  expect(zip.headers.get('Content-Type')).toBe('application/zip');
  const text = new TextDecoder().decode(await zip.arrayBuffer());
  expect(text).toContain('00-index.csv');
  expect(text).toMatch(/2026\/2026-09\/2026-09-04_/);
  expect((await request('/files.zip?in=year:2020')).status).toBe(404);
});

test('a sent month is a file: its package as sent, and its ZIP rebuilt from that copy', async () => {
  idFrom(await uploadPdf());
  const at = '2026-10-03T09:00:00.000Z';
  await env.DB.prepare(
    "INSERT INTO month_sends(month,sent_at,method,file_count,total_minor,receipts_hash,receipts_json) VALUES ('2026-09',?,'download',1,12550,'h','[]')",
  )
    .bind(at)
    .run();
  const key = encodeURIComponent(`p:2026-09@${at}`);
  expect(await page('/?in=kind:package')).toContain('September 2026');
  // Before a copy was kept the page offers the month again.
  expect(await page(`/files/${key}`)).toContain('month=2026-09');
  expect((await request(`/files/${key}/package.zip`)).status).toBe(404);
  await snapshotPackage(env, '2026-09', at, 'http://localhost');
  expect(await page(`/files/${key}`)).toContain('00-index');
  const zip = await request(`/files/${key}/package.zip`);
  expect(zip.status).toBe(200);
  expect(new TextDecoder().decode(await zip.arrayBuffer())).toContain('.pdf');
});

test('a row opened from an older page keeps that page and lands back on its row', async () => {
  const id = idFrom(await uploadPdf());
  const cursor = `2099-01-01_2099-01-01T00:00:00Z_r:${'f'.repeat(64)}`;
  const list = await page(`/?before=${encodeURIComponent(cursor)}`);
  expect(list).toContain(`open=r%3A${id}#row-${id}`);
  expect(list).toContain(`before=${encodeURIComponent(cursor)}&amp;open=r%3A${id}`);
  const opened = await page(`/?before=${encodeURIComponent(cursor)}&open=r%3A${id}`);
  expect(opened).toContain(`href="/?before=${encodeURIComponent(cursor)}#row-${id}">‹ Back to the list</a>`);
  expect(opened).not.toContain('@view-transition');
});

test('the one Add form keeps another document too, and every page has the same Add', async () => {
  const pdf = () =>
    new File([Uint8Array.from(atob(env.SAMPLE_PDF), (c) => c.charCodeAt(0))], 'lease.pdf', { type: 'application/pdf' });
  const receipts = await env.DB.prepare('SELECT count(*) n FROM receipts').first('n');
  const one = await post('/upload', { kind: 'other', file: pdf() });
  expect(locationOf(one)).toMatch(/^\/files\/d%3A[0-9a-f]{64}\?done=documentAdded/);
  const body = new FormData();
  body.set('kind', 'other');
  body.set('file', pdf());
  const json = await request('/upload', { method: 'POST', body, headers: { Accept: 'application/json' } });
  const [file] = (await json.json<{ files: { href: string }[] }>()).files;
  expect(file!.href).toMatch(/^\/files\/d%3A[0-9a-f]{64}$/);
  expect(await env.DB.prepare('SELECT count(*) n FROM receipts').first('n')).toBe(receipts);
  expect(await page('/?in=kind:other')).toContain('lease');
  for (const path of ['/', '/receipts', '/payments', '/settings'])
    expect(await page(path)).toContain('<a class="navadd" href="/add"');
  expect(await page('/receipts?view=all&kind=sales')).toContain('href="/add?kind=sales" class="tabadd"');
  expect(await page('/add?kind=other')).toContain('value="other" checked');
});

test('a folder chart keeps one bar size whether it has 0, 1, 2 or 12 months', () => {
  const seller: Folder = { type: 'vendor', name: 'Sample Cloud Lantern Oy' };
  const data = (eur: number[]): Overview => ({
    months: eur.map((v, i) => ({ m: `2026-${String(i + 1).padStart(2, '0')}`, eur: v, n: 1 })),
    n: eur.length,
    eur: eur.reduce((a, b) => a + b, 0),
    other: 0,
    missing: null,
  });
  const svg = (html: string) => html.match(/<svg class="bars"[^>]*>/)?.[0] ?? null;
  const bars = (html: string) => [...html.matchAll(/<rect x="(\d+)" y="[\d.]+" width="(\d+)" height="(\d+)"/g)];

  for (const values of [[], [12000], [12000, 6000], Array.from({ length: 12 }, (_, i) => (i + 1) * 1000)]) {
    const html = overview(data(values), seller);
    expect(svg(html)).toContain('viewBox="0 0 424 102" width="424" height="102"');
    const drawn = bars(html);
    expect(drawn).toHaveLength(12);
    expect(drawn.every((b) => b[2] === '28')).toBe(true);
    if (values.length) expect(Math.max(...drawn.map((b) => Number(b[3])))).toBe(72);
  }
  const oneMonth = overview(data([12000]), seller);
  expect(oneMonth).toContain('February 2025: EUR 0.00');
  expect(oneMonth).toContain('January 2026: EUR 120.00');
  expect(svg(oneMonth)).toContain('aria-label="Spent by month: January 2026 EUR 120.00"');
  expect(
    bars(overview(data([12000, 6000]), seller))
      .slice(-2)
      .map((b) => b[3]),
  ).toEqual(['72', '36']);
});

test('folder headings and navigation identify the open folder', async () => {
  const id = idFrom(await uploadPdf());
  await env.DB.prepare("UPDATE receipts SET vendor='Sample Seller', issue_date='2026-01-15' WHERE id=?").bind(id).run();
  const current = new Date().toISOString().slice(0, 7);
  for (const [folder, label, eyebrow] of [
    ['vendor:Sample Seller', 'Sample Seller', 'SELLER'],
    ['client:Example Client', 'Example Client', 'CLIENT'],
    ['starred', 'Starred', 'STARRED'],
    ['year:2026', '2026', 'YEAR'],
  ]) {
    const html = await page(`/?in=${encodeURIComponent(folder!)}`);
    expect(html).toContain(`<title>${label} ·`);
    expect(html).toContain(`<p class="folder-eyebrow">${eyebrow}</p><h1>${label}</h1>`);
    expect(html).not.toContain(`<div class="lhead"><h2>${label}</h2>`);
    if (folder === 'vendor:Sample Seller') {
      const chart = html.match(/<svg class="bars"[\s\S]*?<\/svg>/)?.[0] ?? '';
      expect(chart.match(/<rect /g)).toHaveLength(12);
      expect(chart).toContain('January 2026');
    }
    if (folder === 'year:2026') {
      expect(html).toContain('<details class="monthfold">');
      expect(html).toContain('href="/?in=year%3A2025"');
      expect(html).toContain('href="/?in=year%3A2027"');
    } else {
      expect(html).not.toContain('class="monthfold"');
      expect(html).toContain(`class="folder-back" href="/?month=${current}"`);
      expect(await stylesheet(html)).toContain('.months a.folder-back{font-family:var(--font-ui)}');
    }
  }
  expect(await page('/?q=sample')).toContain('<details class="monthfold">');
});
