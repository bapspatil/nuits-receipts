// The structure of every control, read off the rendered pages of a busy month: each button and
// button-link carries one icon and a visible word, no list row holds a primary, the registries
// keep one icon per meaning, and each page's sprite holds the icons it uses and no others.
import { FOLDER_ICONS, KINDS } from '../src/archive';
import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { ACTIONS } from '../src/actions';
import { ICON_PATHS } from '../src/icons';
import { STATUS } from '../src/status';
import { seedBusyMonth } from './busy-month';
import { locationOf, request } from './helpers';

// Two actions may share an icon when they are the same act on a different scope.
const SHARED_ICONS: readonly (readonly string[])[] = [
  ['match', 'matchAll'],
  ['undo', 'restore'],
];

async function pages(): Promise<Record<string, string>> {
  const b = await seedBusyMonth();
  const [discarded, reading] = [b.todo[2]!, b.todo[3]!];
  await env.DB.batch([
    env.DB.prepare("UPDATE receipts SET discarded_at='2026-09-20T10:00:00Z',discard_reason='personal' WHERE id=?").bind(
      discarded,
    ),
    env.DB.prepare("UPDATE receipts SET status='processing' WHERE id=?").bind(reading),
  ]);
  const form = new FormData();
  form.set('op', 'discard');
  form.set('list', 'receipts');
  form.set('view', 'todo');
  form.set('upto', '50');
  form.append('id', b.todo[4]!);
  const acted = locationOf(await request('/receipts/bulk', { method: 'POST', body: form }));
  const ready = b.ready[0]!;
  const paths = [
    '/',
    `/?month=${b.month}`,
    '/receipts?view=todo',
    `/receipts?view=todo&month=${b.month}`,
    '/',
    `/receipts?view=all&kind=sales&month=${b.month}`,
    '/?show=discarded',
    '/?show=reading',
    `/receipts/${b.todo[0]}?from=todo`,
    `/receipts/${b.todo[1]}?from=todo`,
    `/receipts/${b.sales[0]}?from=todo`,
    `/receipts/${ready}`,
    `/receipts/${discarded}`,
    `/receipts/${reading}`,
    `/payments?month=${b.month}&view=todo`,
    `/payments?month=${b.month}&view=all`,
    '/settings?open=senders',
    '/import',
    '/add',
    '/help',
    '/no-such-page',
    acted,
  ];
  const out: Record<string, string> = {};
  for (const path of paths) out[path] = await (await request(path)).text();
  return out;
}

const text = (html: string) =>
  html
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
const used = (html: string) => [...html.matchAll(/<use href="#i-([a-z0-9-]+)"/g)].map((m) => m[1]!);

test('every button, button link and button summary has exactly one icon and a visible word', async () => {
  const all = await pages();
  let seen = 0;
  for (const [path, html] of Object.entries(all)) {
    const controls = [
      ...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g),
      ...html.matchAll(/<a\b[^>]*\bclass="[^"]*\bbtn\b[^"]*"[^>]*>[\s\S]*?<\/a>/g),
      ...html.matchAll(/<summary\b[^>]*\bclass="[^"]*\bbtn\b[^"]*"[^>]*>[\s\S]*?<\/summary>/g),
    ].map((m) => m[0]);
    for (const control of controls) {
      seen++;
      expect(control.match(/<use /g)?.length, `${path}: ${control.slice(0, 200)}`).toBe(1);
      expect(text(control), `${path}: ${control.slice(0, 200)}`).not.toBe('');
    }
  }
  expect(seen).toBeGreaterThan(100);
});

test('no list row holds a primary, and red appears only behind a confirm step', async () => {
  const all = await pages();
  let rows = 0;
  for (const [path, html] of Object.entries(all)) {
    const lists = [
      ...html.matchAll(/<(ul|ol) class="[^"]*\b(?:list|pays|rowlist)\b[^"]*"[\s\S]*?<\/\1>/g),
      ...html.matchAll(/<section class="held"[\s\S]*?<\/section>/g),
    ].map((m) => m[0]);
    for (const list of lists)
      for (const [li] of list.matchAll(/<li\b[\s\S]*?<\/li>/g)) {
        rows++;
        expect(li, path).not.toMatch(/class="[^"]*\bprimary\b/);
      }
    for (const m of html.matchAll(/class="btn danger"/g))
      expect(html.slice(0, m.index).lastIndexOf('<details'), path).toBeGreaterThan(
        html.slice(0, m.index).lastIndexOf('</details>'),
      );
  }
  expect(rows).toBeGreaterThan(50);
});

test('no two actions share an icon except the ones that are one act at two scopes', () => {
  const byIcon = new Map<string, string[]>();
  for (const [key, action] of Object.entries(ACTIONS))
    byIcon.set(action.icon, [...(byIcon.get(action.icon) ?? []), key]);
  const shared = [...byIcon.values()].filter((keys) => keys.length > 1);
  const names = (groups: readonly (readonly string[])[]) => groups.map((keys) => [...keys].sort().join('+')).sort();
  expect(names(shared)).toEqual(names(SHARED_ICONS));
});

test('every registry icon exists in the sprite, and every sprite icon is used by a registry, the nav or the month arrows', () => {
  const NAV = ['house', 'receipt', 'landmark', 'sliders-horizontal', 'chevron-left', 'chevron-right'];
  const wanted = new Set<string>([
    ...Object.values(ACTIONS).map((a) => a.icon),
    ...Object.values(STATUS).map((s) => s.icon),
    ...Object.values(KINDS).map((k) => k.icon),
    ...Object.values(FOLDER_ICONS),
    ...NAV,
  ]);
  for (const icon of wanted) expect(Object.keys(ICON_PATHS), icon).toContain(icon);
  const unused = Object.keys(ICON_PATHS).filter((icon) => !wanted.has(icon));
  expect(unused, 'remove it from scripts/app-sprite.mjs and run `bun run sprite`').toEqual([]);
});

test('each page ships a sprite with every icon it references and no other', async () => {
  const all = await pages();
  for (const [path, html] of Object.entries(all)) {
    const referenced = new Set(used(html));
    expect(referenced.size, path).toBeGreaterThan(0);
    const sprites = [...html.matchAll(/<svg hidden[^>]*>([\s\S]*?)<\/svg>/g)];
    expect(sprites, path).toHaveLength(1);
    const defined = [...sprites[0]![1]!.matchAll(/<symbol id="i-([a-z0-9-]+)"/g)].map((m) => m[1]!);
    expect(new Set(defined).size, `${path}: a symbol twice`).toBe(defined.length);
    expect([...new Set(defined)].sort(), path).toEqual([...referenced].sort());
  }
});

test('each status renders from the registry with its word, tone and icon', () => {
  for (const [key, status] of Object.entries(STATUS)) {
    expect(Object.keys(ICON_PATHS), key).toContain(status.icon);
    expect(['warn', 'info', 'ok', 'muted'], key).toContain(status.tone);
  }
});
