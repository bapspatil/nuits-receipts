import { env } from 'cloudflare:workers';
import { expect, test, vi } from 'vitest';
import { paymentDate, parseExtraction, settleChoice } from '../src/ai';
import { cleanText, documentText, preserve, processReceipt } from '../src/receipts';
import { modelResponse } from './model';

// Synthetic text shaped like a Stripe receipt PDF whose hyphens extract as U+0000.
const STRIPE_LIKE = [
  'Receipt',
  'Invoice number SAMPLE00\u00000001',
  'Receipt number 1234\u00005678',
  'Date paid October 22, 2026',
  'Sample Vendor Inc',
  'FI\u000000100 Helsinki',
  'Oct 22\u0000Nov 22, 2026 \u20ac82.07 1234\u00005678',
  'Tax\u0007to be paid\r\n\u20ac0.00',
].join('\n');

test('NUL from PDF text layers becomes "-" and other control characters become spaces', async () => {
  const clean = cleanText(STRIPE_LIKE);
  expect(clean).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
  expect(clean).toContain('Receipt number 1234-5678');
  expect(clean).toContain('Invoice number SAMPLE00-0001');
  expect(clean).toContain('FI-00100 Helsinki');
  expect(clean).toContain('Oct 22-Nov 22, 2026');
  expect(clean).toContain('Tax to be paid\n');
  expect(cleanText('a\tb\nc')).toBe('a\tb\nc');
  expect(await documentText(new TextEncoder().encode(STRIPE_LIKE), 'text/plain')).toBe(clean);
});

test('a single labelled payment date is read; conflicting or unlabelled dates are not', () => {
  expect(paymentDate('Date paid October 22, 2026')).toBe('2026-10-22');
  expect(paymentDate('Date paid Oct 2, 2026')).toBe('2026-10-02');
  expect(paymentDate('Paid on 5 September 2026')).toBe('2026-09-05');
  expect(paymentDate('Payment date: 2026-09-30')).toBe('2026-09-30');
  expect(paymentDate('Date paid October 22, 2026\nDate paid October 22, 2026')).toBe('2026-10-22');
  expect(paymentDate('Date paid October 22, 2026\nPayment date 2026-10-23')).toBeNull();
  expect(paymentDate('Date paid 10/22/2026')).toBe('2026-10-22');
  expect(paymentDate('Date paid 10/11/2026')).toBeNull();
  expect(paymentDate('Date paid Smarch 22, 2026')).toBeNull();
  expect(paymentDate('Date paid February 30, 2026')).toBeNull();
  expect(paymentDate('Oct 22, 2026')).toBeNull();
});

const nullIssue = { issue_date: { type: 'date', value: null, guess: '2026-10-22', confidence: 0.99, p_null: 0.91 } };
test('issue date falls back to the payment date only when the model read none', () => {
  const document = cleanText(STRIPE_LIKE);
  const fallback = parseExtraction(modelResponse(nullIssue), document);
  expect(fallback.facts.issue_date).toBe('2026-10-22');
  expect(fallback.reasons).not.toContain('uncertain_issue_date');
  const without = parseExtraction(modelResponse(nullIssue), 'Receipt with no dates');
  expect(without.facts.issue_date).toBeNull();
  expect(without.reasons).toContain('uncertain_issue_date');
  const printed = parseExtraction(modelResponse(), document);
  expect(printed.facts.issue_date).toBe('2026-09-01');
});

