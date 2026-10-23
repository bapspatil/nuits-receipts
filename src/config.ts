import type { Env } from './env';
import { DEFAULT_TUNING, EXPONENTS, InputError, type Product, type Tuning } from './domain';
import type { AccessConfig } from './access';

// Deployment-specific settings. Every value comes from Worker vars (see
// wrangler.jsonc and docs/ENVIRONMENT.md); nothing here names a real person,
// inbox, account or business. Invalid values fail closed.
export type { Product };
export type AppConfig = {
  username: string;
  allowedSenders: ReadonlySet<string>;
  receiptAddress: string;
  // Mail sent to this address is a sales invoice. '' turns invoice email off.
  invoicesAddress: string;
  // Names the owner invoices under; a sales invoice must show one as seller.
  // Empty skips the check.
  sellerNames: readonly string[];
  // Every message the Worker receives is also forwarded here. '' is off.
  forwardCopyTo: string;
  products: readonly { id: Product; label: string }[];
  defaultProduct: Product;
  accountantLabel: string;
  sourceRepository: string;
  appName: string;
  exportPrefix: string;
  // '' serves the app at the root; '/app' serves it under https://host/app.
  basePath: string;
  // Cloudflare Access mode replaces HTTP Basic sign-in. null is off.
  access: AccessConfig | null;
  // Free text under the month download button. '' shows nothing.
  sendHint: string;
  // Direct OneDrive upload. null is off; incomplete means MS_CLIENT_ID is set
  // but a secret is missing, so Settings can say so.
  oneDrive: OneDriveConfig | null;
  oneDriveIncomplete: boolean;
  // Preselected for a new bank account.
  defaultCurrency: string;
  // Review and matching thresholds (Settings > Setup > Advanced).
  tuning: Tuning;
};
export type OneDriveConfig = { clientId: string; clientSecret: string; tokenKey: Uint8Array };

// Example passwords from the docs are refused in live mode, so a template
// deployment never runs with a value someone else knows.
export const WEAK_PASSWORDS: ReadonlySet<string> = new Set(['local-dummy-password', 'change-me', 'password']);
export const MIN_PASSWORD_LENGTH = 16;
export const DEFAULT_PRODUCTS_JSON = '[{"id":"general","label":"General"}]';
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const cache = new WeakMap<object, AppConfig>();

export class ConfigError extends InputError {
  constructor(message: string) {
    super(`Configuration error: ${message}. See docs/ENVIRONMENT.md.`, 503);
  }
}

function text(value: unknown, fallback: string, name: string, max = 200): string {
  const result = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  if (result.length > max || /[\u0000-\u001f]/.test(result)) throw new ConfigError(`${name} is invalid`);
  return result;
}

// The most allowed senders. Saved in the app they are stored as one text of
// "a, b, c" (2 characters between addresses), at most 254 characters each:
// 75 x 254 + 74 x 2 + 2 quotes = 19,200, under the 20,000 the settings table
// accepts (settings.value_json). A higher count could never be saved.
export const MAX_ALLOWED_SENDERS = 75;

// Comma, semicolon or whitespace separated. Empty disables email ingestion.
export function parseSenders(value: unknown, max = 100): ReadonlySet<string> {
  const raw = typeof value === 'string' ? value : '';
  const items = raw
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (items.length > max || items.some((s) => s.length > 254 || !EMAIL.test(s)))
    throw new ConfigError(`ALLOWED_SENDER_EMAILS must be a list of at most ${max} email addresses`);
  return new Set(items);
}

// One address, or empty to turn forwarding off. It must be a verified
// destination address in Cloudflare Email Routing, or the forward fails.
export function parseForwardCopyTo(value: unknown): string {
  const result = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (result && (result.length > 254 || !EMAIL.test(result)))
    throw new ConfigError('FORWARD_COPY_TO must be a single email address or empty');
  return result;
}

// Comma or semicolon separated, e.g. "Example Studio, Jane Doe". Empty skips the
// seller check on sales invoices.
export function parseSellerNames(value: unknown): readonly string[] {
  const raw = typeof value === 'string' ? value : '';
  const names = raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length > 20 || names.some((n) => n.length > 100 || /[\u0000-\u001f]/.test(n)))
    throw new ConfigError('SELLER_NAMES must be up to 20 names of at most 100 characters');
  return names;
}

