// Optional Cloudflare Access mode. When ACCESS_TEAM_DOMAIN, ACCESS_AUD and
// ACCESS_ALLOWED_EMAILS are set, Cloudflare Access signs people in at the
// edge and this Worker checks the signed token Access adds to every request
// (Cf-Access-Jwt-Assertion) instead of HTTP Basic. The check is defence in
// depth: a request that skips Access (a misconfigured or deleted Access app,
// another route) is refused here. See docs/ENVIRONMENT.md#cloudflare-access.

export type AccessConfig = {
  // https://<team>.cloudflareaccess.com, no trailing slash. Also the JWT issuer.
  teamDomain: string;
  aud: string;
  emails: ReadonlySet<string>;
};

type Jwk = JsonWebKey & { kid?: string };
type Fetcher = (input: string) => Promise<Response>;

const CERT_TTL_MS = 60 * 60 * 1000;
// Allowed clock difference between Access and this Worker.
const SKEW_SECONDS = 60;
const certs = new Map<string, { at: number; keys: Map<string, CryptoKey> }>();

export function resetAccessCertCache(): void {
  certs.clear();
}

function decode(part: string): Uint8Array {
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
function json(part: string): Record<string, unknown> {
  const value: unknown = JSON.parse(new TextDecoder().decode(decode(part)));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JWT part is not an object');
  return value as Record<string, unknown>;
}

async function loadKeys(teamDomain: string, fetcher: Fetcher): Promise<Map<string, CryptoKey>> {
  const response = await fetcher(`${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Access certs returned ${response.status}`);
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys ?? []) {
    if (jwk.kty !== 'RSA' || !jwk.kid || !jwk.n || !jwk.e) continue;
    keys.set(
      jwk.kid,
      await crypto.subtle.importKey(
        'jwk',
        { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      ),
    );
  }
  return keys;
}

// Keys are cached per isolate for an hour and refetched once when a token
// names a key id we have not seen (Access rotates its signing keys).
async function key(kid: string, teamDomain: string, fetcher: Fetcher, now: number): Promise<CryptoKey | undefined> {
  const cached = certs.get(teamDomain);
  if (cached && now - cached.at < CERT_TTL_MS && cached.keys.has(kid)) return cached.keys.get(kid);
  const keys = await loadKeys(teamDomain, fetcher);
  certs.set(teamDomain, { at: now, keys });
  return keys.get(kid);
}

// Returns the signed-in email when the token is valid for this app and the
// email is allowed, otherwise null. Never throws for a bad token.
export async function verifyAccessJwt(
  token: string | null,
  access: AccessConfig,
  fetcher: Fetcher = (input) => fetch(input),
  now = Date.now(),
): Promise<string | null> {
  if (!token || token.length > 16 * 1024) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts as [string, string, string];
    const header = json(h);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
    const publicKey = await key(header.kid, access.teamDomain, fetcher, now);
    if (!publicKey) return null;
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      decode(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
    if (!valid) return null;
    const claims = json(p);
    const seconds = Math.floor(now / 1000);
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(access.aud)) return null;
    if (claims.iss !== access.teamDomain) return null;
    if (typeof claims.exp !== 'number' || claims.exp + SKEW_SECONDS < seconds) return null;
    if (typeof claims.nbf === 'number' && claims.nbf - SKEW_SECONDS > seconds) return null;
    if (typeof claims.iat === 'number' && claims.iat - SKEW_SECONDS > seconds) return null;
    if (typeof claims.email !== 'string') return null;
    const email = claims.email.trim().toLowerCase();
    return access.emails.has(email) ? email : null;
  } catch {
    return null;
  }
}
