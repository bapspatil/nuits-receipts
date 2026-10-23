export const EXPENSE_TYPES = ['infra', 'AI APIs', 'subscriptions', 'other'] as const;
export const EXPONENTS: Record<string, number> = {
  EUR: 2,
  USD: 2,
  GBP: 2,
  CHF: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  CAD: 2,
  AUD: 2,
  JPY: 0,
};
export const MONEY_TOLERANCE_MINOR = 2,
  VAT_RATE_TOLERANCE_BPS = 10;
// Review and matching thresholds. Defaults here; Worker vars or Settings >
// Setup > Advanced can change them within bounds (see src/settings.ts).
export type Tuning = {
  // A read field is trusted only at or above this confidence...
  minFieldConfidence: number;
  // ...and at or below this chance that the field is absent.
  maxFieldPNull: number;
  // Product and expense type suggestions below this are left for review.
  minCategoryProbability: number;
  // A bank payment may be booked this many days before / after the receipt.
  matchDaysBefore: number;
  matchDaysAfter: number;
  // Share of name words the receipt vendor and bank merchant must share.
  minVendorSimilarity: number;
  // Money in may arrive this many days before issue / after the due date.
  salesDaysBefore: number;
  salesDaysAfterDue: number;
  // Due date for a sales invoice that prints none.
  paymentTermsDays: number;
};
export const DEFAULT_TUNING: Readonly<Tuning> = Object.freeze({
  minFieldConfidence: 0.9,
  maxFieldPNull: 0.1,
  minCategoryProbability: 0.85,
  matchDaysBefore: 3,
  matchDaysAfter: 45,
  minVendorSimilarity: 0.6,
  salesDaysBefore: 7,
  salesDaysAfterDue: 60,
  paymentTermsDays: 30,
});
export const MAX_EMAIL_BYTES = 20 * 1024 * 1024,
  MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024,
  MAX_PDF_PAGES = 25,
  MAX_ATTACHMENTS = 10;
export const MAX_STATE_CHARS = 40_000,
  PROCESSING_LEASE_SECONDS = 120;
export const MAX_CSV_BYTES = 2 * 1024 * 1024,
  MAX_CSV_ROWS = 5_000;
// Product ids are configured per deployment (PRODUCTS_JSON, see src/config.ts).
export type Product = string & { readonly __brand: 'Product' };
export type ExpenseType = (typeof EXPENSE_TYPES)[number];
export type Facts = {
  vendor: string | null;
  invoice_number: string | null;
  issue_date: string | null;
  due_date: string | null;
  currency: string | null;
  total_minor: number | null;
  net_minor: number | null;
  vat_minor: number | null;
  vat_rate_bps: number | null;
  line_items_json: string | null;
};
export const KINDS = ['expense', 'sales'] as const;
export type Kind = (typeof KINDS)[number];
export const VAT_TREATMENTS = ['domestic', 'reverse_charge', 'export', 'exempt'] as const;
export type VatTreatment = (typeof VAT_TREATMENTS)[number];
// Sales invoice columns (kind='sales'); null on expense receipts.
export type SalesFacts = {
  client: string | null;
  client_country: string | null;
  client_vat_id: string | null;
  vat_treatment: VatTreatment | null;
  reference_number: string | null;
};
export const emptySales: SalesFacts = {
  client: null,
  client_country: null,
  client_vat_id: null,
  vat_treatment: null,
  reference_number: null,
};
export type Receipt = Facts &
  SalesFacts & {
    id: string;
    kind: Kind;
    paid_outside_on: string | null;
    paid_outside_note: string | null;
    original_key: string;
    filename: string;
    media_type: string;
    source: 'upload' | 'email';
    email_key: string | null;
    received_at: string;
    status: 'pending' | 'processing' | 'ready' | 'needs_review';
    attempt_id: string | null;
    lease_until: string | null;
    revision: number;
    product: Product;
    expense_type: ExpenseType;
    ai_json: string | null;
    classification_json: string | null;
    manual_fields_json: string;
    review_reasons_json: string;
    reviewed_at: string | null;
    fx_eur_minor: number | null;
    fx_requested_date: string | null;
    eur_override_minor: number | null;
    eur_override_reason: string | null;
    duplicate_of: string | null;
  };
