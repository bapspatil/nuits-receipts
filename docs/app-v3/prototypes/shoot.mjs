#!/usr/bin/env node
// Screenshots every HTML file in a prototype folder at 1440 and 390, runs axe
// on each, and writes <folder>/shots/ plus <folder>/shots/REPORT.md.
//   node docs/app-v3/prototypes/shoot.mjs docs/app-v3/prototypes/a-ledger
//   node docs/app-v3/prototypes/shoot.mjs docs/app-v3/prototypes/a-ledger --dark   dark colour scheme
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const folder = resolve(process.argv[2] ?? '.');
const scheme = process.argv.includes('--dark') ? 'dark' : 'light';
const suffix = scheme === 'dark' ? '-dark' : '';
const out = join(folder, 'shots');
mkdirSync(out, { recursive: true });

function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  for (const build of readdirSync(cache)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort()
    .reverse())
    for (const bundle of [
      'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
      'chrome-linux/chrome',
    ])
      if (existsSync(join(cache, build, bundle))) return join(cache, build, bundle);
  throw new Error('No Chromium found. Set CHROME.');
}

const axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const browser = await chromium.launch({ executablePath: chromePath(), args: ['--allow-file-access-from-files'] });
const rows = ['| Screen | Width | Height (viewports) | axe violations |', '| --- | --- | --- | --- |'];
for (const file of readdirSync(folder)
  .filter((f) => f.endsWith('.html'))
  .sort()) {
  for (const [name, width, height] of [
    ['1440', 1440, 900],
    ['390', 390, 844],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: 'reduce',
      colorScheme: scheme,
    });
    const page = await context.newPage();
    await page.goto(pathToFileURL(join(folder, file)).href);
    await page.evaluate(() => document.fonts.ready);
    const scroll = await page.evaluate(() => document.documentElement.scrollHeight);
    const shot = `${file.replace(/\.html$/, '')}-${name}${suffix}.png`;
    await page.screenshot({ path: join(out, shot), fullPage: true });
    await page.addScriptTag({ content: axe });
    const violations = await page.evaluate(async () =>
      (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] })).violations.map(
        (v) => `${v.id} (${v.impact}, ${v.nodes.length})`,
      ),
    );
    rows.push(`| [${file}](${shot}) | ${name} | ${(scroll / height).toFixed(2)} | ${violations.join(', ') || '0'} |`);
    await context.close();
  }
}
await browser.close();
writeFileSync(join(out, `REPORT${suffix}.md`), rows.join('\n') + '\n');
console.log(rows.join('\n'));
