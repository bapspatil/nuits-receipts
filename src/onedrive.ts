// Optional direct upload of the month package into a OneDrive or SharePoint
// folder, through Microsoft Graph with the owner's own Microsoft sign-in.
// Off unless MS_CLIENT_ID, MS_CLIENT_SECRET and ONEDRIVE_TOKEN_KEY are all
// set (src/config.ts). Tokens are never logged; the refresh token is stored
// only AES-GCM encrypted, and the access token lives for one request.
import { InputError, requireInput } from './domain';
import type { Env } from './env';
import { config, type OneDriveConfig } from './config';
import {
  MAIN_FOLDER,
  markSent,
  packageTexts,
  planPackage,
  requirePackable,
  type PackageFile,
  type PackageOptions,
  type Plan,
} from './package';

const LOGIN = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';
export const SCOPES = 'offline_access Files.ReadWrite.All User.Read';
// Graph takes simple PUTs up to 4 MB; larger files go through an upload
// session in chunks that must be multiples of 320 KiB.
export const SMALL_UPLOAD = 4 * 1024 * 1024;
export const CHUNK = 10 * 320 * 1024;
// Files per request, so one slow Graph call can't time out the page.
export const BATCH = 10;
const COOKIE = 'onedrive_oauth';
const STATE_SECONDS = 600;

export type Connection = {
  account_name: string;
  account_email: string;
  refresh_token_enc: string;
  connected_at: string;
  folder_drive_id: string | null;
  folder_item_id: string | null;
  folder_name: string | null;
  folder_web_url: string | null;
};
export type DriveFolder = { driveId: string; itemId: string; name: string; webUrl: string };

// Microsoft asked us to slow down (429 or 503 with Retry-After).
export class RetryLater extends InputError {
  constructor(public seconds: number) {
    super(`Microsoft asked us to wait. Try again in ${seconds} seconds; nothing is lost.`, 503);
  }
}
const reconnect = () =>
  new InputError('Your Microsoft sign-in has expired or was revoked. Reconnect it in Settings, then try again.', 401);

export function oneDrive(env: Env): OneDriveConfig {
  const settings = config(env).oneDrive;
  requireInput(settings, 'OneDrive upload is not set up', 404);
  return settings;
}
export function redirectUri(origin: string, base: string): string {
  return `${origin}${base}/settings/onedrive/callback`;
}
export async function connection(env: Env): Promise<Connection | null> {
  return env.DB.prepare('SELECT * FROM onedrive_connection WHERE id=1').first<Connection>();
}

// ---------- Encryption ----------
const utf8 = (text: string) => new TextEncoder().encode(text);
export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64url(text: string): Uint8Array {
  const normal = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(normal + '='.repeat((4 - (normal.length % 4)) % 4)), (c) => c.charCodeAt(0));
}
function aesKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', oneDrive(env).tokenKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
// The purpose is bound as associated data, so a sealed state cookie can't be
// replayed as a refresh token or the other way round.
export async function seal(env: Env, purpose: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(purpose) },
    await aesKey(env),
    utf8(plain),
  );
  const out = new Uint8Array(12 + sealed.byteLength);
  out.set(iv);
  out.set(new Uint8Array(sealed), 12);
  return base64url(out);
}
export async function unseal(env: Env, purpose: string, sealed: string): Promise<string | null> {
  try {
    const bytes = fromBase64url(sealed);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: utf8(purpose) },
      await aesKey(env),
      bytes.slice(12),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

// ---------- Sign-in ----------
export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(verifier))));
  return { verifier, challenge };
}
function stateCookie(value: string, origin: string, base: string, maxAge: number): string {
  return `${COOKIE}=${value}; Path=${base}/settings/onedrive; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${origin.startsWith('https:') ? '; Secure' : ''}`;
}

