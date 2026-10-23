// In-app settings (Settings > Setup). A value saved here overrides the Worker
// var of the same name for every request: app setting > Worker var > built-in
// default. Rows are read once per request and layered over env, so config(env)
// and every env.X read stay synchronous and see the same values.
//
// Only keys in FIELDS are ever read from the table. Secrets, sign-in, the base
// path and bindings stay deploy-time (DEPLOY_ONLY) whatever the table holds.
import type { Env } from './env';
import { parseConfig, TUNING_VARS } from './config';
import { DEFAULT_TUNING, EXPONENTS, InputError, requireInput } from './domain';

export type Group = 'business' | 'email' | 'accountant' | 'review' | 'integrations';
export type SettingKey =
  | 'APP_NAME'
  | 'SELLER_NAMES'
  | 'PRODUCTS_JSON'
  | 'DEFAULT_PRODUCT'
  | 'DEFAULT_CURRENCY'
  | 'RECEIPT_ADDRESS'
  | 'INVOICES_ADDRESS'
  | 'ALLOWED_SENDER_EMAILS'
  | 'FORWARD_COPY_TO'
  | 'ACCOUNTANT_LABEL'
  | 'EXPORT_PREFIX'
  | 'SEND_HINT'
  | 'PAYMENT_TERMS_DAYS'
  | 'REVIEW_MIN_CONFIDENCE'
  | 'REVIEW_MAX_UNCERTAINTY'
  | 'REVIEW_MIN_CATEGORY_CONFIDENCE'
  | 'MATCH_DAYS_BEFORE'
  | 'MATCH_DAYS_AFTER'
  | 'MATCH_NAME_SIMILARITY'
  | 'SALES_MATCH_DAYS_BEFORE'
  | 'SALES_MATCH_DAYS_AFTER_DUE'
  | 'SOURCE_REPOSITORY';
export type Field = {
  key: SettingKey;
  group: Group;
  label: string;
  help: string;
  kind: 'text' | 'textarea' | 'list' | 'email' | 'number' | 'products' | 'product' | 'currency';
  // Built-in default, as shown when neither the app nor the deploy sets it.
  fallback: string;
  // Class B: a change needs this box ticked in the same save.
  confirm?: string;
  // Shown next to a class B field before it is changed.
  warning?: string;
  advanced?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  step?: number;
};
const tuningDefault = (key: SettingKey) =>
  String(
    DEFAULT_TUNING[
      (Object.entries(TUNING_VARS).find(([, v]) => v.name === key)?.[0] ?? '') as keyof typeof DEFAULT_TUNING
    ],
  );
const bounds = (key: SettingKey) => {
  const spec = Object.values(TUNING_VARS).find((v) => v.name === key)!;
  return { min: spec.min, max: spec.max, step: spec.integer ? 1 : 0.01 };
};
const ROUTING =
  'The app can’t change Cloudflare Email Routing. Add a “Send to a Worker” rule for the new address first, send a test, then remove the old rule.';
