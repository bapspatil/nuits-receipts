import type { Env } from './env';
import { config } from './config';
import {
  date,
  EXPONENTS,
  EXPENSE_TYPES,
  DEFAULT_TUNING,
  type Tuning,
  MONEY_TOLERANCE_MINOR,
  minor,
  normalize,
  object,
  requireInput,
  type Facts,
  type Product,
  type ExpenseType,
  type Rule,
} from './domain';
import { isBuyer, parseDocument, sellerMatches } from './parse';
import { readSales } from './sales';
import { cleanVendor, isOwnName } from './vendor';
import { emptySales, type Kind, type SalesFacts } from './domain';
import { DATE_FORMATS, dateFormatFor, numberFormatFor, type CsvMapping, type DateFormat } from './csv';

type FieldSpec = {
  type: 'text' | 'date' | 'number' | 'list';
  instructions: string;
  decimals?: number;
  unit?: string;
  items?: 'text';
};
export const CLAIRIC_FIELDS: Record<string, FieldSpec> = {
  vendor: {
    type: 'text',
    instructions: 'Printed invoice issuer, not the forwarding sender.',
  },
  invoice_number: {
    type: 'text',
    instructions: 'Printed invoice or receipt number only.',
  },
  currency: {
    type: 'text',
    instructions: 'Currency code or symbol printed with the amounts, e.g. EUR, €, USD or $.',
  },
  issue_date: {
    type: 'date',
    instructions:
      'Printed unambiguous invoice or receipt date (Invoice date, Date of issue). On a receipt with no other date, the Date paid.',
  },
  due_date: { type: 'date', instructions: 'Printed due date, null if absent.' },
  total: {
    type: 'number',
    decimals: 2,
    instructions:
      'Final amount due or paid including VAT (Total, Total due, Amount paid), not the subtotal. Never calculate.',
  },
  net: {
    type: 'number',
    decimals: 2,
    instructions: 'Printed net amount. Never calculate.',
  },
  vat_amount: {
    type: 'number',
    decimals: 2,
    instructions: 'Printed VAT amount. Never calculate or assume zero.',
  },
  vat_rate: {
    type: 'number',
    decimals: 2,
    unit: 'percent',
    instructions: 'Printed single VAT rate, 25.5 means 25.5%. Null for mixed rates.',
  },
  line_items: {
    type: 'list',
    items: 'text',
    instructions: 'Up to 20 short printed descriptions.',
  },
};
// Sales invoices: the same fields seen from the seller's side, plus the client.
export const SALES_FIELDS: Record<string, FieldSpec> = {
  ...CLAIRIC_FIELDS,
  vendor: {
    type: 'text',
    instructions: 'Printed seller who issued this invoice (the business sending it), not the customer.',
  },
  client: {
    type: 'text',
    instructions:
      'Printed customer the invoice is billed to (Bill to, Invoice to, Customer, Laskutetaan). Company or person name only.',
  },
  client_vat_id: {
    type: 'text',
    instructions: "Printed VAT number of the customer, null if absent. Never the seller's own VAT number.",
  },
};
function mock(state: string, specs: Record<string, FieldSpec> = CLAIRIC_FIELDS): unknown {
  const answers: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(specs)) {
    const labels = Object.keys(specs).join('|');
    const printed =
      state.match(new RegExp(`(?:^|\\s)${key}:\\s*(.*?)(?=\\s(?:${labels}):|$)`, 'is'))?.[1]?.trim() ?? null;
    const value =
      printed === null ? null : spec.type === 'number' ? Number(printed) : spec.type === 'list' ? [printed] : printed;
    answers[key] = {
      type: spec.type,
      value,
      confidence: 1,
      p_null: value === null ? 1 : 0,
    };
  }
  return {
    model: 'deterministic-local-mock-v1',
    answers,
    truncated: false,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}