export type Rule = {
  id: number;
  priority: number;
  vendor_contains: string;
  context_contains: string | null;
  bank_alias: string | null;
  product: Product;
  expense_type: ExpenseType;
};
export const emptyFacts: Facts = {
  vendor: null,
  invoice_number: null,
  issue_date: null,
  due_date: null,
  currency: null,
  total_minor: null,
  net_minor: null,
  vat_minor: null,
  vat_rate_bps: null,
  line_items_json: null,
};
export class InputError extends Error {
  constructor(
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}
export function requireInput(condition: unknown, message: string, status = 422): asserts condition {
  if (!condition) throw new InputError(message, status);
}
export function object(value: unknown): Record<string, unknown> {
  requireInput(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected object');
  return value as Record<string, unknown>;
}
export function date(value: string): string {
  requireInput(
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value,
    'Invalid ISO date',
  );
  return value;
}
export function minor(value: string | number, currency: string): number {
  const exponent = EXPONENTS[currency];
  requireInput(exponent !== undefined, 'Unsupported currency');
  const text = String(value);
  requireInput(/^[+-]?\d+(\.\d+)?$/.test(text), 'Invalid amount');
  const [whole = '', fraction = ''] = text.replace(/^[+-]/, '').split('.');
  requireInput(!/[1-9]/.test(fraction.slice(exponent)), 'Sub-minor amount');
  const result =
    Number(BigInt(whole) * 10n ** BigInt(exponent) + BigInt(fraction.slice(0, exponent).padEnd(exponent, '0') || '0')) *
    (text.startsWith('-') ? -1 : 1);
  requireInput(Number.isSafeInteger(result), 'Unsafe amount');
  return result;
}
export function money(value: number | bigint | null, currency = 'EUR'): string {
  if (value === null) return '';
  const amount = BigInt(value),
    exponent = EXPONENTS[currency] ?? 2;
  const digits = (amount < 0n ? -amount : amount).toString().padStart(exponent + 1, '0');
  return (amount < 0n ? '-' : '') + (exponent ? digits.slice(0, -exponent) + '.' + digits.slice(-exponent) : digits);
}
export function roundRatio(numerator: bigint, denominator: bigint): number {
  const sign = numerator < 0n ? -1n : 1n,
    magnitude = numerator * sign;
  const result = Number(sign * ((magnitude * 2n + denominator) / (2n * denominator)));
  requireInput(Number.isSafeInteger(result), 'Unsafe conversion');
  return result;
}
export function convertEur(amount: number, currency: string, rate: string): number {
  requireInput(/^\d+(\.\d+)?$/.test(rate) && Number(rate) > 0, 'Invalid FX rate');
  const [whole = '', fraction = ''] = rate.split('.');
  return roundRatio(
    BigInt(amount) * BigInt(whole + fraction) * 100n,
    10n ** BigInt((EXPONENTS[currency] ?? 2) + fraction.length),
  );
}
export function review(f: Facts): string[] {
  const reasons: string[] = [];
  for (const field of [
    'vendor',
    'issue_date',
    'currency',
    'total_minor',
    'net_minor',
    'vat_minor',
    'invoice_number',
  ] as const) {
    if (f[field] === null || f[field] === '') reasons.push(`missing_${field.replace('_minor', '')}`);
  }
  if (f.currency && EXPONENTS[f.currency] === undefined) reasons.push('unsupported_currency');
  if (f.total_minor !== null && f.net_minor !== null && f.vat_minor !== null) {
    const net = BigInt(f.net_minor),
      vat = BigInt(f.vat_minor),
      total = BigInt(f.total_minor);
    const abs = (value: bigint) => (value < 0n ? -value : value);
    if (abs(net + vat - total) > BigInt(MONEY_TOLERANCE_MINOR)) reasons.push('vat_mismatch');
    if ([f.total_minor, f.net_minor, f.vat_minor].some((n) => n < 0)) reasons.push('credit_or_sign');
    if (f.vat_minor !== 0 && f.vat_rate_bps === null) reasons.push('missing_vat_rate');
    if (
      f.net_minor !== 0 &&
      f.vat_rate_bps !== null &&
      abs(vat * 10000n - net * BigInt(f.vat_rate_bps)) > BigInt(MONEY_TOLERANCE_MINOR * 10000) &&
      abs(vat * 10000n - net * BigInt(f.vat_rate_bps)) > abs(net) * BigInt(VAT_RATE_TOLERANCE_BPS)
    )
      reasons.push('vat_rate_mismatch');
  }
  return reasons;
}
export function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !['oy', 'ltd', 'inc', 'llc', 'limited', 'ab'].includes(w))
    .join(' ');
}
export function similar(a: string, b: string, min = DEFAULT_TUNING.minVendorSimilarity): boolean {
  a = normalize(a);
  b = normalize(b);
  if (!a || !b) return false;
  if (['stripe', 'paypal'].includes(a) || ['stripe', 'paypal'].includes(b)) return false;
  const aa = new Set(a.split(' ')),
    bb = new Set(b.split(' '));
  return a === b || [...aa].filter((t) => bb.has(t)).length / new Set([...aa, ...bb]).size >= min;
}
export function withinWindow(issue: string, booking: string, t: Tuning = DEFAULT_TUNING): boolean {
  const days = (Date.parse(booking) - Date.parse(issue)) / 86400000;
  return days >= -t.matchDaysBefore && days <= t.matchDaysAfter;
}
export async function hash(bytes: ArrayBuffer | Uint8Array | string): Promise<string> {
  const input = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', input)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
