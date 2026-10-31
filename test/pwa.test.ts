import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/env';
import { ICON_SOURCE_HASH } from '../src/app-icons';
import { ICON_SOURCES } from '../src/icon';
import { authorization, pdfBytes, request } from './helpers';

const based = { ...env, APP_BASE_PATH: '/app' } as Env;
const anonymous = (path: string, init: RequestInit = {}, deploy: Env = env as Env) =>
  worker.fetch(new Request('http://localhost' + path, init), deploy);
const at = (path: string, init: RequestInit = {}) =>
  worker.fetch(
    new Request('http://localhost' + path, {
      ...init,
      headers: { Authorization: authorization, Origin: 'http://localhost', ...init.headers },
    }),
    based,
  );

test('the install icons are the ones rendered from the current glyph (run `bun run icons`)', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(ICON_SOURCES));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  expect(hex).toBe(ICON_SOURCE_HASH);
});

test('the icons and favicon answer without sign-in; everything else does not', async () => {
  const open = [
    '/favicon.svg',
    '/apple-touch-icon.png',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/icon-maskable-512.png',
  ];
  for (const path of open) {
    const response = await anonymous(path);
    expect(response.status, path).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400');
  }
  const png = new Uint8Array(await (await anonymous('/apple-touch-icon.png')).arrayBuffer());
  expect([...png.slice(1, 4)]).toEqual([80, 78, 71]);
  for (const path of ['/sw.js', '/assets/app.js', '/', '/add', '/icons/icon-1024.png', '/manifest.json'])
    expect((await anonymous(path)).status, path).toBe(401);
});

test('the manifest answers without sign-in, holds no data, and keeps the base path', async () => {
  const plain = await anonymous('/manifest.webmanifest');
  expect(plain.status).toBe(200);
  expect(plain.headers.get('Content-Type')).toBe('application/manifest+json');
  const m = (await (await anonymous('/app/manifest.webmanifest', {}, based)).json()) as Record<string, any>;
  expect(Object.keys(m).sort()).toEqual(
    [
      'background_color',
      'display',
      'icons',
      'id',
      'name',
      'scope',
      'share_target',
      'short_name',
      'shortcuts',
      'start_url',
      'theme_color',
    ].sort(),
  );
  expect([m.start_url, m.scope, m.display]).toEqual(['/app/', '/app/', 'standalone']);
  for (const icon of m.icons as { src: string }[]) {
    const response = await anonymous(icon.src, {}, based);
    expect(response.status, icon.src).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
  }
  expect(m.icons.map((i: { purpose: string }) => i.purpose)).toEqual(['any', 'any', 'maskable']);
  for (const method of ['POST', 'PUT'])
    expect((await anonymous('/manifest.webmanifest', { method }, based)).status, method).not.toBe(200);
});

test('the manifest names the app and keeps every URL under the base path', async () => {
  const root = await request('/manifest.webmanifest');
  expect(root.headers.get('Content-Type')).toBe('application/manifest+json');
  expect(root.headers.get('Cache-Control')).toBe('no-cache');
  const plain = (await root.json()) as Record<string, any>;
  expect(plain).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone', name: 'Nuits Receipts' });
  expect(plain.share_target.action).toBe('/share');

  const m = (await (await at('/app/manifest.webmanifest')).json()) as Record<string, any>;
  expect([m.id, m.start_url, m.scope]).toEqual(['/app/', '/app/', '/app/']);
  expect(m.icons.map((i: { src: string }) => i.src)).toEqual([
    '/app/icons/icon-192.png',
    '/app/icons/icon-512.png',
    '/app/icons/icon-maskable-512.png',
  ]);
  expect(m.shortcuts[0].url).toBe('/app/add');
  expect(m.share_target).toMatchObject({
    action: '/app/share',
    method: 'POST',
    enctype: 'multipart/form-data',
    params: { files: [{ name: 'files', accept: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] }] },
  });
  expect(m.short_name).toBe('Nuits Receipts');
  expect(m.name).toBe('Nuits Receipts');
  expect(m.short_name.length).toBeLessThanOrEqual(16);
});

test('pages link the manifest, touch icon and worker script, under the base path too', async () => {
  const html = await (await request('/')).text();
  expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">');
  expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
  expect(html).toContain('<meta name="theme-color" content="#F3EDE2">');
  expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Nuits Receipts">');
  expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes">');
  expect(html).toContain('<meta name="mobile-web-app-capable" content="yes">');
  expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="default">');
  expect(html).toContain('<script src="/assets/app.js" defer></script>');

  const prefixed = await (await at('/app/')).text();
  for (const tag of [
    '<link rel="manifest" href="/app/manifest.webmanifest" crossorigin="use-credentials">',
    '<link rel="apple-touch-icon" href="/app/apple-touch-icon.png">',
    '<link rel="icon" href="/app/favicon.svg" type="image/svg+xml">',
    '<script src="/app/assets/app.js" defer></script>',
  ])
    expect(prefixed).toContain(tag);
});

test('the service worker script is no-cache and registers at the default scope', async () => {
  const sw = await request('/sw.js');
  expect(sw.headers.get('Cache-Control')).toBe('no-cache');
  expect(sw.headers.get('Content-Type')).toContain('text/javascript');
  const code = await sw.text();
  expect(code).toContain('skipWaiting');
  expect(code).toContain('clients.claim');
  expect(code).toContain("request.mode === 'navigate' && !self.navigator.onLine");
  const app = await (await request('/assets/app.js')).text();
  expect(app).toContain("new URL('../sw.js', document.currentScript.src)");
  expect(app).not.toContain('scope');
});

test('a share POST that reaches the Worker goes to Add and stores nothing', async () => {
  const before = await env.DB.prepare('SELECT count(*) n FROM receipts').first<number>('n');
  const listed = (await env.ORIGINALS.list()).objects.length;
  const share = (path: string, headers: Record<string, string>, deploy: Env) => {
    const form = new FormData();
    form.set('files', new File([pdfBytes()], 'shared.pdf', { type: 'application/pdf' }));
    return worker.fetch(
      new Request('http://localhost' + path, {
        method: 'POST',
        body: form,
        headers: { Authorization: authorization, ...headers },
      }),
      deploy,
    );
  };
  for (const headers of [{} as Record<string, string>, { Origin: 'https://evil.example' }]) {
    const response = await share('/share', headers, env as Env);
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/add');
    const prefixed = await share('/app/share', headers, based);
    expect(prefixed.status).toBe(303);
    expect(prefixed.headers.get('Location')).toBe('/app/add');
  }
  expect((await anonymous('/share', { method: 'POST' })).status).toBe(401);
  expect(await env.DB.prepare('SELECT count(*) n FROM receipts').first<number>('n')).toBe(before);
  expect((await env.ORIGINALS.list()).objects.length).toBe(listed);
});

test('Add renders as usual when files were shared, and never submits by itself', async () => {
  const html = await (await request('/add?shared=1')).text();
  expect(html).toContain('id="add-status"');
  expect(html).toContain('<input required name="file" type="file" multiple');
  const script = await (await request('/assets/add.js')).text();
  expect(script).toContain("caches.open('nuits-share')");
  expect(script).toContain('ready. Choose what they are, then press Upload.');
  expect(script).not.toContain('press Add');
});
