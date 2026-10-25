import { env } from 'cloudflare:workers';
import { expect, test, vi } from 'vitest';
import worker from '../src/index';
import { authorization, request } from './helpers';

const get = (path: string, cookie = '') =>
  worker.fetch(
    new Request('https://localhost' + path, {
      headers: { Authorization: authorization, ...(cookie ? { Cookie: cookie } : {}) },
    }),
    env,
  );

test('a read starts anywhere, a write on the primary, and a bookmark carries on from the last response', async () => {
  const spy = vi.mocked(env.DB.withSession);
  await request('/');
  expect(spy).toHaveBeenLastCalledWith('first-unconstrained');
  await request('/rules', { method: 'POST', body: new FormData() });
  expect(spy).toHaveBeenLastCalledWith('first-primary');
  await get('/', '__Host-d1=0000000b-00000003-00004f53-a1b2c3; other=1');
  expect(spy).toHaveBeenLastCalledWith('0000000b-00000003-00004f53-a1b2c3');
  // Anything that isn't a bookmark is ignored.
  await get('/', '__Host-d1=<script>');
  expect(spy).toHaveBeenLastCalledWith('first-unconstrained');
});

test('with a real session, pages render and hand the browser a bookmark cookie', async () => {
  vi.restoreAllMocks();
  const response = await get('/review');
  expect(response.status).toBe(200);
  const cookie = response.headers.get('Set-Cookie') ?? '';
  expect(cookie).toMatch(/^__Host-d1=[0-9a-f-]+; Path=\/; Secure; HttpOnly; SameSite=Lax$/i);
  // The bookmark sent back starts the next request's session.
  const again = await get('/review', cookie.split(';')[0]);
  expect(again.status).toBe(200);
});
