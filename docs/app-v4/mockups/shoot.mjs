#!/usr/bin/env node
// Screenshots both mockups at 1440 and 390 and checks them in the browser:
// axe (WCAG 2.x A and AA, contrast included), every button carries an icon and
// a text label, no row holds a primary, and nothing scrolls sideways.
// Usage: node docs/app-v4/mockups/shoot.mjs   (exits non-zero on any miss)

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

// Same lookup as chromePath() in scripts/ux-journeys.mjs.
function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const builds = existsSync(cache)
    ? readdirSync(cache)
        .filter((d) => /^chromium-\d+$/.test(d))
        .sort()
    : [];
  for (const build of builds.reverse()) {
    for (const app of ['chrome-mac-arm64', 'chrome-mac']) {
      for (const bundle of [
        'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'Chromium.app/Contents/MacOS/Chromium',
      ]) {
        const path = join(cache, build, app, bundle);
        if (existsSync(path)) return path;
      }
    }
    const linux = join(cache, build, 'chrome-linux/chrome');
    if (existsSync(linux)) return linux;
  }
  throw new Error('No Chromium found. Set CHROME, or run `npx playwright install chromium`.');
}

const out = join(here, 'screens');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: chromePath() });
let misses = 0;
const miss = (msg) => {
  misses++;
  console.error(`MISS ${msg}`);
};

for (const name of ['native', 'paper']) {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: width < 600 ? 2 : 1 });
    await page.goto(pathToFileURL(join(here, `${name}.html`)).href);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
    const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`));
    const facts = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('.app button, .app .btn, .specimen button')];
      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        bare: buttons.filter((b) => !b.querySelector('svg.i use') || !b.textContent.trim()).map((b) => b.outerHTML.slice(0, 80)),
        rowPrimary: document.querySelectorAll('.row .primary').length,
        dashes: /[\u2013\u2014]/.test(document.documentElement.outerHTML),
      };
    });
    if (facts.overflow > 0) miss(`${name}-${width}: scrolls sideways by ${facts.overflow}px`);
    if (facts.bare.length) miss(`${name}-${width}: buttons without icon and label: ${facts.bare.join(' | ')}`);
    if (facts.rowPrimary) miss(`${name}-${width}: ${facts.rowPrimary} primary buttons inside rows`);
    if (facts.dashes) miss(`${name}-${width}: an em or en dash`);
    // Sticky bars cover rows mid-scroll in any app; the real app keeps focused
    // rows clear with scroll-padding-bottom. Audit the full-height layout the
    // screenshot captures, where each bar sits at the end of its screen.
    await page.setViewportSize({ width, height: await page.evaluate(() => document.documentElement.scrollHeight) });
    await page.addScriptTag({ content: axeSource });
    const axe = await page.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } });
      return r.violations.map((v) => ({ id: v.id, n: v.nodes.length, first: v.nodes[0]?.target.join(' '), why: v.nodes[0]?.failureSummary }));
    });
    for (const v of axe) miss(`${name}-${width}: axe ${v.id} x${v.n} at ${v.first}\n  ${v.why}`);
    await page.screenshot({ path: join(out, `${name}-${width}.png`), fullPage: true });
    console.log(`${name}-${width}: axe ${axe.length} violations, fonts ${fonts.join(', ') || 'system only'}`);
    await page.close();
  }
}
await browser.close();
if (misses) process.exit(1);
console.log('all checks pass');
