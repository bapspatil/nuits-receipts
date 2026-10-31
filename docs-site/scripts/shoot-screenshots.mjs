#!/usr/bin/env node
// Reshoots every docs screenshot from a real, running copy of the app in the
// "Your first month" state: both samples added and approved, bank.csv
// imported, then Sample Missing Vendor marked Not a purchase.
//
// Start a FRESH local app first (empty database), from the repository root:
//   cp .dev.vars.example .dev.vars   # then set NUITS_PASSWORD
//   bun run migrate && bun run dev   # http://localhost:8787
// Then, from the repository root:
//   NUITS_PASSWORD=... node docs-site/scripts/shoot-screenshots.mjs
//
// Options (flags or env): --base / BASE_URL (default http://localhost:8787),
// --user (default owner), --password / NUITS_PASSWORD, --out (default
// docs-site/src/assets/screenshots), --only a.png,b.png (shoot a subset; the
// flow still runs to keep the state right).
// It drives the app only. It never renders HTML of its own. Point it at a
// local, empty copy: it uploads, approves, imports and marks things.
import { mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const require = createRequire(join(root, 'package.json'));
const { chromium } = require('playwright-core');
const docsRequire = createRequire(join(root, 'docs-site/package.json'));
const sharp = docsRequire('sharp');
const { chromePath } = await import(join(root, 'scripts/chrome-path.mjs'));

const args = process.argv.slice(2);
const flag = (name, env, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : (env && process.env[env]) || fallback;
};
const BASE = flag('base', 'BASE_URL', 'http://localhost:8787');
const USER = flag('user', 'NUITS_USER', 'owner');
const PASSWORD = flag('password', 'NUITS_PASSWORD', '');
const OUT = resolve(flag('out', null, join(root, 'docs-site/src/assets/screenshots')));
const only = flag('only', null, '')
  .split(',')
  .filter(Boolean);
const SAMPLES = join(root, 'scripts/sample-receipts');
if (!PASSWORD) throw new Error('Set NUITS_PASSWORD or pass --password.');
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE) && !args.includes('--allow-remote'))
  throw new Error(`Refusing to drive ${BASE}: this script writes data. Use a local copy, or pass --allow-remote.`);
mkdirSync(OUT, { recursive: true });

// Chromium's own controls ("Choose Files") follow the macOS language, not the
// context locale. Pin English for the test browser's own preference domain for
// the length of the run, then remove the key again.
const executablePath = chromePath();
let appDomain = null;
if (process.platform === 'darwin') {
  try {
    const app = executablePath.replace(/\/Contents\/MacOS\/.*$/, '');
    appDomain = execFileSync('defaults', ['read', join(app, 'Contents/Info'), 'CFBundleIdentifier']).toString().trim();
    execFileSync('defaults', ['write', appDomain, 'AppleLanguages', '-array', 'en']);
  } catch {
    appDomain = null;
  }
}
const restoreLocale = () => {
  if (!appDomain) return;
  try {
    execFileSync('defaults', ['delete', appDomain, 'AppleLanguages']);
  } catch {}
  appDomain = null;
};
process.on('exit', restoreLocale);

const browser = await chromium.launch({ executablePath, args: ['--lang=en-US'] });
const context = await browser.newContext({
  locale: 'en-US',
  baseURL: BASE,
  httpCredentials: { username: USER, password: PASSWORD },
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
  colorScheme: 'light',
});
const page = await context.newPage();
await page.addInitScript(() => {
  // Keep the caret out of the shots.
  document.addEventListener('DOMContentLoaded', () => {
    const s = document.createElement('style');
    s.textContent = '*{caret-color:transparent!important}';
    document.head.append(s);
  });
});

const settle = async () => {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
};
async function shoot(name, { width = 1280, height }) {
  await page.setViewportSize({ width, height });
  await settle();
  if (only.length && !only.includes(name)) return;
  const file = join(OUT, name);
  const png = await page.screenshot();
  let out = png;
  // Over ~330 KB: palette-quantise (UI screenshots have few colours).
  if (png.length > 330 * 1024) out = await sharp(png).png({ palette: true, quality: 92, compressionLevel: 9 }).toBuffer();
  await sharp(out).toFile(file);
  console.log(`shot ${name} ${width}x${height} ${Math.round(statSync(file).size / 1024)} KB  ${page.url().split('?')[0]}`);
}
const go = async (path) => {
  await page.goto(path);
  await settle();
};

// 1. Add: both samples uploaded.
await go('/add');
await page.setInputFiles('input[type=file]', [join(SAMPLES, 'sample.pdf'), join(SAMPLES, 'sample.png')]);
await page.getByRole('button', { name: 'Upload' }).click();
await page.getByText('2 of 2 added').waitFor();
await shoot('upload.png', { height: 860 });

// 2. Receipts > To do > the receipt that needs you.
await go('/receipts');
await page.getByRole('link', { name: /Start checking/ }).click();
await page.getByRole('button', { name: 'Approve receipt' }).first().waitFor();
await shoot('receipt-review.png', { width: 1440, height: 1340 });

// 3. Fill in sample.png from the table in the tutorial and approve it.
await page.locator('[name=vendor]').fill('Sample Pixel Harbor Ltd');
await page.locator('[name=issue_date]').fill('2026-09-05');
await page.locator('[name=currency]').selectOption('USD');
await page.locator('[name=total]').fill('20.00');
await page.locator('[name=net]').fill('20.00');
await page.locator('[name=vat]').fill('0.00');
await page.locator('[name=invoice_number]').fill('SAMPLE-1002');
await page.locator('[name=vat_rate]').fill('0');
await page.getByRole('button', { name: 'Approve receipt' }).first().click();
await settle();

// 4. Import the bank statement.
await go('/import');
await page.setInputFiles('input[type=file]', join(SAMPLES, 'bank.csv'));
await shoot('import-preview.png', { width: 1440, height: 900 });
await page.getByRole('button', { name: 'Import statement' }).click();
await settle();
const which = page.getByText('Which account is this?');
if (await which.count()) {
  await page.getByLabel(/Bank account/).first().check().catch(() => {});
  await page.getByRole('button', { name: 'Import statement' }).click();
  await settle();
}
await page.getByText(/Added 2 payments/).waitFor();
await shoot('payments.png', { height: 780 });

// 5. Home for September, one payment still missing its receipt.
await go('/?month=2026-09');
await shoot('home.png', { height: 1040 });

// 6. Mark the missing payment Not a purchase, then Home is ready to send.
await go('/payments?month=2026-09');
await page.getByRole('button', { name: 'Not a purchase' }).first().click();
await settle();
await go('/?month=2026-09');
await shoot('month.png', { height: 960 });

// 7. Settings.
await go('/settings');
await page.locator('summary', { hasText: 'Business' }).click();
await shoot('settings.png', { height: 1100 });

// 8. Quick find: Cmd+K with a query.
await go('/?month=2026-09');
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
await page.keyboard.type('Cloud');
await page.waitForTimeout(600);
await shoot('quick-find.png', { height: 700 });

await browser.close();
restoreLocale();
