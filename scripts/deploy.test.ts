// scripts/deploy.mjs against a fake Wrangler: no Cloudflare calls.
import { afterEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonc, selectConfig, validateVars, checkPassword } from './deploy-lib.mjs';

const ROOT = join(import.meta.dir, '..');
const TMP = join(ROOT, '.wrangler', 'deploy-test');
const FAKE = join(TMP, 'fake-wrangler.cjs');
const LOG = join(TMP, 'calls.log');
const RESOLVED = join(ROOT, 'wrangler.resolved.jsonc');

function setup(state: {
  databases?: { name: string; uuid: string }[];
  tables?: string[];
  pending?: boolean;
  failMigrate?: boolean;
}) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  writeFileSync(join(TMP, 'state.json'), JSON.stringify({ databases: [], tables: [], pending: true, ...state }));
  writeFileSync(
    FAKE,
    `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const dir = ${JSON.stringify(TMP)}, file = path.join(dir, 'state.json');
const state = JSON.parse(fs.readFileSync(file, 'utf8')), args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, 'calls.log'), args.join(' ') + '\\n');
const is = (...words) => words.every((w, i) => args[i] === w);
if (is('d1', 'list')) console.log(JSON.stringify(state.databases));
else if (is('d1', 'execute')) console.log(JSON.stringify([{ results: state.tables.map((name) => ({ name })) }]));
else if (is('d1', 'create')) { state.databases.push({ name: args[2], uuid: '11111111-2222-4333-8444-555555555555' }); fs.writeFileSync(file, JSON.stringify(state)); }
else if (is('d1', 'migrations', 'list')) console.log(state.pending ? 'Migrations to be applied: 0001_template.sql' : '✅ No migrations to apply!');
else if (is('d1', 'migrations', 'apply')) process.exit(state.failMigrate ? 1 : 0);
process.exit(0);
`,
  );
  chmodSync(FAKE, 0o755);
}
function config(db: Record<string, unknown>, vars: Record<string, string> = {}) {
  const path = join(TMP, 'wrangler.test.jsonc');
  writeFileSync(
    path,
    `// comment with "quotes" and https://example.com
{ "name": "x", "main": "src/index.ts", "vars": { "AI_MODE": "live", ${Object.entries(vars)
      .map(([k, v]) => `"${k}": ${JSON.stringify(v)},`)
      .join('')} },
  "d1_databases": [ ${JSON.stringify({ binding: 'DB', ...db })} ], }`,
  );
  return path;
}
function deploy(path: string, ...extra: string[]) {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'deploy.mjs'), '--config', path, ...extra], {
    cwd: ROOT,
    env: { ...process.env, NUITS_WRANGLER_BIN: FAKE, NUITS_D1_DATABASE_ID: '' },
    encoding: 'utf8',
  });
  const calls = existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n') : [];
  return { status: r.status, out: r.stdout + r.stderr, calls };
}
const template = { database_name: 'fresh-db', migrations_dir: 'schema', migrations_table: 'template_migrations' };
afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  rmSync(RESOLVED, { force: true });
});

