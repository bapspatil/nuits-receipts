// Every action returns to the list it came from, at the next open row, and every list says how
// many rows it really has. Each test here was a reviewer's repro on PR 5. Names are invented.
import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { seedBusyMonth } from './busy-month';
import { locationOf, request } from './helpers';

const get = async (path: string) => (await request(path)).text();
function post(path: string, fields: Record<string, string | string[]>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) body.append(k, one);
  return request(path, { method: 'POST', body });
}

test('J: a long search answers with the list, not a crash', async () => {
  const b = await seedBusyMonth();
  const vendor = 'Fake Long Name Trading Company of Northern Example Province Oy Ab';
  await env.DB.prepare('UPDATE receipts SET vendor=? WHERE id=?').bind(vendor, b.ready[0]!).run();
  const hit = await request(`/receipts?q=${encodeURIComponent(vendor.slice(5, 65))}`);
  expect(hit.status).toBe(200);
  expect(await hit.text()).toContain(`/receipts/${b.ready[0]}`);
  const miss = await request(`/receipts?q=${encodeURIComponent(vendor + ' and more')}`);
  expect(miss.status).toBe(200);
  expect(await miss.text()).toContain('Nothing matches');
  expect((await request(`/receipts?q=${'y'.repeat(5000)}`)).status).toBe(200);
});
