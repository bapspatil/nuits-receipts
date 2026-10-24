// Feedback links are signed. A redirect that carries ?done= gets iat (issued-at,
// in seconds) and sig (HMAC-SHA256 over the page, the event and every other
// param). The page shell shows a banner, and its Undo form, only for a link
// whose signature verifies and is under FEEDBACK_TTL old; anything else is
// dropped as if ?done= were not there. So a link someone else made up can
// neither say something nor post an Undo.
//
// The key is 32 random bytes made once and kept in the settings table under a
// reserved name (like INVOICES_ADDRESS_PREVIOUS, it is not a setting, so
// nothing reads or shows it). Each request loads it at most once.
import type { Env } from './env';

export const FEEDBACK_TTL = 15 * 60;
const KEY_NAME = '_FEEDBACK_KEY';
const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const fromBase64Url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function loadKey(env: Env): Promise<CryptoKey> {
  const read = () =>
    env.DB.prepare('SELECT value_json FROM settings WHERE key=?').bind(KEY_NAME).first<string>('value_json');
  let stored = await read();
  if (!stored) {
    const fresh = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    // Two requests may race here; the first insert wins and both then read it back.
    await env.DB.prepare(
      "INSERT INTO settings(key,value_json,updated_at,updated_by) VALUES (?,?,?,'system') ON CONFLICT(key) DO NOTHING",
    )
      .bind(KEY_NAME, JSON.stringify(fresh), new Date().toISOString())
      .run();
    stored = await read();
  }
  if (!stored) throw new Error('feedback key unavailable');
  return crypto.subtle.importKey(
    'raw',
    fromBase64Url(JSON.parse(stored) as string),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

// What the signature covers: the page, then every param but sig, sorted.
function payload(pathname: string, params: URLSearchParams): Uint8Array {
  const pairs = [...params]
    .filter(([k]) => k !== 'sig')
    .sort(([a, x], [b, y]) => (a === b ? x.localeCompare(y) : a.localeCompare(b)));
  return encoder.encode(['feedback-v1', pathname, ...pairs.map(([k, v]) => `${k}=${v}`)].join('\n'));
}

export type Signer = {
  // location with iat and sig added when it carries ?done=; any other location is returned as is.
  sign(location: string, now?: number): Promise<string>;
  // url unchanged when its ?done= link is fresh and genuine, else without done, iat and sig.
  verify(url: URL, now?: number): Promise<URL>;
};

// A signer that loads the key on first use and keeps it for this request only.
export function signer(env: Env): Signer {
  let key: Promise<CryptoKey> | undefined;
  const get = () => (key ??= loadKey(env));
  return {
    async sign(location, now = Date.now()) {
      const [rest = '', hash] = location.split('#');
      const url = new URL(rest, 'http://app.invalid');
      if (!url.searchParams.has('done')) return location;
      url.searchParams.set('iat', String(Math.floor(now / 1000)));
      const signature = await crypto.subtle.sign('HMAC', await get(), payload(url.pathname, url.searchParams));
      const tail = `iat=${url.searchParams.get('iat')}&sig=${toBase64Url(new Uint8Array(signature))}`;
      return `${rest}${rest.includes('?') ? '&' : '?'}${tail}${hash === undefined ? '' : '#' + hash}`;
    },
    async verify(url, now = Date.now()) {
      if (!url.searchParams.has('done')) return url;
      const iat = Number(url.searchParams.get('iat')),
        sig = url.searchParams.get('sig') ?? '';
      const age = Math.floor(now / 1000) - iat;
      let ok = false;
      try {
        ok =
          Number.isSafeInteger(iat) &&
          age >= -60 &&
          age <= FEEDBACK_TTL &&
          /^[A-Za-z0-9_-]{43}$/.test(sig) &&
          (await crypto.subtle.verify(
            'HMAC',
            await get(),
            fromBase64Url(sig),
            payload(url.pathname, url.searchParams),
          ));
      } catch (error) {
        console.warn(JSON.stringify({ reason: 'feedback_key_unavailable', error: String(error) }));
      }
      if (ok) return url;
      const plain = new URL(url);
      for (const name of ['done', 'iat', 'sig']) plain.searchParams.delete(name);
      return plain;
    },
  };
}