test('JSONC parsing keeps // inside strings', () => {
  expect(parseJsonc('{"a":"https://x//y", /* c */ "b":[1,],} // end')).toEqual({ a: 'https://x//y', b: [1] });
});
test('config selection prefers --config, then NUITS_WRANGLER_CONFIG', () => {
  expect(selectConfig(['--config', 'a.jsonc'], {})).toBe('a.jsonc');
  expect(selectConfig([], { NUITS_WRANGLER_CONFIG: 'b.jsonc' })).toBe('b.jsonc');
});
test('vars and passwords are validated', () => {
  expect(validateVars({ vars: { AI_MODE: 'live' } })).toEqual([]);
  expect(validateVars({ vars: { AI_MODE: 'live', ALLOWED_SENDER_EMAILS: 'nope' } })[0]).toContain('invalid address');
  expect(validateVars({ vars: { AI_MODE: 'live', DEFAULT_PRODUCT: 'x' } })[0]).toContain('DEFAULT_PRODUCT');
  expect(validateVars({ vars: { AI_MODE: 'live', FORWARD_COPY_TO: 'copy@example.com' } })).toEqual([]);
  expect(
    validateVars({
      vars: {
        AI_MODE: 'live',
        RECEIPT_ADDRESS: 'r@example.com',
        INVOICES_ADDRESS: 'i@example.com',
        SELLER_NAMES: 'A, B',
      },
    }),
  ).toEqual([]);
  expect(
    validateVars({ vars: { AI_MODE: 'live', RECEIPT_ADDRESS: 'r@example.com', INVOICES_ADDRESS: 'R@example.com' } })[0],
  ).toContain('INVOICES_ADDRESS');
  expect(validateVars({ vars: { AI_MODE: 'live', INVOICES_ADDRESS: 'nope' } })[0]).toContain('INVOICES_ADDRESS');
  expect(validateVars({ vars: { AI_MODE: 'live', SELLER_NAMES: 'x'.repeat(101) } })[0]).toContain('SELLER_NAMES');
  expect(validateVars({ vars: { AI_MODE: 'live', FORWARD_COPY_TO: 'a@example.com, b@example.com' } })[0]).toContain(
    'FORWARD_COPY_TO',
  );
  const accessVars = {
    AI_MODE: 'live',
    ACCESS_TEAM_DOMAIN: 'example-team.cloudflareaccess.com',
    ACCESS_AUD: 'a'.repeat(64),
    ACCESS_ALLOWED_EMAILS: 'owner@example.com',
  };
  expect(validateVars({ vars: accessVars })).toEqual([]);
  expect(validateVars({ vars: { ...accessVars, ACCESS_AUD: '' } })[0]).toContain('set together');
  expect(validateVars({ vars: { ...accessVars, ACCESS_AUD: 'nope' } })[0]).toContain('ACCESS_AUD');
  expect(validateVars({ vars: { ...accessVars, ACCESS_ALLOWED_EMAILS: 'nope' } })[0]).toContain(
    'ACCESS_ALLOWED_EMAILS',
  );
  const live = { AI_MODE: 'live' };
  expect(validateVars({ vars: { ...live, SEND_HINT: '', MS_CLIENT_ID: '' } })).toEqual([]);
  expect(validateVars({ vars: { ...live, SEND_HINT: "Drop the folder into your accountant's OneDrive" } })).toEqual([]);
  expect(validateVars({ vars: { ...live, SEND_HINT: 'x'.repeat(301) } })[0]).toContain('SEND_HINT');
  expect(validateVars({ vars: { ...live, MATCH_DAYS_AFTER: '60', REVIEW_MIN_CONFIDENCE: '0.85' } })).toEqual([]);
  expect(validateVars({ vars: { ...live, MATCH_DAYS_AFTER: '500' } })[0]).toContain('MATCH_DAYS_AFTER');
  expect(validateVars({ vars: { ...live, PAYMENT_TERMS_DAYS: '14.5' } })[0]).toContain('whole number');
  expect(validateVars({ vars: { ...live, DEFAULT_CURRENCY: 'XXX' } })[0]).toContain('DEFAULT_CURRENCY');
  expect(validateVars({ vars: { ...live, MS_CLIENT_ID: '11111111-2222-3333-4444-555555555555' } })).toEqual([]);
  expect(validateVars({ vars: { ...live, MS_CLIENT_ID: 'my-app' } })[0]).toContain('MS_CLIENT_ID');
  expect(validateVars({ vars: { ...live, MS_CLIENT_SECRET: 'oops' } })[0]).toContain('MS_CLIENT_SECRET is a secret');
  expect(validateVars({ vars: { ...live, ONEDRIVE_TOKEN_KEY: 'oops' } })[0]).toContain(
    'ONEDRIVE_TOKEN_KEY is a secret',
  );
  expect(checkPassword('')).toBeTruthy();
  expect(checkPassword('local-dummy-password')).toBeTruthy();
  expect(checkPassword('short')).toBeTruthy();
  expect(checkPassword('a-long-unique-password')).toBeNull();
});
test('a new install creates the named database, migrates DB, then deploys', () => {
  setup({});
  const r = deploy(config(template));
  expect(r.status).toBe(0);
  expect(r.calls.map((c) => c.split(' --config')[0])).toEqual([
    'd1 list --json',
    'd1 create fresh-db',
    'd1 list --json',
    'd1 migrations list DB --remote',
    'd1 migrations apply DB --remote',
    'deploy',
  ]);
  expect(r.calls.at(-1)).toContain('wrangler.resolved.jsonc');
  expect(parseJsonc(readFileSync(RESOLVED, 'utf8')).d1_databases[0].database_id).toBe(
    '11111111-2222-4333-8444-555555555555',
  );
});
test('an existing empty database or one with this app ledger is adopted', () => {
  setup({ databases: [{ name: 'fresh-db', uuid: 'aaaaaaaa-2222-4333-8444-555555555555' }] });
  expect(deploy(config(template)).status).toBe(0);
  setup({
    databases: [{ name: 'fresh-db', uuid: 'aaaaaaaa-2222-4333-8444-555555555555' }],
    tables: ['template_migrations', 'receipts'],
  });
  expect(deploy(config(template)).status).toBe(0);
});
test('a database with someone else\u2019s tables is never reused silently', () => {
  setup({ databases: [{ name: 'fresh-db', uuid: 'aaaaaaaa-2222-4333-8444-555555555555' }], tables: ['customers'] });
  const r = deploy(config(template));
  expect(r.status).toBe(1);
  expect(r.out).toContain('Refusing to reuse it');
  expect(r.calls.some((c) => c.startsWith('deploy'))).toBe(false);
});
test('migration failure stops before deploy', () => {
  setup({ failMigrate: true });
  const r = deploy(config(template));
  expect(r.status).toBe(1);
  expect(r.calls.some((c) => c.startsWith('deploy'))).toBe(false);
});
test('a private database with pending migrations needs --apply-migrations', () => {
  const priv = () =>
    config({
      database_name: 'prod',
      database_id: 'bbbbbbbb-2222-4333-8444-555555555555',
      migrations_dir: 'migrations',
    });
  setup({});
  const blocked = deploy(priv());
  expect(blocked.status).toBe(1);
  expect(blocked.out).toContain('--apply-migrations');
  expect(blocked.calls.some((c) => c.startsWith('d1 migrations apply') || c.startsWith('deploy'))).toBe(false);
  setup({});
  const allowed = deploy(priv(), '--apply-migrations');
  expect(allowed.status).toBe(0);
  expect(allowed.calls.at(-1)).toContain('wrangler.test.jsonc');
  setup({ pending: false });
  const clean = deploy(priv());
  expect(clean.status).toBe(0);
  expect(clean.calls.some((c) => c.startsWith('d1 migrations apply'))).toBe(false);
});
test('invalid vars and placeholder IDs fail before any Wrangler call', () => {
  setup({});
  const bad = deploy(config(template, { PRODUCTS_JSON: '{' }));
  expect(bad.status).toBe(1);
  expect(bad.calls).toEqual([]);
  setup({});
  const zero = deploy(config({ ...template, database_id: '00000000-0000-0000-0000-000000000000' }));
  expect(zero.status).toBe(1);
  expect(zero.out).toContain('placeholder');
});
test('--dry-run only bundles', () => {
  setup({});
  const r = deploy(config(template), '--dry-run');
  expect(r.status).toBe(0);
  expect(r.calls).toHaveLength(1);
  expect(r.calls[0]).toStartWith('deploy --dry-run');
});
