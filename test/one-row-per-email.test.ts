// One inbound email is one receipt: a Stripe-style email with a receipt PDF and
// an invoice PDF for the same charge must not count the charge twice.
import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { expect, test } from 'vitest';
import { getReceipt, preserve, receiveEmail } from '../src/receipts';
import { mergeDuplicates, mergePlan } from '../src/dedupe';
import { locationOf, request, signed } from './helpers';

const pass = 'Authentication-Results: mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass;\r\n';

async function textPdf(lines: string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date('2026-09-01T00:00:00Z'));
  pdf.setModificationDate(new Date('2026-09-01T00:00:00Z'));
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, i) => page.drawText(line, { x: 45, y: 780 - i * 24, size: 11, font }));
  return pdf.save({ useObjectStreams: false });
}
const b64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
// "key: value" lines are what the mock extractor reads.
const charge = (kind: 'Receipt' | 'Invoice', extra: string[] = []) =>
  textPdf([
    kind,
    ...extra,
    'vendor: Sample Boat Inc',
    'invoice_number: OQGHKVUR-0001',
    'issue_date: 2026-10-23',
    'currency: USD',
    'total: 20.00',
    'net: 20.00',
    'vat_amount: 0',
    'vat_rate: 0',
    'line_items: Sample plan',
  ]);

