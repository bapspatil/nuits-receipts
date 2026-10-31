// Shared helpers for scripts/setup.mjs and scripts/deploy.mjs. Node 20+ or Bun.
// No network calls of their own: everything goes through the local Wrangler CLI,
// which talks only to your own Cloudflare account.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TEMPLATE_CONFIG = 'wrangler.jsonc';
export const PRIVATE_CONFIG = 'wrangler.production.jsonc';
export const RESOLVED_CONFIG = 'wrangler.resolved.jsonc';
export const MIN_PASSWORD_LENGTH = 16;
const WEAK = new Set(['local-dummy-password', 'change-me', 'password']);

// JSONC: strips // and /* */ comments outside strings, then trailing commas.
export function parseJsonc(text) {
  let out = '';
  for (let i = 0, inString = false; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

export function readConfig(path) {
  return parseJsonc(readFileSync(resolve(ROOT, path), 'utf8'));
}

// Which config to use: --config, NUITS_WRANGLER_CONFIG, the gitignored private
// override if present, else the public template.
export function selectConfig(argv = process.argv.slice(2), env = process.env) {
  const flag = argv.indexOf('--config');
  if (flag !== -1 && argv[flag + 1]) return argv[flag + 1];
  if (env.NUITS_WRANGLER_CONFIG) return env.NUITS_WRANGLER_CONFIG;
  if (existsSync(join(ROOT, PRIVATE_CONFIG))) return PRIVATE_CONFIG;
  return TEMPLATE_CONFIG;
}

export function database(config) {
  const db = (config.d1_databases ?? []).find((d) => d.binding === 'DB');
  if (!db) throw new Error('The config has no D1 binding named DB.');
  if (!db.database_name && !db.database_id) throw new Error('The DB binding needs a database_name.');
  if (db.database_id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(db.database_id))
    throw new Error('DB database_id is not a D1 UUID. Remove it to let setup resolve the database.');
  if (db.database_id === '00000000-0000-0000-0000-000000000000')
    throw new Error('DB database_id is a placeholder. Remove it to let setup resolve the database.');
  return db;
}

export const TUNING_BOUNDS = [
  ['REVIEW_MIN_CONFIDENCE', 0.5, 0.99, false],
  ['REVIEW_MAX_UNCERTAINTY', 0.01, 0.5, false],
  ['REVIEW_MIN_CATEGORY_CONFIDENCE', 0.5, 0.99, false],
  ['MATCH_DAYS_BEFORE', 0, 30, true],
  ['MATCH_DAYS_AFTER', 1, 180, true],
  ['MATCH_NAME_SIMILARITY', 0.3, 1, false],
  ['SALES_MATCH_DAYS_BEFORE', 0, 60, true],
  ['SALES_MATCH_DAYS_AFTER_DUE', 0, 365, true],
  ['PAYMENT_TERMS_DAYS', 0, 365, true],
];
// Same rules as src/config.ts, checked before anything is deployed.
export function validateVars(config) {
  const vars = config.vars ?? {},
    errors = [];
  const email = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
  if (!['live', 'mock'].includes(vars.AI_MODE)) errors.push('AI_MODE must be "live" or "mock".');
  if (vars.AUTH_USERNAME && String(vars.AUTH_USERNAME).includes(':')) errors.push('AUTH_USERNAME cannot contain ":".');
  const senders = String(vars.ALLOWED_SENDER_EMAILS ?? '')
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (senders.length > 75) errors.push('ALLOWED_SENDER_EMAILS can list at most 75 addresses.');
  for (const s of senders) if (!email.test(s)) errors.push(`ALLOWED_SENDER_EMAILS has an invalid address: ${s}`);
  if (vars.RECEIPT_ADDRESS && !email.test(vars.RECEIPT_ADDRESS))
    errors.push('RECEIPT_ADDRESS must be an email address.');
  if (vars.FORWARD_COPY_TO && !email.test(String(vars.FORWARD_COPY_TO).trim()))
    errors.push('FORWARD_COPY_TO must be a single email address or empty.');
  const invoices = String(vars.INVOICES_ADDRESS ?? '').trim();
  if (invoices && !email.test(invoices)) errors.push('INVOICES_ADDRESS must be a single email address or empty.');
  if (
    invoices &&
    [vars.RECEIPT_ADDRESS, vars.FORWARD_COPY_TO].some(
      (a) =>
        String(a ?? '')
          .trim()
          .toLowerCase() === invoices.toLowerCase(),
    )
  )
    errors.push('INVOICES_ADDRESS must differ from RECEIPT_ADDRESS and FORWARD_COPY_TO.');
  const sellers = String(vars.SELLER_NAMES ?? '')
    .split(/[,;\n]/)
    .map((n) => n.trim())
    .filter(Boolean);
  if (sellers.length > 20 || sellers.some((n) => n.length > 100))
    errors.push('SELLER_NAMES must be at most 20 names of up to 100 characters each.');
  const accessVars = ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'ACCESS_ALLOWED_EMAILS'].map((k) =>
    String(vars[k] ?? '').trim(),
  );
  if (accessVars.some(Boolean)) {
    const [team, aud, emails] = accessVars;
    if (!accessVars.every(Boolean))
      errors.push('ACCESS_TEAM_DOMAIN, ACCESS_AUD and ACCESS_ALLOWED_EMAILS must be set together.');
    else {
      if (!/^(https:\/\/)?[a-z0-9.-]+\.[a-z]{2,}\/?$/i.test(team))
        errors.push('ACCESS_TEAM_DOMAIN must look like "your-team.cloudflareaccess.com".');
      if (!/^[a-f0-9]{64}$/.test(aud)) errors.push('ACCESS_AUD must be the 64-character Access audience tag.');
      for (const s of emails.split(/[\s,;]+/).filter(Boolean))
        if (!email.test(s)) errors.push(`ACCESS_ALLOWED_EMAILS has an invalid address: ${s}`);
    }
  }
  let products = [{ id: 'general' }];
  try {
    if (vars.PRODUCTS_JSON) products = JSON.parse(vars.PRODUCTS_JSON);
    if (!Array.isArray(products) || !products.length) throw new Error();
  } catch {
    errors.push('PRODUCTS_JSON must be a non-empty JSON list.');
    products = [];
  }
  const ids = products.map((p) => (typeof p === 'string' ? p : p?.id));
  if (ids.some((id) => typeof id !== 'string' || !id.trim() || id.length > 100))
    errors.push('Every product needs an id of 1 to 100 characters.');
  if (new Set(ids).size !== ids.length) errors.push('PRODUCTS_JSON has duplicate ids.');
  if (vars.DEFAULT_PRODUCT && ids.length && !ids.includes(vars.DEFAULT_PRODUCT))
    errors.push('DEFAULT_PRODUCT must be one of the PRODUCTS_JSON ids.');
  if (vars.SOURCE_REPOSITORY && !/^https:\/\//.test(vars.SOURCE_REPOSITORY))
    errors.push('SOURCE_REPOSITORY must be an https URL.');
  const hint = String(vars.SEND_HINT ?? '').trim();
  if (hint.length > 300 || /[\u0000-\u001f]/.test(hint))
    errors.push('SEND_HINT must be one line of at most 300 characters.');
  const currency = String(vars.DEFAULT_CURRENCY ?? '').trim();
  if (
    currency &&
    !['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'CAD', 'AUD', 'JPY'].includes(currency.toUpperCase())
  )
    errors.push('DEFAULT_CURRENCY must be a supported currency code such as EUR.');
  // Review and matching thresholds: optional, bounded like TUNING_VARS in src/config.ts.
  for (const [name, min, max, integer] of TUNING_BOUNDS) {
    const raw = String(vars[name] ?? '').trim();
    if (!raw) continue;
    const n = Number(raw);
    if (!/^\d+(\.\d+)?$/.test(raw) || n < min || n > max || (integer && !Number.isInteger(n)))
      errors.push(`${name} must be ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}.`);
  }
  const clientId = String(vars.MS_CLIENT_ID ?? '').trim();
  if (clientId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId))
    errors.push('MS_CLIENT_ID must be the Application (client) ID from Microsoft Entra, a GUID.');
  // These would be readable by anyone with the config; they belong in secrets.
  for (const secret of ['MS_CLIENT_SECRET', 'ONEDRIVE_TOKEN_KEY'])
    if (String(vars[secret] ?? '').trim())
      errors.push(`${secret} is a secret. Remove it from vars and run: bunx wrangler secret put ${secret}`);
  return errors;
}

export function checkPassword(value) {
  if (!value) return 'The password is empty.';
  if (value.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (WEAK.has(value)) return 'That is an example password. Choose your own.';
  return null;
}

// Wrangler's D1 commands ignore the config's account_id when the login reaches more than one
// account, and fail in a non-interactive run. The environment variable reaches every command.
export function useAccount(config, env = process.env) {
  if (config.account_id && !env.CLOUDFLARE_ACCOUNT_ID) env.CLOUDFLARE_ACCOUNT_ID = config.account_id;
}

export function wranglerEnv(extra = {}) {
  return { ...process.env, WRANGLER_SEND_METRICS: 'false', ...extra };
}

// Runs the project's own Wrangler. Override the binary with NUITS_WRANGLER_BIN (tests).
export function wrangler(args, { capture = false, input } = {}) {
  const bin = process.env.NUITS_WRANGLER_BIN || join(ROOT, 'node_modules', '.bin', 'wrangler');
  const result = spawnSync(bin, args, {
    cwd: ROOT,
    env: wranglerEnv(),
    input,
    encoding: 'utf8',
    stdio: capture || input !== undefined ? ['pipe', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout ?? '' };
}

function jsonFrom(stdout) {
  const start = stdout.search(/[[{]/);
  if (start === -1) throw new Error('Wrangler returned no JSON.');
  return JSON.parse(stdout.slice(start));
}

export function listDatabases(configPath) {
  const r = wrangler(['d1', 'list', '--json', '--config', configPath], { capture: true });
  if (r.status !== 0) throw new Error('`wrangler d1 list` failed. Run `bunx wrangler login` first.');
  return jsonFrom(r.stdout);
}

export function userTables(name, configPath) {
  const r = wrangler(
    [
      'd1',
      'execute',
      name,
      '--remote',
      '--json',
      '--config',
      configPath,
      '--command',
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
    ],
    { capture: true },
  );
  if (r.status !== 0) throw new Error(`Could not inspect D1 database ${name}.`);
  const parsed = jsonFrom(r.stdout);
  return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((p) => p.results ?? []).map((row) => row.name);
}

// Finds or creates the D1 database the config names. Never adopts a database
// that already holds other data unless the owner confirms its exact ID.
export function resolveDatabase(config, configPath, env = process.env) {
  const db = database(config);
  if (db.database_id) return { id: db.database_id, how: 'configured' };
  const name = db.database_name;
  const ledger = db.migrations_table ?? 'd1_migrations';
  const existing = listDatabases(configPath).find((d) => d.name === name);
  if (existing) {
    const id = existing.uuid;
    if (env.NUITS_D1_DATABASE_ID && env.NUITS_D1_DATABASE_ID === id)
      return { id, how: 'confirmed by NUITS_D1_DATABASE_ID' };
    const tables = userTables(name, configPath);
    if (tables.length === 0) return { id, how: 'existing empty database' };
    if (tables.includes(ledger)) return { id, how: `existing database with this app's ${ledger} ledger` };
    throw new Error(
      `A D1 database named "${name}" already exists and holds other tables (${tables.slice(0, 5).join(', ')}). ` +
        'Refusing to reuse it. Pick another database_name, or set NUITS_D1_DATABASE_ID to its exact ID if it really is this app.',
    );
  }
  const created = wrangler(['d1', 'create', name, '--config', configPath], { capture: true });
  if (created.status !== 0) throw new Error(`Could not create D1 database ${name}.`);
  const fresh = listDatabases(configPath).find((d) => d.name === name);
  if (!fresh) throw new Error(`D1 database ${name} was created but cannot be found.`);
  return { id: fresh.uuid, how: 'created' };
}

export function writeResolved(config, id) {
  const copy = structuredClone(config);
  database(copy).database_id = id;
  const header = '// Generated by scripts/deploy.mjs. Gitignored. Holds your resolved D1 ID; do not commit.\n';
  writeFileSync(join(ROOT, RESOLVED_CONFIG), header + JSON.stringify(copy, null, 2) + '\n');
  return RESOLVED_CONFIG;
}
