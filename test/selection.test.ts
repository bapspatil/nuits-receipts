import { expect, test } from 'vitest';
import {
  BULK_CAP,
  BULK_HELPERS,
  BULK_JS,
  bulkBar,
  bulkCheck,
  bulkTools,
  capped,
  countOf,
  escapeTo,
  postChunks,
  select,
  type Before,
  type BulkList,
  type Reply,
  type Selection,
} from '../src/bulk';
import { request } from './helpers';

const fresh = (order: string[]): Selection => ({ order, picked: [], anchor: null, all: false });
const run = (state: Selection, ...events: Parameters<typeof select>[1][]) => events.reduce(select, state);
const list: BulkList = {
  form: 'bulk-receipts',
  action: '/receipts/bulk',
  noun: ['receipt', 'receipts'],
  total: 120,
  scope: { month: '2026-09', back: '/receipts?month=2026-09' },
  actions: [
    { op: 'discard', label: 'Discard', tone: 'danger', confirm: 'Discard the selected receipts?' },
    { op: 'reread', label: 'Read again', max: 10 },
    { op: 'move', label: 'Move', fields: '<select name="kind"><option>sales</option></select>' },
    { op: 'restore', label: 'Restore', tone: 'primary' },
  ],
};

test('shift range selects from the anchor to the target in either direction and moves the anchor', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const down = run(fresh(ids), { type: 'toggle', id: 'b', range: false }, { type: 'toggle', id: 'd', range: true });
  expect(down.picked).toEqual(['b', 'c', 'd']);
  expect(down.anchor).toBe('d');
  const up = run(fresh(ids), { type: 'toggle', id: 'e', range: false }, { type: 'toggle', id: 'c', range: true });
  expect(up.picked).toEqual(['c', 'd', 'e']);
  const off = select(down, { type: 'toggle', id: 'b', range: true });
  expect(off.picked).toEqual([]);
  expect(off.anchor).toBe('b');
});

test('a range without an anchor toggles one row', () => {
  expect(select(fresh(['a', 'b']), { type: 'toggle', id: 'b', range: true }).picked).toEqual(['b']);
});

test('select all counts the whole filter until any row is unticked', () => {
  const all = select(fresh(['a', 'b', 'c']), { type: 'all' });
  expect(all.picked).toEqual(['a', 'b', 'c']);
  expect(countOf(all, 120)).toBe(120);
  const less = select(all, { type: 'toggle', id: 'b', range: false });
  expect(less.all).toBe(false);
  expect(countOf(less, 120)).toBe(2);
});

test('page on picks every row, off clears them and leaves all mode', () => {
  const on = select(fresh(['a', 'b']), { type: 'page', on: true });
  expect(countOf(on, 9)).toBe(2);
  const off = run(on, { type: 'all' }, { type: 'page', on: false });
  expect(off.picked).toEqual([]);
  expect(countOf(off, 9)).toBe(0);
});

test('clear resets the selection, all mode and the anchor', () => {
  const state = run(fresh(['a', 'b']), { type: 'toggle', id: 'a', range: false }, { type: 'all' }, { type: 'clear' });
  expect(state).toEqual(fresh(['a', 'b']));
});

// The helpers as the browser gets them: their source alone, outside the module.
const shipped = new Function(`return (${BULK_HELPERS})`)() as {
  select: typeof select;
  capped: typeof capped;
  escapeTo: typeof escapeTo;
  postChunks: typeof postChunks;
};

test('the shipped reducer runs on its own, outside the module', () => {
  expect(BULK_JS).not.toContain('__name');
  expect(BULK_JS).toContain(BULK_HELPERS);
  const state = run(fresh(['a', 'b', 'c']), { type: 'toggle', id: 'a', range: false });
  expect(shipped.select(state, { type: 'toggle', id: 'c', range: true })).toEqual(
    select(state, { type: 'toggle', id: 'c', range: true }),
  );
  expect(() => new Function(BULK_JS)).not.toThrow();
});

test('Escape closes an open step first, never clears from a field, and clears the selection otherwise', () => {
  const at = { typing: false, stepOpen: false, picked: true };
  expect(shipped.escapeTo(at)).toBe('clear');
  expect(shipped.escapeTo({ ...at, typing: true })).toBe('none');
  expect(shipped.escapeTo({ ...at, typing: true, stepOpen: true })).toBe('step');
  expect(shipped.escapeTo({ ...at, stepOpen: true })).toBe('step');
  expect(shipped.escapeTo({ ...at, picked: false })).toBe('none');
});

// A server that adds the posted totals to its own, as runBulk does; each id is done unless it starts with s.
function server(fail: (call: number) => Reply | 'throw' | null | undefined = () => undefined) {
  const calls: { ids: string[]; before: Before | null }[] = [];
  const post = async (ids: string[], before: Before | null): Promise<Reply | null> => {
    calls.push({ ids, before });
    const failed = fail(calls.length);
    if (failed === 'throw') throw new Error('offline');
    if (failed !== undefined) return failed;
    const n = ids.filter((id) => !id.startsWith('s')).length;
    return {
      n: (before?.n ?? 0) + n,
      skipped: (before?.skipped ?? 0) + ids.length - n,
      location: `/receipts?n=${calls.length}`,
    };
  };
  return { calls, post };
}

