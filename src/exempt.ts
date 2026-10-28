// Payments that are not purchases, marked so on their own: money to yourself,
// tax, bank fees, cash, statutory pension, card top-ups and food delivery by rule, then a
// capped Clef question for the few rows a rule can't place. A rule or Clef
// only ever fills an empty exempt_by; once the owner has chosen ('owner'),
// nothing here touches the row again.
import type { Env } from './env';
import type { Transaction } from './banking';
import { normalize } from './domain';
import { live, parseChoice } from './ai';

export type ExemptRule = 'own' | 'tax' | 'fee' | 'cash' | 'pension' | 'topup' | 'delivery';
export type ExemptBy = ExemptRule | 'clef' | 'owner';
export const AUTO_EXEMPT: readonly ExemptBy[] = ['own', 'tax', 'fee', 'cash', 'pension', 'topup', 'delivery', 'clef'];
// The word shown next to "Not a purchase" for a row marked automatically.
export const EXEMPT_LABELS: Record<Exclude<ExemptBy, 'owner'>, string> = {
  own: 'Own transfer',
  tax: 'Tax',
  fee: 'Bank fee',
  cash: 'Cash',
  pension: 'Pension',
  topup: 'Top-up',
  delivery: 'Delivery',
  clef: 'Auto',
};

const TAX =
  /\b(verohallinto|skatteforvaltningen|skatteverket|skatteetaten|finanzamt|hmrc|tax administration|tax office)\b/;
const FEE =
  /\b(service|bank|account|monthly|card|transaction) fee\b|\b(palvelumaksu|pankkimaksu|kuukausimaksu|tilinhoitomaksu)\b/;
const CASH = /^atm\b|\bcash withdrawal\b|\b(kateisnosto|kateisautomaatti)\b/;
const PENSION =
  /\b(pension insurance|pension fund|elakevakuutus|tyoelakevakuutus|tyoelake|elakekassa|yel)\b|\b(ilmarinen|varma|veritas|elo)\b.*\b(pension|elake)\b/;
const TOPUP = /\btop ?up\b|\badd money\b|\blataus\b/;
// Food delivery is personal. Uber Eats only: a plain Uber ride is a business trip.
const DELIVERY = /\buber ?eats\b|\b(wolt|foodora|zomato|swiggy|deliveroo)\b/;

// SELLER_NAMES are the owner's own names (sole traders invoice under their
// own). Only the whole name counts: "Fake Studio Supplies" is somebody else.
function ownName(merchant: string, ownNames: readonly string[]): boolean {
  const m = normalize(merchant);
  return !!m && ownNames.some((name) => normalize(name) === m);
}
export function exemptionFor(t: Transaction, ownNames: readonly string[]): ExemptRule | null {
  if (t.amount_minor >= 0) return null;
  const merchant = normalize(t.merchant),
    text = normalize(`${t.merchant} ${t.reference ?? ''}`);
  if (/\bself transfer\b/.test(text) || ownName(t.merchant, ownNames)) return 'own';
  if (TAX.test(merchant)) return 'tax';
  if (FEE.test(merchant)) return 'fee';
  if (CASH.test(merchant)) return 'cash';
  if (PENSION.test(merchant)) return 'pension';
  if (TOPUP.test(merchant)) return 'topup';
  if (DELIVERY.test(merchant)) return 'delivery';
  return null;
}

// A bank transfer to a name that reads like a person, not a card payment to a
// shop: the only rows worth asking Clef about. Card merchants carry a
// processor star, digits, a legal form or capitals only.
const BUSINESS = /\b(oy|oyj|ab|ky|tmi|ry|ltd|inc|llc|gmbh|plc|bv|sa|as|aps|corp|limited|company)\b/i;
export function unclear(t: Transaction): boolean {
  if (t.amount_minor >= 0) return false;
  const name = t.merchant.trim();
  const transfer =
    /(^|\s)(RF\d{2}\w+|\d{5,})\s*\//.test(t.reference ?? '') || /\btransfer\b|tilisiirto/i.test(t.reference ?? '');
  const personLike =
    /^[\p{Lu}][\p{Ll}'-]+(\s+[\p{Lu}][\p{Ll}'-]+){1,3}$/u.test(name) && !BUSINESS.test(name) && !/[*\d]/.test(name);
  return transfer && personLike;
}

// One Clef call decides at most this many rows; an import makes at most one call.
export const CLEF_MAX_ROWS = 40;
const CHOICES = ['purchase', 'not_purchase'] as const;
const question = (t: Transaction) => ({
  type: 'choice',
  instructions: `Bank payment out: "${t.merchant}", ${(t.reference ?? '').slice(0, 120)}. Is it a purchase from a business that should have a receipt?`,
  criteria: {
    purchase: 'A purchase of goods or services from a business',
    not_purchase: 'Not a purchase: money to a private person or yourself, tax, a loan, salary or a refund',
  },
});
// The ids Clef says are not purchases, confidently. In mock mode a transfer to a
// name with no business form is one, so tests and local runs need no model.
export async function clefExemptions(env: Env, rows: readonly Transaction[], min: number): Promise<string[]> {
  const asked = rows.slice(0, CLEF_MAX_ROWS);
  if (!asked.length) return [];
  if (env.AI_MODE === 'mock') return asked.filter((t) => unclear(t)).map((t) => t.id);
  let raw: unknown;
  try {
    raw = await live(env, '@cf/cloudflare/clef', {
      model: 'clef',
      state: { task: 'Sort bank payments out of a small business account.' },
      questions: Object.fromEntries(asked.map((t, i) => [`p${i}`, question(t)])),
    });
  } catch {
    return [];
  }
  return asked.flatMap((t, i) => {
    try {
      return parseChoice(raw, `p${i}`, CHOICES, min) === 'not_purchase' ? [t.id] : [];
    } catch {
      return [];
    }
  });
}
