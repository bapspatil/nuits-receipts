import { expect, test } from 'vitest';
import { env } from 'cloudflare:workers';
import { arrivalMonth } from '../src/arrival';
import { seed } from './package-helpers';

const now = new Date('2026-11-15T12:00:00Z');
const doubtful = { status: 'needs_review', review_reasons_json: '["uncertain_issue_date"]' } as const;

test('a month whose only open item has a date in question does not hold Home', async () => {
  await env.DB.prepare('DELETE FROM receipts').run();
  // One receipt read as March 2019, its date flagged: that is not a month anyone sends.
  await seed({ issue_date: '2019-03-05', ...doubtful });
  expect(await arrivalMonth(env, now)).toEqual({ month: '2026-11', current: '2026-11', why: null });
  // An older month with a real document still wins over a later one, and the misdated one is passed over.
  await seed({ issue_date: '2026-09-10', status: 'ready', review_reasons_json: '[]' });
  expect(await arrivalMonth(env, now)).toMatchObject({ month: '2026-09', why: 'unsent' });
});

test('a month with a document that is not in question stays the arrival month, flagged dates or not', async () => {
  await env.DB.prepare('DELETE FROM receipts').run();
  await seed({ issue_date: '2019-03-05', ...doubtful });
  await seed({ issue_date: '2019-03-20', status: 'ready', review_reasons_json: '[]' });
  expect(await arrivalMonth(env, now)).toMatchObject({ month: '2019-03', why: 'unsent' });
  // Another reason to look at it (not the date) is still an open item of its month.
  await env.DB.prepare('DELETE FROM receipts').run();
  await seed({ issue_date: '2019-03-05', status: 'needs_review', review_reasons_json: '["vat_rate_mismatch"]' });
  expect(await arrivalMonth(env, now)).toMatchObject({ month: '2019-03', why: 'unsent' });
});

test('a month already sent is not skipped when its documents changed, whatever their dates', async () => {
  await env.DB.prepare('DELETE FROM receipts').run();
  await env.DB.prepare('DELETE FROM month_sends').run();
  await seed({ issue_date: '2026-10-05', ...doubtful });
  await env.DB.prepare(
    "INSERT INTO month_sends VALUES ('2026-10','2026-11-01T10:00:00Z','download',1,0,'old','[]')",
  ).run();
  expect(await arrivalMonth(env, now)).toMatchObject({ month: '2026-10', why: 'changed' });
});
