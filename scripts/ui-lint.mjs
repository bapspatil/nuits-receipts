#!/usr/bin/env node
// Lints the rendered pages of a running instance against scripts/ui-policy.json with lintapple,
// at each viewport the policy names. Rerun it on every UI PR.
//
//   AUTH=owner:password node scripts/ui-lint.mjs --base http://127.0.0.1:8790 --out ui-lint.json [--budget 40] [paths...]
//
// Exits 1 when the findings exceed the budget (0 unless --budget is given) and 2 when a page
// could not be checked. Chromium is the one Playwright cached, unless CHROME is set.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { checkPage, validatePolicy } from 'lintapple';
import { chromePath } from './chrome-path.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const flagged = new Set(['--base', '--out', '--budget', '--policy']);
const given = args.filter((a, i) => !a.startsWith('--') && !flagged.has(args[i - 1]));
const BASE = flag('base', 'http://127.0.0.1:8790').replace(/\/$/, '');
const OUT = flag('out', '');
const BUDGET = Number(flag('budget', '0'));
const POLICY = resolve(flag('policy', 'scripts/ui-policy.json'));
const PATHS = given.length
  ? given
  : [
      '/',
      '/receipts?view=todo',
      '/?in=year:2026',
      '/?q=supply',
      '/receipts?view=all&kind=sales',
      '/payments',
      '/payments?view=todo',
      '/settings',
      '/import',
      '/add',
      '/help',
    ];

const [user, ...rest] = (process.env.AUTH ?? '').split(':');
if (!user || !rest.length) {
  console.error('Set AUTH=user:password for the instance.');
  process.exit(2);
}
const policy = validatePolicy(JSON.parse(readFileSync(POLICY, 'utf8')));

// lintapple measures the gap between blocks only inside a data-ui-stack, and the pages carry no
// such marks. Every element in main whose children stack as blocks gets one here, so two blocks
// that touch (a button sitting on the box under it) are found on every page without marking
// each one by hand. Rows of a list or a table are left out: they are ruled, not spaced.
const markStacks = (page) =>
  page.evaluate(() => {
    const blocky = (el) => {
      const s = getComputedStyle(el);
      return (
        !s.display.startsWith('inline') &&
        s.display !== 'none' &&
        s.display !== 'contents' &&
        s.position !== 'absolute' &&
        s.position !== 'fixed'
      );
    };
    // What a fold holds is checked open: lintapple skips a closed one, and the Send step and most
    // of Settings live in folds.
    // A menu that opens over the page (a row's More) is not a fold and stays shut.
    for (const el of document.querySelectorAll('main details:not(.bulkbar details)')) {
      el.open = true;
      const over = [...el.children].some(
        (c) => c.tagName !== 'SUMMARY' && ['absolute', 'fixed'].includes(getComputedStyle(c).position),
      );
      if (over) el.open = false;
    }
    // The phone's tab bar floats over the page, so axe cannot tell what is behind the row under
    // it. It joins the page's flow at the end for the check; its own labels are still checked.
    for (const el of document.querySelectorAll('nav.tabs')) el.style.position = 'static';
    // A visually hidden heading is a 1px box lintapple still counts; nobody sees it.
    for (const el of document.querySelectorAll('main :is(h1, h2, h3, h4).vh')) el.inert = true;
    for (const el of [document.querySelector('main'), ...document.querySelectorAll('main *')]) {
      if (!el || el.closest('table, ul, ol, dl, svg, pre, .textLayer, [hidden]')) continue;
      // One surface drawn in parts: a disclosure's summary over its body, a folder tab over its
      // card, and the Settings and Help sections, which share their borders.
      if (el.matches('details') || el.querySelector(':scope > details.sect')) continue;
      // Rows ruled apart by a line, like the fields of a Settings section, touch on purpose.
      const kids = [...el.children].filter(blocky);
      const ruled = (k) => ['Top', 'Bottom'].some((side) => parseFloat(getComputedStyle(k)[`border${side}Width`]) > 0);
      if (kids.length > 1 && kids.slice(0, -1).every(ruled)) continue;
      const s = getComputedStyle(el);
      const column =
        s.display === 'block' ||
        s.display === 'flow-root' ||
        (s.display.endsWith('flex') && s.flexDirection.startsWith('column')) ||
        (s.display.endsWith('grid') && s.gridTemplateColumns.split(' ').length === 1);
      if (column && [...el.children].filter(blocky).length > 1) el.setAttribute('data-ui-stack', '');
    }
  });

const browser = await chromium.launch({ executablePath: chromePath() });
const pages = [];
let unfinished = 0;
try {
  for (const colorScheme of policy.colorSchemes ?? ['light'])
    for (const viewport of policy.viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        httpCredentials: { username: user, password: rest.join(':') },
        reducedMotion: 'reduce',
        colorScheme,
      });
      for (const path of PATHS) {
        const page = await context.newPage();
        const where = `${viewport.width}x${viewport.height} ${colorScheme}`;
        try {
          const response = await page.goto(BASE + path, { waitUntil: 'load' });
          if (!response || response.status() >= 400) throw new Error(`HTTP ${response?.status()}`);
          await markStacks(page);
          const { findings } = await checkPage(page, policy);
          pages.push({ path, viewport: where, findings });
        } catch (error) {
          unfinished++;
          pages.push({ path, viewport: where, findings: [], error: String(error.message).split('\n')[0] });
        } finally {
          await page.close();
        }
      }
      await context.close();
    }
} finally {
  await browser.close();
}

const groups = new Map();
for (const { path, viewport, findings } of pages)
  for (const f of findings) {
    const key = `${f.rule}\u0000${f.selector}\u0000${f.message}`;
    const group = groups.get(key) ?? { rule: f.rule, selector: f.selector, message: f.message, fix: f.fix, where: [] };
    group.where.push(`${path} @ ${viewport}`);
    groups.set(key, group);
  }
const grouped = [...groups.values()]
  .map((g) => ({ ...g, count: g.where.length }))
  .sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule));
const total = pages.reduce((sum, p) => sum + p.findings.length, 0);
const byRule = Object.fromEntries(
  [...new Set(grouped.map((g) => g.rule))]
    .sort()
    .map((rule) => [rule, grouped.filter((g) => g.rule === rule).reduce((n, g) => n + g.count, 0)]),
);
const report = { base: BASE, total, budget: BUDGET, byRule, unfinished, groups: grouped, pages };
if (OUT) writeFileSync(resolve(OUT), JSON.stringify(report, null, 2) + '\n');

console.log(
  `ui-lint: ${total} findings in ${grouped.length} groups across ${pages.length} page checks (budget ${BUDGET}).`,
);
for (const [rule, n] of Object.entries(byRule)) console.log(`  ${rule}: ${n}`);
for (const p of pages.filter((p) => p.error)) console.error(`  not checked: ${p.path} @ ${p.viewport} (${p.error})`);
process.exit(unfinished ? 2 : total > BUDGET ? 1 : 0);
