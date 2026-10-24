import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import worker from '../src/index';
import { documentText, getReceipt } from '../src/receipts';

import { authorization, idFrom, request, pdfBytes, uploadPdf } from './helpers';

test('all routes require authentication and mutations require the exact Origin', async () => {
  for (const path of [
    '/',
    '/upload',
    '/export.csv',
    '/payments',
    '/imports/csv',
    '/rules',
    '/matches',
    '/receipts/' + 'a'.repeat(64),
    '/originals/' + 'a'.repeat(64),
  ]) {
    expect((await worker.fetch(new Request('http://localhost' + path), env)).status).toBe(401);
  }
  expect(
    (
      await request('/upload', {
        method: 'POST',
        headers: { Origin: 'http://evil.example' },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await worker.fetch(
        new Request('http://localhost', {
          headers: { Authorization: authorization },
        }),
        { ...env, NUITS_PASSWORD: undefined },
      )
    ).status,
  ).toBe(401);
});
test('text PDF travels through workerd extraction, original download, view, and CSV', async () => {
  expect(await documentText(pdfBytes(), 'application/pdf')).toContain('Sample Cloud Lantern Oy');
  const response = await uploadPdf();
  expect(response.status).toBe(303);
  const location = response.headers.get('Location')!;
  const row = await getReceipt(env, idFrom(response));
  expect(row.vendor).toBe('Sample Cloud Lantern Oy');
  expect(row.total_minor).toBe(12550);
  expect(row.vat_minor).toBe(2550);
  expect(row.status).toBe('ready');
  const original = await request('/originals/' + row.id);
  expect(original.headers.get('Content-Disposition')).toContain('attachment');
  expect(new Uint8Array(await original.arrayBuffer())).toEqual(pdfBytes());
  expect(await (await request(location)).text()).toContain('Sample Cloud Lantern Oy');
  const csv = await (await request('/export.csv?month=2026-09')).text();
  expect(csv).toContain('125.50');
  expect(csv).toContain('25.50');
});