// All three Access vars together turn Access mode on; all empty leaves HTTP
// Basic sign-in. A partial set fails closed so a typo never opens the app.
export function parseAccess(env: Partial<Env>): AccessConfig | null {
  const raw = {
    team: typeof env.ACCESS_TEAM_DOMAIN === 'string' ? env.ACCESS_TEAM_DOMAIN.trim() : '',
    aud: typeof env.ACCESS_AUD === 'string' ? env.ACCESS_AUD.trim() : '',
    emails: typeof env.ACCESS_ALLOWED_EMAILS === 'string' ? env.ACCESS_ALLOWED_EMAILS.trim() : '',
  };
  if (!raw.team && !raw.aud && !raw.emails) return null;
  if (!raw.team || !raw.aud || !raw.emails)
    throw new ConfigError('ACCESS_TEAM_DOMAIN, ACCESS_AUD and ACCESS_ALLOWED_EMAILS must be set together');
  const host = raw.team
    .replace(/^https:\/\//, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host) || host.length > 253)
    throw new ConfigError('ACCESS_TEAM_DOMAIN must look like "your-team.cloudflareaccess.com"');
  if (!/^[a-f0-9]{64}$/.test(raw.aud))
    throw new ConfigError('ACCESS_AUD must be the 64-character Access application audience tag');
  let emails: ReadonlySet<string>;
  try {
    emails = parseSenders(raw.emails);
  } catch {
    throw new ConfigError('ACCESS_ALLOWED_EMAILS must be a list of email addresses');
  }
  if (emails.size < 1) throw new ConfigError('ACCESS_ALLOWED_EMAILS must list at least one address');
  return { teamDomain: `https://${host}`, aud: raw.aud, emails };
}

// OneDrive upload needs all three values; anything less leaves it off, so a
// missing secret never half-enables it. Values that are set must be valid.
export function parseOneDrive(env: Partial<Env>): Pick<AppConfig, 'oneDrive' | 'oneDriveIncomplete'> {
  const value = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const clientId = value(env.MS_CLIENT_ID),
    clientSecret = value(env.MS_CLIENT_SECRET),
    key = value(env.ONEDRIVE_TOKEN_KEY);
  if (clientId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId))
    throw new ConfigError('MS_CLIENT_ID must be the Application (client) ID from Microsoft Entra, a GUID');
  if (!clientId || !clientSecret || !key) return { oneDrive: null, oneDriveIncomplete: !!clientId };
  if (clientSecret.length > 256 || /[\u0000-\u001f\s]/.test(clientSecret))
    throw new ConfigError('MS_CLIENT_SECRET is invalid');
  let tokenKey: Uint8Array;
  try {
    tokenKey = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
  } catch {
    tokenKey = new Uint8Array();
  }
  if (tokenKey.length !== 32)
    throw new ConfigError('ONEDRIVE_TOKEN_KEY must be 32 random bytes in base64, as from `openssl rand -base64 32`');
  return { oneDrive: { clientId: clientId.toLowerCase(), clientSecret, tokenKey }, oneDriveIncomplete: false };
}

export function parseProducts(
  value: unknown,
  fallbackDefault: unknown,
): Pick<AppConfig, 'products' | 'defaultProduct'> {
  const raw = typeof value === 'string' && value.trim() ? value : DEFAULT_PRODUCTS_JSON;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError('PRODUCTS_JSON is not valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 200)
    throw new ConfigError('PRODUCTS_JSON must be a list of 1 to 200 products');
  const products = parsed.map((item) => {
    const entry = typeof item === 'string' ? { id: item, label: item } : item;
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof (entry as { id: unknown }).id !== 'string' ||
      ((entry as { label?: unknown }).label !== undefined && typeof (entry as { label: unknown }).label !== 'string')
    )
      throw new ConfigError('PRODUCTS_JSON entries need a string id and optional label');
    const id = (entry as { id: string }).id.trim(),
      label = ((entry as { label?: string }).label ?? id).trim() || id;
    if (id.length < 1 || id.length > 100 || label.length > 100 || /[\u0000-\u001f]/.test(id + label))
      throw new ConfigError('Product ids and labels must be 1 to 100 characters');
    return { id: id as Product, label };
  });
  if (new Set(products.map((p) => p.id)).size !== products.length)
    throw new ConfigError('PRODUCTS_JSON has duplicate ids');
  const defaultId =
    typeof fallbackDefault === 'string' && fallbackDefault.trim() ? fallbackDefault.trim() : products[0]!.id;
  const defaultProduct = products.find((p) => p.id === defaultId)?.id;
  if (!defaultProduct) throw new ConfigError('DEFAULT_PRODUCT must be one of PRODUCTS_JSON');
  return { products, defaultProduct };
}

