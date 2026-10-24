import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import worker from '../src/index';
import { resetAccessCertCache, verifyAccessJwt } from '../src/access';
import { parseConfig } from '../src/config';
import type { Env } from '../src/env';
import { authorization, request } from './helpers';

// Synthetic team and audience only.
const TEAM = 'https://example-team.cloudflareaccess.com';
const AUD = 'a'.repeat(64);
const access = { teamDomain: TEAM, aud: AUD, emails: new Set(['owner@example.com']) };
const accessEnv = {
  ...env,
  APP_BASE_PATH: '/app',
  ACCESS_TEAM_DOMAIN: 'example-team.cloudflareaccess.com',
  ACCESS_AUD: AUD,
  ACCESS_ALLOWED_EMAILS: 'owner@example.com',
} as Env;

let signing: CryptoKeyPair, other: CryptoKeyPair, jwk: JsonWebKey;
const generate = () =>
  crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  ) as Promise<CryptoKeyPair>;
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const part = (value: object) => b64url(new TextEncoder().encode(JSON.stringify(value)));
async function token(claims: Record<string, unknown> = {}, opts: { key?: CryptoKey; kid?: string; alg?: string } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${part({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'test-kid', typ: 'JWT' })}.${part({
    aud: [AUD],
    email: 'owner@example.com',
    iss: TEAM,
    iat: now,
    nbf: now,
    exp: now + 600,
    type: 'app',
    ...claims,
  })}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    opts.key ?? signing.privateKey,
    new TextEncoder().encode(body),
  );
  return `${body}.${b64url(new Uint8Array(signature))}`;
}

beforeAll(async () => {
  signing = await generate();
  other = await generate();
  jwk = (await crypto.subtle.exportKey('jwk', signing.publicKey)) as JsonWebKey;
});
let certFetches: string[] = [];
beforeEach(() => {
  resetAccessCertCache();
  certFetches = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    certFetches.push(url);
    if (url !== `${TEAM}/cdn-cgi/access/certs`) return new Response('unexpected', { status: 500 });
    return Response.json({ keys: [{ ...jwk, kid: 'test-kid', alg: 'RS256', use: 'sig' }] });
  });
});
afterEach(() => vi.restoreAllMocks());

function at(path: string, headers: Record<string, string> = {}, init: RequestInit = {}) {
  return worker.fetch(
    new Request('https://receipts.example.com' + path, {
      ...init,
      headers: { Origin: 'https://receipts.example.com', ...headers },
    }),
    accessEnv,
  );
}

test('Access vars are off by default and must be set together', () => {
  expect(parseConfig({}).access).toBeNull();
  const parsed = parseConfig({
    ACCESS_TEAM_DOMAIN: 'https://Example-Team.cloudflareaccess.com/',
    ACCESS_AUD: AUD,
    ACCESS_ALLOWED_EMAILS: 'Owner@Example.com',
  }).access;
  expect(parsed?.teamDomain).toBe(TEAM);
  expect([...(parsed?.emails ?? [])]).toEqual(['owner@example.com']);
  for (const partial of [
    { ACCESS_TEAM_DOMAIN: 'example-team.cloudflareaccess.com' },
    { ACCESS_AUD: AUD },
    { ACCESS_ALLOWED_EMAILS: 'owner@example.com' },
    { ACCESS_TEAM_DOMAIN: 'example-team.cloudflareaccess.com', ACCESS_AUD: AUD },
  ])
    expect(() => parseConfig(partial)).toThrow(/set together/);
  const base = {
    ACCESS_TEAM_DOMAIN: 'example-team.cloudflareaccess.com',
    ACCESS_AUD: AUD,
    ACCESS_ALLOWED_EMAILS: 'owner@example.com',
  };
  expect(() => parseConfig({ ...base, ACCESS_TEAM_DOMAIN: 'http://evil.example/x' })).toThrow(/ACCESS_TEAM_DOMAIN/);
  expect(() => parseConfig({ ...base, ACCESS_AUD: 'short' })).toThrow(/ACCESS_AUD/);
  expect(() => parseConfig({ ...base, ACCESS_ALLOWED_EMAILS: 'not-an-email' })).toThrow(/ACCESS_ALLOWED_EMAILS/);
});

test('a valid token for an allowed email is accepted', async () => {
  expect(await verifyAccessJwt(await token(), access)).toBe('owner@example.com');
  expect(await verifyAccessJwt(await token({ aud: AUD, email: 'OWNER@example.com' }), access)).toBe(
    'owner@example.com',
  );
});