export const FIELDS: readonly Field[] = [
  // Business
  {
    key: 'APP_NAME',
    group: 'business',
    label: 'App name',
    help: 'Header and browser tab.',
    kind: 'text',
    fallback: 'Nuits Receipts',
    maxLength: 60,
  },
  {
    key: 'SELLER_NAMES',
    group: 'business',
    label: 'Your business names',
    help: 'As on invoices you send, comma separated. Other sellers are flagged.',
    kind: 'text',
    fallback: '',
    maxLength: 2000,
  },
  {
    key: 'PRODUCTS_JSON',
    group: 'business',
    label: 'Parts of the business',
    help: 'Each receipt is filed under one. Parts in use can’t be removed.',
    kind: 'products',
    fallback: '[{"id":"general","label":"General"}]',
  },
  {
    key: 'DEFAULT_PRODUCT',
    group: 'business',
    label: 'Default part',
    help: 'Used when nothing says otherwise.',
    kind: 'product',
    fallback: '',
  },
  {
    key: 'PAYMENT_TERMS_DAYS',
    group: 'business',
    label: 'Payment terms, days',
    help: 'For sales invoices without a due date.',
    kind: 'number',
    fallback: tuningDefault('PAYMENT_TERMS_DAYS'),
    ...bounds('PAYMENT_TERMS_DAYS'),
  },
  {
    key: 'DEFAULT_CURRENCY',
    group: 'business',
    label: 'New account currency',
    help: 'Preselected for new bank accounts.',
    kind: 'currency',
    fallback: 'EUR',
  },
  // Email in
  {
    key: 'RECEIPT_ADDRESS',
    group: 'email',
    label: 'Receipt address',
    help: 'Where you forward receipts.',
    kind: 'email',
    fallback: '',
    confirm: 'I’ve added the Email Routing rule for this address',
    warning: ROUTING,
    maxLength: 254,
  },
  {
    key: 'INVOICES_ADDRESS',
    group: 'email',
    label: 'Invoice address',
    help: 'Mail here is filed as a sales invoice. Empty is off.',
    kind: 'email',
    fallback: '',
    confirm: 'I’ve added the Email Routing rule for this address',
    warning: ROUTING,
    maxLength: 254,
  },
  {
    key: 'ALLOWED_SENDER_EMAILS',
    group: 'email',
    label: 'Allowed senders',
    help: 'Only mail from these is read. One per line.',
    kind: 'list',
    fallback: '',
    confirm: 'I’ve checked this list; mail from anyone else is ignored',
    warning: 'This decides who can put documents into your books.',
    maxLength: 26000,
  },
  {
    key: 'FORWARD_COPY_TO',
    group: 'email',
    label: 'Forward a copy to',
    help: 'Gets a copy of all mail, so sign-in codes reach you. Empty is off.',
    kind: 'email',
    fallback: '',
    confirm: 'This address is a verified destination in Email Routing',
    warning:
      'It must be a verified destination address in Cloudflare Email Routing, or copies are lost. The app can’t check this.',
    maxLength: 254,
  },
  // Accountant & export
  {
    key: 'ACCOUNTANT_LABEL',
    group: 'accountant',
    label: 'Accountant',
    help: 'As in “Send to your accountant”.',
    kind: 'text',
    fallback: 'your accountant',
    maxLength: 100,
  },
  {
    key: 'EXPORT_PREFIX',
    group: 'accountant',
    label: 'Export file name',
    help: 'Start of export file names. Letters, digits, . _ -',
    kind: 'text',
    fallback: 'receipts',
    maxLength: 40,
  },
  {
    key: 'SEND_HINT',
    group: 'accountant',
    label: 'Note under the month download',
    help: 'One line under the month download. Empty shows nothing.',
    kind: 'text',
    fallback: '',
    maxLength: 300,
  },
  // Review (Advanced)
  {
    key: 'REVIEW_MIN_CONFIDENCE',
    group: 'review',
    label: 'Ask me when the reader is less sure than',
    help: '0.5 to 0.99. Lower asks less but errs more.',
    kind: 'number',
    fallback: tuningDefault('REVIEW_MIN_CONFIDENCE'),
    advanced: true,
    ...bounds('REVIEW_MIN_CONFIDENCE'),
  },
  {
    key: 'REVIEW_MAX_UNCERTAINTY',
    group: 'review',
    label: 'Ask me when a field may be missing, above',
    help: '0.01 to 0.5.',
    kind: 'number',
    fallback: tuningDefault('REVIEW_MAX_UNCERTAINTY'),
    advanced: true,
    ...bounds('REVIEW_MAX_UNCERTAINTY'),
  },
  {
    key: 'REVIEW_MIN_CATEGORY_CONFIDENCE',
    group: 'review',
    label: 'Use a suggested part or type only above',
    help: '0.5 to 0.99. Below it, the default is used.',
    kind: 'number',
    fallback: tuningDefault('REVIEW_MIN_CATEGORY_CONFIDENCE'),
    advanced: true,
    ...bounds('REVIEW_MIN_CATEGORY_CONFIDENCE'),
  },
  {
    key: 'MATCH_DAYS_BEFORE',
    group: 'review',
    label: 'Payment may be booked days before the receipt',
    help: '0 to 30.',
    kind: 'number',
    fallback: tuningDefault('MATCH_DAYS_BEFORE'),
    advanced: true,
    ...bounds('MATCH_DAYS_BEFORE'),
  },
  {
    key: 'MATCH_DAYS_AFTER',
    group: 'review',
    label: 'and days after it',
    help: '1 to 180. Wider finds late bookings, risks wrong pairs.',
    kind: 'number',
    fallback: tuningDefault('MATCH_DAYS_AFTER'),
    advanced: true,
    ...bounds('MATCH_DAYS_AFTER'),
  },
  {
    key: 'MATCH_NAME_SIMILARITY',
    group: 'review',
    label: 'Seller and bank name must share',
    help: 'Share of words, 0.3 to 1.',
    kind: 'number',
    fallback: tuningDefault('MATCH_NAME_SIMILARITY'),
    advanced: true,
    ...bounds('MATCH_NAME_SIMILARITY'),
  },
  {
    key: 'SALES_MATCH_DAYS_BEFORE',
    group: 'review',
    label: 'Money in may arrive days before an invoice',
    help: '0 to 60.',
    kind: 'number',
    fallback: tuningDefault('SALES_MATCH_DAYS_BEFORE'),
    advanced: true,
    ...bounds('SALES_MATCH_DAYS_BEFORE'),
  },
  {
    key: 'SALES_MATCH_DAYS_AFTER_DUE',
    group: 'review',
    label: 'and days after it’s due',
    help: '0 to 365.',
    kind: 'number',
    fallback: tuningDefault('SALES_MATCH_DAYS_AFTER_DUE'),
    advanced: true,
    ...bounds('SALES_MATCH_DAYS_AFTER_DUE'),
  },
  // Integrations
  {
    key: 'SOURCE_REPOSITORY',
    group: 'integrations',
    label: 'Source code link',
    help: 'An https URL for the footer. Empty hides it.',
    kind: 'text',
    fallback: '',
    maxLength: 300,
  },
];
export const GROUPS: readonly { id: Group; title: string }[] = [
  { id: 'business', title: 'Business' },
  { id: 'email', title: 'Email' },
  { id: 'accountant', title: 'Export' },
  { id: 'review', title: 'Review & matching' },
  { id: 'integrations', title: 'Integrations' },
];
// Stay deploy-time whatever the settings table holds, and why.
export const DEPLOY_ONLY: readonly { key: string; label: string; why: string; secret?: boolean }[] = [
  { key: 'ACCESS_TEAM_DOMAIN', label: 'Access team', why: 'Sign-in boundary; must match your Access application.' },
  { key: 'ACCESS_AUD', label: 'Access audience', why: 'Sign-in boundary; must match your Access application.' },
  { key: 'ACCESS_ALLOWED_EMAILS', label: 'Who can sign in', why: 'Sign-in boundary; must match Access policy.' },
  { key: 'AUTH_USERNAME', label: 'Password user name', why: 'Changing it here could lock you out.' },
  { key: 'NUITS_PASSWORD', label: 'Password', why: 'Secret.', secret: true },
  { key: 'APP_BASE_PATH', label: 'Address', why: 'Must match the Worker routes, or every page 404s.' },
  { key: 'AI_MODE', label: 'Reader', why: 'mock would quietly stop real reading.' },
  { key: 'MS_CLIENT_ID', label: 'OneDrive app', why: 'Must match the Microsoft Entra app and its secrets.' },
  { key: 'MS_CLIENT_SECRET', label: 'OneDrive secret', why: 'Secret.', secret: true },
  {
    key: 'ONEDRIVE_TOKEN_KEY',
    label: 'OneDrive token key',
    why: 'Secret; rotating it disconnects OneDrive.',
    secret: true,
  },
];
export const FIELD = new Map(FIELDS.map((f) => [f.key, f]));
// INVOICES_ADDRESS is still read for 30 days after it changes, so mail in
// transit to the old address is not filed as a receipt. Not a field.
export const PREVIOUS_INVOICES = 'INVOICES_ADDRESS_PREVIOUS';
export const GRACE_DAYS = 30;

