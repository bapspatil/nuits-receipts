import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { EVENTS, feedback, isEvent, withDone, type EventKey } from '../src/events';
import { request } from './helpers';

const sources: Record<string, string> = JSON.parse(env.SOURCE_FILES);
const TX = 'a'.repeat(64),
  RID = 'b'.repeat(64),
  CREDIT = 'c'.repeat(64);

// Params each event needs for its full message and Undo.
const SAMPLE: Partial<Record<EventKey, Record<string, string>>> = {
  paid: { id: RID, on: '2026-09-03' },
  notPaid: { id: RID, on: '2026-09-03', note: 'cash' },
  matched: { tx: TX, rid: RID, name: 'Acme', kind: 'receipt', back: `/receipts/${RID}` },
  unmatched: { tx: TX, rid: RID, name: 'Acme' },
  notPurchase: { tx: TX, name: 'Acme' },
  needsReceipt: { tx: TX, name: 'Acme' },
  transferMade: { tx: TX, name: 'Acme' },
  transferUndone: { tx: TX, credit: CREDIT, reason: 'Moved to savings' },
  discarded: { n: '2', at: '2026-09-03T10:00:00.000Z', back: '/review' },
  restored: { n: '2' },
  merged: { n: '2' },
  imported: { inserted: '3', skipped: '1' },
  sent: { month: '2026-09' },
  driveMore: { n: '2', of: '5' },
  filesAdded: { added: '2' },
  settingReset: { label: 'App name', group: 'business', to: 'deploy' },
  accountRenamed: { name: 'Everyday' },
};

const pageFor = (event: EventKey) => {
  const query = new URLSearchParams({ done: event, ...SAMPLE[event] });
  return `/review?${query}`;
};

test('every event renders one non-empty status banner on a real page', async () => {
  for (const key of Object.keys(EVENTS) as EventKey[]) {
    const html = await (await request(pageFor(key))).text();
    const banners = [...html.matchAll(/role="status"[^>]*>([\s\S]*?)<\/(?:p|div)>/g)];
    expect(banners, key).toHaveLength(1);
    expect(banners[0]![1]!.replace(/<[^>]+>/g, '').trim(), key).not.toBe('');
  }
});

test('an event with an Undo posts the inverse route, and only when its params are well formed', () => {
  const undone = (key: EventKey, extra = {}) =>
    feedback(new URLSearchParams({ done: key, ...SAMPLE[key], ...extra }))?.undo;
  expect(undone('matched')).toEqual({
    action: '/matches',
    fields: { transaction_id: TX, action: 'unlink', return_to: `/receipts/${RID}` },
  });
  expect(undone('unmatched')?.fields).toMatchObject({ action: 'link', receipt_id: RID, confirm_exception: 'yes' });
  expect(undone('notPurchase')).toEqual({ action: `/payments/${TX}`, fields: { receipt_required: '1' } });
  expect(undone('needsReceipt')).toEqual({ action: `/payments/${TX}`, fields: { receipt_required: '0' } });
  expect(undone('transferMade')).toEqual({ action: `/transfers/${TX}/undo`, fields: {} });
  expect(undone('transferUndone')?.action).toBe('/transfers');
  expect(undone('paid')).toEqual({ action: `/receipts/${RID}/paid`, fields: {} });
  expect(undone('notPaid')?.fields).toMatchObject({ paid_outside_on: '2026-09-03' });
  expect(undone('discarded')).toEqual({
    action: '/restore',
    fields: { at: '2026-09-03T10:00:00.000Z', back: '/review' },
  });
  // A forged id or back path gets no Undo form.
  expect(undone('matched', { tx: 'nope' })).toBeNull();
  expect(undone('paid', { id: '../x' })).toBeNull();
  expect(undone('discarded', { back: 'https://evil.example/' })).toBeNull();
  expect(undone('transferUndone', { reason: '' })).toBeNull();
});

test('the Undo form on a page posts to the inverse route', async () => {
  const html = await (await request(pageFor('notPurchase'))).text();
  expect(html).toContain(
    `<form method="post" action="/payments/${TX}"><input type="hidden" name="receipt_required" value="1">`,
  );
});

test('address-bar text in a message is escaped', async () => {
  const html = await (
    await request(`/review?${new URLSearchParams({ done: 'matched', name: '<script>alert(1)</script>', tx: TX })}`)
  ).text();
  expect(html).not.toContain('<script>alert(1)</script>');
  expect(html).toContain('&lt;script&gt;');
});

test('withDone keeps the query and the fragment in order', () => {
  expect(withDone('saved', '/settings#rules')).toBe('/settings?done=saved#rules');
  expect(withDone('sent', '/?month=2026-10#send')).toBe('/?month=2026-10&done=sent#send');
  expect(withDone('merged', '/review', { n: 2, skip: null })).toBe('/review?done=merged&n=2');
});

test('every event key src/ redirects with exists in EVENTS', () => {
  const used = new Set<string>();
  for (const [file, text] of Object.entries(sources)) {
    if (file === 'events.ts') continue;
    for (const match of text.matchAll(/withDone\(\s*'([A-Za-z]+)'/g)) used.add(match[1]!);
    for (const match of text.matchAll(/[?&]done=([A-Za-z]+)/g)) used.add(match[1]!);
  }
  expect(used.size).toBeGreaterThan(20);
  for (const key of used) expect(isEvent(key), `${key} is not in EVENTS`).toBe(true);
});

test('every event is used by a redirect, so none go stale', () => {
  const all = Object.entries(sources)
    .filter(([file]) => file !== 'events.ts')
    .map(([, text]) => text)
    .join('\n');
  // 'discarded' and 'restored' are built from a template in discard.ts.
  const templated = new Set(['discarded', 'restored']);
  for (const key of Object.keys(EVENTS))
    if (!templated.has(key)) expect(all, key).toMatch(new RegExp(`'${key}'|done=${key}\\b`));
});

test('every Undo action is a POST route the app serves', () => {
  const index = sources['index.ts']!;
  expect(index).toContain("path === '/matches'");
  expect(index).toContain("path === '/restore'");
  expect(index).toContain("path === '/transfers'");
  expect(index).toContain('transfers\\/([a-f0-9]{64})\\/undo$');
  expect(index).toContain('receipts\\/([a-f0-9]{64})\\/paid$');
});

test('an unknown event says nothing', async () => {
  // Unknown or forged events say nothing rather than guess.
  const html = await (await request('/review?done=nope')).text();
  expect(html).not.toContain('role="status"');
});
