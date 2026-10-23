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

const CORE: readonly FlagField[] = ['vendor', 'issue_date', 'currency', 'total', 'net', 'vat'];
const seller: Flag = {
  group: 'Seller',
  title: 'Who is this from?',
  body: "We couldn't read the seller's name.",
  fields: ['vendor'],
};
const issueDate: Flag = {
  group: 'Date',
  title: 'No date on it.',
  body: 'Copy the issue date from the receipt.',
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
  title: 'Amount before VAT is missing.',
  body: "Enter it, or the total if there's no VAT.",
  fields: ['net'],
};
const vat: Flag = {
  group: 'Amounts',
  title: 'VAT amount is missing.',
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
    title: "We don't know this currency.",
    body: (r) => `${r.currency ?? 'This code'} can't be converted. Fix it, or enter the euro amount.`,
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
    title: "The numbers don't add up.",
    body: 'Before VAT plus VAT should equal the total.',
    fields: ['net', 'vat', 'total'],
  },
  vat_rate_mismatch: {
    group: 'Amounts',
    title: "VAT doesn't match the rate.",
    body: "The VAT isn't that % of the amount before VAT.",
    fields: ['vat', 'vat_rate'],
  },
  credit_or_sign: {
    group: 'Amounts',
    title: 'This looks like a refund or credit note.',
    body: "One of the amounts is negative. Approve it if that's right.",
    fields: [],
  },
  missing_invoice_number: {
    group: 'Details',
    title: 'No receipt number.',
    body: "Leave it blank if there isn't one.",
    fields: ['invoice_number'],
  },
  missing_eur: {
    group: 'Euro amount',
    title: 'No euro amount yet.',
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
    title: "We couldn't file this automatically.",
    body: 'Pick where it belongs.',
    fields: ['product', 'expense_type'],
  },
  rule_conflict: {
    group: 'Filing',
    title: 'Two of your rules disagree.',
    body: 'Several vendor rules match. Pick one here; tidy them in Settings.',
    fields: ['product', 'expense_type'],
  },
  probable_duplicate: {
    group: 'Duplicate',
    title: 'Looks like one we already have.',
    body: 'Same seller, number, date and total as another. Pick it to keep it out of the export.',
    fields: ['duplicate_of'],
  },
  sender_unverified: {
    group: 'Source',
    title: "We couldn't verify who sent this email.",
    body: 'Kept but not read. Check the email is genuine, then have it read.',
    fields: [],
    action: 'retry',
  },
  email_skipped_parts: typeIn('Some attachments were skipped.', 'Download the email to check nothing is missing.'),
  mime_failed: typeIn("We couldn't open this email.", 'Download it, then type the numbers in or upload the receipt.'),
  pdf_no_text: {
    ...typeIn('This PDF has no readable text.', 'Probably a scan. Type the numbers in, or upload a photo.'),
    action: 'upload',
  },
  pdf_too_large: typeIn('This PDF is too big to read.', 'Type the key numbers in from the original.'),
  pdf_too_many_pages: typeIn('This PDF has too many pages to read.', 'Type the key numbers in from the original.'),
  unsupported_document: {
    ...typeIn("We can't read this file type.", 'Upload a PDF or a photo instead, or type the numbers in.'),
    action: 'upload',
  },
  original_missing: {
    ...typeIn('The original file is missing.', 'Upload it again if you have it.'),
    action: 'upload',
  },
  input_truncated: {
    group: 'Source',
    title: 'This was long, so we only read the start.',
    body: 'Check the amounts against the original.',
    fields: ['total', 'net', 'vat'],
  },
  model_truncated: retry(
    'The reader stopped early.',
    'Some details may be missing. Check them, or have it read again.',
  ),
  // ---------- Sales invoices ----------
  seller_mismatch: {
    group: 'Seller',
    title: "This doesn't look like an invoice you sent.",
    body: "The seller isn't one of your business names. Fix it, or move it to receipts.",
    fields: ['vendor'],
    action: 'move',
  },
  invoice_no_attachment: {
    group: 'Source',
    title: 'The email had no invoice attached.',
    body: 'Forward it again with the PDF attached, or upload the invoice here.',
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
    title: "Reverse charge needs the client's VAT number.",
    body: 'As on the invoice, for example DE123456789.',
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
    title: "The VAT doesn't fit how it was handled.",
    body: 'Only invoices with Finnish VAT charged have VAT.',
    fields: ['vat', 'vat_treatment'],
  },
  domestic_rate_unexpected: {
    group: 'Amounts',
    title: "That isn't a Finnish VAT rate.",
    body: 'Rates are 25.5 %, 14 % and 10 % (24 % before September 2024).',
    fields: ['vat_rate', 'vat'],
  },
  invalid_model_output: retry('The reader got confused.', 'Have it read again, or type the numbers in.'),
  extraction_failed: retry('Reading failed.', 'Something went wrong. Try reading it again in a minute.'),
};

export function flagFor(code: string): Flag {
  return (
    FLAGS[code] ?? {
      group: 'Other',
      title: 'Something needs a look.',
      body: 'Check the details against the original.',
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

// Review queue filters (links on /review). 'All' is the default.
export const REVIEW_FILTERS = {
  info: { label: 'Missing info', groups: ['Seller', 'Date', 'Details', 'Filing', 'Duplicate'] },
  amount: { label: 'Check the amount', groups: ['Amounts', 'Euro amount'] },
  sender: { label: 'Email not verified', groups: [] },
} as const satisfies Record<string, { label: string; groups: readonly FlagGroup[] }>;
export type ReviewFilter = keyof typeof REVIEW_FILTERS;

export function matchesFilter(codes: readonly string[], filter: ReviewFilter): boolean {
  if (filter === 'sender') return codes.includes('sender_unverified');
  const groups: readonly FlagGroup[] = REVIEW_FILTERS[filter].groups;
  return codes.some((c) => groups.includes(flagFor(c).group));
}