test('invalid tokens are rejected', async () => {
  const now = Math.floor(Date.now() / 1000);
  const good = await token();
  const [h, p] = good.split('.');
  const cases = [
    null,
    '',
    'not-a-jwt',
    `${h}.${p}.`,
    `${h}.${part({ ...JSON.parse(atob(p!.replace(/-/g, '+').replace(/_/g, '/'))), email: 'attacker@example.com' })}.${good.split('.')[2]}`,
    await token({}, { key: other.privateKey }),
    await token({}, { kid: 'unknown-kid' }),
    await token({}, { alg: 'HS256' }),
    await token({ aud: ['b'.repeat(64)] }),
    await token({ iss: 'https://other-team.cloudflareaccess.com' }),
    await token({ exp: now - 3600 }),
    await token({ exp: undefined }),
    await token({ nbf: now + 3600 }),
    await token({ email: 'someone-else@example.com' }),
    await token({ email: undefined }),
  ];
  for (const candidate of cases) expect(await verifyAccessJwt(candidate, access)).toBeNull();
});

test('signing keys are cached and refetched for an unknown key id', async () => {
  await verifyAccessJwt(await token(), access);
  await verifyAccessJwt(await token(), access);
  expect(certFetches).toHaveLength(1);
  await verifyAccessJwt(await token({}, { kid: 'rotated' }), access);
  expect(certFetches).toHaveLength(2);
});

test('a failed certs fetch fails closed', async () => {
  vi.mocked(fetch).mockImplementation(async () => new Response('down', { status: 503 }));
  expect(await verifyAccessJwt(await token(), access)).toBeNull();
});

test('in Access mode the app needs a valid Access token and ignores the password', async () => {
  const ok = await at('/app/', { 'Cf-Access-Jwt-Assertion': await token() });
  expect(ok.status).toBe(200);
  const html = await ok.text();
  expect(html).toContain('href="/cdn-cgi/access/logout"');
  expect(html).not.toContain('href="/app/cdn-cgi');
  // Every page, error pages included, has the un-prefixed Access sign out.
  for (const path of ['/app/review', '/app/?month=2026-09', '/app/settings', '/app/import', '/app/nope']) {
    const page = await (await at(path, { 'Cf-Access-Jwt-Assertion': await token() })).text();
    expect(page, path).toContain('<a href="/cdn-cgi/access/logout" class="sign-out">Sign out</a>');
    expect(page, path).toContain('<nav class="main" aria-label="Main">');
    expect(page, path).toContain('<nav class="tabs" aria-label="Main">');
  }
  // On phones the header link is hidden; Settings carries Sign out, also un-prefixed.
  const settings = await (await at('/app/settings', { 'Cf-Access-Jwt-Assertion': await token() })).text();
  expect(settings).toContain('<a class="btn secondary" href="/cdn-cgi/access/logout">Sign out</a>');
  // The old More address redirects only after sign-in.
  const more = await at('/app/more', { 'Cf-Access-Jwt-Assertion': await token() });
  expect(more.status).toBe(302);
  expect(more.headers.get('Location')).toBe('/app/settings');
  expect((await at('/app/more', { Authorization: authorization })).status).toBe(403);
  expect((await at('/app/month', { Authorization: authorization })).status).toBe(403);

  for (const headers of [
    {} as Record<string, string>,
    { Authorization: authorization },
    { 'Cf-Access-Jwt-Assertion': 'garbage' },
    { 'Cf-Access-Jwt-Assertion': await token({ email: 'someone-else@example.com' }) },
    { 'Cf-Access-Jwt-Assertion': await token({ aud: ['b'.repeat(64)] }) },
    { 'Cf-Access-Jwt-Assertion': await token({}, { key: other.privateKey }) },
  ]) {
    const denied = await at('/app/', headers);
    expect(denied.status).toBe(403);
    expect(denied.headers.get('WWW-Authenticate')).toBeNull();
    expect(await denied.text()).not.toContain('Monthly costs');
  }
  // Writes need the token too.
  const form = new FormData();
  form.set('label', 'x');
  expect((await at('/app/accounts', { Authorization: authorization }, { method: 'POST', body: form })).status).toBe(
    403,
  );
});

test('without Access vars the password path is unchanged', async () => {
  const ok = await request('/');
  expect(ok.status).toBe(200);
  expect(await ok.text()).not.toContain('/cdn-cgi/access/logout');
  const denied = await request('/', { headers: { Authorization: 'Basic ' + btoa('owner:wrong-password-value') } });
  expect(denied.status).toBe(401);
  expect(denied.headers.get('WWW-Authenticate')).toContain('Basic');
  const tokenOnly = await worker.fetch(
    new Request('http://localhost/', { headers: { 'Cf-Access-Jwt-Assertion': await token() } }),
    env,
  );
  expect(tokenOnly.status).toBe(401);
  expect(certFetches).toHaveLength(0);
});