test('chunks post the running totals of what was done and skipped, and land on the last banner', async () => {
  const { calls, post } = server();
  const steps: number[] = [];
  const end = await shipped.postChunks([['a', 's1'], ['s2', 'b'], ['c']], post, (sent) => steps.push(sent));
  expect(end).toEqual({ url: '/receipts?n=3' });
  expect(calls.map((c) => c.before)).toEqual([
    { n: 0, skipped: 0 },
    { n: 1, skipped: 1 },
    { n: 2, skipped: 2 },
  ]);
  expect(steps).toEqual([2, 4, 5]);
  const one = server();
  await shipped.postChunks([['a']], one.post, () => {});
  expect(one.calls[0]!.before).toBeNull();
});

test('after a post has gone out, a failure is reported and nothing is posted again', async () => {
  for (const bad of ['throw', null, { location: '/x' } as unknown as Reply] as const) {
    const { calls, post } = server((call) => (call === 2 ? bad : undefined));
    expect(await shipped.postChunks([['a'], ['b'], ['c']], post, () => {})).toEqual({
      error: '1 of 3 done. That did not work. Reload to see what changed.',
    });
    expect(calls).toHaveLength(2);
  }
  // A 200 with no usable body on the only post: reported too, never resubmitted.
  const first = server(() => 'throw');
  expect(await shipped.postChunks([['a', 'b']], first.post, () => {})).toEqual({
    error: 'That did not work. Reload to see what changed.',
  });
  expect(first.calls).toHaveLength(1);
  const refused = server((call) => (call === 2 ? { error: 'Up to 10 at a time.' } : undefined));
  expect(await shipped.postChunks([['a'], ['b']], refused.post, () => {})).toEqual({
    error: '1 of 2 done. Up to 10 at a time.',
  });
  const moved = server(() => ({ url: '/login' }));
  expect(await shipped.postChunks([['a']], moved.post, () => {})).toEqual({ url: '/login' });
});

test('in all mode the bar turns off the actions whose cap is below the filter', () => {
  expect(shipped.capped(true, 120, 10)).toBe('Up to 10 at a time');
  expect(shipped.capped(true, 8, 10)).toBeNull();
  expect(shipped.capped(false, 120, 10)).toBeNull();
  expect(shipped.capped(true, 120, 0)).toBeNull();
});

test('the bulk script is served as JavaScript and app pages allow same-origin scripts', async () => {
  const js = await request('/assets/bulk.js');
  expect(js.status).toBe(200);
  expect(js.headers.get('Content-Type')).toContain('text/javascript');
  expect(await js.text()).toBe(BULK_JS);
  for (const path of ['/', '/receipts', '/review'])
    expect((await request(path)).headers.get('Content-Security-Policy'), path).toContain("script-src 'self';");
});

test('the bar and row checks are real form controls that work without the script', () => {
  const check = bulkCheck(list, 'r<1>', 'Café & co');
  expect(check).toContain('<input type="checkbox" name="id" value="r&lt;1&gt;" form="bulk-receipts">');
  expect(check).toContain('Select Café &amp; co');
  const bar = bulkBar(list);
  expect(bar).toMatch(
    /^<form id="bulk-receipts" class="bulkbar" data-bulk [^>]*method="post" action="\/receipts\/bulk">/,
  );
  expect(bar).toContain('<input type="hidden" name="month" value="2026-09">');
  expect(bar).toContain('<input type="hidden" name="all" value="">');
  expect(bar).toContain('aria-live="polite"');
  expect(bar).toContain('<button type="reset" class="linkbtn">Clear</button>');
  expect(bar).toContain('data-bulk-all hidden>Select all 120 receipts</button>');
  expect(bar).toMatch(
    /<details class="bulkstep"><summary class="btn danger">Discard<\/summary>.*Discard the selected receipts\?.*name="op" value="discard"/,
  );
  expect(bar).toContain('<button name="op" value="reread" class="btn" data-max="10">Read again</button>');
  expect(bar).toMatch(/<details class="bulkmore"><summary class="btn">More<\/summary>.*value="restore"/);
  expect(bulkBar({ ...list, total: BULK_CAP + 1 })).not.toContain('data-bulk-all');
  const tools = bulkTools(list, 25);
  expect(tools).toContain('<label class="pick" hidden><input type="checkbox" data-bulk-page>');
  expect(tools).not.toContain('select=1');
  expect(tools).not.toContain('data-bulk-select');
  const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
  for (const html of [check, bar, tools, BULK_JS]) expect(html).not.toMatch(dashes);
});
