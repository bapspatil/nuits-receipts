import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { expect, test, vi } from 'vitest';
import { documentText, getReceipt, preserve, processReceipt, receiveEmail, visibleText } from '../src/receipts';
import { hash } from '../src/domain';
import { pdfBytes, uploadPdf, request } from './helpers';

test('concurrent duplicate deliveries create one receipt and one successful extraction', async () => {
  const responses = await Promise.all([uploadPdf(), uploadPdf()]);
  expect(responses.map((r) => r.status)).toEqual([303, 303]);
  expect(responses[0]!.headers.get('Location')).toBe(responses[1]!.headers.get('Location'));
  expect(await env.DB.prepare('SELECT count(*) AS n FROM receipts').first('n')).toBe(1);
  const row = await getReceipt(env, await hash(pdfBytes()));
  expect(row.status).toBe('ready');
  const attempt = row.attempt_id;
  await uploadPdf();
  expect((await getReceipt(env, row.id)).attempt_id).toBe(attempt);
});
test('HTML conversion keeps visible content without scripts and styles', async () => {
  const text = await visibleText(
    '<p>vendor: Sample Sender</p><script>secret</script><style>hidden</style><p>total: 12</p>',
  );
  expect(text).toContain('vendor: Sample Sender');
  expect(text).toContain('total: 12');
  expect(text).not.toContain('secret');
  expect(text).not.toContain('hidden');
});
test('envelope allowlist drops blocked senders before reading the message', async () => {
  const start = vi.fn();
  const stream = new ReadableStream<Uint8Array>({ pull: start });
  const context = createExecutionContext();
  await receiveEmail({ from: 'evil@example.com', raw: stream }, env, context);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM receipts').first('n')).toBe(0);
  expect((await env.ORIGINALS.list()).objects).toHaveLength(0);
  await stream.cancel();
});
// Headers Cloudflare Email Routing prepends after authenticating the envelope.
export const cloudflarePass = 'Authentication-Results: mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass;\r\n';
function message(raw: string, auth = cloudflarePass) {
  return new Response(auth + raw).body!;
}
test('approved sender attachment and body-only mail deduplicate and preserve source', async () => {
  const context = createExecutionContext();
  const attachment = [
    'From: arbitrary-vendor@example.com',
    'To: receipts@example.com',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary=sample',
    '',
    '--sample',
    'Content-Type: text/plain',
    '',
    'Forwarded content',
    '--sample',
    'Content-Type: application/pdf',
    'Content-Disposition: attachment; filename="sample.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    env.SAMPLE_PDF,
    '--sample--',
    '',
  ].join('\r\n');
  await receiveEmail({ from: 'OWNER@EXAMPLE.COM', raw: message(attachment) }, env, context);
  await waitOnExecutionContext(context);
  const row = await getReceipt(env, await hash(pdfBytes()));
  expect(row.status).toBe('ready');
  expect(row.email_key).toMatch(/^emails\//);
  const repeatContext = createExecutionContext();
  await receiveEmail({ from: 'owner@example.com', raw: message(attachment) }, env, repeatContext);
  await waitOnExecutionContext(repeatContext);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM receipts').first('n')).toBe(1);
  const bodyContext = createExecutionContext();
  const html =
    '<p>vendor: Sample Body Oy</p><p>issue_date: 2026-09-01</p><p>currency: EUR</p><p>total: 12.55</p><p>net: 10.00</p><p>vat_amount: 2.55</p><p>vat_rate: 25.5</p><p>invoice_number: BODY-1</p>';
  await receiveEmail(
    {
      from: 'bookkeeping@example.org',
      raw: message('MIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n' + html),
    },
    env,
    bodyContext,
  );
  await waitOnExecutionContext(bodyContext);
  const bodyId = await env.DB.prepare("SELECT id FROM receipts WHERE media_type='text/html'").first<string>('id');
  const body = await getReceipt(env, bodyId!);
  expect(body.vendor).toBe('Sample Body Oy');
  const download = await request('/originals/' + body.id);
  expect(download.headers.get('Content-Disposition')).toContain('attachment');
  expect(download.headers.get('X-Content-Type-Options')).toBe('nosniff');
});
test('object-only partial write repairs on resubmission; expired leases are reclaimed', async () => {
  const id = await hash(pdfBytes());
  await env.ORIGINALS.put('receipts/' + id, pdfBytes());
  const row = await preserve(env, {
    bytes: pdfBytes(),
    filename: 'sample.pdf',
    media: 'application/pdf',
    source: 'upload',
  });
  await env.DB.prepare(
    "UPDATE receipts SET status='processing',lease_until='2000-01-01T00:00:00Z',attempt_id='old' WHERE id=?",
  )
    .bind(id)
    .run();
  expect((await processReceipt(env, row.id)).status).toBe('ready');
});
test('failed extraction preserves original and explicit Retry succeeds', async () => {
  const row = await preserve(env, {
    bytes: pdfBytes(),
    filename: 'sample.pdf',
    media: 'application/pdf',
    source: 'upload',
  });
  const failed = await processReceipt(
    {
      ...env,
      AI_MODE: 'live',
      AI: {
        run: async () => {
          throw new Error('unavailable');
        },
      },
    },
    row.id,
  );
  expect(failed.status).toBe('needs_review');
  expect(await env.ORIGINALS.head(row.original_key)).not.toBeNull();
  expect((await processReceipt(env, row.id, { retry: true })).total_minor).toBe(12550);
});
test('R2 failure never creates metadata; D1 failure leaves a repairable original', async () => {
  const put = vi.spyOn(env.ORIGINALS, 'put').mockRejectedValueOnce(new Error('storage failure'));
  await expect(
    preserve(env, {
      bytes: pdfBytes(),
      filename: 'x',
      media: 'application/pdf',
      source: 'upload',
    }),
  ).rejects.toThrow();
  put.mockRestore();
  expect(await env.DB.prepare('SELECT count(*) AS n FROM receipts').first('n')).toBe(0);
  const prepare = vi.spyOn(env.DB, 'prepare').mockImplementationOnce(() => {
    throw new Error('D1 failed');
  });
  await expect(
    preserve(env, {
      bytes: pdfBytes(),
      filename: 'x',
      media: 'application/pdf',
      source: 'upload',
    }),
  ).rejects.toThrow();
  prepare.mockRestore();
  expect(await env.ORIGINALS.head('receipts/' + (await hash(pdfBytes())))).not.toBeNull();
  expect(
    (
      await preserve(env, {
        bytes: pdfBytes(),
        filename: 'x',
        media: 'application/pdf',
        source: 'upload',
      })
    ).status,
  ).toBe('pending');
});
test('corrupt and empty PDFs become review work without losing originals', async () => {
  const row = await preserve(env, {
    bytes: new TextEncoder().encode('%PDF-1.7 broken'),
    filename: 'corrupt.pdf',
    media: 'application/pdf',
    source: 'upload',
  });
  expect((await processReceipt(env, row.id)).status).toBe('needs_review');
  await expect(documentText(new Uint8Array(), 'application/pdf')).rejects.toThrow();
});

test('scan-only and excessive-page PDFs are review records rather than fabricated facts', async () => {
  for (const [base64, reason] of [
    [env.BLANK_PDF, 'pdf_no_text'],
    [env.TOO_MANY_PAGES_PDF, 'pdf_too_many_pages'],
  ]) {
    const bytes = Uint8Array.from(atob(base64!), (c) => c.charCodeAt(0));
    const row = await preserve(env, {
      bytes,
      filename: 'blank.pdf',
      media: 'application/pdf',
      source: 'upload',
    });
    const result = await processReceipt(env, row.id);
    expect(result.status).toBe('needs_review');
    expect(result.review_reasons_json).toContain(reason);
    expect(result.total_minor).toBeNull();
  }
});
const pdfMail = () =>
  [
    'From: Owner <owner@example.com>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary=sample',
    '',
    '--sample',
    'Content-Type: application/pdf',
    'Content-Disposition: attachment; filename="sample.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    env.SAMPLE_PDF,
    '--sample--',
    '',
  ].join('\r\n');
test('spoofed allowlisted envelope that fails SPF is dropped without storage or extraction', async () => {
  const context = createExecutionContext();
  await receiveEmail(
    {
      from: 'owner@example.com',
      raw: message(pdfMail(), 'Authentication-Results: mx.cloudflare.net; spf=softfail; dkim=pass; dmarc=none;\r\n'),
    },
    env,
    context,
  );
  await waitOnExecutionContext(context);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM receipts').first('n')).toBe(0);
  expect((await env.ORIGINALS.list()).objects).toHaveLength(0);
});
test('mail without Cloudflare authentication results is quarantined for review, not extracted', async () => {
  const context = createExecutionContext();
  // A forged result lower in the message does not count without Cloudflare's own header on top.
  await receiveEmail(
    { from: 'sender@example.net', raw: message(pdfMail(), 'Authentication-Results: mx.google.com; spf=pass\r\n') },
    env,
    context,
  );
  await waitOnExecutionContext(context);
  const rows = await env.DB.prepare(
    'SELECT status, review_reasons_json, media_type, attempt_id, vendor FROM receipts',
  ).all();
  expect(rows.results).toEqual([
    {
      status: 'needs_review',
      review_reasons_json: '["sender_unverified"]',
      media_type: 'message/rfc822',
      attempt_id: null,
      vendor: null,
    },
  ]);
});
