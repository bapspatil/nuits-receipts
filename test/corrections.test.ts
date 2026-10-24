import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { correctReceipt, getReceipt, preserve, processReceipt } from '../src/receipts';
import { eurValue } from '../src/banking';
import { pdfBytes, request, uploadPdf, idFrom } from './helpers';

async function receipt() {
  const response = await uploadPdf();
  return getReceipt(env, idFrom(response));
}
function form(revision: number, extra: Record<string, string> = {}) {
  const values = {
    revision: String(revision),
    vendor: 'Sample Cloud Lantern Oy',
    invoice_number: 'SAMPLE-1001',
    issue_date: '2026-09-04',
    due_date: '2026-09-18',
    currency: 'EUR',
    total: '125.50',
    net: '100.00',
    vat: '25.50',
    vat_rate: '25.5',
    product: 'app',
    expense_type: 'infra',
    action: 'save',
    ...extra,
  };
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}
test('corrections reject stale forms and invalid money, dates, and enums', async () => {
  const row = await receipt();
  const invalidForms: Record<string, string>[] = [
    { total: '12.001' },
    { issue_date: '2026-02-30' },
    { product: 'invented' },
    { expense_type: 'invented' },
    { eur_override: '10.00' },
  ];
  for (const invalid of invalidForms) {
    expect(
      (
        await request('/receipts/' + row.id, {
          method: 'POST',
          body: form(row.revision, invalid),
        })
      ).status,
    ).toBe(422);
  }
  expect(
    (
      await request('/receipts/' + row.id, {
        method: 'POST',
        body: form(row.revision),
      })
    ).status,
  ).toBe(303);
  expect(
    (
      await request('/receipts/' + row.id, {
        method: 'POST',
        body: form(row.revision),
      })
    ).status,
  ).toBe(409);
});
test('manual values and categories survive Retry while raw facts remain intact', async () => {
  const row = await receipt();
  await correctReceipt(
    env,
    row.id,
    form(row.revision, {
      vendor: 'Corrected vendor',
      total: '251.00',
      net: '200.00',
      vat: '51.00',
    }),
  );
  const retried = await processReceipt(env, row.id, { retry: true });
  expect(retried.vendor).toBe('Corrected vendor');
  expect(retried.total_minor).toBe(25100);
  expect(retried.product).toBe('app');
  expect(retried.ai_json).toContain('Sample Cloud Lantern Oy');
  expect(retried.manual_fields_json).toContain('Corrected vendor');
});
test('manual approval needs complete tax facts and records an exception reason', async () => {
  const row = await receipt();
  await expect(
    correctReceipt(
      env,
      row.id,
      form(row.revision, {
        action: 'approve',
        invoice_number: '',
        net: '',
        approval_reason: 'No printed number',
      }),
    ),
  ).rejects.toThrow('Fill in the seller');
  await correctReceipt(
    env,
    row.id,
    form(row.revision, {
      action: 'approve',
      invoice_number: '',
      approval_reason: 'No printed number',
    }),
  );
  const corrected = await getReceipt(env, row.id);
  expect(corrected.status).toBe('ready');
  expect(corrected.reviewed_at).not.toBeNull();
  expect(corrected.manual_fields_json).toContain('No printed number');
});
test('EUR override requires a reason and overrides native or bank amounts until cleared', async () => {
  const row = await receipt();
  await correctReceipt(
    env,
    row.id,
    form(row.revision, {
      eur_override: '120.12',
      eur_override_reason: 'Confirmed accounting amount',
    }),
  );
  expect(await eurValue(env, await getReceipt(env, row.id))).toMatchObject({
    source: 'manual',
    minor: 12012,
  });
  await correctReceipt(env, row.id, form(row.revision + 1));
  expect(await eurValue(env, await getReceipt(env, row.id))).toMatchObject({
    source: 'native',
    minor: 12550,
  });
});
test('stale AI completion cannot overwrite a correction', async () => {
  const row = await preserve(env, {
    bytes: pdfBytes(),
    media: 'application/pdf',
    filename: 'sample.pdf',
    source: 'upload',
  });
  let begin: () => void = () => {},
    release: (value: unknown) => void = () => {};
  const started = new Promise<void>((resolve) => {
    begin = resolve;
  });
  const response = new Promise<unknown>((resolve) => {
    release = resolve;
  });
  const processing = processReceipt(
    {
      ...env,
      AI_MODE: 'live',
      AI: {
        run: async () => {
          begin();
          return response;
        },
      },
    },
    row.id,
  );
  await started;
  await correctReceipt(env, row.id, form(row.revision, { vendor: 'Manual winner' }));
  release({
    model: 'invalid',
    answers: {},
    truncated: false,
    usage: { input_tokens: 0, output_tokens: 0 },
  });
  await processing;
  const saved = await getReceipt(env, row.id);
  expect(saved.vendor).toBe('Manual winner');
  expect(saved.status).toBe('ready');
  expect(saved.revision).toBe(1);
});
test('duplicates are excluded from totals and cannot form chains or cycles', async () => {
  const original = await receipt();
  const duplicate = await preserve(env, {
    bytes: new TextEncoder().encode('duplicate bytes'),
    media: 'text/plain',
    filename: 'duplicate.txt',
    source: 'email',
  });
  await correctReceipt(env, duplicate.id, form(0, { duplicate_of: original.id }));
  expect(await (await request('/?month=2026-09')).text()).toContain('EUR 125.50');
  const csv = await (await request('/export.csv?month=2026-09')).text();
  expect(csv).not.toContain(duplicate.id);
  await expect(
    correctReceipt(env, original.id, form(original.revision, { duplicate_of: duplicate.id })),
  ).rejects.toThrow();
  await expect(
    correctReceipt(env, original.id, form(original.revision, { duplicate_of: original.id })),
  ).rejects.toThrow();
});
test('rules apply to future receipts and conflicting priorities require review', async () => {
  const original = await receipt();
  const rule = new URLSearchParams({
    vendor_contains: 'Sample Cloud',
    context_contains: '',
    bank_alias: 'Sample Bank Descriptor',
    priority: '10',
    product: 'website',
    expense_type: 'subscriptions',
  });
  expect((await request('/rules', { method: 'POST', body: rule })).status).toBe(303);
  expect((await getReceipt(env, original.id)).product).toBe('general');
  expect((await processReceipt(env, original.id, { retry: true })).product).toBe('website');
  await env.DB.prepare(
    "INSERT INTO vendor_rules(vendor_contains,priority,product,expense_type) VALUES ('Sample Cloud',10,'hosting','infra')",
  ).run();
  const conflict = await processReceipt(env, original.id, { retry: true });
  expect(conflict.status).toBe('needs_review');
  expect(conflict.review_reasons_json).toContain('rule_conflict');
});

