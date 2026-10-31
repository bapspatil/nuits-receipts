import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import worker from '../src/index';
import { parseConfig, parseOneDrive } from '../src/config';
import { CHUNK, seal, shareId, unseal } from '../src/onedrive';
import type { Env } from '../src/env';
import { hash } from '../src/domain';
import { authorization, locationOf, signed } from './helpers';
import { seed, unzip } from './package-helpers';
import { buttonLink } from '../src/actions';

// Synthetic app registration and key; nothing here talks to Microsoft.
const CLIENT_ID = '11111111-2222-3333-4444-555555555555';
const KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 7)));
const ORIGIN = 'https://receipts.example.com';
const LOGIN = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const odEnv = {
  ...env,
  APP_BASE_PATH: '/app',
  MS_CLIENT_ID: CLIENT_ID,
  MS_CLIENT_SECRET: 'synthetic-client-secret',
  ONEDRIVE_TOKEN_KEY: KEY,
} as Env;

function at(path: string, init: RequestInit = {}, headers: Record<string, string> = {}, target: Env = odEnv) {
  return worker.fetch(
    new Request(ORIGIN + path, {
      redirect: 'manual',
      ...init,
      headers: { Authorization: authorization, Origin: ORIGIN, ...headers },
    }),
    target,
  );
}
function post(path: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return at(path, { method: 'POST', body: form }, headers);
}

type Call = { method: string; url: string; headers: Headers; body: Uint8Array };
type Reply = Response | undefined;
// A small fake of the Microsoft endpoints the app uses. Tests override
// `hook` to inject failures; anything unexpected throws.
class FakeMicrosoft {
  calls: Call[] = [];
  refreshes: string[] = [];
  folders = new Map<string, string>();
  files = new Map<string, Uint8Array>();
  sessions = new Map<string, Uint8Array[]>();
  rotate = false;
  refreshFails = false;
  shares: Reply = Response.json({
    id: 'root-folder',
    name: 'Accountant Inbox',
    webUrl: 'https://example.sharepoint.com/Inbox',
    folder: {},
    parentReference: { driveId: 'drive-1' },
  });
  sharedWithMe: unknown[] = [];
  hook: (call: Call) => Reply = () => undefined;

  async handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input as RequestInfo, init);
    const call = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: new Uint8Array(await request.arrayBuffer()),
    };
    this.calls.push(call);
    const hooked = this.hook(call);
    if (hooked) return hooked;
    const url = decodeURIComponent(call.url);
    if (url === `${LOGIN}/token`) {
      const form = new URLSearchParams(new TextDecoder().decode(call.body));
      if (form.get('grant_type') === 'authorization_code')
        return Response.json({ access_token: 'access-code', refresh_token: 'refresh-original', expires_in: 3600 });
      this.refreshes.push(form.get('refresh_token')!);
      if (this.refreshFails) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      const n = this.refreshes.length;
      return Response.json({
        access_token: `access-${n}`,
        ...(this.rotate ? { refresh_token: `refresh-rotated-${n}` } : {}),
      });
    }
    if (
      !call.url.startsWith('https://upload.example.net/') &&
      !call.headers.get('Authorization')?.startsWith('Bearer ')
    )
      throw new Error('Graph call without a token: ' + url);
    if (url.startsWith(`${GRAPH}/me?`))
      return Response.json({ displayName: 'Synthetic Owner', mail: 'owner@example.com' });
    if (url.startsWith(`${GRAPH}/shares/`)) return this.shares ?? new Response(null, { status: 404 });
    if (url.startsWith(`${GRAPH}/me/drive/sharedWithMe`)) return Response.json({ value: this.sharedWithMe });
    let m = /\/drives\/drive-1\/items\/([^/:]+):\/([^/:]+)$/.exec(url);
    if (m && call.method === 'GET') {
      const id = this.folders.get(`${m[1]}/${m[2]}`);
      return id ? Response.json({ id, name: m[2], folder: {} }) : Response.json({ error: {} }, { status: 404 });
    }
    m = /\/drives\/drive-1\/items\/([^/:]+)\/children$/.exec(url);
    if (m && call.method === 'POST') {
      const { name } = JSON.parse(new TextDecoder().decode(call.body)) as { name: string };
      const id = `${name}-id`;
      this.folders.set(`${m[1]}/${name}`, id);
      return Response.json({ id, name, folder: {} }, { status: 201 });
    }
    m = /\/drives\/drive-1\/items\/([^/:]+):\/([^/:]+):\/content\?@microsoft\.graph\.conflictBehavior=replace$/.exec(
      url,
    );
    if (m && call.method === 'PUT') {
      this.files.set(`${m[1]}/${m[2]}`, call.body);
      return Response.json({ id: `item-${m[2]}` }, { status: 201 });
    }
    m = /\/drives\/drive-1\/items\/([^/:]+):\/([^/:]+):\/createUploadSession$/.exec(url);
    if (m && call.method === 'POST') {
      this.sessions.set(`${m[1]}/${m[2]}`, []);
      return Response.json({ uploadUrl: `https://upload.example.net/session/${m[1]}/${m[2]}` });
    }
    m = /^https:\/\/upload\.example\.net\/session\/([^/]+)\/([^/]+)$/.exec(url);
    if (m && call.method === 'PUT') {
      const key = `${m[1]}/${m[2]}`,
        parts = this.sessions.get(key)!;
      parts.push(call.body);
      const [, end, total] = /bytes \d+-(\d+)\/(\d+)/.exec(call.headers.get('Content-Range')!)!.map(Number);
      if (end! + 1 < total!) return Response.json({ nextExpectedRanges: [`${end! + 1}-`] }, { status: 202 });
      const all = new Uint8Array(total!);
      let at = 0;
      for (const p of parts) all.set(p, (at += p.length) - p.length);
      this.files.set(key, all);
      return Response.json({ id: `item-${m[2]}` }, { status: 201 });
    }
    m = /\/drives\/drive-1\/items\/([^/:]+)$/.exec(url);
    if (m && call.method === 'DELETE') return new Response(null, { status: 204 });
    throw new Error(`Unexpected outbound call ${call.method} ${url}`);
  }
}
let ms: FakeMicrosoft;
beforeEach(() => {
  ms = new FakeMicrosoft();
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => ms.handle(input, init));
});
afterEach(() => vi.restoreAllMocks());

