import type { Env } from './env';
import { config } from './config';
import { parseCsv, inspectCsv, headerFingerprint, validateMapping, type CsvMapping } from './csv';
import { holviMapping, aliases, type BankPreset } from './presets';
import type { AccountChoice } from './accounts';
import {
  convertEur,
  date,
  EXPONENTS,
  hash,
  MAX_CSV_ROWS,
  MAX_CSV_BYTES,
  DEFAULT_TUNING,
  type Tuning,
  MONEY_TOLERANCE_MINOR,
  InputError,
  normalize,
  object,
  requireInput,
  similar,
  withinWindow,
  type Receipt,
  type Rule,
} from './domain';

export type Transaction = {
  id: string;
  account_key: string;
  external_id: string | null;
  import_id: string;
  booking_date: string;
  amount_minor: number;
  currency: string;
  original_amount_minor: number | null;
  original_currency: string | null;
  merchant: string;
  reference: string | null;
  raw_json: string;
  receipt_required: number;
  receipt_id: string | null;
  match_method: 'automatic' | 'manual' | null;
  matched_at: string | null;
};
export type ParsedImport = {
  headers: string[];
  mapping: Record<string, string>;
  rows: Omit<Transaction, 'id' | 'import_id'>[];
  errors: string[];
};
export function parsePreset(
  text: string,
  account: string,
  accountCurrency: string,
  selected: Record<string, string> = {},
): ParsedImport {
  requireInput(account.trim().length > 0 && account.length <= 100, 'Account label required');
  requireInput(Object.hasOwn(EXPONENTS, accountCurrency), 'Confirm supported account currency');
  const bytes = new TextEncoder().encode(text),
    layout = inspectCsv(bytes);
  const result: ParsedImport = { headers: layout.headers, mapping: {}, rows: [], errors: [] };
  for (const [key, names] of Object.entries(aliases))
    result.mapping[key] = selected[key] ?? layout.headers.find((h) => names.includes(normalize(h))) ?? '';
  try {
    requireInput(new Set(layout.headers).size === layout.headers.length, 'Duplicate headers');
    const mapping = { ...holviMapping(layout.headers, accountCurrency, selected), delimiter: layout.delimiter };
    const preview = parseCsv(bytes, mapping);
    result.errors = preview.issues.map((issue) => `Row ${issue.record}: ${issue.message}`);
    result.rows = preview.rows.map(({ value }) => ({
      ...value,
      account_key: account.trim(),
      receipt_required: 1,
      receipt_id: null,
      match_method: null,
      matched_at: null,
    }));
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : 'Invalid mapping');
  }
  return result;
}
export function normalizedImport(preview: ReturnType<typeof parseCsv>, account: string): ParsedImport {
  return {
    headers: preview.headers,
    mapping: {},
    rows: preview.rows.map(({ value }) => ({
      ...value,
      account_key: account,
      receipt_required: 1,
      receipt_id: null,
      match_method: null,
      matched_at: null,
    })),
    errors: preview.issues.map((issue) => `Record ${issue.record}, ${issue.field}: ${issue.message}`),
  };
}
type PresetRow = Omit<BankPreset, 'mapping'> & { mapping_json: string };
function presetValue(row: PresetRow): BankPreset {
  const { mapping_json, ...rest } = row;
  return { ...rest, mapping: validateMapping(JSON.parse(mapping_json)) };
}
export async function savedPresets(env: Env, headers: string[], bank = ''): Promise<BankPreset[]> {
  const fingerprint = await headerFingerprint(headers);
  return (
    await env.DB.prepare(
      'SELECT * FROM bank_presets WHERE header_fingerprint=? ORDER BY CASE WHEN bank_name=? COLLATE NOCASE THEN 0 ELSE 1 END,bank_name COLLATE NOCASE,name COLLATE NOCASE,id',
    )
      .bind(fingerprint, bank)
      .all<PresetRow>()
  ).results.map(presetValue);
}
export async function savePreset(
  env: Env,
  input: { id?: string; revision?: number; bank_name: string; name: string; headers: string[]; mapping: CsvMapping },
): Promise<BankPreset> {
  const bank = input.bank_name.trim(),
    name = input.name.trim(),
    mapping = validateMapping(input.mapping);
  requireInput(
    bank.length > 0 && bank.length <= 100 && name.length > 0 && name.length <= 100,
    'Preset bank and name require 1 to 100 characters',
  );
  requireInput(!input.id?.startsWith('builtin-'), 'Built-in presets cannot be changed');
  const fingerprint = await headerFingerprint(input.headers),
    now = new Date().toISOString(),
    id = input.id ?? crypto.randomUUID();
  try {
    if (input.id) {
      requireInput(Number.isSafeInteger(input.revision), 'Preset revision required');
      const updated = await env.DB.prepare(
        'UPDATE bank_presets SET bank_name=?,name=?,header_fingerprint=?,mapping_json=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',
      )
        .bind(bank, name, fingerprint, JSON.stringify(mapping), now, id, input.revision)
        .run();
      requireInput(updated.meta.changes === 1, 'Preset changed. Preview and save again.', 409);
    } else
      await env.DB.prepare(
        'INSERT INTO bank_presets(id,bank_name,name,header_fingerprint,mapping_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      )
        .bind(id, bank, name, fingerprint, JSON.stringify(mapping), now, now)
        .run();
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint'))
      throw new InputError('Preset name already exists for this bank', 409);
    throw error;
  }
  const row = await env.DB.prepare('SELECT * FROM bank_presets WHERE id=?').bind(id).first<PresetRow>();
  requireInput(row, 'Preset not found', 404);
  return presetValue(row);
}
export function canonical(row: ParsedImport['rows'][number]): string {
  return JSON.stringify([
    row.booking_date,
    row.amount_minor,
    row.currency,
    normalize(row.merchant),
    row.reference?.trim() ?? '',
    row.original_amount_minor,
    row.original_currency,
  ]);
}
export async function transactionIds(rows: ParsedImport['rows']): Promise<string[]> {
  const counts = new Map<string, number>();
  return Promise.all(
    rows.map((row) => {
      const key = canonical(row),
        occurrence = (counts.get(key) ?? 0) + 1;
      counts.set(key, occurrence);
      return hash(row.account_key + (row.external_id ? ':id:' + row.external_id : ':facts:' + key + ':' + occurrence));
    }),
  );
}
export async function importIdentity(account: string, bytes: Uint8Array): Promise<{ id: string; key: string }> {
  const digest = await hash(bytes);
  return {
    id: await hash(account.trim() + ':' + digest),
    key: `imports/${digest}.csv`,
  };
}
export async function collisions(env: Env, parsed: ParsedImport, importId: string): Promise<string[]> {
  const ids = await transactionIds(parsed.rows),
    overlaps: string[] = [];
  const existingRows = new Map<string, Transaction>();
  for (let offset = 0; offset < ids.length; offset += 90) {
    const chunk = ids.slice(offset, offset + 90);
    const found = await env.DB.prepare(
      `SELECT * FROM bank_transactions WHERE id IN (${chunk.map(() => '?').join(',')})`,
    )
      .bind(...chunk)
      .all<Transaction>();
    for (const row of found.results) existingRows.set(row.id, row);
  }
  for (const [i, id] of ids.entries()) {
    const existing = existingRows.get(id);
    if (existing && existing.import_id !== importId) {
      if (parsed.rows[i]!.external_id)
        requireInput(canonical(existing) === canonical(parsed.rows[i]!), 'Stable bank ID has conflicting facts', 409);
      else overlaps.push(id);
    }
  }
  return overlaps;
}
type FrozenRow = { id: string; facts: string; own: boolean; external: boolean };
type ImportManifest = {
  version: 1;
  canonicalization: 1;
  settings: string;
  expected: { sourceRows: number; insertRows: number; skipRows: number };
  rows: FrozenRow[];
};
type StoredImport = { id: string; account_key: string; status: 'pending' | 'complete'; snapshot_json: string };
export type ImportInput = {
  bytes: Uint8Array;
  parsed: ParsedImport;
  collision: string;
  mapping?: CsvMapping;
  accountChoice?: AccountChoice;
  crossAccountAcknowledged?: boolean;
};
async function transactionsById(env: Env, ids: string[]): Promise<Map<string, Transaction>> {
  const result = new Map<string, Transaction>();
  for (let offset = 0; offset < ids.length; offset += 90) {
    const chunk = ids.slice(offset, offset + 90);
    const found = await env.DB.prepare(
      `SELECT * FROM bank_transactions WHERE id IN (${chunk.map(() => '?').join(',')})`,
    )
      .bind(...chunk)
      .all<Transaction>();
    for (const row of found.results) result.set(row.id, row);
  }
  return result;
}
export async function otherAccountCandidates(env: Env, parsed: ParsedImport): Promise<string[]> {
  const first = parsed.rows[0];
  if (!first) return [];
  const other = await env.DB.prepare('SELECT 1 FROM bank_transactions WHERE account_key<>? LIMIT 1')
    .bind(first.account_key)
    .first();
  if (!other) return [];
  const found = new Set<string>();
  const pairs = [...new Set(parsed.rows.map((r) => JSON.stringify([r.booking_date, r.amount_minor])))].map(
    (v) => JSON.parse(v) as [string, number],
  );
  const external = [...new Set(parsed.rows.flatMap((r) => (r.external_id ? [r.external_id] : [])))];
  for (let offset = 0; offset < pairs.length; offset += 44) {
    const chunk = pairs.slice(offset, offset + 44);
    const rows = await env.DB.prepare(
      `SELECT id FROM bank_transactions WHERE account_key<>? AND (${chunk.map(() => '(booking_date=? AND amount_minor=?)').join(' OR ')})`,
    )
      .bind(first.account_key, ...chunk.flat())
      .all<{ id: string }>();
    for (const row of rows.results) found.add(row.id);
  }
  for (let offset = 0; offset < external.length; offset += 89) {
    const chunk = external.slice(offset, offset + 89);
    const rows = await env.DB.prepare(
      `SELECT id FROM bank_transactions WHERE account_key<>? AND external_id IN (${chunk.map(() => '?').join(',')})`,
    )
      .bind(first.account_key, ...chunk)
      .all<{ id: string }>();
    for (const row of rows.results) found.add(row.id);
  }
  return [...found].sort();
}
export async function importBankCsv(env: Env, input: ImportInput): Promise<string> {
  requireInput(input.parsed.errors.length === 0, 'Fix CSV errors before import');
  requireInput(input.bytes.length <= MAX_CSV_BYTES, 'CSV too large', 413);
  requireInput(input.parsed.rows.length > 0 && input.parsed.rows.length <= MAX_CSV_ROWS, 'CSV requires 1 to 5000 rows');
  const account = input.parsed.rows[0]!.account_key;
  requireInput(
    input.parsed.rows.every((r) => r.account_key === account),
    'Import must use one account',
  );
  const identity = await importIdentity(account, input.bytes);
  let prior = await env.DB.prepare('SELECT id,account_key,status,snapshot_json FROM imports WHERE original_key=?')
    .bind(identity.key)
    .first<StoredImport>();
  requireInput(!prior || prior.account_key === account, 'This file already belongs to another account', 409);
  if (prior?.status === 'complete') {
    await env.ORIGINALS.put(identity.key, input.bytes, { httpMetadata: { contentType: 'text/csv' } });
    return identity.id;
  }
  const accountRow = await env.DB.prepare('SELECT archived_at FROM accounts WHERE id=?')
    .bind(account)
    .first<{ archived_at: string | null }>();
  requireInput(
    accountRow || (input.accountChoice?.kind === 'new' && input.accountChoice.id === account),
    'Choose an existing account or create one',
  );
  requireInput(!accountRow?.archived_at, 'Account is archived', 409);
  const settings = JSON.stringify({
    mapping: input.mapping ?? null,
    collision: input.collision,
    account: { kind: 'existing', id: account },
    crossAccountAcknowledged: input.crossAccountAcknowledged ?? false,
  });
  const ids = await transactionIds(input.parsed.rows);
  requireInput(new Set(ids).size === ids.length, 'Duplicate transaction ID within file');
  const facts = await Promise.all(input.parsed.rows.map((row) => hash(canonical(row))));
  let manifest: ImportManifest;
  if (prior) {
    manifest = JSON.parse(prior.snapshot_json);
    requireInput(
      manifest.version === 1 &&
        manifest.settings === settings &&
        manifest.rows?.length === facts.length &&
        manifest.rows.every((r, i) => r.facts === facts[i]),
      'Pending import has a frozen manifest. Replay the original settings.',
      409,
    );
  } else {
    const overlaps = new Set(await collisions(env, input.parsed, identity.id));
    requireInput(
      !overlaps.size || ['keep_existing', 'additional'].includes(input.collision),
      'Confirm overlapping transactions before import',
      409,
    );
    const risks = await otherAccountCandidates(env, input.parsed);
    requireInput(
      !risks.length || input.crossAccountAcknowledged,
      'Similar transactions exist in another account. Confirm account selection.',
      409,
    );
    const existing = await transactionsById(env, ids);
    const rows: FrozenRow[] = [];
    for (const [index, id] of ids.entries()) {
      const overlap = overlaps.has(id),
        external = !!input.parsed.rows[index]!.external_id;
      rows.push({
        id: overlap && input.collision === 'additional' ? await hash(id + ':additional:' + identity.id) : id,
        facts: facts[index]!,
        own: overlap ? input.collision === 'additional' : !existing.has(id),
        external,
      });
    }
    manifest = {
      version: 1,
      canonicalization: 1,
      settings,
      expected: {
        sourceRows: rows.length,
        insertRows: rows.filter((r) => r.own).length,
        skipRows: rows.filter((r) => !r.own).length,
      },
      rows,
    };
  }
  const snapshot = JSON.stringify(manifest);
  requireInput(new TextEncoder().encode(snapshot).length <= 1024 * 1024, 'Import snapshot exceeds 1 MiB');
  await env.ORIGINALS.put(identity.key, input.bytes, { httpMetadata: { contentType: 'text/csv' } });
  const statements: D1PreparedStatement[] = [];
  if (input.accountChoice?.kind === 'new') {
    const choice = input.accountChoice;
    statements.push(
      env.DB.prepare(
        'INSERT INTO accounts(id,label,bank_name,default_currency,created_at) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM imports WHERE original_key=? AND account_key<>?) ON CONFLICT(id) DO NOTHING',
      ).bind(
        choice.id,
        choice.label,
        choice.bank_name,
        choice.default_currency,
        new Date().toISOString(),
        identity.key,
        account,
      ),
    );
  }
  statements.push(
    env.DB.prepare(
      "INSERT INTO imports(id,account_key,original_key,status,row_count,imported_at,snapshot_json) VALUES (?,?,?,'pending',?,?,?) ON CONFLICT DO NOTHING",
    ).bind(identity.id, account, identity.key, input.parsed.rows.length, new Date().toISOString(), snapshot),
  );
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint'))
      throw new InputError('Account label already exists', 409);
    throw error;
  }
  prior = await env.DB.prepare('SELECT id,account_key,status,snapshot_json FROM imports WHERE original_key=?')
    .bind(identity.key)
    .first<StoredImport>();
  requireInput(prior?.id === identity.id, 'This file already belongs to another account', 409);
  if (prior.status === 'complete') return identity.id;
  requireInput(
    prior.snapshot_json === snapshot,
    'Pending import has a frozen manifest. Replay the original settings.',
    409,
  );
  const inserts: D1PreparedStatement[] = [];
  for (const [index, expected] of manifest.rows.entries()) {
    if (!expected.own) continue;
    const entries = Object.entries({ ...input.parsed.rows[index]!, id: expected.id, import_id: identity.id });
    inserts.push(
      env.DB.prepare(
        `INSERT INTO bank_transactions (${entries.map(([k]) => k).join(',')}) VALUES (${entries.map(() => '?').join(',')}) ON CONFLICT(id) DO NOTHING`,
      ).bind(...entries.map(([, v]) => v)),
    );
  }
  for (let offset = 0; offset < inserts.length; offset += 50) await env.DB.batch(inserts.slice(offset, offset + 50));
  const stored = await transactionsById(
    env,
    manifest.rows.map((r) => r.id),
  );
  const foreignImports = new Set<string>();
  for (const expected of manifest.rows) {
    const row = stored.get(expected.id);
    requireInput(
      row && row.account_key === account && (await hash(canonical(row))) === expected.facts,
      'Stored transaction has conflicting canonical facts. Import remains pending.',
      409,
    );
    requireInput(
      !expected.own || expected.external || row.import_id === identity.id,
      'Overlapping transaction changed after preview. Import remains pending.',
      409,
    );
    if (row.import_id !== identity.id) foreignImports.add(row.import_id);
  }
  for (const importId of foreignImports) {
    requireInput(
      await env.DB.prepare("SELECT id FROM imports WHERE id=? AND status='complete'").bind(importId).first(),
      'An overlapping import is still pending. Retry after it completes.',
      409,
    );
  }
  const owned = (
    await env.DB.prepare('SELECT id FROM bank_transactions WHERE import_id=?').bind(identity.id).all<{ id: string }>()
  ).results;
  const expectedIds = new Set(manifest.rows.filter((r) => r.own).map((r) => r.id));
  requireInput(
    owned.every((r) => expectedIds.has(r.id)),
    'Stored import contains unexpected rows',
    409,
  );
  await env.DB.prepare("UPDATE imports SET status='complete' WHERE id=? AND snapshot_json=?")
    .bind(identity.id, snapshot)
    .run();
  await reconcile(env);
  return identity.id;
}
export function matchable(receipt: Receipt): boolean {
  return (
    receipt.status === 'ready' ||
    (receipt.status === 'needs_review' && receipt.review_reasons_json === '["missing_eur"]')
  );
}
function samePaymentFacts(receipt: Receipt, transaction: Transaction, tuning: Tuning): boolean {
  return (
    receipt.total_minor !== null &&
    !!receipt.issue_date &&
    receipt.currency === (transaction.original_currency ?? transaction.currency) &&
    Math.abs(receipt.total_minor - Math.abs(transaction.original_amount_minor ?? transaction.amount_minor)) <=
      MONEY_TOLERANCE_MINOR &&
    withinWindow(receipt.issue_date, transaction.booking_date, tuning)
  );
}
// Whether a receipt and a payment could be paired at all: both still open, money out, dated and priced.
function pairable(receipt: Receipt, transaction: Transaction): boolean {
  return !(
    receipt.kind === 'sales' ||
    !matchable(receipt) ||
    receipt.duplicate_of ||
    receipt.discarded_at ||
    transaction.receipt_id ||
    !transaction.receipt_required ||
    transaction.amount_minor >= 0 ||
    receipt.total_minor === null ||
    !receipt.issue_date
  );
}
// Same amount, currency and date window, whatever the names say. Worth showing, never matched alone.
export function lookalike(receipt: Receipt, transaction: Transaction, tuning: Tuning = DEFAULT_TUNING): boolean {
  return pairable(receipt, transaction) && samePaymentFacts(receipt, transaction, tuning);
}
export function eligible(
  receipt: Receipt,
  transaction: Transaction,
  rules: Rule[],
  approximate = false,
  tuning: Tuning = DEFAULT_TUNING,
): boolean {
  if (!pairable(receipt, transaction)) return false;
  const exact = samePaymentFacts(receipt, transaction, tuning);
  const estimated =
    approximate &&
    receipt.currency !== 'EUR' &&
    transaction.currency === 'EUR' &&
    receipt.fx_eur_minor !== null &&
    Math.abs(receipt.fx_eur_minor + transaction.amount_minor) <= Math.max(100, Math.abs(receipt.fx_eur_minor) * 0.03) &&
    withinWindow(receipt.issue_date!, transaction.booking_date, tuning);
  if (!exact && !estimated) return false;
  const alias = rules.some(
    (rule) =>
      normalize(rule.bank_alias ?? '') &&
      normalize(receipt.vendor ?? '').includes(normalize(rule.vendor_contains)) &&
      normalize(transaction.merchant) === normalize(rule.bank_alias ?? ''),
  );
  return alias || similar(receipt.vendor ?? '', transaction.merchant, tuning.minVendorSimilarity);
}
const matchableReceipts = `SELECT * FROM receipts WHERE kind='expense' AND (status='ready' OR (status='needs_review' AND review_reasons_json='["missing_eur"]')) AND duplicate_of IS NULL AND discarded_at IS NULL AND id NOT IN (SELECT receipt_id FROM bank_transactions t JOIN imports i ON i.id=t.import_id WHERE receipt_id IS NOT NULL AND i.status='complete')`;
const unmatchedTransactions =
  "SELECT t.* FROM bank_transactions t JOIN imports i ON i.id=t.import_id WHERE i.status='complete' AND t.receipt_id IS NULL AND t.amount_minor<0 AND t.receipt_required=1";
