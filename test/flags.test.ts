import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { FLAGS, flagCards, flagFor } from '../src/flags';
import { emptyFacts, review } from '../src/domain';

const sources: Record<string, string> = JSON.parse(env.SOURCE_FILES);
const CODE = "'([a-z]+(?:_[a-z]+)+)'";

// Every review reason code src/ can write to review_reasons_json.
function emittedCodes(): Set<string> {
  const codes = new Set<string>(review(emptyFacts));
  const patterns = [
    new RegExp(`\\b(?:push|drop)\\(\\s*${CODE}\\)`, 'g'),
    new RegExp(`emailReview\\([^)]*?${CODE}\\)`, 'g'),
    new RegExp(`super\\(${CODE}\\)`, 'g'),
    // settleChoice's { value, reason }. Log lines use JSON.stringify({ reason: ... }) and are not codes.
    new RegExp(`,\\s*reason: ${CODE}`, 'g'),
    new RegExp(`\\?\\s*\\[${CODE}\\]`, 'g'),
    // Thrown InputError codes that processReceipt turns into reasons.
    new RegExp(`requireInput\\([^;]*?,\\s*(?<!422,\\s*)${CODE}\\)`, 'g'),
    // processReceipt's catch: ? 'invalid_model_output' : ... : 'extraction_failed';
    new RegExp(`[?:]\\s*${CODE}\\s*[;:]`, 'g'),
  ];
  for (const file of ['domain.ts', 'ai.ts', 'receipts.ts', 'banking.ts', 'sales.ts'])
    for (const pattern of patterns) for (const match of sources[file]!.matchAll(pattern)) codes.add(match[1]!);
  // uncertain_${key} templates in ai.ts: the extraction field list and settleChoice keys.
  const ai = sources['ai.ts']!;
  expect(ai.match(/`uncertain_\$\{key\}`/g)).toHaveLength(2);
  const fields = ai.match(/\[([^\]]+)\]\.includes\(key\)/)?.[1];
  expect(fields).toBeTruthy();
  for (const key of fields!.matchAll(/'([a-z_]+)'/g)) codes.add(`uncertain_${key[1]}`);
  for (const key of ai.matchAll(/settleChoice\([^,]+,\s*'([a-z_]+)'/g)) codes.add(`uncertain_${key[1]}`);
  // A receipt status from `reasons.length ? 'needs_review' : 'ready'`, not a reason.
  codes.delete('needs_review');
  return codes;
}

test('every review reason code the app emits has plain-language copy', () => {
  const codes = emittedCodes();
  // Spot-check the scan itself so a broken regex cannot pass silently.
  for (const known of [
    'missing_vendor',
    'uncertain_vat_amount',
    'uncertain_product',
    'uncertain_expense_type',
    'sender_unverified',
    'pdf_no_text',
    'original_missing',
    'invalid_model_output',
    'extraction_failed',
    'missing_eur',
    'probable_duplicate',
    'rule_conflict',
    'classification_failed',
    'model_truncated',
    'email_skipped_parts',
    'mime_failed',
  ])
    expect(codes).toContain(known);
  const missing = [...codes].filter((code) => !FLAGS[code]);
  expect(missing).toEqual([]);
});

test('flag copy is plain, punctuated and free of long dashes', () => {
  for (const [code, flag] of Object.entries(FLAGS)) {
    expect(flag.title, code).toMatch(/[.?]$/);
    const body = typeof flag.body === 'string' ? flag.body : flag.body({ currency: 'XYZ' } as never);
    expect(body, code).toMatch(/[.!]$/);
    expect(flag.title + body, code).not.toMatch(new RegExp('[\\u2013\\u2014]'));
    expect(flag.title + body, code).not.toMatch(/\b(uncertain|missing)_[a-z_]+/);
  }
});

test('codes for the same problem share one card and unknown codes fall back', () => {
  const cards = flagCards(['uncertain_vendor', 'missing_vendor', 'missing_issue_date', 'brand_new_code']);
  expect(cards.map((c) => c.codes)).toEqual([
    ['uncertain_vendor', 'missing_vendor'],
    ['missing_issue_date'],
    ['brand_new_code'],
  ]);
  expect(flagFor('brand_new_code').title).toBe('Something needs a look.');
});