// The single labelled payment date ("Date paid October 22, 2026") in a document.
export function paymentDate(document: string): string | null {
  return parseDocument(document).paymentDate;
}
const UNAMBIGUOUS_SYMBOLS: Record<string, string> = { '€': 'EUR', '£': 'GBP' };
const KEY_FIELDS = ['vendor', 'issue_date', 'currency', 'total', 'net', 'vat_amount', 'vat_rate'] as const;
type KeyField = (typeof KEY_FIELDS)[number];
export type Extraction = {
  facts: Facts;
  reasons: string[];
  // Derived review codes that the document itself settles (a mixed-rate VAT table).
  suppress: string[];
  // Where each key value came from: 'document', 'model', 'both', 'derived' or 'none'.
  evidence: Partial<Record<KeyField | 'invoice_number', string>>;
};
// Clairic's answers are cross-checked against the document's own labelled lines
// (src/parse.ts) and the arithmetic. A value is settled when the document states
// it, when the model and the document agree, when the model is confident and the
// document does not contradict it, or when net + VAT = total ties it to settled
// values. Only unsettled or contradicted values are flagged for review.
export function parseExtraction(
  raw: unknown,
  document = '',
  rules: readonly Pick<Rule, 'vendor_contains'>[] = [],
  tuning: Pick<Tuning, 'minFieldConfidence' | 'maxFieldPNull'> = DEFAULT_TUNING,
  // ownNames: the user's business names, never the vendor of an expense.
  // senderName: who sent the email, a last resort when nothing names the seller.
  hints: { ownNames?: readonly string[]; senderName?: string | null } = {},
): Extraction {
  const response = object(raw),
    answers = object(response.answers),
    usage = object(response.usage);
  requireInput(
    typeof response.model === 'string' && typeof response.truncated === 'boolean',
    'Invalid extraction envelope',
  );
  requireInput(
    Number.isSafeInteger(usage.input_tokens) &&
      Number.isSafeInteger(usage.output_tokens) &&
      Number(usage.input_tokens) >= 0 &&
      Number(usage.output_tokens) >= 0,
    'Invalid usage',
  );
  const reasons: string[] = response.truncated ? ['model_truncated'] : [];
  const values: Record<string, unknown> = {};
  const confident: Partial<Record<KeyField, boolean>> = {};
  for (const [key, spec] of Object.entries(CLAIRIC_FIELDS)) {
    const answer = object(answers[key]);
    requireInput(answer.type === spec.type && 'value' in answer, `Invalid answer ${key}`);
    const value = answer.value;
    if (value !== null) {
      if (spec.type === 'number')
        requireInput(typeof value === 'number' && Number.isFinite(value), `Invalid number ${key}`);
      else if (spec.type === 'list')
        requireInput(
          Array.isArray(value) && value.every((v) => typeof v === 'string') && value.length <= 20,
          'Invalid descriptions',
        );
      else {
        requireInput(typeof value === 'string' && value.length <= 1000, `Invalid text ${key}`);
        if (spec.type === 'date') date(value);
      }
    }
    values[key] = value;
    if ((KEY_FIELDS as readonly string[]).includes(key))
      confident[key as KeyField] =
        value !== null &&
        typeof answer.confidence === 'number' &&
        Number.isFinite(answer.confidence) &&
        answer.confidence >= tuning.minFieldConfidence &&
        answer.confidence <= 1 &&
        typeof answer.p_null === 'number' &&
        Number.isFinite(answer.p_null) &&
        answer.p_null <= tuning.maxFieldPNull &&
        answer.p_null >= 0;
  }
  const doc = parseDocument(document);
  const settled: Partial<Record<KeyField, boolean>> = {};
  const evidence: Extraction['evidence'] = {};
  const text = (key: string) => (typeof values[key] === 'string' ? (values[key] as string) : null);

  // Currency.
  const printed = (text('currency') ?? '').trim();
  const modelCurrency = currencyCode(text('currency'));
  const bareSymbol = /^(\$|kr)$/i.test(printed);
  let currency = modelCurrency;
  if (doc.currency) {
    currency = doc.currency;
    settled.currency = !modelCurrency || modelCurrency === doc.currency || !confident.currency;
    evidence.currency = modelCurrency === doc.currency ? 'both' : 'document';
  } else if (doc.conflicts.includes('currency') || doc.currencyAmbiguous) {
    currency = modelCurrency ?? doc.currencyGuess;
    settled.currency = false;
    evidence.currency = 'model';
  } else {
    settled.currency = !!confident.currency && !bareSymbol;
    evidence.currency = modelCurrency ? 'model' : 'none';
  }
  const unit = currency && EXPONENTS[currency] !== undefined ? currency : null;
  const amount = (key: string) => (values[key] === null || !unit ? null : minor(String(values[key]), unit));
  // Document amounts are read at two decimals unless the document named the currency.
  const docUsable = !!unit && (doc.currency === unit || (!doc.currency && EXPONENTS[unit] === 2));

  // Total.
  const modelTotal = amount('total');
  let total = modelTotal;
  if (doc.total !== null && docUsable && confident.total && modelTotal !== doc.total) {
    // A confident model answer that contradicts the labelled total: keep it, flag it.
    settled.total = false;
    evidence.total = 'conflict';
  } else if (doc.total !== null && docUsable) {
    total = doc.total;
    settled.total = !doc.conflicts.includes('total');
    evidence.total = modelTotal === total ? 'both' : 'document';
  } else {
    settled.total = !!confident.total;
    evidence.total = modelTotal === null ? 'none' : 'model';
  }
  // VAT amount: the document's tax lines, or a reverse-charge / zero-tax statement.
  const modelVat = amount('vat_amount');
  let vat = modelVat;
  if (doc.vat !== null && docUsable && confident.vat_amount && modelVat !== doc.vat) {
    settled.vat_amount = false;
    evidence.vat_amount = 'conflict';
  } else if (doc.vat !== null && docUsable) {
    vat = doc.vat;
    settled.vat_amount = true;
    evidence.vat_amount = modelVat === vat ? 'both' : 'document';
  } else {
    settled.vat_amount = !!confident.vat_amount;
    evidence.vat_amount = modelVat === null ? 'none' : 'model';
  }
  // Net: the document's subtotal, else total minus a settled VAT.
  const modelNet = amount('net');
  let net = modelNet;
  if (doc.subtotal !== null && docUsable && confident.net && modelNet !== doc.subtotal) {
    settled.net = false;
    evidence.net = 'conflict';
  } else if (doc.subtotal !== null && docUsable && !doc.conflicts.includes('net')) {
    net = doc.subtotal;
    settled.net = true;
    evidence.net = modelNet === net ? 'both' : 'document';
  } else if (
    total !== null &&
    vat !== null &&
    settled.total &&
    settled.vat_amount &&
    (modelNet === null || modelNet === total - vat)
  ) {
    net = total - vat;
    settled.net = true;
    evidence.net = 'derived';
  } else {
    settled.net = !!confident.net;
    evidence.net = modelNet === null ? 'none' : 'model';
  }
  // Arithmetic: when two of net, VAT and total are settled and net + VAT = total,
  // the third is settled too.
  const adds = total !== null && net !== null && vat !== null && Math.abs(net + vat - total) <= MONEY_TOLERANCE_MINOR;
  const settledCount = [settled.total, settled.net, settled.vat_amount].filter(Boolean).length;
  // The document disagreeing with itself (Total €50, Amount paid €45) is a
  // question for a person, however neatly the other lines add up.
  const conflicted =
    [evidence.total, evidence.net, evidence.vat_amount].includes('conflict') ||
    doc.conflicts.some((c) => ['total', 'net', 'vat_amount'].includes(c));
  if (adds && settledCount >= 2 && !conflicted) settled.total = settled.net = settled.vat_amount = true;
  // A bare € or £ names one currency; with amounts that add up it is settled.
  if (!settled.currency && UNAMBIGUOUS_SYMBOLS[printed] === currency && adds && settled.total) {
    const answer = object(answers.currency);
    if (typeof answer.p_null === 'number' && answer.p_null <= tuning.maxFieldPNull) settled.currency = true;
  }

  // VAT rate.
  const modelRate = values.vat_rate === null ? null : minor(String(values.vat_rate), 'EUR');
  requireInput(modelRate === null || (modelRate >= 0 && modelRate <= 10000), 'Invalid VAT rate');
  let rate = modelRate;
  const suppress: string[] = [];
  if (vat === 0 && (doc.vatZero || settled.vat_amount)) {
    rate = 0;
    settled.vat_rate = true;
    evidence.vat_rate = doc.vatZero ? 'document' : 'derived';
  } else if (doc.vatRates.length === 1) {
    rate = doc.vatRates[0]!;
    settled.vat_rate = true;
    evidence.vat_rate = modelRate === rate ? 'both' : 'document';
  } else if (doc.vatRates.length > 1) {
    rate = null;
    settled.vat_rate = true;
    evidence.vat_rate = 'document';
    const breakdownVat = doc.vatBreakdown.reduce((s, r) => s + Math.round(r.vat * 100), 0);
    if (vat !== null && (doc.vatBreakdown.length ? breakdownVat === vat : true)) suppress.push('missing_vat_rate');
  } else if (modelRate !== null) {
    const matches =
      net !== null &&
      vat !== null &&
      Math.abs(vat * 10000 - net * modelRate) <= Math.max(MONEY_TOLERANCE_MINOR * 10000, Math.abs(net) * 10);
    settled.vat_rate = !!confident.vat_rate || matches;
    evidence.vat_rate = 'model';
  } else {
    settled.vat_rate = true;
    evidence.vat_rate = 'none';
  }

  // Issue date: a labelled issue date, a confident model date, then the labelled
  // payment date of a receipt that prints no other.
  const modelIssue = text('issue_date');
  let issueDate: string | null;
  if (doc.issueDate && confident.issue_date && modelIssue !== doc.issueDate && modelIssue !== doc.paymentDate) {
    issueDate = modelIssue;
    settled.issue_date = false;
    evidence.issue_date = 'conflict';
  } else if (doc.issueDate) {
    issueDate = doc.issueDate;
    settled.issue_date = true;
    evidence.issue_date = modelIssue === issueDate ? 'both' : 'document';
  } else if (modelIssue && confident.issue_date) {
    issueDate = modelIssue;
    settled.issue_date = true;
    evidence.issue_date = modelIssue === doc.paymentDate ? 'both' : 'model';
  } else if (doc.paymentDate) {
    issueDate = doc.paymentDate;
    settled.issue_date = !modelIssue || modelIssue === doc.paymentDate;
    evidence.issue_date = 'document';
  } else if (doc.soleDate && (!modelIssue || modelIssue === doc.soleDate)) {
    issueDate = doc.soleDate;
    settled.issue_date = true;
    evidence.issue_date = modelIssue ? 'both' : 'document';
  } else {
    issueDate = modelIssue;
    settled.issue_date = false;
    evidence.issue_date = modelIssue ? 'model' : 'none';
  }
  if (doc.conflicts.includes('issue_date') && !(doc.issueDate && settled.issue_date)) settled.issue_date = false;

  // Vendor: the seller block or a vendor rule confirms the model; the buyer never counts.
  const own = hints.ownNames ?? [];
  const candidates = doc.sellerCandidates.filter((c) => !isOwnName(c, own));
  let vendor = cleanVendor(text('vendor'));
  const ruled = (name: string) => {
    const n = normalize(name);
    return rules.some((r) => normalize(r.vendor_contains) && n.includes(normalize(r.vendor_contains)));
  };
  if (vendor && isOwnName(vendor, own)) {
    vendor = candidates.length === 1 ? candidates[0]! : null;
    settled.vendor = candidates.length === 1;
    evidence.vendor = vendor ? 'document' : 'none';
  } else if (vendor && isBuyer(doc, vendor)) {
    vendor = candidates.length === 1 ? candidates[0]! : vendor;
    settled.vendor = candidates.length === 1;
    evidence.vendor = 'document';
  } else if (vendor && sellerMatches(doc, vendor)) {
    settled.vendor = true;
    evidence.vendor = 'both';
  } else if (vendor && (confident.vendor || ruled(vendor))) {
    settled.vendor = true;
    evidence.vendor = 'model';
  } else if (candidates.length === 1) {
    vendor = candidates[0]!;
    settled.vendor = true;
    evidence.vendor = 'document';
  } else {
    settled.vendor = false;
    evidence.vendor = vendor ? 'model' : 'none';
  }
  // Nothing named the seller: show the sender's name, still flagged for a look.
  const sender = cleanVendor(hints.senderName);
  if (!vendor && sender && !isOwnName(sender, own)) {
    vendor = sender;
    settled.vendor = false;
    evidence.vendor = 'sender';
  }

  const invoiceNumber = doc.invoiceNumber ?? doc.receiptNumber ?? text('invoice_number');
  evidence.invoice_number = doc.invoiceNumber || doc.receiptNumber ? 'document' : invoiceNumber ? 'model' : 'none';

  // Flags: required fields unsettled (or absent), optional ones only when read but unsettled.
  const present: Record<KeyField, unknown> = {
    vendor,
    issue_date: issueDate,
    currency,
    total,
    net,
    vat_amount: vat,
    vat_rate: rate,
  };
  const required: readonly string[] = ['vendor', 'issue_date', 'currency', 'total'];
  for (const key of KEY_FIELDS)
    if (
      ['vendor', 'issue_date', 'currency', 'total', 'net', 'vat_amount', 'vat_rate'].includes(key) &&
      (present[key] === null ? required.includes(key) : !settled[key])
    )
      reasons.push(`uncertain_${key}`);
  return {
    facts: {
      vendor,
      invoice_number: invoiceNumber,
      issue_date: issueDate,
      due_date: doc.dueDate ?? text('due_date'),
      currency,
      total_minor: total,
      net_minor: net,
      vat_minor: vat,
      vat_rate_bps: rate,
      line_items_json: values.line_items === null ? null : JSON.stringify(values.line_items),
    },
    reasons,
    suppress,
    evidence,
  };
}
const CURRENCY_SYMBOLS: Record<string, string> = { '€': 'EUR', '£': 'GBP', $: 'USD' };
// Clairic text answers are spans of the input, so a bare symbol is mapped here in code.
export function currencyCode(printed: string | null): string | null {
  if (printed === null) return null;
  const iso = printed.toUpperCase().match(/\b[A-Z]{3}\b/)?.[0];
  if (iso) return iso;
  const symbol = Object.keys(CURRENCY_SYMBOLS).find((s) => printed.includes(s));
  return symbol ? (CURRENCY_SYMBOLS[symbol] ?? null) : null;
}
export function parseChoice(
  raw: unknown,
  key: string,
  options: readonly string[],
  min = DEFAULT_TUNING.minCategoryProbability,
): string {
  const answer = object(object(object(raw).answers)[key]),
    probabilities = object(answer.probabilities);
  requireInput(
    answer.type === 'choice' && typeof answer.choice === 'string' && options.includes(answer.choice),
    'Invalid category',
  );
  const all = Object.values(probabilities);
  requireInput(
    all.length > 0 && all.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1),
    'Invalid probabilities',
  );
  const probability = probabilities[answer.choice];
  requireInput(
    all.every((v) => typeof v === 'number' && typeof probability === 'number' && v <= probability),
    'Choice is not highest probability',
  );
  requireInput(
    typeof answer.confidence === 'number' &&
      Number.isFinite(answer.confidence) &&
      answer.confidence >= 0 &&
      answer.confidence <= 1 &&
      typeof probability === 'number' &&
      Number.isFinite(probability) &&
      probability >= min &&
      probability <= 1,
    'Uncertain category',
  );
  return answer.choice;
}
export const FORWARDED_CONTEXT = '\nForwarded email context:\n';
// A confident choice is used. A weak one falls back, and is flagged only when the
// model leaned towards something other than the fallback. Malformed output fails.
export function settleChoice(
  raw: unknown,
  key: string,
  options: readonly string[],
  fallback: string,
  min = DEFAULT_TUNING.minCategoryProbability,
): { value: string; reason: string | null } {
  try {
    return { value: parseChoice(raw, key, options, min), reason: null };
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'Uncertain category')
      return { value: fallback, reason: 'classification_failed' };
    const choice = object(object(object(raw).answers)[key]).choice;
    return { value: fallback, reason: choice === fallback ? null : `uncertain_${key}` };
  }
}
export class ExtractionFailure extends Error {
  constructor(readonly raw: unknown) {
    super('invalid_model_output');
  }
}
export async function extract(
  env: Env,
  input: {
    state: string;
    receivedAt: string;
    images?: { content_type: string; base64: string }[];
    kind?: Kind;
    senderName?: string | null;
  },
): Promise<{
  facts: Facts;
  reasons: string[];
  suppress: string[];
  product: Product;
  expense_type: ExpenseType;
  raw: unknown;
  classification: unknown;
  sales: SalesFacts;
}> {
  const sales = input.kind === 'sales';
  const specs = sales ? SALES_FIELDS : CLAIRIC_FIELDS;
  const raw =
    env.AI_MODE === 'mock'
      ? mock(input.state, specs)
      : await live(env, '@cf/cloudflare/clairic', {
          model: 'clairic',
          state: input.state,
          fields: specs,
          images: input.images,
          reference_date: new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Helsinki',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(input.receivedAt)),
        });
  if (sales) return salesExtraction(env, raw, input.state.split(FORWARDED_CONTEXT)[0] ?? '');
  const rules = (await env.DB.prepare('SELECT * FROM vendor_rules ORDER BY priority DESC, id').all<Rule>()).results;
  let parsed: Extraction;
  try {
    parsed = parseExtraction(raw, input.state.split(FORWARDED_CONTEXT)[0], rules, config(env).tuning, {
      ownNames: config(env).sellerNames,
      senderName: input.senderName,
    });
  } catch {
    throw new ExtractionFailure(raw);
  }
  const { facts, reasons, suppress } = parsed;
  const context = normalize(input.state),
    vendor = normalize(facts.vendor ?? '');
  const matches = rules.filter(
    (r) =>
      vendor.includes(normalize(r.vendor_contains)) &&
      (!r.context_contains || context.includes(normalize(r.context_contains))),
  );
  const top = matches[0];
  const settings = config(env),
    options = settings.products.map((p) => p.id);
  let product: Product = settings.defaultProduct,
    expense_type: ExpenseType = 'other',
    classification: unknown = null;
  if (
    top &&
    !matches.some(
      (r) => r.priority === top.priority && (r.product !== top.product || r.expense_type !== top.expense_type),
    )
  ) {
    product = top.product;
    expense_type = top.expense_type;
    classification = { rule_id: top.id };
  } else if (top) reasons.push('rule_conflict');
  else if (env.AI_MODE === 'mock') classification = { mock: true };
  else {
    try {
      classification = await live(env, '@cf/cloudflare/clef', {
        model: 'clef',
        state: {
          vendor: facts.vendor,
          descriptions: facts.line_items_json,
          context: input.state,
        },
        questions: {
          product: {
            type: 'choice',
            instructions: `Choose explicit project ownership. Shared or unknown costs belong to ${settings.defaultProduct}.`,
            criteria: Object.fromEntries(settings.products.map((p) => [p.id, p.label])),
          },
          expense_type: {
            type: 'choice',
            instructions: 'Choose expense category.',
            criteria: Object.fromEntries(EXPENSE_TYPES.map((t) => [t, t])),
          },
        },
      });
    } catch {
      classification = null;
      reasons.push('classification_failed');
    }
    if (classification !== null) {
      // Product and expense type stand on their own: one weak answer keeps its
      // own fallback without discarding the other.
      const min = settings.tuning.minCategoryProbability,
        p = settleChoice(classification, 'product', options, product, min),
        t = settleChoice(classification, 'expense_type', EXPENSE_TYPES, expense_type, min);
      product = options.find((option) => option === p.value) ?? product;
      expense_type = EXPENSE_TYPES.find((option) => option === t.value) ?? expense_type;
      for (const reason of [p.reason, t.reason]) if (reason) reasons.push(reason);
    }
  }
  return {
    facts,
    reasons,
    suppress,
    product,
    expense_type,
    raw: { schema_version: 2, extraction: raw, evidence: parsed.evidence, classification },
    classification,
    sales: { ...emptySales },
  };
}
// A sales invoice: the owner is the seller (SELLER_NAMES stand in for vendor
// rules), the buyer block is the client, and there is nothing to classify.
function salesExtraction(env: Env, raw: unknown, document: string) {
  const settings = config(env);
  let parsed: Extraction;
  try {
    parsed = parseExtraction(
      raw,
      document,
      settings.sellerNames.map((name) => ({ vendor_contains: name })),
      settings.tuning,
    );
  } catch {
    throw new ExtractionFailure(raw);
  }
  const answers = object(object(raw).answers);
  const answer = (key: string) => {
    const value = answers[key] && typeof answers[key] === 'object' ? (answers[key] as { value?: unknown }).value : null;
    return typeof value === 'string' && value.length <= 1000 ? value : null;
  };
  const doc = parseDocument(document);
  const facts = { ...parsed.facts };
  let reasons = [...parsed.reasons];
  const reading = readSales(
    document,
    doc,
    facts,
    { client: answer('client'), client_vat_id: answer('client_vat_id') },
    settings.sellerNames,
  );
  // The owner's own name printed in the seller block settles the seller.
  if (settings.sellerNames.length && reading.sellerKnown && !reading.sellerIsBuyer) {
    const own = settings.sellerNames.find((n) => normalize(facts.vendor ?? '').includes(normalize(n)));
    if (!own)
      facts.vendor =
        settings.sellerNames.find((n) => normalize(document).includes(normalize(n))) ?? settings.sellerNames[0]!;
    reasons = reasons.filter((r) => r !== 'uncertain_vendor');
  }
  if (settings.sellerNames.length && (!reading.sellerKnown || reading.sellerIsBuyer)) reasons.push('seller_mismatch');
  const { sellerKnown: _known, sellerIsBuyer: _buyer, ...salesFacts } = reading;
  return {
    facts,
    reasons,
    suppress: parsed.suppress,
    product: settings.defaultProduct,
    expense_type: 'other' as ExpenseType,
    raw: { schema_version: 2, kind: 'sales', extraction: raw, evidence: parsed.evidence, sales: reading },
    classification: null,
    sales: salesFacts,
  };
}
// Bank files no preset knows: one small Clef call picks each column's role from
// the file's own column names, shown with a few truncated sample rows. Nothing
// else from the file is sent. The answer is only a proposal; the caller parses
// the whole file with it and falls back to manual mapping if anything fails.
export const COLUMN_ROLES = {
  date: 'The date each payment was booked.',
  amount: 'One column holding every amount, money in and money out.',
  debit: 'Only money out, when amounts are split over two columns.',
  credit: 'Only money in, when amounts are split over two columns.',
  currency: 'The currency code of each row.',
  merchant: 'The other party: payee, payer or counterparty.',
  description: 'A free-text description or message.',
  reference: 'A payment reference number.',
  external_id: 'A unique transaction ID from the bank.',
} as const;
type Role = keyof typeof COLUMN_ROLES;
const SAMPLE_ROWS = 5,
  SAMPLE_CELL = 40;