// Mail to the previous INVOICES_ADDRESS still counts as an invoice for 30 days.
export function previousInvoicesAddress(env: Env, now = Date.now()): string {
  const previous = applied(env).previousInvoices;
  return previous && Date.parse(previous.until) > now ? previous.address : '';
}

export type Row = { key: string; value_json: string; updated_at: string; updated_by: string };
export type Applied = {
  // Valid app values in force, by key.
  app: ReadonlyMap<SettingKey, Row & { value: string }>;
  // Saved values that failed validation, so the deploy value or default is used.
  invalid: ReadonlyMap<SettingKey, { value: string; error: string }>;
  // Latest audit id; a save naming an older revision gets 409.
  revision: number;
  previousInvoices: { address: string; until: string } | null;
};
const APPLIED = Symbol('settings');
const EMPTY: Applied = { app: new Map(), invalid: new Map(), revision: 0, previousInvoices: null };
export function applied(env: Env): Applied {
  return (env as unknown as Record<symbol, Applied | undefined>)[APPLIED] ?? EMPTY;
}
function decode(json: string): string | null {
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}
// Own properties are defined, never assigned: assignment on an object whose
// prototype is the runtime env can reach the env itself (it may be a proxy).
export function put(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}
const layers = new WeakMap<object, Map<string, { values: [SettingKey, string][]; applied: Applied }>>();
// The env for one request: env with valid app values on top. Values are
// checked one at a time in FIELDS order; one that fails (alone or with the
// ones before it) is skipped and reported, never a 503.
export function layer(env: Env, rows: readonly Row[], revision: number): Env {
  const signature = JSON.stringify([revision, rows]);
  let byEnv = layers.get(env);
  if (!byEnv) layers.set(env, (byEnv = new Map()));
  let cached = byEnv.get(signature);
  if (!cached) {
    const stored = new Map(rows.map((r) => [r.key, r]));
    const app = new Map<SettingKey, Row & { value: string }>(),
      invalid = new Map<SettingKey, { value: string; error: string }>(),
      values: [SettingKey, string][] = [];
    let baseValid = true;
    try {
      parseConfig(env);
    } catch {
      baseValid = false;
    }
    const candidate = Object.create(env) as Record<string, unknown>;
    for (const field of FIELDS) {
      const row = stored.get(field.key);
      if (!row) continue;
      const value = decode(row.value_json);
      if (value === null) {
        invalid.set(field.key, { value: row.value_json, error: `${field.key} is not text` });
        continue;
      }
      const before = candidate[field.key];
      put(candidate, field.key, value);
      try {
        if (baseValid) parseConfig(candidate as Partial<Env>);
        app.set(field.key, { ...row, value });
        values.push([field.key, value]);
      } catch (error) {
        put(candidate, field.key, before);
        invalid.set(field.key, {
          value,
          error:
            error instanceof Error ? error.message.replace(/^Configuration error: |\. See docs.*$/g, '') : 'Invalid',
        });
      }
    }
    const previous = stored.get(PREVIOUS_INVOICES);
    let previousInvoices: Applied['previousInvoices'] = null;
    try {
      const p = previous ? (JSON.parse(previous.value_json) as { address?: unknown; until?: unknown }) : null;
      if (p && typeof p.address === 'string' && typeof p.until === 'string')
        previousInvoices = { address: p.address, until: p.until };
    } catch {
      previousInvoices = null;
    }
    cached = { values, applied: { app, invalid, revision, previousInvoices } };
    if (byEnv.size > 20) byEnv.clear();
    byEnv.set(signature, cached);
  }
  const result = Object.create(env) as Record<string | symbol, unknown>;
  for (const [key, value] of cached.values) put(result, key, value);
  Object.defineProperty(result, APPLIED, { value: cached.applied });
  return result as unknown as Env;
}
// One read per request or email. A missing table (migration not applied yet)
// or a D1 error leaves the deploy values in force.
export async function withSettings(env: Env): Promise<Env> {
  if ((env as unknown as Record<symbol, unknown>)[APPLIED]) return env;
  try {
    const [rows, audit] = await env.DB.batch([
      env.DB.prepare('SELECT key,value_json,updated_at,updated_by FROM settings ORDER BY key'),
      env.DB.prepare('SELECT COALESCE(MAX(id),0) AS revision FROM settings_audit'),
    ]);
    return layer(
      env,
      (rows!.results as Row[]) ?? [],
      Number((audit!.results[0] as { revision?: number } | undefined)?.revision ?? 0),
    );
  } catch (error) {
    console.warn(
      JSON.stringify({ reason: 'settings_unavailable', error: error instanceof Error ? error.message : String(error) }),
    );
    return env;
  }
}
// The deploy env underneath the app layer.
export function deployEnv(env: Env): Env {
  let base: Env = env;
  while ((base as unknown as Record<symbol, unknown>)[APPLIED]) base = Object.getPrototypeOf(base) as Env;
  return base;
}
export type Source = 'app' | 'deploy' | 'default';
export function sourceOf(env: Env, key: SettingKey): Source {
  if (applied(env).app.has(key)) return 'app';
  const raw = (deployEnv(env) as unknown as Record<string, unknown>)[key];
  return typeof raw === 'string' && raw.trim() ? 'deploy' : 'default';
}
export function deployValue(env: Env, key: SettingKey): string {
  const raw = (deployEnv(env) as unknown as Record<string, unknown>)[key];
  return typeof raw === 'string' ? raw : '';
}
// What the form shows: the value in force, as text.
export function currentValue(env: Env, key: SettingKey): string {
  const raw = (env as unknown as Record<string, unknown>)[key];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : '';
}

