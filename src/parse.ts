// Deterministic reading of a receipt's text layer. Labelled lines ("Total",
// "Amount paid", "Subtotal", "VAT 25.5%", "Date paid", "Invoice number"), the
// seller block and reverse-charge notes are read with plain rules, so the code
// can cross-check the model and do the arithmetic itself. Nothing here guesses:
// a value is returned only when the document states it without contradiction.
import { date, EXPONENTS, minor, normalize } from './domain';

export type ParsedDocument = {
  // ISO code of the amounts, or null when none or conflicting markers were found.
  currency: string | null;
  // True when the only marker is a bare "$" or "kr" with no country or ISO hint.
  currencyAmbiguous: boolean;
  // The likeliest reading of an ambiguous marker ("$" -> USD), never settled.
  currencyGuess: string | null;
  total: number | null;
  subtotal: number | null;
  vat: number | null;
  vatRates: number[];
  // Per-rate VAT table rows that each add up (net + VAT = gross).
  vatBreakdown: { rate: number; net: number; vat: number; gross: number }[];
  // The document says no VAT is charged: a reverse-charge note, a 0% / 0.00 tax line.
  vatZero: boolean;
  reverseCharge: boolean;
  issueDate: string | null;
  paymentDate: string | null;
  // The only date printed anywhere, for till receipts that label none.
  soleDate: string | null;
  dueDate: string | null;
  invoiceNumber: string | null;
  receiptNumber: string | null;
  sellerCandidates: string[];
  buyerLines: string[];
  conflicts: string[];
};

const SYMBOLS: Record<string, string> = { '€': 'EUR', '£': 'GBP', US$: 'USD', C$: 'CAD', A$: 'AUD' };
const ISO = Object.keys(EXPONENTS);
const MARKER = String.raw`(US\$|C\$|A\$|€|£|\$|kr|${ISO.join('|')})`;
// An amount: optional marker, digits with optional thousands groups, a decimal
// part of exactly two digits (or a marker), optional trailing marker.
const AMOUNT = new RegExp(
  String.raw`(?<![\w.,])${MARKER}?\s?(-?\d{1,3}(?:[ \u00a0.,]\d{3})+(?:[.,]\d{2})?|-?\d+(?:[.,]\d{2})?)(?!\d)\s?${MARKER}?(?![\w])`,
  'gi',
);

export type Amount = { value: string; marker: string | null; index: number };

// "1 234,56" "1,234.56" "12.50" "12,50" -> "1234.56"; null when not money-shaped.
export function decimal(raw: string): string | null {
  const text = raw.replace(/[ \u00a0]/g, '');
  const sign = text.startsWith('-') ? '-' : '';
  const body = text.replace(/^-/, '');
  const last = Math.max(body.lastIndexOf('.'), body.lastIndexOf(','));
  if (last < 0) return sign + body;
  const fraction = body.slice(last + 1);
  if (fraction.length === 2) return sign + body.slice(0, last).replace(/[.,]/g, '') + '.' + fraction;
  if (fraction.length === 3) return sign + body.replace(/[.,]/g, '');
  return null;
}

export function amounts(line: string): Amount[] {
  const found: Amount[] = [];
  for (const match of line.matchAll(AMOUNT)) {
    const marker = match[1] ?? match[3] ?? null,
      number = match[2]!;
    const hasDecimals = /[.,]\d{2}$/.test(number);
    // Bare integers are quantities, years or phone numbers unless a currency marks them.
    if (!marker && !hasDecimals) continue;
    const value = decimal(number);
    if (value === null) continue;
    found.push({ value, marker: marker ? marker.toUpperCase() : null, index: match.index ?? 0 });
  }
  return found;
}