export type ColumnSample = { headers: string[]; rows: string[][] };
export function columnSample(headers: string[], rows: string[][]): ColumnSample {
  const cut = (cell: string) => cell.trim().slice(0, SAMPLE_CELL);
  return {
    headers: headers.map(cut),
    rows: rows
      .filter((row) => row.some((cell) => cell.trim()))
      .slice(0, SAMPLE_ROWS)
      .map((row) => headers.map((_, i) => cut(row[i] ?? ''))),
  };
}
const DATE_EXAMPLES: Record<DateFormat, string> = {
  ISO: '2026-05-31',
  'DD.MM.YYYY': '31.05.2026',
  'DD/MM/YYYY': '31/05/2026',
  'MM/DD/YYYY': '05/31/2026',
  ISO_OR_DOTTED: '2026-05-31 or 31.05.2026',
  'D MMM YYYY': '31 May 2026',
};
function columnQuestions(sample: ColumnSample) {
  const columns = {
    none: 'No such column',
    ...Object.fromEntries(
      sample.headers.map((h, i) => [`c${i}`, `${h || `Column ${i + 1}`}: ${sample.rows[0]?.[i] ?? ''}`]),
    ),
  };
  return {
    ...Object.fromEntries(
      Object.entries(COLUMN_ROLES).map(([role, instructions]) => [
        role,
        { type: 'choice', instructions, criteria: columns },
      ]),
    ),
    date_format: { type: 'choice', instructions: 'How the dates are written.', criteria: DATE_EXAMPLES },
    sign: {
      type: 'choice',
      instructions: 'How the single amount column shows money out.',
      criteria: { negative: 'Money out is negative', positive: 'Money out is positive' },
    },
  };
}
// Picks columns by their names alone, for local use and tests.
function mockColumns(sample: ColumnSample): unknown {
  const names = sample.headers.map(normalize),
    used = new Set<number>();
  const pick = (...patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const found = names.findIndex((name, i) => !used.has(i) && pattern.test(name));
      if (found >= 0) {
        used.add(found);
        return `c${found}`;
      }
    }
    return 'none';
  };
  const choices: Record<string, string> = {
    external_id: pick(/\b(transaction|filing|archive) id\b/, /^id$/),
    date: pick(/\bbooking date\b/, /\bdate\b/, /\b(kirjauspaiva|paivamaara|datum)\b/),
    amount: pick(/^amount\b/, /\b(amount|summa|maara|betrag)\b/),
    currency: pick(/\b(currency|valuutta)\b/),
    merchant: pick(/\b(counterparty|payee|payer|recipient|merchant|beneficiary|saaja|maksaja)\b/, /\bname\b/),
    description: pick(/\b(description|message|details|memo|viesti|selite)\b/),
    reference: pick(/\b(reference|viite)\b/),
  };
  choices.debit = choices.amount === 'none' ? pick(/\b(debit|money out|paid out|withdrawal)s?\b/) : 'none';
  choices.credit = choices.amount === 'none' ? pick(/\b(credit|money in|paid in|deposit)s?\b/) : 'none';
  const dates = choices.date === 'none' ? [] : sample.rows.map((row) => row[Number(choices.date!.slice(1))] ?? '');
  choices.date_format = dateFormatFor(dates) ?? 'ISO';
  choices.sign = 'negative';
  return {
    model: 'deterministic-local-mock-v1',
    answers: Object.fromEntries(
      Object.entries(choices).map(([key, choice]) => [
        key,
        { type: 'choice', choice, probabilities: { [choice]: 1 }, confidence: 1 },
      ]),
    ),
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}
// The proposed mapping, or null when the answer lacks a date, an amount or a payee.
export function columnsMapping(raw: unknown, sample: ColumnSample, currency: string): CsvMapping | null {
  const columns = ['none', ...sample.headers.map((_, i) => `c${i}`)];
  const answer = (key: string, options: readonly string[]) => {
    try {
      return parseChoice(raw, key, options, 0);
    } catch {
      return null;
    }
  };
  const at = (role: Role) => {
    const choice = answer(role, columns);
    return choice && choice !== 'none' ? Number(choice.slice(1)) : null;
  };
  const date = at('date'),
    amount = at('amount'),
    debit = at('debit'),
    credit = at('credit'),
    description = at('description');
  const merchant = at('merchant') ?? description;
  if (date === null || merchant === null || (amount === null && (debit === null || credit === null))) return null;
  const values = (...cols: number[]) => sample.rows.flatMap((row) => cols.map((c) => row[c] ?? ''));
  const dates = values(date);
  const named = DATE_FORMATS.find((f) => f === answer('date_format', DATE_FORMATS));
  const format = named && dateFormatFor(dates) === named ? named : (dateFormatFor(dates) ?? named ?? 'ISO');
  const currencyColumn = at('currency');
  const reference = at('reference');
  return {
    version: 1,
    encoding: 'utf-8',
    delimiter: ',',
    headerRecord: 0,
    trailingRecords: 0,
    date: { column: date, format, time: 'optional' },
    number: numberFormatFor(amount === null ? values(debit!, credit!) : values(amount)),
    amount:
      amount === null
        ? { kind: 'split', debit: debit!, credit: credit! }
        : {
            kind: 'signed',
            column: amount,
            outgoing: answer('sign', ['negative', 'positive']) === 'positive' ? 'positive' : 'negative',
          },
    currency:
      currencyColumn === null
        ? { kind: 'default', currency }
        : { kind: 'column', column: currencyColumn, blankDefault: currency },
    merchant,
    reference,
    ...(description !== null && description !== merchant && description !== reference
      ? { moreReferences: [description] }
      : {}),
    externalId: at('external_id'),
    original: null,
  };
}
export async function suggestColumns(env: Env, sample: ColumnSample, currency: string): Promise<CsvMapping | null> {
  if (sample.headers.length < 2 || !sample.rows.length) return null;
  try {
    const raw =
      env.AI_MODE === 'mock'
        ? mockColumns(sample)
        : await live(env, '@cf/cloudflare/clef', {
            model: 'clef',
            state: { headers: sample.headers, rows: sample.rows },
            questions: columnQuestions(sample),
          });
    return columnsMapping(raw, sample, currency);
  } catch {
    return null;
  }
}
async function live(env: Env, model: string, input: Record<string, unknown>) {
  requireInput(env.AI_MODE === 'live' && env.AI, 'Live AI binding unavailable');
  return env.AI.run(model, input);
}