// Normalises one submitted value. Lists become ", " separated, lower case.
export function normalizeValue(field: Field, raw: string): string {
  const value = raw.replace(/\r\n?/g, '\n').trim();
  if (field.kind === 'list')
    return value
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .join(', ');
  if (field.kind === 'email') return value.toLowerCase();
  if (field.kind === 'number' && value) {
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : value;
  }
  if (field.kind === 'currency') {
    requireInput(EXPONENTS[value] !== undefined, 'Choose a supported currency');
    return value;
  }
  requireInput(field.kind === 'textarea' || !/[\u0000-\u001f]/.test(value), `${field.label} can’t contain line breaks`);
  return value;
}

export type Change = { key: SettingKey | typeof PREVIOUS_INVOICES; value: string | null; old: string | null };
// Writes changes (null value = back to deploy/default) with their audit rows
// in one batch. The first statement fails the batch when someone else saved
// since `revision`, so two tabs can't silently overwrite each other.
export async function saveChanges(env: Env, changes: readonly Change[], who: string, revision: number): Promise<void> {
  if (!changes.length) return;
  const now = new Date().toISOString(),
    base = deployEnv(env);
  const stored = new Map(
    (
      await base.DB.prepare('SELECT key,value_json FROM settings').all<{ key: string; value_json: string }>()
    ).results.map((r) => [r.key, r.value_json]),
  );
  const current = await base.DB.prepare('SELECT COALESCE(MAX(id),0) AS revision FROM settings_audit').first<{
    revision: number;
  }>();
  if (Number(current?.revision ?? 0) !== revision)
    throw new InputError('Settings were changed in another tab or by someone else. Reload and try again.', 409);
  const statements: D1PreparedStatement[] = [
    // Guard: insert a marker only if nobody saved in between; the CHECK on the
    // next statement aborts the batch otherwise.
    base.DB.prepare(
      "INSERT INTO settings_audit(key,old_json,new_json,changed_at,changed_by) SELECT '_revision',NULL,NULL,?,? WHERE (SELECT COALESCE(MAX(id),0) FROM settings_audit)=?",
    ).bind(now, who, revision),
    base.DB.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json('settings changed') END"),
  ];
  for (const change of changes) {
    const json =
      change.value === null ? null : change.key === PREVIOUS_INVOICES ? change.value : JSON.stringify(change.value);
    statements.push(
      json === null
        ? base.DB.prepare('DELETE FROM settings WHERE key=?').bind(change.key)
        : base.DB.prepare(
            'INSERT INTO settings(key,value_json,updated_at,updated_by) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by',
          ).bind(change.key, json, now, who),
    );
    if (change.key !== PREVIOUS_INVOICES)
      statements.push(
        base.DB.prepare(
          'INSERT INTO settings_audit(key,old_json,new_json,changed_at,changed_by) VALUES (?,?,?,?,?)',
        ).bind(change.key, stored.get(change.key) ?? null, json, now, who),
      );
  }
  try {
    await base.DB.batch(statements);
  } catch (error) {
    if (error instanceof Error && /malformed JSON|settings changed/i.test(error.message))
      throw new InputError('Settings were changed in another tab or by someone else. Reload and try again.', 409);
    throw error;
  }
}
export type AuditRow = {
  id: number;
  key: string;
  old_json: string | null;
  new_json: string | null;
  changed_at: string;
  changed_by: string;
};
export async function history(env: Env, limit = 20): Promise<AuditRow[]> {
  try {
    return (
      await deployEnv(env)
        .DB.prepare("SELECT * FROM settings_audit WHERE key<>'_revision' ORDER BY id DESC LIMIT ?")
        .bind(limit)
        .all<AuditRow>()
    ).results;
  } catch {
    return [];
  }
}
