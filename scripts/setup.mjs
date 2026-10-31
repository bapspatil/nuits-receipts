#!/usr/bin/env node
// `bun run setup`: guided manual install into your own Cloudflare account.
// Writes the gitignored wrangler.production.jsonc, finds or creates D1, deploys
// with scripts/deploy.mjs, then asks for NUITS_PASSWORD and stores it as a
// Worker secret. The password is never written to disk or printed.
//
//   bun run setup              # interactive
//   bun run setup -- --no-deploy   # only write wrangler.production.jsonc
import { createInterface } from 'node:readline';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  ROOT,
  PRIVATE_CONFIG,
  TEMPLATE_CONFIG,
  checkPassword,
  database,
  readConfig,
  resolveDatabase,
  useAccount,
  validateVars,
  wrangler,
  wranglerEnv,
} from './deploy-lib.mjs';

const argv = process.argv.slice(2);
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let muted = false;
const write = rl._writeToOutput?.bind(rl);
rl._writeToOutput = (text) => {
  if (!muted || text.includes('\n') || text.startsWith('\x1b')) write?.(muted ? '\n' : text);
};
const ask = (question, fallback = '') =>
  new Promise((resolve) =>
    rl.question(`${question}${fallback ? ` [${fallback}]` : ''}: `, (a) => resolve(a.trim() || fallback)),
  );
const askHidden = (question) =>
  new Promise((resolve) => {
    rl.question(`${question}: `, (a) => {
      muted = false;
      resolve(a);
    });
    muted = true;
  });
const stop = (message) => {
  console.error(`\n✗ ${message}`);
  rl.close();
  process.exit(1);
};

console.log('Nuits Receipts setup. Everything is created in your own Cloudflare account.\n');
if (wrangler(['whoami'], { capture: true }).status !== 0) stop('Sign in first: bunx wrangler login');

if (existsSync(join(ROOT, PRIVATE_CONFIG))) {
  const answer = await ask(`${PRIVATE_CONFIG} already exists. Overwrite it? (y/N)`, 'N');
  if (!/^y/i.test(answer)) stop(`Kept ${PRIVATE_CONFIG}. Run \`bun run deploy\` to deploy it.`);
}

const config = readConfig(TEMPLATE_CONFIG);
const db = database(config);
const bucket = config.r2_buckets.find((b) => b.binding === 'ORIGINALS');
config.name = await ask('Worker name', config.name);
const account = await ask(
  'Cloudflare account ID (blank if you have only one account)',
  process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
);
if (account) config.account_id = account;
useAccount(config);
db.database_name = await ask('D1 database name', `${config.name}`);
bucket.bucket_name = await ask('Private R2 bucket name', `${config.name}-originals`);
const vars = config.vars;
vars.AUTH_USERNAME = await ask('Sign-in user name', vars.AUTH_USERNAME);
vars.ALLOWED_SENDER_EMAILS = await ask(
  'Email addresses allowed to send receipts (comma separated, blank disables email)',
  '',
);
vars.RECEIPT_ADDRESS = await ask('Receipt address you will route to this Worker (blank for uploads only)', '');
if (vars.RECEIPT_ADDRESS)
  vars.FORWARD_COPY_TO = await ask(
    'Also forward a copy of every incoming email to (one verified Email Routing destination, blank for none)',
    '',
  );
if (vars.RECEIPT_ADDRESS) {
  vars.INVOICES_ADDRESS = await ask(
    'Address for copies of sales invoices you send (also routed to this Worker, blank for none)',
    '',
  );
  if (vars.INVOICES_ADDRESS)
    vars.SELLER_NAMES = await ask('Your business names as they appear on your invoices (comma separated)', '');
}
const products = await ask('Products or projects to group costs by (comma separated)', 'General');
const list = [
  ...new Set(
    products
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean),
  ),
];
vars.PRODUCTS_JSON = JSON.stringify(
  list.map((label) => ({
    id:
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'general',
    label,
  })),
);
vars.DEFAULT_PRODUCT = JSON.parse(vars.PRODUCTS_JSON)[0].id;
vars.ACCOUNTANT_LABEL = await ask('Who receives the CSV export', vars.ACCOUNTANT_LABEL);
const errors = validateVars(config);
if (errors.length) stop(errors.join('\n'));

const configPath = PRIVATE_CONFIG;
const save = () =>
  writeFileSync(
    join(ROOT, configPath),
    '// Your private deployment config, written by `bun run setup`. Gitignored; do not commit.\n' +
      JSON.stringify(config, null, 2) +
      '\n',
    { mode: 0o600 },
  );
save();
try {
  const resolved = resolveDatabase(config, configPath);
  db.database_id = resolved.id;
  console.log(`D1 database ${db.database_name}: ${resolved.how}`);
} catch (error) {
  stop(error.message);
}
save();
console.log(`Wrote ${configPath}.`);
if (argv.includes('--no-deploy')) {
  rl.close();
  process.exit(0);
}

let password = await askHidden('NUITS_PASSWORD for signing in (at least 16 characters; leave blank to generate one)');
if (!password) {
  password = randomBytes(24).toString('base64url');
  console.log('Generated a password. It is shown once, below; store it in your password manager now.');
  console.log(password);
} else {
  const problem = checkPassword(password);
  if (problem) stop(problem);
  if ((await askHidden('Repeat the password')) !== password) stop('The passwords differ.');
}

const deploy = spawnSync(process.execPath, [join(ROOT, 'scripts', 'deploy.mjs'), '--config', configPath], {
  cwd: ROOT,
  env: wranglerEnv(),
  stdio: 'inherit',
});
if (deploy.status !== 0) stop('Deploy failed; the password was not stored.');
const secret = wrangler(['secret', 'put', 'NUITS_PASSWORD', '--config', configPath], { input: password + '\n' });
password = '';
if (secret.status !== 0)
  stop('Could not store NUITS_PASSWORD. Run: bunx wrangler secret put NUITS_PASSWORD --config ' + configPath);
console.log(`\n✓ Done. Sign in as "${vars.AUTH_USERNAME}" at your workers.dev URL shown above.`);
if (vars.RECEIPT_ADDRESS)
  console.log(
    `Next: in Email Routing, add a "Send to a Worker" rule for ${vars.RECEIPT_ADDRESS} pointing at ${config.name}. See README.md.`,
  );
rl.close();