// Starts the Microsoft sign-in. State and the PKCE verifier travel in an
// encrypted, short-lived cookie scoped to the callback path.
export async function connectStart(env: Env, origin: string, base: string): Promise<Response> {
  const settings = oneDrive(env);
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const { verifier, challenge } = await pkce();
  const sealed = await seal(
    env,
    'oauth-state',
    JSON.stringify({ state, verifier, expires: Date.now() + STATE_SECONDS * 1000 }),
  );
  const authorize = new URL(`${LOGIN}/authorize`);
  authorize.search = new URLSearchParams({
    client_id: settings.clientId,
    response_type: 'code',
    redirect_uri: redirectUri(origin, base),
    response_mode: 'query',
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return new Response(null, {
    status: 303,
    headers: { Location: authorize.toString(), 'Set-Cookie': stateCookie(sealed, origin, base, STATE_SECONDS) },
  });
}

function cookieValue(request: Request): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return null;
}
const SIGN_IN_ERRORS: Record<string, string> = {
  access_denied: 'The Microsoft sign-in was cancelled, or consent was not given.',
  consent_required: 'Your organisation needs an administrator to approve this app before you can connect it.',
  interaction_required: 'Microsoft needs you to finish signing in. Start again from Settings.',
};

export async function connectCallback(env: Env, request: Request, url: URL, base: string): Promise<Response> {
  const settings = oneDrive(env);
  const error = url.searchParams.get('error');
  requireInput(
    !error,
    SIGN_IN_ERRORS[error ?? ''] ?? 'Microsoft did not complete the sign-in. Start again from Settings.',
    400,
  );
  const sealed = cookieValue(request);
  const saved = sealed ? await unseal(env, 'oauth-state', sealed) : null;
  const flow = saved ? (JSON.parse(saved) as { state: string; verifier: string; expires: number }) : null;
  requireInput(
    flow && flow.expires > Date.now() && flow.state === url.searchParams.get('state'),
    'This sign-in link expired or was opened in another browser. Start again from Settings.',
    400,
  );
  const code = url.searchParams.get('code');
  requireInput(code, 'Microsoft did not send a sign-in code. Start again from Settings.', 400);
  const token = await fetch(`${LOGIN}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(url.origin, base),
      code_verifier: flow.verifier,
      scope: SCOPES,
    }),
  });
  requireInput(
    token.ok,
    "Microsoft didn't accept the sign-in. Check that the redirect URI shown in Settings is added to the app in Microsoft Entra, and that MS_CLIENT_SECRET is current.",
    502,
  );
  const tokens = (await token.json()) as { access_token?: string; refresh_token?: string };
  requireInput(
    tokens.access_token && tokens.refresh_token,
    'Microsoft did not allow offline access. Make sure the app asks for offline_access, then connect again.',
    502,
  );
  const me = await fetch(`${GRAPH}/me?$select=displayName,mail,userPrincipalName`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  requireInput(me.ok, 'Microsoft signed you in but would not say who you are. Try connecting again.', 502);
  const profile = (await me.json()) as { displayName?: string; mail?: string | null; userPrincipalName?: string };
  const email = String(profile.mail || profile.userPrincipalName || '').slice(0, 254);
  const now = new Date().toISOString();
  // Reconnecting the same account keeps the chosen folder; another account
  // has to pick it again.
  await env.DB.prepare(
    `INSERT INTO onedrive_connection (id,account_name,account_email,refresh_token_enc,connected_at) VALUES (1,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      folder_drive_id=CASE WHEN account_email=excluded.account_email THEN folder_drive_id END,
      folder_item_id=CASE WHEN account_email=excluded.account_email THEN folder_item_id END,
      folder_name=CASE WHEN account_email=excluded.account_email THEN folder_name END,
      folder_web_url=CASE WHEN account_email=excluded.account_email THEN folder_web_url END,
      account_name=excluded.account_name,account_email=excluded.account_email,
      refresh_token_enc=excluded.refresh_token_enc,connected_at=excluded.connected_at`,
  )
    .bind(
      String(profile.displayName || email || 'Microsoft account').slice(0, 200),
      email,
      await seal(env, 'refresh-token', tokens.refresh_token),
      now,
    )
    .run();
  return new Response(null, {
    status: 303,
    headers: {
      Location: '/settings?onedrive=connected#onedrive',
      'Set-Cookie': stateCookie('', url.origin, base, 0),
    },
  });
}

export async function disconnect(env: Env): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM onedrive_connection'),
    env.DB.prepare('DELETE FROM onedrive_uploads'),
  ]);
}

// ---------- Graph ----------
function retryAfter(response: Response): number {
  const seconds = Number(response.headers.get('Retry-After'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.ceil(seconds), 3600) : 30;
}

// Graph calls with one access token per request. A 401 refreshes the token
// once and retries; 429 and 503 stop with RetryLater.
export class Graph {
  private token: string | null = null;
  constructor(
    private env: Env,
    private conn: Connection,
  ) {}

  private async refresh(): Promise<string> {
    const settings = oneDrive(this.env);
    const current = await unseal(this.env, 'refresh-token', this.conn.refresh_token_enc);
    if (!current) throw reconnect();
    const response = await fetch(`${LOGIN}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: current,
        scope: SCOPES,
      }),
    });
    if (response.status === 429 || response.status === 503) throw new RetryLater(retryAfter(response));
    if (!response.ok) throw reconnect();
    const tokens = (await response.json()) as { access_token?: string; refresh_token?: string };
    if (!tokens.access_token) throw reconnect();
    // Microsoft may rotate the refresh token; keep the newest one.
    if (tokens.refresh_token && tokens.refresh_token !== current) {
      this.conn.refresh_token_enc = await seal(this.env, 'refresh-token', tokens.refresh_token);
      await this.env.DB.prepare('UPDATE onedrive_connection SET refresh_token_enc=? WHERE id=1')
        .bind(this.conn.refresh_token_enc)
        .run();
    }
    return tokens.access_token;
  }

  async fetch(path: string, init: RequestInit = {}, { auth = true } = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const headers = new Headers(init.headers);
      if (auth) headers.set('Authorization', `Bearer ${(this.token ??= await this.refresh())}`);
      const response = await fetch(path.startsWith('https://') ? path : GRAPH + path, { ...init, headers });
      if (response.status === 401 && auth && attempt === 0) {
        this.token = null;
        continue;
      }
      if (response.status === 401) throw reconnect();
      if (response.status === 429 || response.status === 503) throw new RetryLater(retryAfter(response));
      return response;
    }
  }
}

