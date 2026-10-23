import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import worker, { withBase } from '../src/index';
import { parseConfig } from '../src/config';
import type { Env } from '../src/env';
import { authorization, pdfBytes } from './helpers';

const based = { ...env, APP_BASE_PATH: '/app' } as Env;
function at(path: string, init: RequestInit = {}, headers: Record<string, string> = {}) {
  return worker.fetch(
    new Request('http://localhost' + path, {
      ...init,
      headers: { Authorization: authorization, Origin: 'http://localhost', ...headers },
    }),
    based,
  );
}
async function upload() {
  const form = new FormData();
  form.set('file', new File([pdfBytes()], 'sample.pdf', { type: 'application/pdf' }));
  return at('/app/upload', { method: 'POST', body: form });
}

test('APP_BASE_PATH defaults to the root and rejects odd values', () => {
  expect(parseConfig({}).basePath).toBe('');
  expect(parseConfig({ APP_BASE_PATH: '/app/' }).basePath).toBe('/app');
  expect(parseConfig({ APP_BASE_PATH: '/tools/receipts' }).basePath).toBe('/tools/receipts');
  for (const bad of ['app', '/a b', '//evil.example', '/app?x', '/../x/'.replace(/\/$/, 'é')])
    expect(() => parseConfig({ APP_BASE_PATH: bad })).toThrow(/APP_BASE_PATH/);
  expect(withBase('/payments', '/app')).toBe('/app/payments');
  expect(withBase('//evil.example/', '/app')).toBe('//evil.example/');
  expect(withBase('https://github.com/x', '/app')).toBe('https://github.com/x');
  expect(withBase('/x', '')).toBe('/x');
});

test('only paths under the base path reach the app', async () => {
  expect((await at('/app')).status).toBe(200);
  expect((await at('/app/')).status).toBe(200);
  expect((await at('/app/payments')).status).toBe(200);
  for (const path of ['/', '/payments', '/apple', '/privacy/']) {
    const response = await at(path);
    expect(response.status).toBe(404);
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
  }
  const anonymous = await worker.fetch(new Request('http://localhost/app'), based);
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers.get('WWW-Authenticate')).toContain('Basic');
});

test('links, form actions and redirects carry the base path', async () => {
  const html = await (await at('/app/payments?month=2026-09')).text();
  const targets = [...html.matchAll(/\b(?:href|action|formaction|src)="(\/[^"]*)"/g)].map((m) => m[1]!);
  expect(targets.length).toBeGreaterThan(3);
  for (const target of targets) expect(target.startsWith('/app/')).toBe(true);
  const uploaded = await upload();
  expect(uploaded.status).toBe(303);
  const location = uploaded.headers.get('Location')!;
  expect(location).toMatch(/^\/app\/receipts\/[a-f0-9]{64}$/);
  const receipt = await (await at(location)).text();
  expect(receipt).toMatch(/href="\/app\/originals\/[a-f0-9]{64}"/);
  expect(receipt).toMatch(/action="\/app\/receipts\/[a-f0-9]{64}\/retry"/);
  expect((await at(location.replace('/receipts/', '/originals/'))).status).toBe(200);
});

test('cross-origin posts are refused under the base path', async () => {
  const form = new FormData();
  form.set('label', 'x');
  const response = await at('/app/accounts', { method: 'POST', body: form }, { Origin: 'https://evil.example' });
  expect(response.status).toBe(403);
});

test('export links point at the base path', async () => {
  await upload();
  const month = String(await env.DB.prepare('SELECT substr(received_at,1,7) m FROM receipts').first('m'));
  const issue = await env.DB.prepare('SELECT issue_date FROM receipts').first<string>('issue_date');
  const csv = await (await at(`/app/export.csv?month=${(issue ?? month).slice(0, 7)}`)).text();
  expect(csv).toContain('http://localhost/app/originals/');
  expect(csv).not.toMatch(/http:\/\/localhost\/originals\//);
});
