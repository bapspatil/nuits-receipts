import { env } from 'cloudflare:workers';
import { expect, test, vi } from 'vitest';
import { preserve, processReceipt } from '../src/receipts';
import { modelResponse } from './model';

test('injected live Clairic and Clef validate request contracts and retain provider metadata', async () => {
  const received = await preserve(env, {
    bytes: new TextEncoder().encode('A synthetic live-contract fixture'),
    media: 'text/plain',
    filename: 'sample.txt',
    source: 'email',
  });
  const run = vi.fn(async (model: string, input: Record<string, unknown>) => {
    if (model === '@cf/cloudflare/clairic') {
      expect(input.model).toBe('clairic');
      expect(input.state).toContain('synthetic');
      expect(input.reference_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(input.fields).toMatchObject({
        total: { type: 'number', decimals: 2 },
        line_items: { type: 'list', items: 'text' },
      });
      return modelResponse();
    }
    expect(model).toBe('@cf/cloudflare/clef');
    expect(input.model).toBe('clef');
    expect(input.questions).toMatchObject({
      product: { type: 'choice', criteria: { app: 'App' } },
      expense_type: { type: 'choice', criteria: { infra: 'infra' } },
    });
    return {
      model: 'clef-fixture',
      answers: {
        product: {
          type: 'choice',
          choice: 'app',
          probabilities: { app: 0.9, general: 0.1 },
          confidence: 0.9,
        },
        expense_type: {
          type: 'choice',
          choice: 'infra',
          probabilities: { infra: 0.95, other: 0.05 },
          confidence: 0.95,
        },
      },
      usage: { input_tokens: 50, output_tokens: 5 },
    };
  });
  const row = await processReceipt({ ...env, AI_MODE: 'live', AI: { run } }, received.id);
  expect(run).toHaveBeenCalledTimes(2);
  expect(row.status).toBe('ready');
  expect(row.product).toBe('app');
  expect(row.expense_type).toBe('infra');
  expect(row.ai_json).toContain('input_tokens');
  expect(row.ai_json).toContain('clef-fixture');
});
test('images use documented embedded-object shape and malformed output is retained for review', async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const received = await preserve(env, {
    bytes,
    media: 'image/png',
    filename: 'sample.png',
    source: 'upload',
  });
  const run = vi.fn(async (_model: string, input: Record<string, unknown>) => {
    expect(input.images).toEqual([
      {
        content_type: 'image/png',
        base64: btoa(String.fromCharCode(...bytes)),
      },
    ]);
    return {
      model: 'malformed-fixture',
      answers: {},
      truncated: false,
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  });
  const row = await processReceipt({ ...env, AI_MODE: 'live', AI: { run } }, received.id);
  expect(row.status).toBe('needs_review');
  expect(row.ai_json).toContain('malformed-fixture');
  expect(row.review_reasons_json).toContain('invalid_model_output');
});

test('low-confidence extraction reaches the review UI instead of becoming ready', async () => {
  const row = await preserve(env, {
    bytes: new TextEncoder().encode('Synthetic uncertain invoice'),
    media: 'text/plain',
    filename: 'uncertain.txt',
    source: 'email',
  });
  await env.DB.prepare(
    "INSERT INTO vendor_rules(vendor_contains,product,expense_type) VALUES ('Sample','general','other')",
  ).run();
  const result = await processReceipt(
    {
      ...env,
      AI_MODE: 'live',
      AI: {
        // Net alone cannot vouch for the total; a confident VAT would (net + VAT = total).
        run: async () =>
          modelResponse({
            total: { type: 'number', value: 125.5, confidence: 0.89, p_null: 0.1 },
            vat_amount: { type: 'number', value: 25.5, confidence: 0.5, p_null: 0.1 },
          }),
      },
    },
    row.id,
  );
  expect(result.status).toBe('needs_review');
  expect(result.review_reasons_json).toContain('uncertain_total');
});