type Part = { filename: string; type: string; bytes: Uint8Array };
function email(parts: Part[], body = 'Forwarded receipt', from = 'owner@example.com'): ReadableStream {
  const raw = [
    `From: ${from}`,
    'To: receipts@example.com',
    'Subject: Fwd: Your receipt from Sample Boat',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary=b1',
    '',
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
    ...parts.flatMap((p) => [
      '--b1',
      `Content-Type: ${p.type}`,
      `Content-Disposition: attachment; filename="${p.filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      b64(p.bytes),
    ]),
    '--b1--',
    '',
  ].join('\r\n');
  return new Response(pass + raw).body!;
}
async function deliver(raw: ReadableStream, from = 'owner@example.com') {
  const context = createExecutionContext();
  await receiveEmail({ from, to: 'receipts@example.com', raw }, env, context);
  await waitOnExecutionContext(context);
}
const live = async () =>
  (await env.DB.prepare('SELECT * FROM receipts WHERE duplicate_of IS NULL ORDER BY received_at,id').all()).results;

test('a receipt PDF and an invoice PDF for one charge become one receipt, both files kept', async () => {
  const receipt = await charge('Receipt', ['Receipt number 2983-5731']);
  const invoice = await charge('Invoice');
  await deliver(
    email([
      { filename: 'Receipt-2983-5731.pdf', type: 'application/pdf', bytes: receipt },
      { filename: 'Invoice-OQGHKVUR-0001.pdf', type: 'application/pdf', bytes: invoice },
    ]),
  );
  const rows = await live();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ filename: 'Invoice-OQGHKVUR-0001.pdf', total_minor: 2000, currency: 'USD' });
  const other = await env.DB.prepare('SELECT * FROM receipts WHERE duplicate_of IS NOT NULL').all();
  expect(other.results).toHaveLength(1);
  expect(other.results[0]).toMatchObject({ filename: 'Receipt-2983-5731.pdf', duplicate_of: rows[0]!.id });
  // Both PDFs stay in R2, and the receipt page links the second file.
  const keys = (await env.ORIGINALS.list({ prefix: 'receipts/' })).objects.map((o) => o.key);
  expect(keys).toHaveLength(2);
  const html = await (await request(`/receipts/${rows[0]!.id}`)).text();
  expect(html).toContain(`/originals/${other.results[0]!.id}`);
  expect(html).toContain('Receipt-2983-5731.pdf');
  // Only one row waits in Review.
  const review = await (await request('/review')).text();
  expect(review.match(/href="\/receipts\/[a-f0-9]{64}"/g) ?? []).toHaveLength(1);
});

test('an attachment that read nothing does not beat one that read a vendor and total', async () => {
  const blank = Uint8Array.from(atob(env.BLANK_PDF), (c) => c.charCodeAt(0));
  const receipt = await charge('Receipt');
  await deliver(
    email([
      { filename: 'Invoice-0001.pdf', type: 'application/pdf', bytes: blank },
      { filename: 'Receipt-0001.pdf', type: 'application/pdf', bytes: receipt },
    ]),
  );
  const rows = await live();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ filename: 'Receipt-0001.pdf', total_minor: 2000 });
});

test('two different charges in one email stay two receipts', async () => {
  const a = await charge('Invoice');
  const b = await textPdf([
    'Invoice',
    'vendor: Sample Boat Inc',
    'invoice_number: X-2',
    'issue_date: 2026-10-24',
    'currency: USD',
    'total: 35.00',
    'line_items: Other plan',
  ]);
  await deliver(
    email([
      { filename: 'Invoice-1.pdf', type: 'application/pdf', bytes: a },
      { filename: 'Invoice-2.pdf', type: 'application/pdf', bytes: b },
    ]),
  );
  expect(await live()).toHaveLength(2);
});

test('the same charge forwarded again in another email is marked a duplicate', async () => {
  await deliver(
    email([{ filename: 'Invoice-OQGHKVUR-0001.pdf', type: 'application/pdf', bytes: await charge('Invoice') }]),
  );
  await deliver(
    email(
      [{ filename: 'Receipt-2983-5731.pdf', type: 'application/pdf', bytes: await charge('Receipt', ['copy']) }],
      'Again',
    ),
  );
  const rows = await live();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ filename: 'Invoice-OQGHKVUR-0001.pdf' });
});

test('a PDF sent as application/octet-stream is read as a PDF, not the body', async () => {
  await deliver(email([{ filename: 'lasku.pdf', type: 'application/octet-stream', bytes: await charge('Invoice') }]));
  const rows = await live();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ media_type: 'application/pdf', filename: 'lasku.pdf', total_minor: 2000 });
});

test('when the PDF reads nothing, the email body is read instead', async () => {
  const blank = Uint8Array.from(atob(env.BLANK_PDF), (c) => c.charCodeAt(0));
  await deliver(
    email(
      [{ filename: 'lasku.pdf', type: 'application/pdf', bytes: blank }],
      ['Helen Sähköverkko Oy', 'Laskun päivämäärä 23.10.2026', 'Laskun summa 45,20 €'].join('\r\n'),
    ),
  );
  const rows = await live();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    media_type: 'text/plain',
    total_minor: 4520,
    currency: 'EUR',
    issue_date: '2026-10-23',
  });
  const kept = await env.DB.prepare("SELECT count(*) n FROM receipts WHERE filename='lasku.pdf' AND duplicate_of=?")
    .bind(rows[0]!.id)
    .first('n');
  expect(kept).toBe(1);
});

test('a forwarded body-only receipt takes its vendor from the forwarded From line', async () => {
  const body = [
    '---------- Forwarded message ---------',
    'From: Finnkino <kuitti@finnkino.fi>',
    'Subject: Kuitti Finnkino+ -tilauksestasi',
    '',
    'Tilauspäivä 10.10.2026',
    'Yhteensä 15,90 €',
  ].join('\r\n');
  await deliver(email([], body));
  const rows = await live();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ vendor: 'Finnkino', total_minor: 1590, currency: 'EUR', issue_date: '2026-10-10' });
});

// Rows made before this fix: one per attachment.
async function legacyRow(filename: string, emailKey: string | null, facts: Record<string, unknown>) {
  const row = await preserve(env, {
    bytes: new TextEncoder().encode(filename + JSON.stringify(facts)),
    filename,
    media: 'text/plain',
    source: emailKey ? 'email' : 'upload',
    emailKey: emailKey ?? undefined,
  });
  const keys = Object.keys(facts);
  await env.DB.prepare(
    `UPDATE receipts SET status='needs_review',review_reasons_json='[]',${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`,
  )
    .bind(...keys.map((k) => facts[k]), row.id)
    .run();
  return row.id;
}
const openRouter = {
  vendor: 'OpenRouter, Inc',
  issue_date: '2026-10-10',
  currency: 'USD',
  total_minor: 1085,
  invoice_number: '6SKTTZIY-0001',
};

test('Merge duplicates folds existing per-attachment rows, keeps files, and is safe to run twice', async () => {
  const r1 = await legacyRow('Receipt-2602-1108.pdf', 'emails/a.eml', openRouter);
  const i1 = await legacyRow('Invoice-6SKTTZIY-0001.pdf', 'emails/a.eml', openRouter);
  // Another email, same charge: merged across emails by vendor, amount, date and number.
  const again = await legacyRow('Invoice-copy.pdf', 'emails/b.eml', openRouter);
  // Same email but a different charge: left alone.
  const other = await legacyRow('Invoice-2.pdf', 'emails/a.eml', {
    ...openRouter,
    total_minor: 5297,
    invoice_number: 'Z-7',
  });
  // An upload with no number: never merged automatically.
  const loose = await legacyRow('photo.pdf', null, { ...openRouter, invoice_number: null });
  const objects = (await env.ORIGINALS.list()).objects.length;

  const review = await (await request('/review')).text();
  expect(review).toContain('action="/review/merge"');
  expect(review).toMatch(/Merge 2\b/);
  expect((await mergePlan(env)).length).toBe(2);

  const response = await request('/review/merge', { method: 'POST' });
  expect(response.status).toBe(303);
  expect(locationOf(response)).toContain('done=merged&n=2');
  const dup = async (id: string) => (await getReceipt(env, id)).duplicate_of;
  expect(await dup(i1)).toBeNull();
  expect(await dup(r1)).toBe(i1);
  expect(await dup(again)).toBe(i1);
  expect(await dup(other)).toBeNull();
  expect(await dup(loose)).toBeNull();
  expect((await env.ORIGINALS.list()).objects.length).toBe(objects);

  expect(await mergeDuplicates(env)).toBe(0);
  expect(await (await request('/review')).text()).not.toContain('action="/review/merge"');
  expect(await (await request(await signed('/review?done=merged&n=2'))).text()).toContain('Merged 2 duplicates.');
});

test('Merge keeps a row you edited or matched as the one that counts', async () => {
  const receipt = await legacyRow('Receipt-1.pdf', 'emails/c.eml', openRouter);
  const invoice = await legacyRow('Invoice-1.pdf', 'emails/c.eml', openRouter);
  await env.DB.prepare(`UPDATE receipts SET manual_fields_json='{"vendor":"OpenRouter"}' WHERE id=?`)
    .bind(receipt)
    .run();
  expect(await mergeDuplicates(env)).toBe(1);
  expect((await getReceipt(env, invoice)).duplicate_of).toBe(receipt);
  expect((await getReceipt(env, receipt)).duplicate_of).toBeNull();
});
