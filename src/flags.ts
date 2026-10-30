// A flag's title is a question when it asks for a fact ("What was the total?") and a short
// instruction when there is something to do ("Type the key numbers in."). Never a statement of
// what is wrong; the body says that. test/flags.test.ts holds every title to one of the two.
// Plain-language copy for every review reason code the app emits (see
// docs/APP-REDESIGN-PLAN.md §6). Codes that describe the same problem share one
// entry, so the receipt page shows one card per problem. Raw codes stay in the
// receipt page's "Technical details" fold only. test/flags.test.ts fails when
// src/ emits a code with no entry here.
import type { Receipt } from './domain';

export type FlagField =
  | 'vendor'
  | 'invoice_number'
  | 'issue_date'
  | 'currency'
  | 'net'
  | 'vat'
  | 'total'
  | 'vat_rate'
  | 'product'
  | 'expense_type'
  | 'eur_override'
  | 'duplicate_of'
  // Sales invoices only.
  | 'client'
  | 'client_vat_id'
  | 'client_country'
  | 'vat_treatment'
  | 'reference_number';
export type FlagGroup =
  | 'Seller'
  | 'Date'
  | 'Amounts'
  | 'Details'
  | 'Euro amount'
  | 'Filing'
  | 'Duplicate'
  | 'Source'
  | 'Other';
export type Flag = {
  group: FlagGroup;
  title: string;
  body: string | ((r: Receipt) => string);
  fields: readonly FlagField[];
  // A fix that is a different action from saving the form.
  action?: 'retry' | 'upload' | 'move';
};

// The facts Approve refuses without, in the order the form lists them. A flag is
// required when it asks for one of these; every other flag is optional: it never
// blocks Approve, so it is shown neutral. 'client' is for sales invoices only.
export const REQUIRED_FIELDS = [
  'vendor',
  'issue_date',
  'currency',
  'total',
  'net',
  'vat',
] as const satisfies readonly FlagField[];
export const REQUIRED_SALES_FIELDS = [...REQUIRED_FIELDS, 'client'] as const satisfies readonly FlagField[];
export function isRequired(flag: Pick<Flag, 'fields'>): boolean {
  return flag.fields.some((f) => (REQUIRED_SALES_FIELDS as readonly string[]).includes(f));
}

const CORE: readonly FlagField[] = ['vendor', 'issue_date', 'currency', 'total', 'net', 'vat'];
const seller: Flag = {
  group: 'Seller',
  title: 'Who is this from?',
  body: "We couldn't read the seller's name.",
  fields: ['vendor'],
};
const issueDate: Flag = {
  group: 'Date',
  title: 'What is the date?',
  body: 'There is no date on it. Copy the issue date from the receipt.',
  fields: ['issue_date'],
};
const currency: Flag = {
  group: 'Amounts',
  title: 'Which currency?',
  body: "We're not sure what currency this is in.",
  fields: ['currency'],
};
const total: Flag = {
  group: 'Amounts',
  title: 'What was the total?',
  body: "We couldn't read the amount you paid.",
  fields: ['total'],
};
const net: Flag = {
  group: 'Amounts',
  title: 'What was the amount before VAT?',
  body: "It's missing. Enter it, or the total if there's no VAT.",
  fields: ['net'],
};
const vat: Flag = {
  group: 'Amounts',
  title: 'What was the VAT amount?',
  body: 'Enter 0 if the receipt has no VAT.',
  fields: ['vat'],
};
const vatRate: Flag = {
  group: 'Amounts',
  title: 'What VAT % was charged?',
  body: "There's VAT but no rate. Copy it from the receipt.",
  fields: ['vat_rate'],
};
const retry = (title: string, body: string): Flag => ({
  group: 'Source',
  title,
  body,
  fields: CORE,
  action: 'retry',
});
const typeIn = (title: string, body: string): Flag => ({ group: 'Source', title, body, fields: CORE });

