import { expect, test } from 'bun:test';

// Every synthetic fixture must keep its fields and its review decision.
// A change that sends a clean receipt to review, or lets an inconsistent one
// through, fails here with the harness's own report.
test('extraction eval: fixtures are extracted and decided as expected', () => {
  const run = Bun.spawnSync(['bun', `${import.meta.dir}/eval-extraction.ts`, '--json']);
  expect(run.exitCode).toBe(0);
  const { summary, rows } = JSON.parse(run.stdout.toString());
  const failures = rows
    .filter(
      (r: { review: boolean; expectReview: boolean; fields: Record<string, { ok: boolean }> }) =>
        r.review !== r.expectReview || Object.values(r.fields).some((f) => !f.ok),
    )
    .map((r: { name: string }) => r.name);
  expect(failures).toEqual([]);
  expect(summary.receipts).toBeGreaterThanOrEqual(13);
  expect(summary.fieldAccuracy).toBe(1);
});