function markerCode(marker: string | null, usdHint: boolean): string | null | 'ambiguous' {
  if (!marker) return null;
  if (marker === '$') return usdHint ? 'USD' : 'ambiguous';
  if (marker === 'KR') return 'ambiguous';
  return SYMBOLS[marker] ?? (ISO.includes(marker) ? marker : null);
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const FI_MONTHS = [
  'tammikuu',
  'helmikuu',
  'maaliskuu',
  'huhtikuu',
  'toukokuu',
  'kesäkuu',
  'heinäkuu',
  'elokuu',
  'syyskuu',
  'lokakuu',
  'marraskuu',
  'joulukuu',
];
function month(name: string): number | null {
  const lower = name.toLowerCase().replace(/\.$/, '');
  if (lower.length < 3) return null;
  const en = MONTHS.findIndex((m) => m.startsWith(lower));
  if (en >= 0) return en + 1;
  const fi = FI_MONTHS.findIndex((m) => lower.startsWith(m));
  return fi >= 0 ? fi + 1 : null;
}
function iso(y: number, m: number, d: number): string | null {
  const value = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  try {
    return date(value);
  } catch {
    return null;
  }
}
// The first unambiguous date at the start of `text`. Slash dates count only when
// the day is above 12; dotted dates are day.month.year as printed in Europe.
export function leadingDate(text: string): string | null {
  const t = text.trim().replace(/^[:\-\u2013\s]+/, '');
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = t.match(/^([A-Za-zäö]{3,12})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})\b/);
  if (m && month(m[1]!)) return iso(+m[3]!, month(m[1]!)!, +m[2]!);
  m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\.? ([A-Za-zäö]{3,12})\.?,? (\d{4})\b/);
  if (m && month(m[2]!)) return iso(+m[3]!, month(m[2]!)!, +m[1]!);
  m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (m) return iso(+m[3]!, +m[2]!, +m[1]!);
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m && +m[1]! > 12) return iso(+m[3]!, +m[2]!, +m[1]!);
  if (m && +m[2]! > 12) return iso(+m[3]!, +m[1]!, +m[2]!);
  return null;
}

const SUFFIX =
  /\b(limited|ltd|inc|incorporated|llc|l\.l\.c|corporation|corp|company|gmbh|ag|bv|b\.v|nv|sas|sarl|s\.a|sa|s\.l|sl|srl|plc|pbc|pty|oy|oyj|ab|aps|as|asa|ky|tmi|kft|s\.r\.o|sp\. z o\.o)\.?,?$/i;
export const BUYER =
  /^(bill(?:ed)? to|invoice to|sold to|ship(?:ped)? to|customer|client|buyer|asiakas|laskutetaan|billing address)\b/i;
const SECTION_END = /^(description|item|items|qty|quantity|product|tuote|amount|summary|payment|€|\$|£)/i;
export const REVERSE_CHARGE =
  /reverse[ -]charge|article 196|art\. 196|käännetty verovelvollisuus|omvänd skattskyldighet|steuerschuldnerschaft des leistungsempfängers|autoliquidation|inversione contabile|inversión del sujeto pasivo/i;

type Label = 'total' | 'paid' | 'due' | 'subtotal' | 'tax';
function label(text: string): Label | null {
  const t = text.toLowerCase().replace(/[:*]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (
    /^(subtotal|sub-total|sub total|net|net amount|net total|total net|total excl(?:uding|\.)? ?(?:vat|tax)|total (?:before|without) (?:vat|tax)|amount excl(?:uding|\.)? ?(?:vat|tax)|veroton(?: hinta| summa| yhteensä)?|välisumma|summa ilman alv|netto)(?![\p{L}\d])/u.test(
      t,
    )
  )
    return 'subtotal';
  if (
    /^(total tax|tax total|vat total|total vat|tax|vat|alv|sales tax|gst|hst|mwst|moms|vero|arvonlisävero|iva|tva)(?![\p{L}\d])/u.test(
      t,
    )
  )
    return 'tax';
  if (/^(amount paid|total paid|paid|maksettu)(?![\p{L}\d])/u.test(t)) return 'paid';
  if (/^(amount due|total due|balance due|due|maksettava)(?![\p{L}\d])/u.test(t)) return 'due';
  if (
    /^(grand total|total|order total|invoice total|total amount|yhteensä|yhteensa|loppusumma|summa|kokonaissumma)(?![\p{L}\d])/u.test(
      t,
    )
  )
    return 'total';
  return null;
}

function single<T>(values: T[]): T | null {
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0]! : null;
}