// ---------- Destination folder ----------
export function shareId(link: string): string {
  return 'u!' + base64url(utf8(link));
}
type Item = {
  id?: string;
  name?: string;
  webUrl?: string;
  folder?: object;
  file?: object;
  parentReference?: { driveId?: string };
  remoteItem?: Item;
};
function sameUrl(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const clean = (value: string) => {
    try {
      const u = new URL(value);
      return decodeURIComponent(u.origin + u.pathname)
        .replace(/\/+$/, '')
        .toLowerCase();
    } catch {
      return value;
    }
  };
  return clean(a) === clean(b);
}
function asFolder(item: Item): DriveFolder {
  const target = item.remoteItem ?? item;
  requireInput(
    target.folder,
    'That link opens a file, not a folder. In OneDrive, share the folder itself and paste that link.',
  );
  const driveId = target.parentReference?.driveId ?? item.parentReference?.driveId;
  requireInput(
    driveId && target.id,
    "Microsoft didn't say where that folder lives. Open the link once in your browser while signed in, then try again.",
    502,
  );
  return {
    driveId,
    itemId: target.id,
    name: String(target.name ?? 'Shared folder'),
    webUrl: String(target.webUrl ?? ''),
  };
}
const NOT_FOUND =
  "We couldn't find a folder behind that link. Check you copied the whole link. If the folder belongs to another organisation, open the link once in your browser while signed in with the same Microsoft account, type the folder's name below, and try again.";
const FORBIDDEN =
  "Microsoft says your account can't use that folder. Ask its owner to give your Microsoft account edit access. Their organisation may also block people from outside it; then only the ZIP download works.";

// A pasted sharing link, resolved with the owner's token. Links from another
// organisation sometimes don't resolve through /shares; then the folder is
// looked up in "Shared with me" by its address or name.
export async function resolveFolder(graph: Graph, link: string, name = ''): Promise<DriveFolder> {
  let parsed: URL | null = null;
  try {
    parsed = new URL(link);
  } catch {
    parsed = null;
  }
  requireInput(
    parsed && parsed.protocol === 'https:' && link.length <= 2000,
    'Paste the full folder link, starting with https://',
  );
  const shared = await graph.fetch(`/shares/${shareId(link)}/driveItem`, { headers: { Prefer: 'redeemSharingLink' } });
  if (shared.ok) return asFolder((await shared.json()) as Item);
  const first = shared.status;
  const list = await graph.fetch('/me/drive/sharedWithMe?allowexternal=true');
  if (list.ok) {
    const items = ((await list.json()) as { value?: Item[] }).value ?? [];
    const wanted = name.trim().toLowerCase();
    const matches = items.filter((i) => {
      const target = i.remoteItem ?? i;
      return (
        target.folder &&
        (sameUrl(target.webUrl, link) || sameUrl(i.webUrl, link) || (!!wanted && target.name?.toLowerCase() === wanted))
      );
    });
    requireInput(
      matches.length <= 1,
      'More than one shared folder has that name. Paste the link to the exact folder instead.',
    );
    if (matches[0]) return asFolder(matches[0]);
  }
  throw new InputError(first === 403 ? FORBIDDEN : NOT_FOUND, first === 403 ? 403 : 404);
}

