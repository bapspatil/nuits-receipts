#!/usr/bin/env node
// Measures, in real Chrome on the busy month, how a resolved row leaves a work list under
// cross-document view transitions: scroll drift, focus, the animation that ran, and what was fetched.
//
//   node scripts/live-measure.mjs --out /tmp/ux4-live [--port 8841] [--only 1-bank]
//
// Needs .dev.vars (NUITS_PASSWORD). Starts its own wrangler dev per scenario on a fresh seeded D1.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { chromePath } from './chrome-path.mjs';
import { busySql, busyReceipts, isComplete, isTodo } from './busy-month.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const OUT = resolve(flag('out', '/tmp/ux4-live'));
const PORT = Number(flag('port', '8841'));
const ONLY = flag('only', '');
const MONTH = '2026-08';
const VIEWPORT = { width: 1440, height: 900 };
const password = readFileSync('.dev.vars', 'utf8')
  .match(/^NUITS_PASSWORD=(.*)$/m)?.[1]
  ?.trim();
if (!password) throw new Error('NUITS_PASSWORD missing from .dev.vars');

const env = {
  ...process.env,
  XDG_CONFIG_HOME: '.cache/config',
  WRANGLER_LOG_PATH: '.wrangler/logs',
  WRANGLER_SEND_METRICS: 'false',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WR = ['wrangler', '--config', 'wrangler.local.jsonc'];

function prepareState(state) {
  rmSync(state, { recursive: true, force: true });
  rmSync(`${state}-pristine`, { recursive: true, force: true });
  const run = (cmd) => spawnSync('bunx', cmd, { env, encoding: 'utf8' });
  const migrate = run([WR[0], 'd1', 'migrations', 'apply', 'DB', '--local', '--config', WR[2], '--persist-to', state]);
  if (migrate.status !== 0) throw new Error(`migrations failed:\n${migrate.stderr}`);
  const file = `${state}.sql`;
  writeFileSync(file, busySql(MONTH));
  const seed = run([WR[0], 'd1', 'execute', 'DB', '--local', '--config', WR[2], '--persist-to', state, '--file', file]);
  if (seed.status !== 0) throw new Error(`seed failed:\n${seed.stderr}`);
  cpSync(state, `${state}-pristine`, { recursive: true });
}
async function up(base) {
  return fetch(base + '/').then(
    () => true,
    () => false,
  );
}
async function startServer(port, state) {
  const base = `http://127.0.0.1:${port}`;
  if (await up(base)) throw new Error(`${base} is already served by something else; pass --port`);
  rmSync(state, { recursive: true, force: true });
  cpSync(`${state}-pristine`, state, { recursive: true });
  const server = spawn(
    'bunx',
    [WR[0], 'dev', '--local', '--config', WR[2], '--persist-to', state, '--port', String(port), '--ip', '127.0.0.1'],
    { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base + '/')).status === 401) break;
    } catch {}
    await sleep(500);
  }
  return {
    stop: async () => {
      try {
        process.kill(-server.pid);
      } catch {}
      for (let i = 0; i < 40 && (await up(base)); i++) await sleep(250);
    },
  };
}

// Records pageswap and pagereveal (the evidence a cross-document transition ran) and what the
// transition animated.
const INIT = `(() => {
  const K = '__live';
  const read = () => { try { return JSON.parse(sessionStorage.getItem(K) || '{}'); } catch { return {}; } };
  const write = (o) => { try { sessionStorage.setItem(K, JSON.stringify(o)); } catch {} };
  addEventListener('pageswap', (e) => { const o = read(); o.swapVT = !!e.viewTransition; write(o); });
  addEventListener('pagereveal', (e) => {
    const o = read();
    const t0 = performance.now();
    o.revealVT = !!e.viewTransition;
    write(o);
    if (!e.viewTransition) return;
    e.viewTransition.ready.then(() => {
      const anims = document.getAnimations().filter((a) => a.effect && a.effect.pseudoElement);
      const names = (p) => new Set(anims.filter((a) => a.effect.pseudoElement.startsWith(p)).map((a) => a.effect.pseudoElement.slice(p.length, -1)));
      const olds = names('::view-transition-old('), news = names('::view-transition-new(');
      const r = read();
      r.ready = { groups: names('::view-transition-group(').size, leaving: [...olds].filter((n) => !news.has(n)).length, entering: [...news].filter((n) => !olds.has(n)).length };
      write(r);
    }).catch(() => {});
    e.viewTransition.finished.then(() => { const r = read(); r.finishedAt = Math.round(performance.now() - t0); write(r); }, () => {});
  });
})();`;

const idFromHash = (url) => url.match(/#row-([a-f0-9]{64})/)?.[1] ?? null;
const clean = (url) => url.replace(/[a-f0-9]{64}/g, ':id').replace(/&(iat|sig|done)=[^&#]*/g, '');

async function open(browser, base) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    httpCredentials: { username: 'owner', password },
  });
  await context.addInitScript(INIT);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  return { context, page, base };
}
const stash = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('__live') || '{}'));
// Every document and JSON response of the action, so a second download of the list shows.
function watch(page) {
  const seen = [];
  page.on('response', async (r) => {
    try {
      const type = (r.headers()['content-type'] || '').split(';')[0];
      if (!/html|json/.test(type)) return;
      const body = await r.body();
      seen.push({
        method: r.request().method(),
        url: new URL(r.url()).pathname.replace(/[a-f0-9]{64}/g, ':id'),
        status: r.status(),
        type,
        bytes: body.length,
      });
    } catch {}
  });
  return () => seen.slice();
}
const landed = (page, nextId) =>
  page.evaluate((id) => {
    const el = id ? document.getElementById('row-' + id) : null;
    const a = document.activeElement;
    return {
      scrollY: Math.round(scrollY),
      nextTop: el ? Math.round(el.getBoundingClientRect().top) : null,
      active: a ? { tag: a.tagName.toLowerCase(), id: a.id || null } : null,
      insideNext: !!(el && a && el.contains(a)),
      title: document.title,
      describedBy: el?.getAttribute('aria-describedby') ?? null,
      banner: (document.querySelector('[role=status]')?.innerText || '').trim().slice(0, 100),
    };
  }, nextId);