async function connect(folder = true) {
  await env.DB.prepare(
    `INSERT INTO onedrive_connection (id,account_name,account_email,refresh_token_enc,connected_at,folder_drive_id,folder_item_id,folder_name,folder_web_url)
    VALUES (1,'Synthetic Owner','owner@example.com',?,'2026-10-20',?,?,?,?)`,
  )
    .bind(
      await seal(odEnv, 'refresh-token', 'refresh-original'),
      folder ? 'drive-1' : null,
      folder ? 'root-folder' : null,
      folder ? 'Accountant Inbox' : null,
      folder ? 'https://example.sharepoint.com/Inbox' : null,
    )
    .run();
}
const graphCalls = () => ms.calls.filter((c) => c.url.startsWith(GRAPH));

test('OneDrive config is all or nothing and validated', () => {
  expect(parseOneDrive({})).toEqual({ oneDrive: null, oneDriveIncomplete: false });
  expect(parseOneDrive({ MS_CLIENT_ID: CLIENT_ID })).toEqual({ oneDrive: null, oneDriveIncomplete: true });
  expect(parseOneDrive({ MS_CLIENT_ID: CLIENT_ID, MS_CLIENT_SECRET: 's' })).toEqual({
    oneDrive: null,
    oneDriveIncomplete: true,
  });
  expect(parseOneDrive({ MS_CLIENT_SECRET: 's', ONEDRIVE_TOKEN_KEY: KEY })).toEqual({
    oneDrive: null,
    oneDriveIncomplete: false,
  });
  const full = parseOneDrive({ MS_CLIENT_ID: CLIENT_ID.toUpperCase(), MS_CLIENT_SECRET: 's', ONEDRIVE_TOKEN_KEY: KEY });
  expect(full.oneDrive?.clientId).toBe(CLIENT_ID);
  expect(full.oneDrive?.tokenKey).toHaveLength(32);
  expect(() => parseOneDrive({ MS_CLIENT_ID: 'not-a-guid' })).toThrow(/MS_CLIENT_ID/);
  for (const key of ['short', btoa('x'.repeat(31)), btoa('x'.repeat(33)), '!!!'])
    expect(() => parseOneDrive({ MS_CLIENT_ID: CLIENT_ID, MS_CLIENT_SECRET: 's', ONEDRIVE_TOKEN_KEY: key })).toThrow(
      /ONEDRIVE_TOKEN_KEY/,
    );
  expect(() =>
    parseOneDrive({ MS_CLIENT_ID: CLIENT_ID, MS_CLIENT_SECRET: 'has space', ONEDRIVE_TOKEN_KEY: KEY }),
  ).toThrow(/MS_CLIENT_SECRET/);
  expect(parseConfig({ SEND_HINT: ' Drop the folder in their OneDrive ' }).sendHint).toBe(
    'Drop the folder in their OneDrive',
  );
  expect(() => parseConfig({ SEND_HINT: 'x'.repeat(301) })).toThrow(/SEND_HINT/);
});