test('saving unchanged facts cannot silently approve model or duplicate warnings', async () => {
  const row = await receipt();
  await env.DB.prepare("UPDATE receipts SET status='needs_review',review_reasons_json=? WHERE id=?")
    .bind(JSON.stringify(['uncertain_total', 'model_truncated', 'input_truncated', 'probable_duplicate']), row.id)
    .run();
  await correctReceipt(env, row.id, form(row.revision));
  const saved = await getReceipt(env, row.id);
  expect(saved.status).toBe('needs_review');
  expect(saved.review_reasons_json).toContain('uncertain_total');
  expect(saved.review_reasons_json).toContain('model_truncated');
});

test('Retry clears a bank match when its new extracted amount invalidates that match', async () => {
  const row = await receipt();
  const { importBankCsv, parsePreset } = await import('../src/banking');
  const csv = 'Transaction ID;Date;Amount;Currency;Payee\nr;2026-09-07;-125,50;EUR;Sample Cloud Lantern Oy\n';
  await importBankCsv(env, {
    bytes: new TextEncoder().encode(csv),
    parsed: parsePreset(csv, 'retry-account', 'EUR'),
    collision: '',
  });
  expect((await eurValue(env, row)).source).toBe('bank');
  const values: Record<string, unknown> = {
    vendor: 'Sample Cloud Lantern Oy',
    invoice_number: 'SAMPLE-1001',
    issue_date: '2026-09-04',
    due_date: null,
    currency: 'EUR',
    total: 251,
    net: 200,
    vat_amount: 51,
    vat_rate: 25.5,
    line_items: [],
  };
  const answers = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      {
        type: ['total', 'net', 'vat_amount', 'vat_rate'].includes(key)
          ? 'number'
          : key.endsWith('date')
            ? 'date'
            : key === 'line_items'
              ? 'list'
              : 'text',
        value,
        confidence: 1,
        p_null: 0,
      },
    ]),
  );
  await env.DB.prepare(
    "INSERT INTO vendor_rules(vendor_contains,product,expense_type) VALUES ('Sample Cloud Lantern','general','other')",
  ).run();
  await processReceipt(
    {
      ...env,
      AI_MODE: 'live',
      AI: {
        run: async () => ({
          model: 'fixture',
          answers,
          truncated: false,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      },
    },
    row.id,
    { retry: true },
  );
  const updated = await getReceipt(env, row.id);
  expect(updated.total_minor).toBe(25100);
  expect((await eurValue(env, updated)).source).toBe('native');
  expect((await eurValue(env, updated)).minor).toBe(25100);
});
