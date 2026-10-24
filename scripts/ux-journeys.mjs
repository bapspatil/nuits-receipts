#!/usr/bin/env node
// Drives a fresh local instance through the five monthly journeys and measures
// what the UX v3 plan promises to improve: clicks, field edits, screens, POSTs
// with no visible feedback, dead-end error pages, page height in viewports and
// axe violations. Rerun it on every UX PR; docs/app-v3/ holds the outputs.
//
//   node scripts/ux-journeys.mjs --out docs/app-v3/baseline
//
// Starts its own `wrangler dev` on an empty database (port 8790 unless --port),
// signs in with NUITS_PASSWORD from .dev.vars, and uses the Chromium that
// Playwright cached unless CHROME is set.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const OUT = resolve(flag('out', 'docs/app-v3/run'));
const PORT = Number(flag('port', '8790'));
const BASE = `http://127.0.0.1:${PORT}`;
const STATE = resolve('.audit/ux-journeys-state');
const ROOT = resolve('.');
const SAMPLES = join(ROOT, 'scripts/sample-receipts');
const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
];

const password = readFileSync('.dev.vars', 'utf8')
  .match(/^NUITS_PASSWORD=(.*)$/m)?.[1]
  ?.trim();
if (!password) throw new Error('NUITS_PASSWORD missing from .dev.vars');

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

const wranglerEnv = {
  ...process.env,
  XDG_CONFIG_HOME: '.cache/config',
  WRANGLER_LOG_PATH: '.wrangler/logs',
  WRANGLER_SEND_METRICS: 'false',
};
function startServer() {
  rmSync(STATE, { recursive: true, force: true });
  const migrate = spawnSync(
    'bunx',
    [
      'wrangler',
      'd1',
      'migrations',
      'apply',
      'DB',
      '--local',
      '--config',
      'wrangler.local.jsonc',
      '--persist-to',
      STATE,
    ],
    { env: wranglerEnv, encoding: 'utf8' },
  );
  if (migrate.status !== 0) throw new Error(`migrations failed:\n${migrate.stderr}`);
  const server = spawn(
    'bunx',
    [
      'wrangler',
      'dev',
      '--local',
      '--config',
      'wrangler.local.jsonc',
      '--persist-to',
      STATE,
      '--port',
      String(PORT),
      '--ip',
      '127.0.0.1',
    ],
    { env: wranglerEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  return { server, log: () => log };
}
async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(BASE + '/')).status === 401) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not start');
}

const auth = 'Basic ' + Buffer.from(`owner:${password}`).toString('base64');
async function sendEmail(name, sender, html, attachment) {
  const boundary = 'nuits-ux-boundary';
  const headers = [
    `Authentication-Results: mx.cloudflare.net; spf=pass smtp.mailfrom=${sender}; dkim=none; dmarc=none`,
    'From: sample-vendor@example.com',
    'To: receipts@example.com',
    `Subject: ${name}`,
    `Message-ID: <ux-${name}-${Date.now()}@example.com>`,
    'Date: Sun, 6 Sep 2026 12:00:00 +0300',
    'MIME-Version: 1.0',
  ];
  const body = attachment
    ? [
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Forwarded receipt.',
        `--${boundary}`,
        `Content-Type: application/pdf; name="${attachment.name}"`,
        `Content-Disposition: attachment; filename="${attachment.name}"`,
        'Content-Transfer-Encoding: base64',
        '',
        attachment.bytes.toString('base64').replace(/.{76}/g, '$&\r\n'),
        `--${boundary}--`,
        '',
      ]
    : ['Content-Type: text/html; charset=utf-8', '', html, ''];
  const raw = [...headers, ...body].join('\r\n');
  const response = await fetch(
    `${BASE}/cdn-cgi/handler/email?from=${encodeURIComponent(sender)}&to=receipts%40example.com`,
    { method: 'POST', body: raw },
  );
  if (!response.ok) throw new Error(`email ${name}: ${response.status}`);
}
const receiptHtml = (fields) =>
  `<!doctype html><html><body><p>SYNTHETIC SAMPLE - NOT A REAL INVOICE</p>${Object.entries(fields)
    .map(([k, v]) => `<p>${k}: ${v}</p>`)
    .join('')}</body></html>`;

