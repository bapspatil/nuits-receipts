import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { EVENTS, feedback, isEvent, withDone, type EventKey } from '../src/events';
import { FEEDBACK_TTL } from '../src/signing';
import { locationOf, request, signed } from './helpers';

const sources: Record<string, string> = JSON.parse(env.SOURCE_FILES);
const TX = 'a'.repeat(64),
  RID = 'b'.repeat(64);

// Params each event needs for its full message and Undo.
const SAMPLE: Partial<Record<EventKey, Record<string, string>>> = {
  paid: { id: RID, on: '2026-09-03' },
  matched: { tx: TX, rid: RID, name: 'Acme', kind: 'receipt', back: `/receipts/${RID}` },
  unmatched: { tx: TX, rid: RID, name: 'Acme' },
  notPurchase: { tx: TX, name: 'Acme' },
  needsReceipt: { tx: TX, name: 'Acme' },
  transferMade: { tx: TX, name: 'Acme' },
  discarded: { n: '2', at: '2026-09-03T10:00:00.000Z', back: '/review' },
  restored: { n: '2' },
  merged: { n: '2' },
  imported: { inserted: '3', skipped: '1' },
  sent: { month: '2026-09' },
  approvedLast: { month: '2026-09', step: 'match' },
  driveMore: { n: '2', of: '5' },
  filesAdded: { added: '2' },
  settingReset: { label: 'App name', group: 'business', to: 'deploy' },
  accountRenamed: { name: 'Everyday' },
};

const pageFor = (event: EventKey) => signed(`/review?${new URLSearchParams({ done: event, ...SAMPLE[event] })}`);

test('every event renders one non-empty status banner on a real page', async () => {
  for (const key of Object.keys(EVENTS) as EventKey[]) {
    const html = await (await request(await pageFor(key))).text();
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
  // The exception box is ticked only when the server said the pair was an exception.
  expect(undone('unmatched')?.fields).toEqual({ transaction_id: TX, receipt_id: RID, action: 'link' });
  expect(undone('unmatched', { exc: '1' })?.fields).toMatchObject({ confirm_exception: 'yes' });
  expect(undone('notPurchase')).toEqual({ action: `/payments/${TX}`, fields: { receipt_required: '1' } });
  expect(undone('needsReceipt')).toEqual({ action: `/payments/${TX}`, fields: { receipt_required: '0' } });
  expect(undone('transferMade')).toEqual({ action: `/transfers/${TX}/undo`, fields: {} });
  expect(undone('paid')).toEqual({ action: `/receipts/${RID}/paid`, fields: {} });
  // These two can't be undone from a link: the note was cleared or deleted with them.
  expect(undone('notPaid')).toBeNull();
  expect(undone('transferUndone')).toBeNull();
  expect(undone('discarded')).toEqual({
    action: '/restore',
    fields: { at: '2026-09-03T10:00:00.000Z', back: '/review' },
  });
  // A forged id or back path gets no Undo form.
  expect(undone('matched', { tx: 'nope' })).toBeNull();
  expect(undone('paid', { id: '../x' })).toBeNull();
  expect(undone('discarded', { back: 'https://evil.example/' })).toBeNull();
});

test('the Undo form on a page posts to the inverse route', async () => {
  const html = await (await request(await pageFor('notPurchase'))).text();
  expect(html).toContain(
    `<form method="post" action="/payments/${TX}"><input type="hidden" name="receipt_required" value="1">`,
  );
});

test('a link that is not genuine and fresh says nothing and offers no Undo', async () => {
  const forged = `/review?done=unmatched&tx=${TX}&rid=${RID}&name=Acme&exc=1`;
  const good = await signed(forged);
  const shows = async (path: string) => (await (await request(path)).text()).includes('role="status"');
  expect(await shows(good)).toBe(true);
  expect(await shows(forged)).toBe(false);
  // Any changed param, a swapped page, or a copied signature on other params fails.
  expect(await shows(good.replace('name=Acme', 'name=Mallory'))).toBe(false);
  expect(await shows(good.replace('exc=1', 'exc=0'))).toBe(false);
  expect(await shows(good.replace('/review', '/receipts'))).toBe(false);
  // Change the signature's first character for certain: a fixed 'A' is a no-op when it already starts with one.
  expect(await shows(good.replace(/sig=(.)/, (_, c: string) => `sig=${c === 'A' ? 'B' : 'A'}`))).toBe(false);
  expect(await shows(good.replace('done=unmatched', 'done=matched'))).toBe(false);
  const html = await (await request(forged)).text();
  expect(html).not.toContain('name="confirm_exception"');
  expect(html).not.toContain('Removed the match');
});

test('an expired link says nothing, a fresh one still does', async () => {
  const path = `/review?done=saved`;
  const now = Date.now();
  const shows = async (p: string) => (await (await request(p)).text()).includes('role="status"');
  expect(await shows(await signed(path, '', now - (FEEDBACK_TTL - 30) * 1000))).toBe(true);
  expect(await shows(await signed(path, '', now - (FEEDBACK_TTL + 30) * 1000))).toBe(false);
  // Not from the future either.
  expect(await shows(await signed(path, '', now + 10 * 60 * 1000))).toBe(false);
});

test('a genuine link shows the banner with its Undo form', async () => {
  const html = await (await request(await signed(`/review?done=notPurchase&tx=${TX}&name=Acme`))).text();
  expect(html).toContain('Acme is not a purchase');
  expect(html).toContain(`<form method="post" action="/payments/${TX}">`);
});

test('a redirect from the app is signed, and the page it lands on shows the banner', async () => {
  const response = await request('/review/merge', { method: 'POST', body: new FormData() });
  const location = response.headers.get('Location')!;
  expect(location).toMatch(/^\/receipts\?view=todo&done=merged&n=0&iat=\d+&sig=[A-Za-z0-9_-]{43}$/);
  expect(locationOf(response)).toBe('/receipts?view=todo&done=merged&n=0');
  expect(await (await request(location)).text()).toContain('Merged 0 duplicates.');
  // The same address without its signature says nothing.
  expect(await (await request(locationOf(response))).text()).not.toContain('Merged 0');
});

test('address-bar text in a message is escaped', async () => {
  const html = await (
    await request(
      await signed(`/review?${new URLSearchParams({ done: 'matched', name: '<script>alert(1)</script>', tx: TX })}`),
    )
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

test('the last approval points at the next step for its month, or just says it is done', () => {
  const said = (extra: string) => feedback(new URLSearchParams(`done=approvedLast${extra}`));
  expect(said('&month=2026-09&step=match')).toMatchObject({
    text: "Every receipt is checked. Next, match September's payments.",
    link: { href: '/payments?month=2026-09&view=todo', label: 'Open Bank' },
  });
  expect(said('&month=2026-09&step=send')).toMatchObject({
    text: 'Every receipt is checked. Next, send September to your accountant.',
    link: { href: '/?month=2026-09#send', label: 'Open September' },
  });
  expect(said('&month=2026-09&step=import')?.link?.href).toBe('/import');
  // Params that don't parse never build a link: the plain message and Bank.
  expect(said('&month=nope&step=send')).toMatchObject({
    text: 'Every receipt is checked.',
    link: { href: '/payments' },
  });
});
