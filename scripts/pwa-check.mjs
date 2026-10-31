#!/usr/bin/env node
// Drives a fresh local instance in Chrome and checks the install: installability and
// manifest through CDP, the service worker, the offline page, the share target and
// the base path. Needs .dev.vars (NUITS_PASSWORD).
//
//   node scripts/pwa-check.mjs [--base /receipts-app] [--port 8791] [--shots docs/pwa]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const BASE_PATH = flag('base', '');
const PORT = Number(flag('port', '8791'));
const SHOTS = resolve(flag('shots', 'docs/pwa'));
const ORIGIN = `http://127.0.0.1:${PORT}`;
const STATE = resolve('.audit/pwa-state');
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
  for (const build of builds.reverse())
    for (const app of ['chrome-mac-arm64', 'chrome-mac'])
      for (const bundle of [
        'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'Chromium.app/Contents/MacOS/Chromium',
      ]) {
        const path = join(cache, build, app, bundle);
        if (existsSync(path)) return path;
      }
  throw new Error('No Chromium found. Set CHROME.');
}

const env = {
  ...process.env,
  XDG_CONFIG_HOME: '.cache/config',
  WRANGLER_LOG_PATH: '.wrangler/logs',
  WRANGLER_SEND_METRICS: 'false',
};
rmSync(STATE, { recursive: true, force: true });
const common = ['wrangler', '--config', 'wrangler.local.jsonc'];
const migrate = spawnSync(
  'bunx',
  ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--config', 'wrangler.local.jsonc', '--persist-to', STATE],
  { env, encoding: 'utf8' },
);
if (migrate.status !== 0) throw new Error(migrate.stderr);
const devArgs = ['wrangler', 'dev', '--local', '--config', 'wrangler.local.jsonc', '--persist-to', STATE];
devArgs.push('--port', String(PORT), '--ip', '127.0.0.1');
if (BASE_PATH) devArgs.push('--var', `APP_BASE_PATH:${BASE_PATH}`);
const server = spawn('bunx', devArgs, { env, stdio: 'ignore', detached: true });

const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

