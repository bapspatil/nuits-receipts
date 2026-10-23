// Extraction eval: runs the full decision pipeline (document text, recorded
// Clairic answers, src/parse.ts cross-checks, review rules) over receipt
// fixtures and reports field accuracy and how many receipts would need review.
//
//   bun scripts/eval-extraction.ts                    # test/fixtures/receipts
//   bun scripts/eval-extraction.ts --dir <dir>        # another fixture dir (.txt or .pdf + .json)
//   bun scripts/eval-extraction.ts --src <dir>        # evaluate another checkout's src/ (before/after)
//   bun scripts/eval-extraction.ts --json             # machine-readable output
//
// A fixture is <name>.txt (or <name>.pdf) plus <name>.json:
//   { "about": "...", "expected": { "vendor": "...", "total_minor": 8207, ... },
//     "expect_review": false, "clairic": <recorded @cf/cloudflare/clairic response> }
// Expected values may be a list of accepted alternatives. Fields left out are not scored.
// No network: answers are recorded. Recording needs Workers AI and is done outside this script.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(option('--dir') ?? `${root}/test/fixtures/receipts`);
const src = resolve(option('--src') ?? `${root}/src`);
const asJson = args.includes('--json');

const ai = await import(`${src}/ai.ts`);
const domain = await import(`${src}/domain.ts`);
const receipts = await import(`${src}/receipts.ts`);
// The template's seeded vendor rules (schema/0001_template.sql).
const rules = [
  { vendor_contains: 'cloudflare' },
  { vendor_contains: 'openai' },
  { vendor_contains: 'anthropic' },
  { vendor_contains: 'amp frontier' },
];
const FIELDS = [
  'vendor',
  'invoice_number',
  'issue_date',
  'currency',
  'total_minor',
  'net_minor',
  'vat_minor',
  'vat_rate_bps',
] as const;

type Row = {
  name: string;
  review: boolean;
  expectReview: boolean;
  reasons: string[];
  fields: Record<string, { got: unknown; want: unknown; ok: boolean }>;
  inputTokens: number;
};
const rows: Row[] = [];
const names = [
  ...new Set(
    readdirSync(dir)
      .filter((f) => /\.(txt|pdf)$/.test(f))
      .map((f) => f.replace(/\.(txt|pdf)$/, '')),
  ),
].sort();
for (const name of names) {
  const meta = JSON.parse(readFileSync(`${dir}/${name}.json`, 'utf8'));
  const document = existsSync(`${dir}/${name}.txt`)
    ? readFileSync(`${dir}/${name}.txt`, 'utf8')
    : await receipts.documentText(new Uint8Array(readFileSync(`${dir}/${name}.pdf`)), 'application/pdf');
  const result = ai.parseExtraction(meta.clairic, document, rules);
  const suppress: string[] = result.suppress ?? [];
  const reasons = [
    ...new Set([...result.reasons, ...domain.review(result.facts).filter((r: string) => !suppress.includes(r))]),
  ];
  const fields: Row['fields'] = {};
  for (const field of FIELDS) {
    if (!(field in meta.expected)) continue;
    const want = meta.expected[field];
    const got = result.facts[field];
    const accepted = Array.isArray(want) ? want : [want];
    fields[field] = { got, want, ok: accepted.some((w) => w === got) };
  }
  rows.push({
    name,
    review: reasons.length > 0,
    expectReview: !!meta.expect_review,
    reasons,
    fields,
    inputTokens: Number(meta.clairic?.usage?.input_tokens ?? 0),
  });
}

const scored = rows.flatMap((r) => Object.values(r.fields));
const summary = {
  receipts: rows.length,
  fieldAccuracy: scored.filter((f) => f.ok).length / Math.max(1, scored.length),
  fieldsScored: scored.length,
  needsReview: rows.filter((r) => r.review).length,
  // Receipts that should be clean but were sent to review, and the reverse.
  falseReview: rows.filter((r) => r.review && !r.expectReview).length,
  missedReview: rows.filter((r) => !r.review && r.expectReview).length,
  cleanAutoApproved: rows.filter((r) => !r.expectReview && !r.review).length,
  cleanTotal: rows.filter((r) => !r.expectReview).length,
  // Clairic: $0.10 per million input tokens (Workers AI pricing, Oct 2026).
  clairicUsdPerReceipt: rows.reduce((s, r) => s + r.inputTokens, 0) / Math.max(1, rows.length) / 1e7,
};
if (asJson) console.log(JSON.stringify({ summary, rows }, null, 1));
else {
  for (const r of rows) {
    const wrong = Object.entries(r.fields)
      .filter(([, f]) => !f.ok)
      .map(([k, f]) => `${k}=${JSON.stringify(f.got)} (want ${JSON.stringify(f.want)})`);
    const verdict = r.review === r.expectReview ? 'ok ' : 'BAD';
    console.log(
      `${verdict} ${r.name.padEnd(34)} ${r.review ? 'review' : 'ready '}  ${r.reasons.join(', ') || '-'}${wrong.length ? `\n      wrong: ${wrong.join('; ')}` : ''}`,
    );
  }
  console.log(
    `\n${summary.receipts} receipts · field accuracy ${(summary.fieldAccuracy * 100).toFixed(1)}% of ${summary.fieldsScored} · needs review ${summary.needsReview}/${summary.receipts} · clean auto-approved ${summary.cleanAutoApproved}/${summary.cleanTotal} · false review ${summary.falseReview} · missed review ${summary.missedReview} · Clairic ≈ $${summary.clairicUsdPerReceipt.toFixed(5)}/receipt`,
  );
}