async function bank(browser, base) {
  const { context, page } = await open(browser, base);
  await page.goto(`${base}/payments?month=${MONTH}&view=todo`, { waitUntil: 'load' });
  const pre = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('li[data-row]')];
    const row = rows[29];
    window.scrollTo({ top: row.getBoundingClientRect().top + scrollY - 120, behavior: 'instant' });
    return {
      rows: rows.length,
      id: row.dataset.row,
      top: Math.round(row.getBoundingClientRect().top),
      scrollY: Math.round(scrollY),
    };
  });
  await page.evaluate(() => sessionStorage.removeItem('__live'));
  const seen = watch(page);
  await Promise.all([
    page.waitForURL((u) => u.searchParams.has('done'), { timeout: 15000 }),
    page.locator(`#row-${pre.id} button[name=receipt_required][value="0"]`).click(),
  ]);
  await page.waitForLoadState('load');
  const url = page.url();
  await sleep(900);
  const after = await landed(page, idFromHash(url));
  const out = {
    pre,
    url: clean(url),
    after,
    drift: after.nextTop === null ? null : after.nextTop - pre.top,
    transition: await stash(page),
    responses: seen(),
  };
  await context.close();
  return out;
}

async function bulk(browser, base) {
  const { context, page } = await open(browser, base);
  await page.goto(`${base}/payments?month=${MONTH}&view=todo`, { waitUntil: 'load' });
  const picked = await page.evaluate(() =>
    [...document.querySelectorAll('li[data-row]')].slice(0, 25).map((r) => r.dataset.row),
  );
  for (const id of picked) await page.locator(`#row-${id} input[name=id]`).check();
  const pre = await page.evaluate((id) => {
    const row = document.getElementById('row-' + id);
    window.scrollTo({ top: row.getBoundingClientRect().top + scrollY - 120, behavior: 'instant' });
    return {
      id,
      top: Math.round(row.getBoundingClientRect().top),
      scrollY: Math.round(scrollY),
      selected: document.querySelectorAll('input[name=id]:checked').length,
    };
  }, picked[0]);
  await page.evaluate(() => sessionStorage.removeItem('__live'));
  const seen = watch(page);
  await Promise.all([
    page.waitForURL((u) => u.searchParams.has('done'), { timeout: 20000 }),
    page.locator('form[data-bulk] button[name=op][value=exempt]').first().click(),
  ]);
  await page.waitForLoadState('load');
  const url = page.url();
  await sleep(900);
  const after = await landed(page, idFromHash(url));
  const responses = seen();
  const out = {
    pre,
    url: clean(url),
    after,
    drift: after.nextTop === null ? null : after.nextTop - pre.top,
    transition: await stash(page),
    responses,
    listDownloads: responses.filter((r) => r.method === 'GET' && r.url === '/payments').length,
  };
  await context.close();
  return out;
}

async function approve(browser, base) {
  const { context, page } = await open(browser, base);
  await page.goto(`${base}/receipts?view=todo`, { waitUntil: 'load' });
  const ids = await page.evaluate(() => [...document.querySelectorAll('li[data-row]')].map((r) => r.dataset.row));
  const ok = new Set(
    busyReceipts(MONTH)
      .filter((r) => isTodo(r) && isComplete(r))
      .map((r) => r.id),
  );
  const id = ids.find((x) => ok.has(x));
  if (!id) throw new Error('no approvable receipt found');
  await page.goto(`${base}/receipts/${id}?from=todo`, { waitUntil: 'load' });
  await page.evaluate(() => sessionStorage.removeItem('__live'));
  await Promise.all([
    page.waitForURL(
      (u) => u.pathname.startsWith('/receipts/') && u.searchParams.has('done') && !u.pathname.endsWith(id),
      { timeout: 15000 },
    ),
    page.locator('button[name=action][value=approve]:not(.vh)').first().click(),
  ]);
  await page.waitForLoadState('load');
  const url = page.url();
  await sleep(900);
  const after = await page.evaluate(() => {
    const a = document.activeElement;
    return {
      scrollY: Math.round(scrollY),
      active: a ? { tag: a.tagName.toLowerCase(), id: a.id || null, name: a.getAttribute('name') } : null,
      title: document.title,
      fragment: location.hash,
    };
  });
  const out = { id, url: clean(url), after, transition: await stash(page) };
  await context.close();
  return out;
}

const state = resolve('.audit/live-state');
prepareState(state);
const browser = await chromium.launch({ executablePath: chromePath(), args: ['--hide-scrollbars'] });
const results = { chrome: browser.version() };
for (const [key, fn] of [
  ['1-bank-single', bank],
  ['2-bank-bulk', bulk],
  ['3-receipt-approve', approve],
]) {
  if (ONLY && !key.includes(ONLY)) continue;
  const server = await startServer(PORT, state);
  try {
    results[key] = await fn(browser, `http://127.0.0.1:${PORT}`);
  } catch (error) {
    results[key] = { error: String(error.message).split('\n')[0] };
  } finally {
    await server.stop();
  }
  console.log(`${key} done`);
}
await browser.close();
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
