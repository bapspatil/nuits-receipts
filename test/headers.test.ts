import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import worker from '../src/index';
import { request } from './helpers';

test('security headers are set on authenticated and unauthenticated responses', async () => {
  const responses = [await request('/'), await worker.fetch(new Request('http://localhost/'), env)];
  expect(responses.map((r) => r.status)).toEqual([200, 401]);
  for (const response of responses) {
    expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(response.headers.get('Referrer-Policy')).toBe('same-origin');
  }
});

test('only app pages may load same-origin fonts, images and scripts; other responses keep the original policy', async () => {
  const html = await request('/');
  expect(html.headers.get('Content-Type')).toContain('text/html');
  expect(html.headers.get('Content-Security-Policy')).toBe(
    "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; manifest-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  expect(html.headers.get('Cache-Control')).toBe('private, no-store');
  const original =
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
  for (const response of [
    await request('/export.csv?month=2026-09'),
    await request('/assets/fonts/bricolage.woff2'),
    await worker.fetch(new Request('http://localhost/'), env),
  ])
    expect(response.headers.get('Content-Security-Policy')).toBe(original);
});