let context;
try {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(ORIGIN + BASE_PATH + '/')).status === 401) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  mkdirSync(SHOTS, { recursive: true });
  // A persistent profile: a plain launch is incognito, which Chrome refuses to install from.
  const profile = resolve('.audit/pwa-profile');
  rmSync(profile, { recursive: true, force: true });
  context = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath(),
    httpCredentials: { username: 'owner', password, origin: ORIGIN },
    viewport: { width: 390, height: 844 },
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const cdp = await context.newCDPSession(page);
  await page.goto(ORIGIN + BASE_PATH + '/');

  const manifest = await cdp.send('Page.getAppManifest');
  check('manifest parses with no errors', manifest.errors.length === 0, JSON.stringify(manifest.errors));
  const parsed = JSON.parse(manifest.data);
  console.log(`manifest url ${manifest.url}`);
  check(
    'manifest id, start_url, scope',
    ['id', 'start_url', 'scope'].every((k) => parsed[k] === BASE_PATH + '/'),
  );
  check(
    'manifest urls carry the base path',
    parsed.icons.every((i) => i.src.startsWith(BASE_PATH + '/icons/')) &&
      parsed.share_target.action === BASE_PATH + '/share' &&
      parsed.shortcuts[0].url === BASE_PATH + '/add',
  );

  const registration = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return { scope: r.scope, state: r.active?.state, script: r.active?.scriptURL };
  });
  console.log(`service worker ${JSON.stringify(registration)}`);
  check('service worker active at the base scope', registration.scope === `${ORIGIN}${BASE_PATH}/`);
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  check('service worker controls the page', true);
  const errors = await cdp.send('Page.getInstallabilityErrors');
  console.log(`installability errors ${JSON.stringify(errors.installabilityErrors)}`);
  check('no installability errors', errors.installabilityErrors.length === 0);

  // Online navigations never pass through the worker.
  const online = await page.goto(ORIGIN + BASE_PATH + '/review');
  check('online navigation is not served by the worker', online.status() === 200 && !online.fromServiceWorker());

  await context.setOffline(true);
  await page
    .goto(ORIGIN + BASE_PATH + '/review')
    .catch((e) => console.log(`offline goto: ${e.message.split('\n')[0]}`));
  const offlineText = await page.locator('body').innerText();
  check('offline navigation shows the offline page', /You're offline/.test(offlineText), offlineText.slice(0, 60));
  await page.screenshot({ path: join(SHOTS, 'offline-390.png') });
  await context.setOffline(false);
  const back = await page.goto(ORIGIN + BASE_PATH + '/review');
  check(
    'back online the real page returns, not from the worker',
    back.status() === 200 && !back.fromServiceWorker() && (await page.locator('h1').count()) > 0,
  );

  // Share target: a multipart POST to /share while the worker is active.
  await page.goto(ORIGIN + BASE_PATH + '/receipts');
  const count = async () => (await page.content()).match(/\/receipts\/[0-9a-f]{64}/g)?.length ?? 0;
  const before = await count();
  const pdf = readFileSync('scripts/sample-receipts/sample.pdf').toString('base64');
  await page.evaluate(
    ({ pdf, action }) => {
      const data = new DataTransfer();
      data.items.add(
        new File([Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0))], 'shared.pdf', { type: 'application/pdf' }),
      );
      const form = document.createElement('form');
      Object.assign(form, { method: 'POST', action, enctype: 'multipart/form-data' });
      const input = Object.assign(document.createElement('input'), { type: 'file', name: 'files' });
      input.files = data.files;
      form.append(input);
      document.body.append(form);
      form.submit();
    },
    { pdf, action: BASE_PATH + '/share' },
  );
  await page.waitForURL(`${ORIGIN}${BASE_PATH}/add?shared=1`);
  await page.waitForFunction(() => document.querySelector('form.add input[type=file]').files.length === 1);
  const status = await page.locator('#add-status').innerText();
  check('share lands on Add with the file in the input', /1 shared file ready/.test(status), status);
  await page.goto(ORIGIN + BASE_PATH + '/receipts');
  check('sharing alone created no receipt', (await count()) === before);

  await page.goto(ORIGIN + BASE_PATH + '/add?shared=1');
  await page.waitForFunction(() => document.querySelector('form.add input[type=file]').files.length === 0);
  check('the stash is cleared after one use', true);

  // Share again and press Add.
  await page.evaluate(
    ({ pdf, action }) => {
      const data = new DataTransfer();
      data.items.add(
        new File([Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0))], 'shared.pdf', { type: 'application/pdf' }),
      );
      const form = document.createElement('form');
      Object.assign(form, { method: 'POST', action, enctype: 'multipart/form-data' });
      const input = Object.assign(document.createElement('input'), { type: 'file', name: 'files' });
      input.files = data.files;
      form.append(input);
      document.body.append(form);
      form.submit();
    },
    { pdf, action: BASE_PATH + '/share' },
  );
  await page.waitForFunction(() => document.querySelector('form.add input[type=file]')?.files.length === 1);
  await page.getByRole('button', { name: 'Add files' }).click();
  await page.waitForFunction(() => /Added|added/.test(document.querySelector('.queue')?.innerText ?? ''), null, {
    timeout: 30000,
  });
  await page.goto(ORIGIN + BASE_PATH + '/receipts');
  check('pressing Add uploads it', (await count()) === before + 1, `${before} -> ${await count()}`);
} catch (error) {
  console.error(error);
  failures.push('script error');
} finally {
  await context?.close();
  process.kill(-server.pid);
}
if (failures.length) {
  console.error(`failed: ${failures.join(', ')}`);
  process.exit(1);
}
