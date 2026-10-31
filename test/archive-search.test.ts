import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { parseQuery, searchText } from '../src/search';
import { indexOlder, unindexedCount } from '../src/receipts';
import { request, uploadPdf, idFrom } from './helpers';

test('a query reads amounts, ranges, dates, kinds and tags out of the words', () => {
  expect(parseQuery('Hetzner 42,50')).toMatchObject({ words: ['hetzner'], amount: { min: 4250, max: 4250 } });
  expect(parseQuery('€42').amount).toEqual({ min: 4200, max: 4200 });
  expect(parseQuery('42').words).toEqual(['42']);
  expect(parseQuery('>100').amount).toEqual({ min: 10001, max: Number.MAX_SAFE_INTEGER });
  expect(parseQuery('<=50').amount).toEqual({ min: 0, max: 5000 });
  expect(parseQuery('100-200').amount).toEqual({ min: 10000, max: 20000 });
  expect(parseQuery('march 2026')).toMatchObject({ month: '2026-03', year: null, words: [] });
  expect(parseQuery('mar')).toMatchObject({ month: '03' });
  expect(parseQuery('2026-03').month).toBe('2026-03');
  expect(parseQuery('2025').year).toBe(2025);
  expect(parseQuery('3.4.2026').date).toBe('2026-04-03');
  expect(parseQuery('kind:sales acme')).toMatchObject({ kinds: ['sales'], words: ['acme'] });
  expect(parseQuery('tag:Tax 2026')).toMatchObject({ tags: ['tax'], year: 2026 });
  expect(parseQuery('"sample coffee" roastery').words).toEqual(['sample coffee', 'roastery']);
});

test('search text is the lower case words, one space apart, capped', () => {
  expect(searchText('  Sample\n\nCOFFEE  Roastery ')).toBe('sample coffee roastery');
  expect(searchText('a '.repeat(40_000)).length).toBe(32_000);
});

test('reading a PDF stores its words, and older rows are indexed once', async () => {
  const id = idFrom(await uploadPdf());
  const row = await env.DB.prepare('SELECT search_text FROM receipts WHERE id=?').bind(id).first<string>('search_text');
  expect(row).toMatch(/[a-z]/);
  await env.DB.prepare('UPDATE receipts SET search_text=NULL').run();
  expect(await unindexedCount(env)).toBe(1);
  expect(await indexOlder(env)).toBe(0);
  const again = await env.DB.prepare('SELECT search_text FROM receipts WHERE id=?')
    .bind(id)
    .first<string>('search_text');
  expect(again).toBe(row);
  expect(await indexOlder(env)).toBe(0);
});

test('the original is served whole, by range, and answers a repeat with 304', async () => {
  const id = idFrom(await uploadPdf());
  const whole = await request(`/originals/${id}?view=raw`);
  expect(whole.status).toBe(200);
  expect(whole.headers.get('Content-Disposition')).toMatch(/^inline; filename="[a-f0-9]{64}\.pdf"$/);
  expect(whole.headers.get('Accept-Ranges')).toBe('bytes');
  const size = (await whole.arrayBuffer()).byteLength;
  const part = await request(`/originals/${id}?view=raw`, { headers: { Range: 'bytes=0-99' } });
  expect(part.status).toBe(206);
  expect(part.headers.get('Content-Range')).toBe(`bytes 0-99/${size}`);
  expect((await part.arrayBuffer()).byteLength).toBe(100);
  const etag = whole.headers.get('ETag')!;
  expect((await request(`/originals/${id}?view=raw`, { headers: { 'If-None-Match': etag } })).status).toBe(304);
  expect((await request(`/originals/${id}?variant=email&view=raw`)).status).toBe(404);
});

test('pages may start the viewer worker from this origin, and still frame nothing', async () => {
  const csp = (await request('/help')).headers.get('Content-Security-Policy')!;
  expect(csp).toContain("worker-src 'self'");
  expect(csp).not.toContain('frame-src');
});