test('without the config there is no OneDrive UI, and a half config only gets a note', async () => {
  const plain = { ...env, APP_BASE_PATH: '/app' } as Env;
  const settings = await (await at('/app/settings', {}, {}, plain)).text();
  expect(settings).not.toMatch(/OneDrive|onedrive/);
  await seed({ bytes: 'r', issue_date: '2026-10-02' });
  expect(await (await at('/app/?month=2026-10', {}, {}, plain)).text()).not.toContain('onedrive');
  expect((await at('/app/settings/onedrive/connect', {}, {}, plain)).status).toBe(404);
  const half = { ...plain, MS_CLIENT_ID: CLIENT_ID } as Env;
  const note = await (await at('/app/settings', {}, {}, half)).text();
  expect(note).toContain('<div class="sectpart" id="onedrive"><h3>OneDrive</h3><p class="warning">');
  expect(note).toContain('<code>MS_CLIENT_SECRET</code> or <code>ONEDRIVE_TOKEN_KEY</code> is missing.');
  expect(note).not.toContain('onedrive/connect');
  expect(ms.calls).toHaveLength(0);
});

test('connect sends PKCE S256 and a sealed state cookie; the callback stores the token encrypted', async () => {
  const settings = await (await at('/app/settings')).text();
  expect(settings).toContain(buttonLink('connect', '/app/settings/onedrive/connect'));
  expect(settings).toContain(`${ORIGIN}/app/settings/onedrive/callback`);
  expect(settings).toContain('<div class="sectpart" id="onedrive"><h3>OneDrive</h3><p class="cta">');
  // The page's one Save is its only filled button; Connect is not.
  expect(settings.match(/class="[^"]*\bbtn primary\b/g)).toHaveLength(1);

  const start = await at('/app/settings/onedrive/connect');
  expect(start.status).toBe(303);
  const location = new URL(start.headers.get('Location')!);
  expect(location.origin + location.pathname).toBe(`${LOGIN}/authorize`);
  const q = location.searchParams;
  expect(Object.fromEntries(q)).toMatchObject({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: `${ORIGIN}/app/settings/onedrive/callback`,
    scope: 'offline_access Files.ReadWrite.All User.Read',
    code_challenge_method: 'S256',
  });
  expect(q.get('state')).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  const cookie = start.headers.get('Set-Cookie')!;
  expect(cookie).toMatch(
    /^onedrive_oauth=[A-Za-z0-9_-]+; Path=\/app\/settings\/onedrive; Max-Age=600; HttpOnly; SameSite=Lax; Secure$/,
  );
  expect(cookie).not.toContain(q.get('state')!);
  const jar = cookie.split(';')[0]!;

  // Wrong state, missing cookie, or a refused sign-in never reach Microsoft.
  for (const [query, headers] of [
    [`code=c&state=wrong`, { Cookie: jar }],
    [`code=c&state=${q.get('state')}`, {}],
    [`code=c&state=${q.get('state')}`, { Cookie: 'onedrive_oauth=tampered' }],
  ] as const) {
    const bad = await at(`/app/settings/onedrive/callback?${query}`, {}, headers);
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain('This sign-in link expired or was opened in another browser');
  }
  const refused = await at(
    '/app/settings/onedrive/callback?error=access_denied&error_description=x',
    {},
    { Cookie: jar },
  );
  expect(await refused.text()).toContain('The Microsoft sign-in was cancelled');
  expect(ms.calls).toHaveLength(0);

  const done = await at(
    `/app/settings/onedrive/callback?code=synthetic-code&state=${q.get('state')}`,
    {},
    { Cookie: jar },
  );
  expect(done.status).toBe(303);
  expect(locationOf(done)).toBe('/app/settings?done=oneDriveConnected#onedrive');
  expect(done.headers.get('Set-Cookie')).toContain('Max-Age=0');
  const exchange = new URLSearchParams(new TextDecoder().decode(ms.calls[0]!.body));
  expect(exchange.get('grant_type')).toBe('authorization_code');
  expect(exchange.get('redirect_uri')).toBe(`${ORIGIN}/app/settings/onedrive/callback`);
  expect(exchange.get('client_secret')).toBe('synthetic-client-secret');
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(exchange.get('code_verifier')!)),
  );
  const challenge = btoa(String.fromCharCode(...digest))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  expect(challenge).toBe(q.get('code_challenge'));
  expect(ms.calls[1]!.headers.get('Authorization')).toBe('Bearer access-code');

  const row = await env.DB.prepare('SELECT * FROM onedrive_connection').first<Record<string, string>>();
  expect(row).toMatchObject({
    account_name: 'Synthetic Owner',
    account_email: 'owner@example.com',
    folder_item_id: null,
  });
  expect(row!.refresh_token_enc).not.toBe('refresh-original');
  expect(row!.refresh_token_enc).not.toContain('refresh');
  expect(await unseal(odEnv, 'refresh-token', row!.refresh_token_enc!)).toBe('refresh-original');
  // Bound to its purpose: the token can't be opened as a state cookie.
  expect(await unseal(odEnv, 'oauth-state', row!.refresh_token_enc!)).toBeNull();
  const after = await (await at(await signed('/app/settings?done=oneDriveConnected', '/app'))).text();
  expect(after).toContain('Microsoft account connected.');
  expect(after).toContain('<dd>Synthetic Owner (owner@example.com)</dd>');
  // The section the callback returns to is open, its summary names the account.
  expect(after).toContain('<details class="sect" open><summary><h2>Sending</h2>');
  expect(after).toContain('action="/app/settings/onedrive/folder"');
});

