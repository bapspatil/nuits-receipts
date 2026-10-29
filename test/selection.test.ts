import { expect, test } from 'vitest';
import {
  BULK_CAP,
  BULK_JS,
  bulkBar,
  bulkCheck,
  bulkTools,
  countOf,
  select,
  type BulkList,
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

test('the shipped reducer runs on its own, outside the module', () => {
  expect(BULK_JS).not.toContain('__name');
  const source = BULK_JS.slice(BULK_JS.lastIndexOf(')(') + 2, -2);
  const shipped = new Function(`return (${source})`)() as typeof select;
  const state = run(fresh(['a', 'b', 'c']), { type: 'toggle', id: 'a', range: false });
  expect(shipped(state, { type: 'toggle', id: 'c', range: true })).toEqual(
    select(state, { type: 'toggle', id: 'c', range: true }),
  );
  expect(() => new Function(BULK_JS)).not.toThrow();
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
  const tools = bulkTools(list, 25, false, '/receipts?select=1');
  expect(tools).toContain('<label class="pick" hidden><input type="checkbox" data-bulk-page>');
  expect(tools).toContain('href="/receipts?select=1" data-bulk-select>Select</a>');
  expect(bulkTools(list, 25, true, '/receipts')).toContain('>Done</a>');
  const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
  for (const html of [check, bar, tools, BULK_JS]) expect(html).not.toMatch(dashes);
});