// The receipts the owner gets in a month: three the reader can file on its own,
// three it can't (no date; no VAT; no amounts), so Review has work in it.
const MAIL = [
  {
    vendor: 'Sample Cloud Lantern Oy',
    invoice_number: 'SAMPLE-1001',
    issue_date: '2026-09-04',
    currency: 'EUR',
    net: '100.00',
    vat_rate: '25.5',
    vat_amount: '25.50',
    total: '125.50',
  },
  {
    vendor: 'Sample Mail Meadow Oy',
    invoice_number: 'SAMPLE-1003',
    issue_date: '2026-09-06',
    currency: 'EUR',
    net: '40.00',
    vat_rate: '25.5',
    vat_amount: '10.20',
    total: '50.20',
  },
  {
    vendor: 'Sample Domain Desk',
    invoice_number: 'SAMPLE-1004',
    issue_date: '2026-09-12',
    currency: 'EUR',
    net: '12.00',
    vat_rate: '0',
    vat_amount: '0.00',
    total: '12.00',
  },
  {
    vendor: 'Sample Coffee Corner',
    invoice_number: 'SAMPLE-1005',
    currency: 'EUR',
    net: '8.00',
    vat_rate: '14',
    vat_amount: '1.12',
    total: '9.12',
  },
  { vendor: 'Sample Train Line', issue_date: '2026-09-15', currency: 'EUR', total: '23.40' },
  { vendor: 'Sample Print Shop', issue_date: '2026-09-18' },
];
const BANK =
  'Transaction ID;Booking date;Amount;Currency;Payee;Reference\n' +
  'UX-1;2026-09-07;-125,50;EUR;Sample Cloud Lantern Oy;SAMPLE-1001\n' +
  'UX-2;2026-09-08;-50,20;EUR;Sample Mail Meadow Oy;SAMPLE-1003\n' +
  'UX-3;2026-09-13;-12,00;EUR;DOMAINDESK*SAMPLE;card\n' +
  'UX-4;2026-09-16;-23,40;EUR;Sample Train Line;ticket\n' +
  'UX-5;2026-09-20;-9,99;EUR;Sample Missing Vendor;No receipt\n' +
  'UX-6;2026-09-25;125,50;EUR;Sample Client Oy;INV-2026-001\n';

// Every interaction goes through the recorder, so the numbers in the report are
// the interaction cost a person pays, not a count of HTTP requests.
class Recorder {
  constructor(page, journey) {
    this.page = page;
    this.journey = journey;
    this.clicks = 0;
    this.edits = 0;
    this.screens = [];
    this.silentPosts = [];
    this.deadEnds = [];
    this.inlineErrors = [];
    this.notes = [];
    this.posted = false;
    this.status = 200;
    page.on('request', (r) => {
      if (r.isNavigationRequest() && r.method() === 'POST') this.posted = true;
    });
    this.redirected = false;
    page.on('response', (r) => {
      if (!r.request().isNavigationRequest() || r.frame() !== page.mainFrame()) return;
      if (r.request().method() === 'POST') this.redirected = r.status() >= 300 && r.status() < 400;
      this.status = r.status();
    });
  }
  screen() {
    const url = new URL(this.page.url());
    const path =
      url.pathname.replace(/[a-f0-9]{64}/g, ':id') +
      // The signature on a feedback link changes every run; leave it out of the report.
      (url.search ? url.search.replace(/[a-f0-9]{64}/g, ':id').replace(/&(iat|sig)=[^&]*/g, '') : '');
    if (this.screens.at(-1) !== path) this.screens.push(path);
  }
  async settle() {
    await this.page.waitForLoadState('load');
    this.screen();
    if (!this.posted) return;
    this.posted = false;
    const banner = await this.page
      .locator('[role=status], [role=alert]')
      .evaluateAll((els) => els.some((e) => e.textContent.trim() && e.getClientRects().length));
    if (this.status >= 400) {
      // A refusal that keeps the form on screen with an alert summary is fixed in place; any other 4xx is a dead end.
      const inline = await this.page.evaluate(() => {
        const alert = [...document.querySelectorAll('main [role=alert]')].some(
          (e) => e.textContent.trim() && e.getClientRects().length,
        );
        return alert && !!document.querySelector('main form [name]');
      });
      (inline ? this.inlineErrors : this.deadEnds).push(`${this.screens.at(-1)} (${this.status})`);
    }
    // A POST that answers with its own page (an import preview) is its own feedback.
    else if (this.redirected && !banner) this.silentPosts.push(this.screens.at(-1));
  }
  async goto(path) {
    await this.page.goto(BASE + path);
    this.clicks++;
    await this.settle();
  }
  async click(locator) {
    await locator.first().click();
    this.clicks++;
    await this.settle();
  }
  async fill(locator, value) {
    await locator.first().fill(value);
    this.edits++;
  }
  async select(locator, value) {
    await locator.first().selectOption(value);
    this.edits++;
  }
  async upload(locator, files) {
    await locator.first().setInputFiles(files);
    this.edits++;
  }
  note(text) {
    this.notes.push(text);
  }
  result() {
    return {
      journey: this.journey,
      clicks: this.clicks,
      edits: this.edits,
      screens: this.screens,
      silentPosts: this.silentPosts,
      deadEnds: this.deadEnds,
      inlineErrors: this.inlineErrors,
      notes: this.notes,
    };
  }
}