const receiptSnapshotSql = (t: Tuning) =>
  `SELECT json_group_array(json_array(id,revision,vendor,issue_date,currency,total_minor)) FROM (${matchableReceipts} AND currency=? AND abs(total_minor-?)<=${MONEY_TOLERANCE_MINOR} AND julianday(?)-julianday(issue_date) BETWEEN -${t.matchDaysBefore} AND ${t.matchDaysAfter} ORDER BY id)`;
const transactionSnapshotSql = (t: Tuning) =>
  `SELECT json_group_array(id) FROM (${unmatchedTransactions} AND COALESCE(t.original_currency,t.currency)=? AND abs(?-abs(COALESCE(t.original_amount_minor,t.amount_minor)))<=${MONEY_TOLERANCE_MINOR} AND julianday(t.booking_date)-julianday(?) BETWEEN -${t.matchDaysBefore} AND ${t.matchDaysAfter} ORDER BY t.id)`;
const ruleSnapshotSql =
  'SELECT json_group_array(json_array(id,vendor_contains,bank_alias)) FROM (SELECT * FROM vendor_rules ORDER BY id)';
export async function reconcile(env: Env): Promise<void> {
  const tuning = config(env).tuning;
  for (let pass = 0; pass < 3; pass++) {
    const receipts = (await env.DB.prepare(matchableReceipts + ' ORDER BY id').all<Receipt>()).results;
    const transactions = (await env.DB.prepare(unmatchedTransactions + ' ORDER BY t.id').all<Transaction>()).results;
    const rules = (await env.DB.prepare('SELECT * FROM vendor_rules ORDER BY id').all<Rule>()).results;
    const receiptState = new Map(
      receipts.map((r) => [r.id, [r.id, r.revision, r.vendor, r.issue_date, r.currency, r.total_minor]]),
    );
    const transactionState = new Set(transactions.map((t) => t.id));
    const ruleState = JSON.stringify(rules.map((r) => [r.id, r.vendor_contains, r.bank_alias]));
    const candidates = receipts.flatMap((r) =>
      transactions.filter((t) => eligible(r, t, rules, false, tuning)).map((t) => ({ r, t })),
    );
    const receiptCounts = new Map<string, number>(),
      transactionCounts = new Map<string, number>();
    for (const { r, t } of candidates) {
      receiptCounts.set(r.id, (receiptCounts.get(r.id) ?? 0) + 1);
      transactionCounts.set(t.id, (transactionCounts.get(t.id) ?? 0) + 1);
    }
    let stale = false;
    for (const { r, t } of candidates) {
      if (receiptCounts.get(r.id) !== 1 || transactionCounts.get(t.id) !== 1) continue;
      try {
        // Guard every possible currency/amount/date candidate, including vendors not currently eligible.
        const result = await env.DB.prepare(
          `UPDATE bank_transactions SET receipt_id=?,match_method='automatic',matched_at=?
          WHERE id=? AND receipt_id IS NULL AND receipt_required=1 AND amount_minor<0
          AND (${receiptSnapshotSql(tuning)})=? AND (${transactionSnapshotSql(tuning)})=? AND (${ruleSnapshotSql})=?`,
        )
          .bind(
            r.id,
            new Date().toISOString(),
            t.id,
            t.original_currency ?? t.currency,
            Math.abs(t.original_amount_minor ?? t.amount_minor),
            t.booking_date,
            JSON.stringify(
              receipts
                .filter((other) => receiptState.has(other.id) && samePaymentFacts(other, t, tuning))
                .map((other) => receiptState.get(other.id)),
            ),
            r.currency,
            r.total_minor,
            r.issue_date,
            JSON.stringify(
              transactions
                .filter((other) => transactionState.has(other.id) && samePaymentFacts(r, other, tuning))
                .map((other) => other.id),
            ),
            ruleState,
          )
          .run();
        if (result.meta.changes !== 1) {
          stale = true;
          break;
        }
        receiptState.delete(r.id);
        transactionState.delete(t.id);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('UNIQUE constraint')) throw error;
        stale = true;
        break;
      }
    }
    if (!stale) break;
  }
  await reconcileSales(env);
  await clearBankReview(env);
}