export const FLAGS: Readonly<Record<string, Flag>> = {
  missing_vendor: seller,
  uncertain_vendor: seller,
  missing_issue_date: issueDate,
  uncertain_issue_date: issueDate,
  missing_currency: currency,
  uncertain_currency: currency,
  unsupported_currency: {
    group: 'Amounts',
    title: 'What is this currency in euros?',
    body: (r) =>
      `We don't know ${r.currency ?? 'this currency'}, so it can't be converted. Fix it, or enter the euro amount.`,
    fields: ['currency', 'eur_override'],
  },
  missing_total: total,
  uncertain_total: total,
  missing_net: net,
  uncertain_net: net,
  missing_vat: vat,
  uncertain_vat_amount: vat,
  missing_vat_rate: vatRate,
  uncertain_vat_rate: vatRate,
  vat_mismatch: {
    group: 'Amounts',
    title: 'Do the amounts add up?',
    body: 'Before VAT plus VAT should equal the total.',
    fields: ['net', 'vat', 'total'],
  },
  vat_rate_mismatch: {
    group: 'Amounts',
    title: 'Does the VAT match the rate?',
    body: "The VAT isn't that % of the amount before VAT.",
    fields: ['vat', 'vat_rate'],
  },
  credit_or_sign: {
    group: 'Amounts',
    title: 'Is this a refund or credit note?',
    body: "One of the amounts is negative. Approve it if that's right.",
    fields: [],
  },
  missing_invoice_number: {
    group: 'Details',
    title: 'What is the receipt number?',
    body: "There isn't one on it. Leave it blank if the receipt has none.",
    fields: ['invoice_number'],
  },
  missing_eur: {
    group: 'Euro amount',
    title: 'Why is there no euro amount?',
    body: "It fills in from your bank or the ECB rate. Different on your bank? See 'Paid in another currency?'.",
    fields: [],
  },
  uncertain_product: {
    group: 'Filing',
    title: 'Which part of the business?',
    body: "We guessed, but we're not sure. Pick the right one.",
    fields: ['product'],
  },
  uncertain_expense_type: {
    group: 'Filing',
    title: 'What kind of cost is this?',
    body: "We guessed, but we're not sure. Pick the right one.",
    fields: ['expense_type'],
  },
  classification_failed: {
    group: 'Filing',
    title: 'Where does this belong?',
    body: "We couldn't file it automatically. Pick where it belongs.",
    fields: ['product', 'expense_type'],
  },
  rule_conflict: {
    group: 'Filing',
    title: 'Which rule should win?',
    body: 'Two of your rules disagree. Pick one here; tidy them in Settings.',
    fields: ['product', 'expense_type'],
  },
  probable_duplicate: {
    group: 'Duplicate',
    title: 'Is this one we already have?',
    body: 'It looks like it: same seller, number, date and total as another. Pick it to keep it out of the export.',
    fields: ['duplicate_of'],
  },
  sender_unverified: {
    group: 'Source',
    title: 'Is this email genuine?',
    body: "We couldn't verify who sent it. Kept but not read. Check it, then have it read.",
    fields: [],
    action: 'retry',
  },
  email_skipped_parts: typeIn(
    'Is anything missing from the email?',
    'Some attachments were skipped. Download the email to check.',
  ),
  mime_failed: typeIn(
    'Open the email and type the numbers in.',
    "We couldn't open it. Download it, then type the numbers in or upload the receipt.",
  ),
  pdf_no_text: {
    ...typeIn('Type the numbers in, or upload a photo.', 'This PDF has no readable text. Probably a scan.'),
    action: 'upload',
  },
  pdf_too_large: typeIn('Type the key numbers in.', 'This PDF is too big to read. Copy them from the original.'),
  pdf_too_many_pages: typeIn(
    'Type the key numbers in.',
    'This PDF has too many pages to read. Copy them from the original.',
  ),
  unsupported_document: {
    ...typeIn('Upload a PDF or a photo.', "We can't read this file type. Or type the numbers in."),
    action: 'upload',
  },
  original_missing: {
    ...typeIn('Upload the original again.', 'The original file is missing. Upload it if you still have it.'),
    action: 'upload',
  },
  input_truncated: {
    group: 'Source',
    title: 'Do the amounts match the original?',
    body: 'This was long, so we only read the start. Check the amounts against the original.',
    fields: ['total', 'net', 'vat'],
  },
  model_truncated: retry(
    'Check the details, or read it again.',
    'The reader stopped early, so some details may be missing.',
  ),
  // ---------- Sales invoices ----------
  seller_mismatch: {
    group: 'Seller',
    title: 'Did you send this invoice?',
    body: "The seller isn't one of your business names. Fix it, or move it to receipts.",
    fields: ['vendor'],
    action: 'move',
  },
  invoice_no_attachment: {
    group: 'Source',
    title: 'Where is the invoice?',
    body: 'The email had no invoice attached. Forward it again with the PDF attached, or upload the invoice here.',
    fields: [],
    action: 'upload',
  },
  missing_client: {
    group: 'Details',
    title: 'Who did you bill?',
    body: 'As written on the invoice.',
    fields: ['client'],
  },
  vat_treatment_unknown: {
    group: 'Details',
    title: 'How was VAT handled?',
    body: 'No VAT on it. Pick reverse charge, outside the EU or exempt.',
    fields: ['vat_treatment'],
  },
  reverse_charge_without_vat_id: {
    group: 'Details',
    title: "What is the client's VAT number?",
    body: 'Reverse charge needs it, as on the invoice, for example DE123456789.',
    fields: ['client_vat_id', 'client_country'],
  },
  reverse_charge_domestic_client: {
    group: 'Details',
    title: 'Reverse charge to a Finnish client?',
    body: 'Reverse charge is for clients in other EU countries.',
    fields: ['client_country', 'vat_treatment'],
  },
  vat_treatment_mismatch: {
    group: 'Amounts',
    title: 'Does the VAT fit how it was handled?',
    body: 'Only invoices with Finnish VAT charged have VAT.',
    fields: ['vat', 'vat_treatment'],
  },
  domestic_rate_unexpected: {
    group: 'Amounts',
    title: 'Which Finnish VAT rate applies?',
    body: "That isn't one of them. Rates are 25.5 %, 14 % and 10 % (24 % before September 2024).",
    fields: ['vat_rate', 'vat'],
  },
  invalid_model_output: retry('Read it again, or type the numbers in.', 'The reader got confused.'),
  extraction_failed: retry('Try reading it again.', 'Reading failed. Wait a minute, then try again.'),
};

