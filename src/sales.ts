// Sales invoices: invoices the owner sent to a client. The same reader and
// parser as receipts, seen from the other side: the owner is the seller, the
// buyer block is the client. VAT treatment is decided here from what the
// invoice prints, never guessed by the model.
import { normalize, type Facts, type SalesFacts, type VatTreatment } from './domain';
import { BUYER, REVERSE_CHARGE, type ParsedDocument } from './parse';

// EU member states (ISO 3166 alpha-2). Greece uses EL in VAT IDs.
const EU = new Set([
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
]);
export function inEu(country: string | null): boolean {
  return !!country && EU.has(country);
}
// VAT number shapes by prefix, after spaces, dots and dashes are removed.
const VAT_SHAPES: Record<string, RegExp> = {
  AT: /^U\d{8}$/,
  BE: /^[01]\d{9}$/,
  BG: /^\d{9,10}$/,
  HR: /^\d{11}$/,
  CY: /^\d{8}[A-Z]$/,
  CZ: /^\d{8,10}$/,
  DK: /^\d{8}$/,
  EE: /^\d{9}$/,
  FI: /^\d{8}$/,
  FR: /^[A-Z0-9]{2}\d{9}$/,
  DE: /^\d{9}$/,
  EL: /^\d{9}$/,
  HU: /^\d{8}$/,
  IE: /^\d{7}[A-Z]{1,2}$|^\d[A-Z+*]\d{5}[A-Z]$/,
  IT: /^\d{11}$/,
  LV: /^\d{11}$/,
  LT: /^\d{9}$|^\d{12}$/,
  LU: /^\d{8}$/,
  MT: /^\d{8}$/,
  NL: /^\d{9}B\d{2}$/,
  PL: /^\d{10}$/,
  PT: /^\d{9}$/,
  RO: /^\d{2,10}$/,
  SK: /^\d{10}$/,
  SI: /^\d{8}$/,
  ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/,
  SE: /^\d{12}$/,
  GB: /^\d{9}$|^\d{12}$/,
  XI: /^\d{9}$|^\d{12}$/,
  CHE: /^\d{9}$/,
};
const VAT_COUNTRY: Record<string, string> = { EL: 'GR', XI: 'GB', CHE: 'CH' };
// "VAT ID: DE 123 456 789", "ALV-numero FI12345678", "CHE-123.456.789 MWST".
export function vatIds(line: string): { id: string; country: string }[] {
  const found: { id: string; country: string }[] = [];
  for (const m of line
    .toUpperCase()
    .matchAll(/(?<![A-Z0-9])(?=(CHE|[A-Z]{2})[\s.-]?([0-9A-Z][0-9A-Z\s.+*-]{6,16}))/g)) {
    const prefix = m[1]!,
      shape = VAT_SHAPES[prefix];
    if (!shape) continue;
    // Shortest-first so a VAT ID followed by other text still matches.
    const compact = m[2]!.replace(/[\s.-]/g, '');
    for (let end = compact.length; end >= 7; end--) {
      const body = compact.slice(0, end);
      if (shape.test(body) && /\d{5}/.test(body)) {
        found.push({ id: prefix + body, country: VAT_COUNTRY[prefix] ?? prefix });
        break;
      }
    }
  }
  return found;
}
// Country names and codes as printed in addresses (English, Finnish, native).
const COUNTRIES: [RegExp, string][] = [
  [/\b(finland|suomi)\b/i, 'FI'],
  [/\b(germany|deutschland|saksa)\b/i, 'DE'],
  [/\b(sweden|sverige|ruotsi)\b/i, 'SE'],
  [/\b(estonia|eesti|viro)\b/i, 'EE'],
  [/\b(france|ranska)\b/i, 'FR'],
  [/\b(netherlands|nederland|alankomaat|holland)\b/i, 'NL'],
  [/\b(belgium|belgique|belgië|belgia)\b/i, 'BE'],
  [/\b(denmark|danmark|tanska)\b/i, 'DK'],
  [/\b(ireland|irlanti)\b/i, 'IE'],
  [/\b(italy|italia)\b/i, 'IT'],
  [/\b(spain|españa|espanja)\b/i, 'ES'],
  [/\b(portugal|portugali)\b/i, 'PT'],
  [/\b(austria|österreich|itävalta)\b/i, 'AT'],
  [/\b(poland|polska|puola)\b/i, 'PL'],
  [/\b(czech republic|czechia|tšekki)\b/i, 'CZ'],
  [/\b(latvia|latvija)\b/i, 'LV'],
  [/\b(lithuania|lietuva|liettua)\b/i, 'LT'],
  [/\b(luxembourg|luxemburg)\b/i, 'LU'],
  [/\b(greece|kreikka)\b/i, 'GR'],
  [/\b(hungary|unkari)\b/i, 'HU'],
  [/\b(romania)\b/i, 'RO'],
  [/\b(bulgaria)\b/i, 'BG'],
  [/\b(croatia|kroatia)\b/i, 'HR'],
  [/\b(slovenia)\b/i, 'SI'],
  [/\b(slovakia)\b/i, 'SK'],
  [/\b(cyprus|kypros)\b/i, 'CY'],
  [/\b(malta)\b/i, 'MT'],
  [/\b(united states|usa|u\.s\.a\.?|yhdysvallat)\b/i, 'US'],
  [/\b(united kingdom|great britain|england|scotland|wales|britannia|iso-britannia)\b/i, 'GB'],
  [/\b(norway|norge|norja)\b/i, 'NO'],
  [/\b(switzerland|schweiz|suisse|sveitsi)\b/i, 'CH'],
  [/\b(canada|kanada)\b/i, 'CA'],
  [/\b(australia)\b/i, 'AU'],
  [/\b(india|intia)\b/i, 'IN'],
  [/\b(japan|japani)\b/i, 'JP'],
  [/\b(singapore)\b/i, 'SG'],
  [/\b(united arab emirates|uae)\b/i, 'AE'],
];
export function countryIn(line: string): string | null {
  for (const [pattern, code] of COUNTRIES) if (pattern.test(line)) return code;
  return null;
}
// Finnish viitenumero ("Viite 12344", "Viitenumero RF18 1234 4") or "Reference".
export function referenceNumber(text: string): string | null {
  const found = new Set<string>();
  for (const m of text.matchAll(
    /(?:^|\n)\s*(?:viitenumero|viite|viitteenne|reference(?: number| no\.?)?|ref\.?(?: no\.?)?|payment reference|maksuviite)[\s:#.]*((?:RF\d{2}[\s]?)?\d[\d ]{1,26}\d)(?=\s*(?:\n|$))/gi,
  )) {
    const value = m[1]!.replace(/\s+/g, '');
    if (/\d{3}/.test(value) && value.length <= 25) found.add(value.toUpperCase());
  }
  return found.size === 1 ? [...found][0]! : null;
}

const EXPORT_TEXT =
  /not subject to finnish vat|not subject to vat in finland|outside the scope of (?:finnish |eu )?vat|place of supply (?:is )?outside|supply outside the eu|export of services|vienti eu:n ulkopuolelle|ei arvonlisäveroa|avl 69|alv 0 %? ?(?:vienti|export)/i;
const EXEMPT_TEXT =
  /vat exempt|exempt from vat|arvonlisäverolain? \d+(?: [a-z])? ?§|avl \d+(?: [a-z])? ?§|vähäinen toiminta|small business exemption|not vat registered|ei alv-rekisterissä|ei arvonlisäverovelvollinen/i;
// The rates a Finnish seller can charge, in basis points (24 % until Aug 2024).
export const FINNISH_RATES: readonly number[] = [2550, 2400, 1400, 1350, 1000];

export type SalesReading = SalesFacts & {
  // True when the document names one of the owner's seller names as seller.
  sellerKnown: boolean;
  // A seller name found in the buyer block: this is an expense sent to the wrong address.
  sellerIsBuyer: boolean;
};

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
function mentions(names: readonly string[], value: string): boolean {
  const v = normalize(value);
  return !!v && names.some((n) => normalize(n) && v.includes(normalize(n)));
}

// Client, VAT ID, country, reference and VAT treatment from the document, with
// the model's client name as a fallback for the buyer.
export function readSales(
  text: string,
  doc: ParsedDocument,
  facts: Pick<Facts, 'vendor' | 'vat_minor'>,
  model: { client: string | null; client_vat_id: string | null },
  sellerNames: readonly string[],
): SalesReading {
  const all = lines(text);
  const buyerAt = all.findIndex((l) => BUYER.test(l));
  const buyerBlock = buyerAt >= 0 ? all.slice(buyerAt, buyerAt + 10) : [];
  const sellerBlock = buyerAt >= 0 ? all.slice(0, buyerAt) : all.slice(0, 15);
  const own = (l: string) => mentions(sellerNames, l);
  // Client: the first buyer line that isn't one of the owner's names.
  const fromDoc = doc.buyerLines.find((l) => !own(l) && !/\d{5,}/.test(l) && l.length <= 100) ?? null;
  let client = model.client && !own(model.client) ? model.client : fromDoc;
  if (client && fromDoc && normalize(fromDoc).includes(normalize(client)) && fromDoc.length > client.length)
    client = fromDoc;
  // VAT IDs: in the buyer block first; otherwise the only one not on the seller side.
  const buyerIds = buyerBlock.flatMap(vatIds);
  const sellerIds = new Set(sellerBlock.flatMap(vatIds).map((v) => v.id));
  const elsewhere = all.flatMap(vatIds).filter((v) => !sellerIds.has(v.id));
  const modelId = model.client_vat_id ? vatIds(model.client_vat_id)[0] : undefined;
  const id =
    buyerIds.length === 1
      ? buyerIds[0]!
      : buyerIds.length === 0 && new Set(elsewhere.map((v) => v.id)).size === 1
        ? elsewhere[0]!
        : modelId && !sellerIds.has(modelId.id)
          ? modelId
          : null;
  const countries = buyerBlock.map(countryIn).filter((c): c is string => !!c);
  const country = id?.country ?? (new Set(countries).size === 1 ? countries[0]! : null);
  // Treatment from the printed wording first, the client's country second.
  let treatment: VatTreatment | null = null;
  if (facts.vat_minor !== null && facts.vat_minor > 0) treatment = 'domestic';
  else if (facts.vat_minor === 0) {
    if (REVERSE_CHARGE.test(text) || doc.reverseCharge) treatment = 'reverse_charge';
    else if (EXPORT_TEXT.test(text)) treatment = 'export';
    else if (EXEMPT_TEXT.test(text)) treatment = 'exempt';
    else if (country && !inEu(country)) treatment = 'export';
  }
  const sellerKnown =
    !sellerNames.length || (!!facts.vendor && mentions(sellerNames, facts.vendor)) || sellerBlock.some(own);
  return {
    client,
    client_country: country,
    client_vat_id: id?.id ?? null,
    vat_treatment: treatment,
    reference_number: referenceNumber(text),
    sellerKnown,
    // Only the label line and the one under it, where the buyer's name is;
    // later lines may be the seller's own footer.
    sellerIsBuyer: sellerNames.length > 0 && buyerBlock.slice(0, 2).some(own),
  };
}

// Review codes that only apply to sales invoices. Recomputed on every save.
export const SALES_DERIVED = [
  'missing_client',
  'vat_treatment_unknown',
  'reverse_charge_without_vat_id',
  'reverse_charge_domestic_client',
  'vat_treatment_mismatch',
  'domestic_rate_unexpected',
] as const;
export function salesReview(f: Pick<Facts, 'vat_minor' | 'vat_rate_bps'>, s: SalesFacts): string[] {
  const reasons: string[] = [];
  if (!s.client) reasons.push('missing_client');
  if (f.vat_minor !== null && s.vat_treatment === null) reasons.push('vat_treatment_unknown');
  if (s.vat_treatment === 'reverse_charge' && !s.client_vat_id) reasons.push('reverse_charge_without_vat_id');
  if (s.vat_treatment === 'reverse_charge' && s.client_country === 'FI') reasons.push('reverse_charge_domestic_client');
  if (s.vat_treatment && s.vat_treatment !== 'domestic' && f.vat_minor !== null && f.vat_minor !== 0)
    reasons.push('vat_treatment_mismatch');
  if (s.vat_treatment === 'domestic' && f.vat_minor === 0) reasons.push('vat_treatment_mismatch');
  if (s.vat_treatment === 'domestic' && f.vat_rate_bps !== null && !FINNISH_RATES.includes(f.vat_rate_bps))
    reasons.push('domestic_rate_unexpected');
  return reasons;
}
export const TREATMENT_LABELS: Record<VatTreatment, string> = {
  domestic: 'Finnish VAT charged',
  reverse_charge: 'EU reverse charge (0 %)',
  export: 'Outside the EU (0 %)',
  exempt: 'VAT exempt (0 %)',
};