// ---------- Sales invoices and money in ----------
// A credit is matched to a sales invoice automatically only when the amount
// fits and either the bank reference carries the invoice's reference or
// number, or the payer's name is the client. Amount alone is a suggestion.
export type CreditFit = 'automatic' | 'suggested' | null;
function digits(value: string | null | undefined): string {
  return (value ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}
export function salesWindow(
  r: Pick<Receipt, 'issue_date' | 'due_date'>,
  booking: string,
  tuning: Tuning = DEFAULT_TUNING,
): boolean {
  if (!r.issue_date) return false;
  const issue = Date.parse(r.issue_date),
    due =
      r.due_date && !Number.isNaN(Date.parse(r.due_date))
        ? Date.parse(r.due_date)
        : issue + tuning.paymentTermsDays * 86400000;
  const at = Date.parse(booking);
  return at >= issue - tuning.salesDaysBefore * 86400000 && at <= due + tuning.salesDaysAfterDue * 86400000;
}
export function creditFit(r: Receipt, t: Transaction, tuning: Tuning = DEFAULT_TUNING): CreditFit {
  if (
    r.kind !== 'sales' ||
    !matchable(r) ||
    r.duplicate_of ||
    r.discarded_at ||
    t.receipt_id ||
    !t.receipt_required ||
    t.amount_minor <= 0 ||
    r.total_minor === null ||
    !salesWindow(r, t.booking_date, tuning)
  )
    return null;
  const amount =
    r.currency === (t.original_currency ?? t.currency) &&
    Math.abs(r.total_minor - Math.abs(t.original_amount_minor ?? t.amount_minor)) <= MONEY_TOLERANCE_MINOR;
  // Foreign-currency invoice paid in euros: bank FX and fees, within 3 %.
  const converted =
    r.currency !== 'EUR' &&
    t.currency === 'EUR' &&
    t.original_currency === null &&
    r.fx_eur_minor !== null &&
    Math.abs(r.fx_eur_minor - t.amount_minor) <= Math.max(100, Math.abs(r.fx_eur_minor) * 0.03);
  const text = digits(`${t.reference ?? ''} ${t.merchant}`);
  const reference =
    (digits(r.reference_number).length >= 3 && text.includes(digits(r.reference_number))) ||
    (digits(r.invoice_number).length >= 3 && text.includes(digits(r.invoice_number)));
  // A client written in a script normalize() cannot read (Cyrillic, CJK, Greek) becomes ''.
  // '' is contained in every merchant, so it must never count as a name match.
  const client = normalize(r.client ?? '');
  const name =
    !!client &&
    (similar(r.client ?? '', t.merchant, tuning.minVendorSimilarity) || normalize(t.merchant).includes(client));
  if (amount && (reference || name)) return 'automatic';
  if (amount || converted || reference) return 'suggested';
  return null;
}
const matchableSales = `SELECT * FROM receipts WHERE kind='sales' AND (status='ready' OR (status='needs_review' AND review_reasons_json='["missing_eur"]')) AND duplicate_of IS NULL AND discarded_at IS NULL AND id NOT IN (SELECT receipt_id FROM bank_transactions t JOIN imports i ON i.id=t.import_id WHERE receipt_id IS NOT NULL AND i.status='complete')`;
export const unmatchedCredits =
  "SELECT t.* FROM bank_transactions t JOIN imports i ON i.id=t.import_id WHERE i.status='complete' AND t.receipt_id IS NULL AND t.amount_minor>0 AND t.receipt_required=1 AND NOT EXISTS (SELECT 1 FROM internal_transfers p WHERE p.credit_id=t.id OR p.debit_id=t.id)";
export async function openSales(env: Env): Promise<Receipt[]> {
  return (await env.DB.prepare(matchableSales + ' ORDER BY issue_date DESC,id').all<Receipt>()).results;
}
export async function reconcileSales(env: Env): Promise<void> {
  const invoices = await openSales(env);
  if (!invoices.length) return;
  const tuning = config(env).tuning;
  const credits = (await env.DB.prepare(unmatchedCredits + ' ORDER BY t.id').all<Transaction>()).results;
  const pairs = invoices.flatMap((r) =>
    credits.filter((t) => creditFit(r, t, tuning) === 'automatic').map((t) => ({ r, t })),
  );
  // Only one-to-one pairs: an invoice with two fitting credits, or a credit
  // fitting two invoices, is left for the owner to pick.
  const byInvoice = new Map<string, number>(),
    byCredit = new Map<string, number>();
  for (const { r, t } of pairs) {
    byInvoice.set(r.id, (byInvoice.get(r.id) ?? 0) + 1);
    byCredit.set(t.id, (byCredit.get(t.id) ?? 0) + 1);
  }
  for (const { r, t } of pairs) {
    if (byInvoice.get(r.id) !== 1 || byCredit.get(t.id) !== 1) continue;
    try {
      await env.DB.prepare(
        `UPDATE bank_transactions SET receipt_id=?,match_method='automatic',matched_at=? WHERE id=? AND receipt_id IS NULL AND receipt_required=1 AND amount_minor>0 AND EXISTS(SELECT 1 FROM receipts WHERE id=? AND kind='sales' AND revision=? AND duplicate_of IS NULL AND discarded_at IS NULL)`,
      )
        .bind(r.id, new Date().toISOString(), t.id, r.id, r.revision)
        .run();
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('UNIQUE constraint')) throw error;
    }
  }
}
export async function clearBankReview(env: Env): Promise<void> {
  await env.DB.prepare(
    `UPDATE receipts SET status='ready',review_reasons_json='[]' WHERE status='needs_review' AND review_reasons_json='["missing_eur"]' AND EXISTS(SELECT 1 FROM bank_transactions t JOIN imports i ON i.id=t.import_id WHERE t.receipt_id=receipts.id AND t.currency='EUR' AND i.status='complete')`,
  ).run();
}
export async function cacheFx(env: Env, receipt: Receipt): Promise<void> {
  if (
    !receipt.currency ||
    receipt.currency === 'EUR' ||
    receipt.total_minor === null ||
    !receipt.issue_date ||
    EXPONENTS[receipt.currency] === undefined
  )
    return;
  let cached = await env.DB.prepare('SELECT eur_per_unit,rate_date FROM fx_rates WHERE currency=? AND requested_date=?')
    .bind(receipt.currency, receipt.issue_date)
    .first<{ eur_per_unit: string; rate_date: string }>();
  if (!cached) {
    try {
      let observations: unknown;
      if (env.AI_MODE === 'mock')
        observations =
          receipt.currency === 'USD' && receipt.issue_date === '2026-09-05' ? [{ date: '2026-09-04', rate: 0.9 }] : [];
      else {
        const from = new Date(Date.parse(receipt.issue_date) - 6 * 86400000).toISOString().slice(0, 10);
        const url = new URL('https://api.frankfurter.dev/v2/rates');
        url.search = new URLSearchParams({
          base: receipt.currency,
          quotes: 'EUR',
          providers: 'ecb',
          from,
          to: receipt.issue_date,
        }).toString();
        const response = await fetch(url, {
          signal: AbortSignal.timeout(10000),
        });
        requireInput(response.ok, 'FX unavailable');
        observations = await response.json();
      }
      requireInput(Array.isArray(observations), 'Invalid FX response');
      const start = Date.parse(receipt.issue_date) - 6 * 86400000;
      const rates = observations
        .map((v) => object(v))
        .filter(
          (v) =>
            typeof v.date === 'string' &&
            v.date <= receipt.issue_date! &&
            Date.parse(v.date) >= start &&
            typeof v.rate === 'number' &&
            Number.isFinite(v.rate) &&
            v.rate > 0,
        )
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const latest = rates[0];
      requireInput(latest, 'No historical FX');
      cached = {
        eur_per_unit: String(latest.rate),
        rate_date: date(String(latest.date)),
      };
      await env.DB.prepare(
        'INSERT INTO fx_rates (currency,requested_date,rate_date,eur_per_unit,source,fetched_at) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING',
      )
        .bind(
          receipt.currency,
          receipt.issue_date,
          cached.rate_date,
          cached.eur_per_unit,
          env.AI_MODE === 'mock' ? 'mock ECB fixture' : 'ECB via Frankfurter',
          new Date().toISOString(),
        )
        .run();
    } catch {
      cached = null;
    }
  }
  const value = cached ? convertEur(receipt.total_minor, receipt.currency, cached.eur_per_unit) : null;
  const bank = await env.DB.prepare(
    "SELECT t.id FROM bank_transactions t JOIN imports i ON i.id=t.import_id WHERE t.receipt_id=? AND t.currency='EUR' AND i.status='complete'",
  )
    .bind(receipt.id)
    .first();
  const reasons: string[] = JSON.parse(receipt.review_reasons_json);
  const remaining = reasons.filter((reason) => reason !== 'missing_eur');
  if (value === null && receipt.eur_override_minor === null && !bank) remaining.push('missing_eur');
  await env.DB.prepare(
    "UPDATE receipts SET fx_eur_minor=?,fx_requested_date=?,review_reasons_json=?,status=CASE WHEN ? THEN 'needs_review' WHEN review_reasons_json='[\"missing_eur\"]' AND status='needs_review' THEN 'ready' ELSE status END WHERE id=? AND revision=?",
  )
    .bind(
      value,
      receipt.issue_date,
      JSON.stringify(remaining),
      remaining.includes('missing_eur') ? 1 : 0,
      receipt.id,
      receipt.revision,
    )
    .run();
}
export type EurValue = {
  source: 'manual' | 'bank' | 'native' | 'ecb' | 'missing';
  minor: number | null;
  rateDate: string | null;
  transaction: string | null;
  accountId: string | null;
  accountName: string | null;
};
export async function eurValue(env: Env, row: Receipt): Promise<EurValue> {
  const bank = await env.DB.prepare(
    "SELECT t.*,a.label AS account_name FROM bank_transactions t JOIN imports i ON i.id=t.import_id JOIN accounts a ON a.id=t.account_key WHERE t.receipt_id=? AND i.status='complete'",
  )
    .bind(row.id)
    .first<Transaction & { account_name: string }>();
  const account = { accountId: bank?.account_key ?? null, accountName: bank?.account_name ?? null };
  if (row.eur_override_minor !== null)
    return {
      ...account,
      source: 'manual',
      minor: row.eur_override_minor,
      rateDate: null,
      transaction: bank?.id ?? null,
    };
  if (bank?.currency === 'EUR')
    return {
      ...account,
      source: 'bank',
      // Money out is negative on the statement; money in (a paid sales invoice) is positive.
      minor: row.kind === 'sales' ? bank.amount_minor : -bank.amount_minor,
      rateDate: null,
      transaction: bank.id,
    };
  if (row.currency === 'EUR')
    return { ...account, source: 'native', minor: row.total_minor, rateDate: null, transaction: bank?.id ?? null };
  const rateDate = await env.DB.prepare('SELECT rate_date FROM fx_rates WHERE currency=? AND requested_date=?')
    .bind(row.currency, row.fx_requested_date)
    .first<string>('rate_date');
  return {
    ...account,
    source: row.fx_eur_minor === null ? 'missing' : 'ecb',
    minor: row.fx_eur_minor,
    rateDate,
    transaction: bank?.id ?? null,
  };
}
