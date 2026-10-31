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

const browser = await chromium.launch({ executablePath: chromePath() });
const pages = [];
let unfinished = 0;
try {
  for (const viewport of policy.viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      httpCredentials: { username: user, password: rest.join(':') },
      reducedMotion: 'reduce',
    });
    for (const path of PATHS) {
      const page = await context.newPage();
      const where = `${viewport.width}x${viewport.height}`;
      try {
        const response = await page.goto(BASE + path, { waitUntil: 'load' });
        if (!response || response.status() >= 400) throw new Error(`HTTP ${response?.status()}`);
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