export function parseDocument(text: string): ParsedDocument {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const result: ParsedDocument = {
    currency: null,
    currencyAmbiguous: false,
    currencyGuess: null,
    total: null,
    subtotal: null,
    vat: null,
    vatRates: [],
    vatBreakdown: [],
    vatZero: false,
    reverseCharge: REVERSE_CHARGE.test(text),
    issueDate: null,
    paymentDate: null,
    soleDate: null,
    dueDate: null,
    invoiceNumber: null,
    receiptNumber: null,
    sellerCandidates: [],
    buyerLines: [],
    conflicts: [],
  };
  // Seller and buyer blocks.
  const buyerAt = lines.findIndex((l) => BUYER.test(l));
  const sellerRegion = lines.slice(0, buyerAt >= 0 ? buyerAt : Math.min(lines.length, 15));
  if (buyerAt >= 0)
    for (const l of lines.slice(buyerAt + 1, buyerAt + 9)) {
      if (SECTION_END.test(l) || amounts(l).length) break;
      result.buyerLines.push(l);
    }
  const usdHint = /\bUSD\b|US\$|United States|\bUSA\b|U\.S\.A/i.test(sellerRegion.join('\n') + '\n' + text);
  const company = (l: string) => {
    const name = l.replace(/^(sold by|seller|from|merchant|myyjä|receipt from|invoice from)[:\s]+/i, '').trim();
    return name.length >= 3 && name.length <= 80 && SUFFIX.test(name) && !/@|https?:|\d{4,}/.test(name) && !label(name)
      ? name
      : null;
  };
  for (const l of sellerRegion) {
    const name = company(l);
    if (name) result.sellerCandidates.push(name);
  }
  // Seller printed after the buyer block (App Store receipts put it at the foot).
  if (!result.sellerCandidates.length && buyerAt >= 0)
    for (const l of lines.slice(buyerAt + 1 + result.buyerLines.length)) {
      const name = company(l);
      if (name && !result.buyerLines.includes(l)) result.sellerCandidates.push(name);
    }
  result.sellerCandidates = [...new Set(result.sellerCandidates)];

  const totals: Record<'total' | 'paid' | 'due', { value: string; code: string | null | 'ambiguous' }[]> = {
    total: [],
    paid: [],
    due: [],
  };
  const subtotals: string[] = [];
  const taxes: { value: string; rate: number | null }[] = [];
  const markers = new Set<string>();
  const issue: string[] = [],
    paid: string[] = [],
    due: string[] = [];
  const anyDates = new Set<string>();
  for (const l of lines) {
    const found = amounts(l);
    for (const a of found) {
      const code = markerCode(a.marker, usdHint);
      if (code) markers.add(code);
    }
    const head = found.length ? l.slice(0, found[0]!.index) : l;
    const kind = label(head);
    const rateMatch = head.match(/(?<![\d.,])(\d{1,2}(?:[.,]\d{1,3})?)\s?%/);
    // Basis points, rounded: 8.875% -> 888.
    const rate = rateMatch ? Math.round(Number(rateMatch[1]!.replace(',', '.')) * 100) : null;
    if (kind && found.length) {
      const last = found[found.length - 1]!;
      const code = markerCode(last.marker, usdHint);
      if (kind === 'subtotal') subtotals.push(last.value);
      else if (kind === 'tax') {
        // "VAT 25.5% 8.13 2.07 10.20" (net, VAT, gross) or "VAT 25.5% 2.07".
        if (found.length === 3 && rate !== null) {
          const [n, v, g] = found.map((a) => Number(a.value));
          if (Math.abs(n! + v! - g!) < 0.015) {
            taxes.push({ value: found[1]!.value, rate });
            continue;
          }
        }
        taxes.push({ value: last.value, rate });
      } else totals[kind].push({ value: last.value, code });
    } else if (!kind && rate !== null && found.length === 3 && head.trim().length <= 12) {
      // Finnish VAT table row: "A 25,5 % 8,13 2,07 10,20".
      const [n, v, g] = found.map((a) => a.value);
      if (Math.abs(Number(n) + Number(v) - Number(g)) < 0.015)
        result.vatBreakdown.push({ rate, net: Number(n), vat: Number(v), gross: Number(g) });
    }
    // Dates.
    const lower = l.toLowerCase();
    const dateAfter = (re: RegExp) => {
      const m = lower.match(re);
      return m ? leadingDate(l.slice((m.index ?? 0) + m[0].length)) : null;
    };
    const p = dateAfter(/^(?:date paid|paid on|payment date|date of payment|maksupäivä)(?![\p{L}\d])/u);
    if (p) paid.push(p);
    const d = dateAfter(/^(?:date due|due date|due on|due|eräpäivä)(?![\p{L}\d])/u);
    if (d) due.push(d);
    const i = dateAfter(
      /^(?:invoice date|date of issue|issue date|issued on|issued|receipt date|order date|date|dated|päiväys|päivämäärä|pvm|laskun päivämäärä|laskupäivä|datum|rechnungsdatum)(?![\p{L}\d])/u,
    );
    if (i && !/^date (?:paid|due)/.test(lower)) issue.push(i);
    for (const m of l.matchAll(
      /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4}|[A-Za-z]{3,9}\.? \d{1,2},? \d{4}|\d{1,2} [A-Za-z]{3,9}\.? \d{4})\b/g,
    )) {
      const found = leadingDate(m[1]!);
      if (found) anyDates.add(found);
    }
    // Numbers.
    const number = l.match(
      /^(invoice (?:number|no\.?|#)|invoice:|receipt (?:number|no\.?|#)|document (?:number|no\.?)|order (?:id|number|no\.?)|laskun? ?(?:numero|nro)|kuitti(?:numero| nro)?|rechnungsnummer)[\s:#]*([A-Z0-9][A-Z0-9\-\/._]{2,40})\b/i,
    );
    if (number && /\d/.test(number[2]!)) {
      if (/^(invoice|lasku|rechnung)/i.test(number[1]!)) result.invoiceNumber ??= number[2]!;
      else result.receiptNumber ??= number[2]!;
    }
  }
  // Currency: the total's own marker first, then a single marker across the document.
  const totalCodes = [...totals.total, ...totals.paid, ...totals.due].map((t) => t.code).filter(Boolean);
  const codes = [...new Set(totalCodes.length ? totalCodes : [...markers])];
  const real = codes.filter((c) => c !== 'ambiguous') as string[];
  if (real.length === 1) result.currency = real[0]!;
  else if (real.length > 1) result.conflicts.push('currency');
  else if (codes.includes('ambiguous')) {
    result.currencyAmbiguous = true;
    if (/(^|[^A-Z])\$/.test(text)) result.currencyGuess = 'USD';
  }
  const toMinor = (value: string) => {
    try {
      return minor(value, result.currency && EXPONENTS[result.currency] !== undefined ? result.currency : 'EUR');
    } catch {
      return null;
    }
  };
  // Total: "Total" first, then "Amount paid", then "Amount due". A paid
  // invoice's "Amount due 0.00" does not contradict its total.
  const pick = (list: { value: string }[]) => single(list.map((t) => t.value));
  const totalValue = pick(totals.total) ?? pick(totals.paid) ?? pick(totals.due.filter((t) => Number(t.value) !== 0));
  if (totals.total.length && pick(totals.total) === null) result.conflicts.push('total');
  if (totalValue !== null) {
    result.total = toMinor(totalValue);
    const paidValue = pick(totals.paid);
    if (paidValue !== null && Number(paidValue) !== Number(totalValue) && Number(paidValue) !== 0)
      result.conflicts.push('total');
  }
  const subtotalValue = single(subtotals);
  if (subtotalValue !== null) result.subtotal = toMinor(subtotalValue);
  else if (subtotals.length) result.conflicts.push('net');
  // VAT: a breakdown table, else the sum of tax lines.
  if (result.vatBreakdown.length) {
    const vatSum = result.vatBreakdown.reduce((s, r) => s + Math.round(r.vat * 100), 0);
    result.vat = vatSum;
    result.vatRates = [...new Set(result.vatBreakdown.map((r) => r.rate))];
    if (result.subtotal === null)
      result.subtotal = result.vatBreakdown.reduce((s, r) => s + Math.round(r.net * 100), 0);
  } else if (taxes.length) {
    // "Total tax" repeats the per-rate lines; use it alone when the lines add up to it.
    const lines = taxes
      .map((t) => ({ rate: t.rate, value: toMinor(t.value) }))
      .filter((t): t is { rate: number | null; value: number } => t.value !== null);
    // The same rate and amount printed twice is one tax line.
    const distinct = [...new Map(lines.map((t) => [`${t.rate}:${t.value}`, t])).values()];
    const values = distinct.map((t) => t.value);
    const sum = values.reduce((s, v) => s + v, 0);
    const max = Math.max(...values);
    result.vat = values.length === 1 ? values[0]! : sum - max === max ? max : sum;
    result.vatRates = [...new Set(taxes.map((t) => t.rate).filter((r): r is number => r !== null))];
  }
  if (result.reverseCharge && (result.vat === null || result.vat === 0)) result.vatZero = true;
  if (result.vat === 0) result.vatZero = true;
  // No tax line and a subtotal equal to the total: no VAT was charged.
  if (result.vat === null && !taxes.length && result.subtotal !== null && result.subtotal === result.total)
    result.vatZero = true;
  if (result.vatZero && result.vat === null) result.vat = 0;
  result.issueDate = single(issue);
  if (issue.length && result.issueDate === null) result.conflicts.push('issue_date');
  result.paymentDate = single(paid);
  if (paid.length && result.paymentDate === null) result.conflicts.push('issue_date');
  result.dueDate = single(due);
  result.soleDate = anyDates.size === 1 ? [...anyDates][0]! : null;
  return result;
}

// True when `vendor` is the seller named in the document's seller block.
export function sellerMatches(parsed: ParsedDocument, vendor: string): boolean {
  const v = normalize(vendor);
  return !!v && parsed.sellerCandidates.some((c) => normalize(c) === v);
}
export function isBuyer(parsed: ParsedDocument, vendor: string): boolean {
  const v = normalize(vendor);
  return !!v && parsed.buyerLines.some((l) => normalize(l) === v);
}