// Each threshold, its Worker var and the range it may take. Values outside
// the range fail closed like any other invalid setting.
export const TUNING_VARS = {
  minFieldConfidence: { name: 'REVIEW_MIN_CONFIDENCE', min: 0.5, max: 0.99, integer: false },
  maxFieldPNull: { name: 'REVIEW_MAX_UNCERTAINTY', min: 0.01, max: 0.5, integer: false },
  minCategoryProbability: { name: 'REVIEW_MIN_CATEGORY_CONFIDENCE', min: 0.5, max: 0.99, integer: false },
  matchDaysBefore: { name: 'MATCH_DAYS_BEFORE', min: 0, max: 30, integer: true },
  matchDaysAfter: { name: 'MATCH_DAYS_AFTER', min: 1, max: 180, integer: true },
  minVendorSimilarity: { name: 'MATCH_NAME_SIMILARITY', min: 0.3, max: 1, integer: false },
  salesDaysBefore: { name: 'SALES_MATCH_DAYS_BEFORE', min: 0, max: 60, integer: true },
  salesDaysAfterDue: { name: 'SALES_MATCH_DAYS_AFTER_DUE', min: 0, max: 365, integer: true },
  paymentTermsDays: { name: 'PAYMENT_TERMS_DAYS', min: 0, max: 365, integer: true },
} as const satisfies Record<keyof Tuning, { name: keyof Env; min: number; max: number; integer: boolean }>;
export function parseTuning(env: Partial<Env>): Tuning {
  const result = { ...DEFAULT_TUNING };
  for (const [field, spec] of Object.entries(TUNING_VARS) as [keyof Tuning, (typeof TUNING_VARS)[keyof Tuning]][]) {
    const raw = env[spec.name];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const value = Number(raw.trim());
    if (
      !/^\d+(\.\d+)?$/.test(raw.trim()) ||
      !Number.isFinite(value) ||
      value < spec.min ||
      value > spec.max ||
      (spec.integer && !Number.isInteger(value))
    )
      throw new ConfigError(
        `${spec.name} must be ${spec.integer ? 'a whole number' : 'a number'} from ${spec.min} to ${spec.max}`,
      );
    result[field] = value;
  }
  return result;
}

export function parseConfig(env: Partial<Env>): AppConfig {
  const username = text(env.AUTH_USERNAME, 'owner', 'AUTH_USERNAME', 64);
  if (username.includes(':')) throw new ConfigError('AUTH_USERNAME cannot contain ":"');
  const receiptAddress = text(env.RECEIPT_ADDRESS, '', 'RECEIPT_ADDRESS', 254).toLowerCase();
  if (receiptAddress && !EMAIL.test(receiptAddress)) throw new ConfigError('RECEIPT_ADDRESS must be an email address');
  const forwardCopyTo = parseForwardCopyTo(env.FORWARD_COPY_TO);
  const invoicesAddress = text(env.INVOICES_ADDRESS, '', 'INVOICES_ADDRESS', 254).toLowerCase();
  if (invoicesAddress && !EMAIL.test(invoicesAddress))
    throw new ConfigError('INVOICES_ADDRESS must be an email address');
  if (invoicesAddress && (invoicesAddress === receiptAddress || invoicesAddress === forwardCopyTo))
    throw new ConfigError('INVOICES_ADDRESS must differ from RECEIPT_ADDRESS and FORWARD_COPY_TO');
  const sourceRepository = text(env.SOURCE_REPOSITORY, '', 'SOURCE_REPOSITORY', 300);
  if (sourceRepository && !/^https:\/\/[^\s"'<>]+$/.test(sourceRepository))
    throw new ConfigError('SOURCE_REPOSITORY must be an https URL');
  const exportPrefix = text(env.EXPORT_PREFIX, 'receipts', 'EXPORT_PREFIX', 40);
  if (!/^[A-Za-z0-9._-]+$/.test(exportPrefix))
    throw new ConfigError('EXPORT_PREFIX may use letters, digits, ".", "_" and "-"');
  const defaultCurrency = text(env.DEFAULT_CURRENCY, 'EUR', 'DEFAULT_CURRENCY', 3).toUpperCase();
  if (EXPONENTS[defaultCurrency] === undefined)
    throw new ConfigError(`DEFAULT_CURRENCY must be one of ${Object.keys(EXPONENTS).join(', ')}`);
  const basePath = text(env.APP_BASE_PATH, '', 'APP_BASE_PATH', 60).replace(/\/+$/, '');
  if (basePath && !/^(\/[A-Za-z0-9._-]+)+$/.test(basePath))
    throw new ConfigError('APP_BASE_PATH must look like "/app" (or be empty)');
  return {
    username,
    allowedSenders: parseSenders(env.ALLOWED_SENDER_EMAILS, MAX_ALLOWED_SENDERS),
    receiptAddress,
    invoicesAddress,
    sellerNames: parseSellerNames(env.SELLER_NAMES),
    forwardCopyTo,
    ...parseProducts(env.PRODUCTS_JSON, env.DEFAULT_PRODUCT),
    accountantLabel: text(env.ACCOUNTANT_LABEL, 'your accountant', 'ACCOUNTANT_LABEL', 100),
    sourceRepository: sourceRepository.replace(/\/+$/, ''),
    appName: text(env.APP_NAME, 'Nuits Receipts', 'APP_NAME', 60),
    exportPrefix,
    basePath,
    access: parseAccess(env),
    sendHint: text(env.SEND_HINT, '', 'SEND_HINT', 300),
    ...parseOneDrive(env),
    defaultCurrency,
    tuning: parseTuning(env),
  };
}

// Parsed once per env object: one per request, since src/settings.ts layers
// the in-app settings over the isolate's env for each request.
export function config(env: Env): AppConfig {
  let result = cache.get(env);
  if (!result) {
    result = parseConfig(env);
    cache.set(env, result);
  }
  return result;
}

export function productIds(env: Env): Product[] {
  return config(env).products.map((p) => p.id);
}
export function isProduct(env: Env, value: string): value is Product {
  return config(env).products.some((p) => p.id === value);
}