test('a folder link resolves through /shares, and other folders and failures are explained', async () => {
  await connect(false);
  const link = 'https://example-my.sharepoint.com/:f:/g/personal/books/EaSynthetic?e=abc';
  const saved = await post('/app/settings/onedrive/folder', { folder_link: link });
  expect(saved.status).toBe(303);
  expect(locationOf(saved)).toBe('/app/settings?done=oneDriveFolder#onedrive');
  const share = graphCalls()[0]!;
  expect(share.url).toBe(`${GRAPH}/shares/${shareId(link)}/driveItem`);
  expect(shareId(link)).toMatch(/^u![A-Za-z0-9_-]+$/);
  expect(share.headers.get('Prefer')).toBe('redeemSharingLink');
  expect(
    await env.DB.prepare('SELECT folder_drive_id,folder_item_id,folder_name FROM onedrive_connection').first(),
  ).toEqual({ folder_drive_id: 'drive-1', folder_item_id: 'root-folder', folder_name: 'Accountant Inbox' });

  ms.shares = Response.json({ id: 'f', name: 'invoice.pdf', file: {}, parentReference: { driveId: 'd' } });
  const file = await post('/app/settings/onedrive/folder', { folder_link: link });
  expect(file.status).toBe(422);
  // Refused in place: Settings again, the link still in its box, the message beside it.
  const refusedHtml = await file.text();
  expect(refusedHtml).toContain('That link opens a file, not a folder.');
  expect(refusedHtml).toContain('<h1>Settings</h1>');
  expect(refusedHtml).toMatch(/id="f-folder_link" aria-invalid="true" aria-describedby="e-onedrive-folder"/);
  expect(refusedHtml).toContain(`value="${link}"`);

  // Another organisation: /shares fails, "Shared with me" finds it by name.
  ms.shares = Response.json({ error: { code: 'itemNotFound' } }, { status: 404 });
  ms.sharedWithMe = [
    {
      id: 'x',
      name: 'Other',
      remoteItem: { id: 'other', name: 'Other', folder: {}, parentReference: { driveId: 'd2' } },
    },
    {
      id: 'y',
      name: 'MVP receipts',
      remoteItem: {
        id: 'remote-folder',
        name: 'MVP receipts',
        folder: {},
        webUrl: 'https://other.sharepoint.com/sites/b/MVP%20receipts',
        parentReference: { driveId: 'remote-drive' },
      },
    },
  ];
  const fallback = await post('/app/settings/onedrive/folder', { folder_link: link, folder_name: 'mvp receipts' });
  expect(fallback.status).toBe(303);
  expect(graphCalls().at(-1)!.url).toBe(`${GRAPH}/me/drive/sharedWithMe?allowexternal=true`);
  expect(await env.DB.prepare('SELECT folder_drive_id,folder_item_id FROM onedrive_connection').first()).toEqual({
    folder_drive_id: 'remote-drive',
    folder_item_id: 'remote-folder',
  });
  // ...or by its address.
  const byUrl = await post('/app/settings/onedrive/folder', {
    folder_link: 'https://other.sharepoint.com/sites/b/MVP receipts/',
  });
  expect(byUrl.status).toBe(303);

  const missing = await post('/app/settings/onedrive/folder', { folder_link: link, folder_name: 'nope' });
  expect(missing.status).toBe(404);
  expect(await missing.text()).toContain('open the link once in your browser while signed in');
  ms.shares = Response.json({ error: { code: 'accessDenied' } }, { status: 403 });
  const forbidden = await post('/app/settings/onedrive/folder', { folder_link: link });
  expect(forbidden.status).toBe(403);
  expect(await forbidden.text()).toContain('Ask its owner to give your Microsoft account edit access');
  expect((await post('/app/settings/onedrive/folder', { folder_link: 'http://insecure.example' })).status).toBe(422);

  ms.refreshFails = true;
  const expired = await post('/app/settings/onedrive/folder', { folder_link: link });
  expect(expired.status).toBe(401);
  expect(await expired.text()).toContain('Reconnect it in Settings');
});