export function flagFor(code: string): Flag {
  return (
    FLAGS[code] ?? {
      group: 'Other',
      title: 'Check the details against the original.',
      body: 'Something needs a look.',
      fields: [],
    }
  );
}

export function reasonCodes(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

// One card per distinct problem, in the order the codes were raised.
export function flagCards(codes: readonly string[]): { flag: Flag; codes: string[] }[] {
  const cards: { flag: Flag; codes: string[] }[] = [];
  for (const code of codes) {
    const flag = flagFor(code),
      found = FLAGS[code] ? cards.find((c) => c.flag === flag) : undefined;
    if (found) found.codes.push(code);
    else cards.push({ flag, codes: [code] });
  }
  return cards;
}

export function bodyOf(flag: Flag, r: Receipt): string {
  return typeof flag.body === 'string' ? flag.body : flag.body(r);
}

// Reasons that never put a receipt in To do: Approve doesn't need them, so they stay on the
// receipt as a quiet note. Every other code does, including the ones with no field to fix (a
// negative amount, a missing euro amount, an unverified sender) and a probable duplicate,
// because each would otherwise reach the export unchecked.
export const OPTIONAL_REASONS = [
  'missing_invoice_number',
  'missing_vat_rate',
  'uncertain_vat_rate',
  'uncertain_product',
  'uncertain_expense_type',
  'classification_failed',
  'rule_conflict',
] as const;
const isTodoReason = (code: string): boolean => !(OPTIONAL_REASONS as readonly string[]).includes(code);

export function hasTodoReason(codes: readonly string[]): boolean {
  return codes.some(isTodoReason);
}
export function optionalReasons(codes: readonly string[]): string[] {
  return codes.filter((code) => !isTodoReason(code));
}

type Flagged = { status: string; review_reasons_json: string };
// A flagged receipt is in To do while a required reason is open. One flagged only for optional
// reasons, from before they stopped counting, is as good as ready.
export function needsReview(r: Flagged): boolean {
  if (r.status !== 'needs_review') return false;
  const codes = reasonCodes(r.review_reasons_json);
  return !codes.length || hasTodoReason(codes);
}
export function isReady(r: Flagged): boolean {
  return r.status === 'ready' || (r.status === 'needs_review' && !needsReview(r));
}

// The same two questions for SQL, over the receipts table or an alias of it.
const OPTIONAL_LIST = OPTIONAL_REASONS.map((c) => `'${c}'`).join(',');
function todoReasonSql(p: string): string {
  return `(json_array_length(${p}review_reasons_json)=0 OR EXISTS(SELECT 1 FROM json_each(${p}review_reasons_json) WHERE value NOT IN (${OPTIONAL_LIST})))`;
}
export function needsReviewSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `(${p}status='needs_review' AND ${todoReasonSql(p)})`;
}
export function readySql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `(${p}status='ready' OR (${p}status='needs_review' AND NOT ${todoReasonSql(p)}))`;
}