import { journeys as JOURNEYS, tourScreens } from './ux-journeys.steps.mjs';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
async function audit(browser, urls) {
  const screens = [];
  mkdirSync(join(OUT, 'screens'), { recursive: true });
  for (const url of urls) {
    // A screen that needs the data in another state gets it set up once, before its first load.
    if (url.prepare) await url.prepare();
    for (const v of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: v.width, height: v.height },
        httpCredentials: { username: 'owner', password },
        bypassCSP: true,
        reducedMotion: 'reduce',
      });
      page = await context.newPage();
      await page.goto(BASE + url.path);
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      const file = `screens/${url.name}-${v.name}.png`;
      await page.screenshot({ path: join(OUT, file), fullPage: true });
      await page.addScriptTag({ content: axeSource });
      const violations = await page.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] });
        return r.violations.map((x) => ({
          id: x.id,
          impact: x.impact,
          nodes: x.nodes.length,
          where: x.nodes.slice(0, 3).map((n) => n.target.join(' ')),
        }));
      });
      screens.push({
        name: url.name,
        path: url.path,
        viewport: v.name,
        viewports: +(height / v.height).toFixed(2),
        file,
        axe: violations,
      });
      await context.close();
    }
  }
  return screens;
}

function report(results, screens) {
  const lines = [
    '# UX journey run',
    '',
    `Instance: fresh local database, mock AI, ${new Date().toISOString().slice(0, 10)}.`,
    '',
  ];
  if (results.length) {
    lines.push(
      '## Journeys',
      '',
      '| Journey | Clicks | Field edits | Screens | POSTs with no feedback | Dead-end error pages | Errors fixed in place |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const r of results)
      lines.push(
        `| ${r.journey} | ${r.clicks} | ${r.edits} | ${r.screens.length} | ${r.silentPosts.length} | ${r.deadEnds.length} | ${r.inlineErrors.length} |`,
      );
    lines.push('');
    for (const r of results) {
      lines.push(`### ${r.journey}`, '', `Screens: ${r.screens.map((s) => '`' + s + '`').join(' → ')}`, '');
      if (r.silentPosts.length)
        lines.push(`No feedback after: ${r.silentPosts.map((s) => '`' + s + '`').join(', ')}`, '');
      if (r.deadEnds.length) lines.push(`Dead ends: ${r.deadEnds.map((s) => '`' + s + '`').join(', ')}`, '');
      if (r.inlineErrors.length)
        lines.push(`Fixed in place: ${r.inlineErrors.map((s) => '`' + s + '`').join(', ')}`, '');
      for (const n of r.notes) lines.push(`- ${n}`);
      lines.push('');
    }
  }
  lines.push('## Screens', '', '| Screen | Width | Height (viewports) | axe violations |', '| --- | --- | --- | --- |');
  for (const s of screens)
    lines.push(
      `| [${s.name}](${s.file}) | ${s.viewport} | ${s.viewports} | ${s.axe.map((a) => `${a.id} (${a.impact}, ${a.nodes})`).join(', ') || '0'} |`,
    );
  return lines.join('\n') + '\n';
}

const { server, log } = startServer();
let browser, page;
try {
  await waitForServer();
  mkdirSync(OUT, { recursive: true });
  browser = await chromium.launch({ executablePath: chromePath() });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    httpCredentials: { username: 'owner', password },
    acceptDownloads: true,
  });
  page = await context.newPage();
  const helpers = { BASE, SAMPLES, MAIL, BANK, sendEmail, receiptHtml, Recorder };
  const results = [];
  const tour = new Set();
  for (const journey of JOURNEYS) {
    const recorder = new Recorder(page, journey.name);
    await journey.run(page, recorder, helpers);
    results.push(recorder.result());
    for (const s of recorder.screens) tour.add(s);
    console.log(`${journey.name}: ${recorder.clicks} clicks, ${recorder.edits} edits`);
  }
  const screens = await audit(browser, await tourScreens(page, BASE, helpers));
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results, screens }, null, 2));
  writeFileSync(join(OUT, 'RESULTS.md'), report(results, screens));
  console.log(`wrote ${join(OUT, 'RESULTS.md')}`);
} catch (error) {
  console.error(log().slice(-1500));
  if (page) {
    await page.screenshot({ path: join(OUT, 'failure.png'), fullPage: true }).catch(() => {});
    console.error(
      `failed on ${page.url()}: ${(
        await page
          .locator('main')
          .innerText()
          .catch(() => '')
      ).slice(0, 600)}`,
    );
  }
  throw error;
} finally {
  await browser?.close();
  process.kill(-server.pid);
}