async function readyMonth(count = 1, big = false) {
  const receipts = [];
  for (let i = 0; i < count; i++)
    receipts.push(await seed({ bytes: `small synthetic ${i}`, vendor: `Vendor ${i}`, issue_date: '2026-10-02' }));
  if (big) {
    const bytes = new Uint8Array(5 * 1024 * 1024 + 12345);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) & 0xff;
    receipts.push(await seed({ bytes, vendor: 'Large Scan', issue_date: '2026-10-03' }));
  }
  return receipts;
}

test('upload puts small files, chunked large files and the index in the month folder, then skips and replaces', async () => {
  await connect();
  const [small, large] = await readyMonth(1, true);
  const page = await (await at('/app/?month=2026-10')).text();
  expect(page).toContain('action="/app/month/onedrive-upload"');
  expect(page).toContain('<span>Upload anyway</span></button>');
  expect(page).toContain('href="/app/settings#onedrive">Change</a>');

  const first = await post('/app/month/onedrive-upload', { month: '2026-10' });
  expect(first.status).toBe(303);
  expect(locationOf(first)).toBe('/app/?month=2026-10&done=driveDone&n=2&of=2#send');
  expect(ms.folders.get('root-folder/receipts-2026-10')).toBe('receipts-2026-10-id');
  const smallName = `2026-10-02_Vendor-0_EUR-12.50_${small!.id.slice(0, 6)}.pdf`;
  const largeName = `2026-10-03_Large-Scan_EUR-12.50_${large!.id.slice(0, 6)}.pdf`;
  // Uploaded bytes match the originals (content-addressed: the id is their SHA-256).
  expect(await hash(ms.files.get(`receipts-2026-10-id/${smallName}`)!)).toBe(small!.id);
  expect(await hash(ms.files.get(`receipts-2026-10-id/${largeName}`)!)).toBe(large!.id);
  const chunks = ms.calls.filter((c) => c.url.startsWith('https://upload.example.net/'));
  expect(chunks.length).toBe(Math.ceil((5 * 1024 * 1024 + 12345) / CHUNK));
  for (const c of chunks.slice(0, -1)) expect(c.body.length % (320 * 1024)).toBe(0);
  for (const c of chunks) expect(c.headers.get('Authorization')).toBeNull();
  expect(chunks[0]!.headers.get('Content-Range')).toBe(`bytes 0-${CHUNK - 1}/${5 * 1024 * 1024 + 12345}`);
  const index = new TextDecoder().decode(ms.files.get('receipts-2026-10-id/00-index-2026-10.csv'));
  expect(index).toContain(`${smallName},main`);
  expect(index).toContain(`${ORIGIN}/app/originals/${small!.id}`);
  expect(await env.DB.prepare('SELECT method,file_count FROM month_sends').first()).toEqual({
    method: 'onedrive',
    file_count: 2,
  });
  expect(await env.DB.prepare('SELECT count(*) n FROM onedrive_uploads').first('n')).toBe(2);
  expect(ms.refreshes).toEqual(['refresh-original']);
  const done = await (await at(await signed('/app/?month=2026-10&done=driveDone&n=2&of=2', '/app'))).text();
  expect(done).toContain('Uploaded to OneDrive. Marked as sent.');
  expect(done).toContain('Via OneDrive');

  // Again: nothing new to upload, only the index is refreshed.
  ms.calls = [];
  await post('/app/month/onedrive-upload', { month: '2026-10' });
  const puts = ms.calls.filter((c) => c.method === 'PUT').map((c) => decodeURIComponent(c.url));
  expect(puts).toHaveLength(1);
  expect(puts[0]).toContain('00-index-2026-10.csv');
  expect(await env.DB.prepare('SELECT count(*) n FROM month_sends').first('n')).toBe(1);

  // A correction that renames the file replaces it and removes the old copy.
  await env.DB.prepare("UPDATE receipts SET revision=revision+1,vendor='Vendor Renamed' WHERE id=?")
    .bind(small!.id)
    .run();
  ms.calls = [];
  const again = await post('/app/month/onedrive-upload', { month: '2026-10', changes: '1' });
  expect(locationOf(again)).toMatch(/^\/app\/\?month=2026-10&changes=1&done=driveDone&n=\d+&of=\d+#send$/);
  const renamed = `2026-10-02_Vendor-Renamed_EUR-12.50_${small!.id.slice(0, 6)}.pdf`;
  const put = ms.calls.find((c) => c.method === 'PUT' && decodeURIComponent(c.url).includes(renamed))!;
  expect(put.url).toContain('conflictBehavior=replace');
  expect(
    ms.calls.some((c) => c.method === 'DELETE' && c.url.endsWith(`/items/item-${encodeURIComponent(smallName)}`)),
  ).toBe(true);
  expect(ms.calls.some((c) => decodeURIComponent(c.url).includes(largeName))).toBe(false);
  expect(await env.DB.prepare('SELECT count(*) n FROM month_sends').first('n')).toBe(2);
  // Uploading only the changes still leaves the full index in the folder.
  const index2 = new TextDecoder().decode(ms.files.get('receipts-2026-10-id/00-index-2026-10.csv'));
  expect(index2).toContain(renamed);
  expect(index2).toContain(largeName);
});

test('uploads run in batches of ten and continue without JavaScript', async () => {
  await connect();
  await readyMonth(12);
  const first = await post('/app/month/onedrive-upload', { month: '2026-10', anyway: '1' });
  expect(locationOf(first)).toBe('/app/?month=2026-10&anyway=1&done=driveMore&n=10&of=12#send');
  expect(await env.DB.prepare('SELECT count(*) n FROM onedrive_uploads').first('n')).toBe(10);
  expect(ms.files.has('receipts-2026-10-id/00-index-2026-10.csv')).toBe(false);
  expect(await env.DB.prepare('SELECT count(*) n FROM month_sends').first('n')).toBe(0);
  const page = await (await at(await signed('/app/?month=2026-10&anyway=1&done=driveMore&n=10&of=12', '/app'))).text();
  expect(page).toContain('10 of 12 uploaded.');
  expect(page).toContain('<input type="hidden" name="anyway" value="1">');
  // No refresh and no script the flow depends on; keys.js, find.js, bulk.js and app.js only enhance the page.
  expect(page).not.toMatch(/http-equiv|<script(?! src="\/app\/assets\/(keys|find|bulk|app)\.js")/);
  const second = await post('/app/month/onedrive-upload', { month: '2026-10', anyway: '1' });
  expect(locationOf(second)).toBe('/app/?month=2026-10&anyway=1&done=driveDone&n=12&of=12#send');
  expect(await env.DB.prepare('SELECT count(*) n FROM onedrive_uploads').first('n')).toBe(12);
  expect(await env.DB.prepare('SELECT method FROM month_sends').first('method')).toBe('onedrive');
});

test('a 401 refreshes the token once and keeps a rotated refresh token', async () => {
  await connect();
  await readyMonth(1);
  ms.rotate = true;
  let failed = false;
  ms.hook = (call) => {
    if (call.method === 'PUT' && !failed) {
      failed = true;
      return Response.json({ error: { code: 'InvalidAuthenticationToken' } }, { status: 401 });
    }
  };
  const result = await post('/app/month/onedrive-upload', { month: '2026-10' });
  expect(locationOf(result)).toContain('done=driveDone');
  expect(ms.refreshes).toEqual(['refresh-original', 'refresh-rotated-1']);
  const stored = await env.DB.prepare('SELECT refresh_token_enc FROM onedrive_connection').first<string>(
    'refresh_token_enc',
  );
  expect(await unseal(odEnv, 'refresh-token', stored!)).toBe('refresh-rotated-2');
  const puts = ms.calls.filter((c) => c.method === 'PUT');
  expect(puts[0]!.headers.get('Authorization')).toBe('Bearer access-1');
  expect(puts[1]!.headers.get('Authorization')).toBe('Bearer access-2');
});

test('429 and 503 stop the batch with the wait Microsoft asks for', async () => {
  await connect();
  await readyMonth(3);
  let puts = 0;
  ms.hook = (call) => {
    if (call.method === 'PUT' && ++puts === 2)
      return new Response(null, { status: 429, headers: { 'Retry-After': '7' } });
  };
  const result = await post('/app/month/onedrive-upload', { month: '2026-10' });
  expect(locationOf(result)).toBe('/app/?month=2026-10&done=driveMore&n=1&of=3&wait=7#send');
  expect(await env.DB.prepare('SELECT count(*) n FROM onedrive_uploads').first('n')).toBe(1);
  const page = await (await at(await signed('/app/?month=2026-10&done=driveMore&n=1&of=3&wait=7', '/app'))).text();
  expect(page).toContain('1 of 3 uploaded. Continue in 7 s.');
  ms.hook = (call) => (call.method === 'PUT' ? new Response(null, { status: 503 }) : undefined);
  expect(locationOf(await post('/app/month/onedrive-upload', { month: '2026-10' }))).toContain('wait=30');
  ms.hook = () => undefined;
  expect(locationOf(await post('/app/month/onedrive-upload', { month: '2026-10' }))).toContain('done=driveDone');
  ms.hook = (call) => (call.method === 'PUT' ? new Response(null, { status: 403 }) : undefined);
  await env.DB.prepare('UPDATE receipts SET revision=revision+1').run();
  const denied = await post('/app/month/onedrive-upload', { month: '2026-10' });
  expect(denied.status).toBe(403);
  expect(await denied.text()).toContain('Your account needs edit rights on the folder');
});

test('upload and disconnect need the same origin, a folder, and the config', async () => {
  await readyMonth(1);
  expect((await post('/app/month/onedrive-upload', { month: '2026-10' })).status).toBe(409);
  await connect();
  expect(
    (await post('/app/month/onedrive-upload', { month: '2026-10' }, { Origin: 'https://evil.example' })).status,
  ).toBe(403);
  expect((await post('/app/settings/onedrive/disconnect', {}, { Origin: 'https://evil.example' })).status).toBe(403);
  // Disconnect deletes the sign-in and has no Undo, so it asks first.
  expect(await (await at('/app/settings')).text()).toMatch(
    /<details class="cta"><summary class="btn ghost"><svg[^>]*><use href="#i-unplug"\/><\/svg><span>Disconnect<\/span><\/summary><div class="body"><form action="\/app\/settings\/onedrive\/disconnect" method="post"><p class="ask">/,
  );
  const gone = await post('/app/settings/onedrive/disconnect', {});
  expect(locationOf(gone)).toBe('/app/settings?done=oneDriveDisconnected#onedrive');
  expect(await env.DB.prepare('SELECT count(*) n FROM onedrive_connection').first('n')).toBe(0);
  const plain = { ...env, APP_BASE_PATH: '/app' } as Env;
  const form = new FormData();
  form.set('month', '2026-10');
  expect((await at('/app/month/onedrive-upload', { method: 'POST', body: form }, {}, plain)).status).toBe(404);
  expect(ms.calls).toHaveLength(0);
  // The ZIP path keeps working with OneDrive configured.
  const zip = await at('/app/month/package.zip?month=2026-10&anyway=1');
  expect(unzip(new Uint8Array(await zip.arrayBuffer())).length).toBe(2);
});
