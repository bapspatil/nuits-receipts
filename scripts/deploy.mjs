#!/usr/bin/env node
// `bun run deploy`: validate config, resolve D1, apply migrations to binding DB,
// then `wrangler deploy`. Fails before deploying if any step fails.
// Used unchanged by the Deploy to Cloudflare button (Workers Builds) and by hand.
//
//   bun run deploy                 # template, or wrangler.production.jsonc if present
//   bun run deploy -- --dry-run    # validate and bundle only, touches nothing remote
//   bun run deploy -- --config wrangler.other.jsonc
import {
  database,
  readConfig,
  resolveDatabase,
  selectConfig,
  useAccount,
  validateVars,
  wrangler,
  writeResolved,
} from './deploy-lib.mjs';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const configPath = selectConfig(argv);
const fail = (message) => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};

console.log(`Using ${configPath}${dryRun ? ' (dry run)' : ''}`);
let config;
try {
  config = readConfig(configPath);
  database(config);
  useAccount(config);
} catch (error) {
  fail(error.message);
}
const errors = validateVars(config);
if (errors.length) fail(`Fix these Worker vars first:\n  - ${errors.join('\n  - ')}`);

if (dryRun) {
  const r = wrangler(['deploy', '--dry-run', '--outdir', '.wrangler/dry-run', '--config', configPath]);
  process.exit(r.status);
}

let deployConfig = configPath;
try {
  const resolved = resolveDatabase(config, configPath);
  console.log(`D1 database: ${resolved.how}`);
  if (resolved.how !== 'configured') deployConfig = writeResolved(config, resolved.id);
} catch (error) {
  fail(error.message);
}

// A populated private database (custom migrations_dir/ledger) only upgrades on
// purpose: back it up first (docs/RELEASING.md), then pass --apply-migrations.
const db = database(config);
const isTemplateLedger = db.migrations_dir === 'schema' && db.migrations_table === 'template_migrations';
const pending = wrangler(['d1', 'migrations', 'list', 'DB', '--remote', '--config', deployConfig], { capture: true });
if (pending.status !== 0) fail('Could not list D1 migrations. Nothing was deployed.');
const nothingPending = /No migrations to apply/i.test(pending.stdout);
if (!nothingPending && !isTemplateLedger && !argv.includes('--apply-migrations'))
  fail(
    `${configPath} has pending migrations for an existing private database:\n${pending.stdout.trim()}\n` +
      'Back up the database first, then rerun with --apply-migrations. Nothing was deployed.',
  );
// Interactive shells confirm the list of migrations; CI (Workers Builds) skips the prompt.
if (!nothingPending) {
  const migrated = wrangler(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', deployConfig]);
  if (migrated.status !== 0) fail('Migrations failed. Nothing was deployed.');
}

const deployed = wrangler(['deploy', '--config', deployConfig]);
if (deployed.status !== 0) fail('wrangler deploy failed.');
console.log('\n✓ Deployed. If this is a new install, set NUITS_PASSWORD (bun run setup) before signing in.');