const symbol = (value: string, confidence = 0.7) => ({
  currency: { type: 'text', value, confidence, p_null: 0.04 },
});
const zeroVat = {
  total: { type: 'number', value: 82.07, confidence: 0.99, p_null: 0 },
  net: { type: 'number', value: 82.07, confidence: 0.96, p_null: 0.05 },
  vat_amount: { type: 'number', value: 0, confidence: 0.97, p_null: 0.05 },
};
test('a bare € or £ passes when amounts add up; $ and inconsistent amounts stay flagged', () => {
  for (const [sign, code] of [
    ['\u20ac', 'EUR'],
    ['\u00a3', 'GBP'],
  ]) {
    const result = parseExtraction(modelResponse({ ...symbol(sign!), ...zeroVat }));
    expect(result.facts.currency).toBe(code);
    expect(result.reasons).not.toContain('uncertain_currency');
  }
  expect(parseExtraction(modelResponse({ ...symbol('\u20ac') })).reasons).not.toContain('uncertain_currency');
  expect(parseExtraction(modelResponse({ ...symbol('$'), ...zeroVat })).reasons).toContain('uncertain_currency');
  const off = { ...zeroVat, net: { type: 'number', value: 80, confidence: 0.96, p_null: 0.05 } };
  expect(parseExtraction(modelResponse({ ...symbol('\u20ac'), ...off })).reasons).toContain('uncertain_currency');
  const noVat = { ...zeroVat, vat_amount: { type: 'number', value: null, confidence: 0.9, p_null: 0.97 } };
  expect(parseExtraction(modelResponse({ ...symbol('\u20ac'), ...noVat })).reasons).toContain('uncertain_currency');
  // A weak total is still tied down when net and VAT are settled and add up to it,
  // so only a weak total with a weak net leaves the currency open.
  const weakTotal = {
    ...zeroVat,
    total: { type: 'number', value: 82.07, confidence: 0.5, p_null: 0 },
    net: { type: 'number', value: 82.07, confidence: 0.5, p_null: 0.3 },
  };
  expect(parseExtraction(modelResponse({ ...symbol('\u20ac'), ...weakTotal })).reasons).toContain('uncertain_currency');
  const maybeAbsent = { currency: { type: 'text', value: '\u20ac', confidence: 0.7, p_null: 0.4 } };
  expect(parseExtraction(modelResponse({ ...maybeAbsent, ...zeroVat })).reasons).toContain('uncertain_currency');
});

const clef = (product: [string, number], expense: [string, number]) => ({
  answers: {
    product: {
      type: 'choice',
      choice: product[0],
      probabilities: { [product[0]]: product[1], other: 1 - product[1] },
      confidence: 0.5,
    },
    expense_type: {
      type: 'choice',
      choice: expense[0],
      probabilities: { [expense[0]]: expense[1], infra: (1 - expense[1]) / 2 },
      confidence: 0.7,
    },
  },
});
test('product and expense type are settled independently', () => {
  const raw = clef(['general', 0.74], ['subscriptions', 0.88]);
  expect(settleChoice(raw, 'product', ['general', 'app'], 'general')).toEqual({ value: 'general', reason: null });
  expect(settleChoice(raw, 'expense_type', ['infra', 'subscriptions', 'other'], 'other')).toEqual({
    value: 'subscriptions',
    reason: null,
  });
  expect(settleChoice(clef(['app', 0.6], ['infra', 0.9]), 'product', ['general', 'app'], 'general')).toEqual({
    value: 'general',
    reason: 'uncertain_product',
  });
  expect(settleChoice({ answers: {} }, 'product', ['general'], 'general').reason).toBe('classification_failed');
});

test('a Stripe-like receipt with a weak product score keeps its expense type and gets a date', async () => {
  const received = await preserve(env, {
    bytes: new TextEncoder().encode(STRIPE_LIKE.replace('Sample Vendor Inc', 'Megawatt Tools Corp')),
    media: 'text/plain',
    filename: 'receipt.txt',
    source: 'email',
  });
  const run = vi.fn(async (model: string, input: Record<string, unknown>) => {
    if (model === '@cf/cloudflare/clairic') {
      expect(String(input.state)).not.toContain('\u0000');
      return modelResponse({
        ...nullIssue,
        vendor: { type: 'text', value: 'Megawatt Tools Corp', confidence: 0.98, p_null: 0.03 },
        ...symbol('\u20ac'),
        ...zeroVat,
        vat_rate: { type: 'number', value: null, confidence: 0.9, p_null: 0.6 },
      });
    }
    return clef(['general', 0.74], ['subscriptions', 0.88]);
  });
  const row = await processReceipt({ ...env, AI_MODE: 'live', AI: { run } }, received.id);
  expect(row.issue_date).toBe('2026-10-22');
  expect(row.currency).toBe('EUR');
  expect(row.expense_type).toBe('subscriptions');
  const reasons = JSON.parse(row.review_reasons_json) as string[];
  for (const reason of ['classification_failed', 'uncertain_currency', 'uncertain_issue_date', 'missing_issue_date'])
    expect(reasons).not.toContain(reason);
});

test('the template seeds a vendor rule for Amp Frontier Corporation', () => {
  const sql = env.TEST_MIGRATIONS.flatMap((m) => m.queries).join('\n');
  expect(sql).toContain("('amp frontier','general','subscriptions')");
});
