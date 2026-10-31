// Serving a stored file from R2.
import type { Env } from './env';
import { requireInput } from './domain';

// A stored file, whole or the byte range asked for, so the viewer can read a long PDF a range
// at a time. It is never cached (private, no-store, set for every response): a shared computer
// keeps no copy after sign-out. The ETag still lets a client that kept one revalidate.
export async function fileResponse(
  request: Request,
  env: Env,
  key: string,
  headers: Record<string, string>,
): Promise<Response> {
  const stored = await env.ORIGINALS.get(key, { range: request.headers, onlyIf: request.headers });
  requireInput(stored, 'Original not found', 404);
  const common = {
    ...headers,
    ETag: stored.httpEtag,
    'Accept-Ranges': 'bytes',
  };
  if (!('body' in stored)) return new Response(null, { status: 304, headers: common });
  const range = stored.range as { offset?: number; length?: number } | undefined;
  const partial = !!request.headers.get('Range') && range && range.offset !== undefined;
  const length = partial ? (range!.length ?? stored.size - range!.offset!) : stored.size;
  return new Response(request.method === 'HEAD' ? null : stored.body, {
    status: partial ? 206 : 200,
    headers: {
      ...common,
      'Content-Length': String(length),
      ...(partial ? { 'Content-Range': `bytes ${range!.offset}-${range!.offset! + length - 1}/${stored.size}` } : {}),
    },
  });
}