export async function chooseFolder(env: Env, link: string, name: string): Promise<DriveFolder> {
  const conn = await connection(env);
  requireInput(conn, 'Connect your Microsoft account first.', 409);
  const folder = await resolveFolder(new Graph(env, conn), link.trim(), name);
  await env.DB.prepare(
    'UPDATE onedrive_connection SET folder_drive_id=?,folder_item_id=?,folder_name=?,folder_web_url=? WHERE id=1',
  )
    .bind(folder.driveId, folder.itemId, folder.name.slice(0, 200), folder.webUrl.slice(0, 2000))
    .run();
  return folder;
}

// ---------- Upload ----------
const path = (driveId: string, itemId: string) =>
  `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`;

async function failure(response: Response): Promise<InputError> {
  if (response.status === 403)
    return new InputError(
      'Microsoft refused the upload. Your account needs edit rights on the folder; ask its owner. Files already uploaded are kept.',
      403,
    );
  if (response.status === 404)
    return new InputError('The destination folder is gone. Choose it again in Settings.', 404);
  if (response.status === 507) return new InputError("The folder's OneDrive is full.", 507);
  return new InputError(
    `OneDrive didn't take the file (HTTP ${response.status}). Try again; files already uploaded are kept.`,
    502,
  );
}

// The child folder with this name, created if it isn't there yet.
async function ensureFolder(graph: Graph, driveId: string, parentId: string, name: string): Promise<string> {
  const lookup = () => graph.fetch(`${path(driveId, parentId)}:/${encodeURIComponent(name)}`);
  let found = await lookup();
  if (found.status === 404) {
    const created = await graph.fetch(`${path(driveId, parentId)}/children`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
    });
    if (created.ok) return String(((await created.json()) as Item).id);
    if (created.status !== 409) throw await failure(created);
    found = await lookup();
  }
  if (!found.ok) throw await failure(found);
  const item = (await found.json()) as Item;
  requireInput(
    item.folder && item.id,
    `There is a file called ${name} where the month folder should go. Rename it.`,
    409,
  );
  return item.id;
}

export async function putFile(
  graph: Graph,
  driveId: string,
  parentId: string,
  name: string,
  bytes: Uint8Array,
  type: string,
): Promise<string> {
  const target = `${path(driveId, parentId)}:/${encodeURIComponent(name)}:`;
  if (bytes.length <= SMALL_UPLOAD) {
    const response = await graph.fetch(`${target}/content?@microsoft.graph.conflictBehavior=replace`, {
      method: 'PUT',
      headers: { 'Content-Type': type },
      body: bytes,
    });
    if (!response.ok) throw await failure(response);
    return String(((await response.json()) as Item).id);
  }
  const session = await graph.fetch(`${target}/createUploadSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
  });
  if (!session.ok) throw await failure(session);
  const { uploadUrl } = (await session.json()) as { uploadUrl?: string };
  requireInput(uploadUrl && uploadUrl.startsWith('https://'), 'OneDrive did not start the upload. Try again.', 502);
  // The upload URL carries its own authorisation; no bearer token is sent.
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, bytes.length);
    const response = await graph.fetch(
      uploadUrl,
      {
        method: 'PUT',
        headers: { 'Content-Range': `bytes ${start}-${end - 1}/${bytes.length}` },
        body: bytes.subarray(start, end),
      },
      { auth: false },
    );
    if (response.status === 200 || response.status === 201) return String(((await response.json()) as Item).id);
    if (response.status !== 202) throw await failure(response);
  }
  throw new InputError('OneDrive did not finish the upload. Try again.', 502);
}

type Uploaded = { receipt_id: string; revision: number; file_name: string; drive_item_id: string };
export type Progress = { plan: Plan; pending: PackageFile[]; folder: string };

// What still has to go up: files not uploaded to this folder yet, or uploaded
// at an older revision or under another name.
export async function progress(
  env: Env,
  conn: Connection,
  month: string,
  o: PackageOptions,
  planned?: Plan,
): Promise<Progress> {
  const plan = planned ?? (await planPackage(env, month, o));
  const done = new Map(
    (
      await env.DB.prepare(
        'SELECT receipt_id,revision,file_name,drive_item_id FROM onedrive_uploads WHERE folder_item_id=? AND month=?',
      )
        .bind(conn.folder_item_id ?? '', month)
        .all<Uploaded>()
    ).results.map((u) => [u.receipt_id, u]),
  );
  const pending = plan.files.filter((f) => {
    const u = done.get(f.receipt.id);
    return !u || u.revision !== f.receipt.revision || u.file_name !== f.path;
  });
  return { plan, pending, folder: conn.folder_name ?? 'the folder' };
}

export type BatchResult = { uploaded: number; remaining: number; total: number; finished: boolean; wait: number };

// Uploads up to BATCH files, then the index once everything is there, and
// records the month as sent. Safe to repeat: finished files are skipped.
export async function uploadBatch(env: Env, month: string, o: PackageOptions, origin: string): Promise<BatchResult> {
  oneDrive(env);
  const conn = await connection(env);
  requireInput(conn?.folder_drive_id && conn.folder_item_id, 'Choose the destination folder in Settings first.', 409);
  const { plan, pending } = await progress(env, conn, month, o);
  requirePackable(plan, o);
  const graph = new Graph(env, conn);
  const driveId = conn.folder_drive_id,
    root = conn.folder_item_id;
  const previous = new Map(
    (
      await env.DB.prepare(
        'SELECT receipt_id,revision,file_name,drive_item_id FROM onedrive_uploads WHERE folder_item_id=? AND month=?',
      )
        .bind(root, month)
        .all<Uploaded>()
    ).results.map((u) => [u.receipt_id, u]),
  );
  let uploaded = 0,
    wait = 0;
  try {
    const monthFolder = await ensureFolder(graph, driveId, root, plan.folder);
    // Subfolders (check-these/, or any other kind's folder) are created on first use.
    const subfolders = new Map<string, string>();
    for (const f of pending.slice(0, BATCH)) {
      let parent = f.folder === MAIN_FOLDER ? monthFolder : subfolders.get(f.folder);
      if (!parent) subfolders.set(f.folder, (parent = await ensureFolder(graph, driveId, monthFolder, f.folder)));
      const object = await env.ORIGINALS.get(f.receipt.original_key);
      requireInput(object, `The original of ${f.name} is missing`, 404);
      const id = await putFile(
        graph,
        driveId,
        parent,
        f.name,
        new Uint8Array(await object.arrayBuffer()),
        f.receipt.media_type,
      );
      const old = previous.get(f.receipt.id);
      // A corrected receipt can get a new name; remove its old copy.
      if (old && old.file_name !== f.path && old.drive_item_id !== id) {
        const removed = await graph.fetch(path(driveId, old.drive_item_id), { method: 'DELETE' });
        if (!removed.ok && removed.status !== 404) throw await failure(removed);
      }
      await env.DB.prepare(
        `INSERT INTO onedrive_uploads (folder_item_id,month,receipt_id,revision,file_name,drive_item_id,uploaded_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(folder_item_id,month,receipt_id) DO UPDATE SET revision=excluded.revision,file_name=excluded.file_name,drive_item_id=excluded.drive_item_id,uploaded_at=excluded.uploaded_at`,
      )
        .bind(root, month, f.receipt.id, f.receipt.revision, f.path, id, new Date().toISOString())
        .run();
      uploaded++;
    }
    if (uploaded === pending.length) {
      for (const text of await packageTexts(env, plan, origin))
        await putFile(graph, driveId, monthFolder, text.name, text.bytes, 'text/csv');
      if (plan.send.list.length && (!plan.send.last || plan.send.changed))
        await markSent(env, month, plan.send.hash, 'onedrive');
    }
  } catch (error) {
    if (!(error instanceof RetryLater)) throw error;
    wait = error.seconds;
  }
  const remaining = pending.length - uploaded;
  return { uploaded, remaining, total: plan.files.length, finished: remaining === 0 && !wait, wait };
}
