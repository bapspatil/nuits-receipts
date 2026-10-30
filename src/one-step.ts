// One-step bank import: choose a file, press Import. The account and the layout are found from the
// file; the owner is asked only when that fails (an account to pick, or the column editor).
//
// Detection order, first hit wins:
//   account: the one chosen on the account question, else the only account, else the one whose
//            bank is the bank the layout names, else a new account named for that bank when there
//            is none yet, else ask.
//   layout:  a layout saved for these column names (the bank's own when several), else the built-in
//            layout for them, else the model's proposal that reads the whole file, else the editor.
// The two old ticks are warnings: payments that look like ones already imported are skipped and
// counted, and payments that look like ones in another account are counted in the banner.
import { InputError, requireInput } from './domain';
import type { Env } from './env';
import { config } from './config';
import { listAccounts, type Account, type AccountChoice, type AccountId } from './accounts';
import { parseCsv, validateMapping, inspectCsv, statedTotals, type CsvMapping } from './csv';
import { suggestMappings } from './presets';
import { columnSample, suggestColumns } from './ai';
import {
  collisions,
  importBankCsv,
  importIdentity,
  normalizedImport,
  otherAccountCandidates,
  savedPresets,
  transactionIds,
  transactionsById,
} from './banking';
import { escape, page, pageHead } from './ui';
import {
  encodedBytes,
  hidden,
  importedResponse,
  importPreview,
  readBytes,
  saveLayout,
  totalsProblems,
} from './imports';
import { undoAt } from './undo';
import { button, buttonLink } from './actions';

type Layout = { mapping: CsvMapping; bank: string; kept: boolean };
// UTF-8 or the file's BOM first; bytes that are not text in either read as Windows-1252, which is
// what a bank that does not write UTF-8 writes.
function inspect(bytes: Uint8Array): ReturnType<typeof inspectCsv> {
  try {
    return inspectCsv(bytes);
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    try {
      return inspectCsv(bytes, { encoding: 'windows-1252' });
    } catch {
      throw error;
    }
  }
}
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// The banks the file's column names point to, from saved and built-in layouts.
async function banksOf(env: Env, headers: string[]): Promise<string[]> {
  const found = [...(await savedPresets(env, headers)), ...suggestMappings(headers, config(env).defaultCurrency)].map(
    (p) => p.bank_name.trim(),
  );
  return [...new Set(found.filter(Boolean).map((b) => b.toLowerCase()))].map(
    (lower) => found.find((b) => b.toLowerCase() === lower)!,
  );
}

async function layoutFor(
  env: Env,
  bytes: Uint8Array,
  inspected: ReturnType<typeof inspectCsv>,
  account: Pick<Account, 'bank_name' | 'default_currency'>,
): Promise<Layout | null> {
  const saved = await savedPresets(env, inspected.headers, account.bank_name);
  const ofBank = saved.filter((p) => same(p.bank_name, account.bank_name));
  const kept = saved.length === 1 ? saved[0] : ofBank.length === 1 ? ofBank[0] : undefined;
  if (kept) return { mapping: kept.mapping, bank: kept.bank_name, kept: true };
  if (saved.length) return null;
  // The Holvi alias reading is the catch-all; a layout made for these exact columns beats it.
  const all = suggestMappings(inspected.headers, account.default_currency);
  // Banks that share one layout (Nordea and OP) are one answer.
  const built = all.length > 1 ? all.filter((p) => p.id !== 'builtin-holvi') : all;
  if (built.length && new Set(built.map((p) => JSON.stringify(p.mapping))).size === 1)
    return { mapping: built[0]!.mapping, bank: built.length === 1 ? built[0]!.bank_name : '', kept: true };
  if (built.length) return null;
  const sample = columnSample(inspected.headers, inspected.records.slice(inspected.headerRecord + 1));
  const guess = await suggestColumns(env, sample, account.default_currency);
  if (!guess) return null;
  try {
    const trial = validateMapping({
      ...guess,
      encoding: inspected.encoding,
      delimiter: inspected.delimiter,
      headerRecord: inspected.headerRecord,
    });
    const read = parseCsv(bytes, trial);
    // A slash date is an order the model guessed; the owner confirms it in the editor.
    if (!read.issues.length && read.rows.length && !trial.date.format.includes('/'))
      return { mapping: trial, bank: '', kept: false };
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
  }
  return null;
}

// The column editor, with the file and the account as found, for when detection fails.
function editor(env: Env, bytes: Uint8Array, account: AccountChoice, encoding: string): Promise<Response> {
  const form = new FormData();
  form.set('encoding', encoding);
  form.set('csv', encodedBytes(bytes));
  form.set('account_choice', JSON.stringify(account));
  return importPreview(env, form);
}

function accountQuestion(env: Env, bytes: Uint8Array, accounts: Account[]): Promise<Response> {
  const options = accounts
    .map(
      (a) =>
        `<option value="${escape(a.id)}">${escape(a.label)}${a.bank_name ? ' · ' + escape(a.bank_name) : ''}</option>`,
    )
    .join('');
  return page(
    'import',
    `<div class="card"><form action="/import" method="post" enctype="multipart/form-data">${hidden('csv', encodedBytes(bytes))}<h2>Which account is this?</h2><p class="small">We could not tell from the file. We will remember the columns, so you are asked this only once per bank.</p><div class="fields"><label>Account<select name="account" id="f-account">${options}</select></label></div>${button('importStmt', { tone: 'primary' })}</form></div>`,
    200,
    env,
    { detail: 'Which account is this?', head: pageHead('Which account is this?') },
  );
}

export async function importOneStep(env: Env, form: FormData): Promise<Response> {
  const bytes = await readBytes(env, form);
  const inspected = inspect(bytes);
  const accounts = await listAccounts(env.DB);
  const chosen = String(form.get('account') ?? '');
  let account: AccountChoice | null = null,
    record: Pick<Account, 'bank_name' | 'default_currency'> | null = null;
  if (chosen) {
    const found = accounts.find((a) => a.id === chosen);
    requireInput(found, 'Account unavailable. Choose the file again.', 409, 'file');
    account = { kind: 'existing', id: found.id };
    record = found;
  } else if (accounts.length === 1) {
    account = { kind: 'existing', id: accounts[0]!.id };
    record = accounts[0]!;
  } else {
    const banks = await banksOf(env, inspected.headers);
    const named = banks.length === 1 ? accounts.filter((a) => same(a.bank_name, banks[0]!)) : [];
    if (named.length === 1) {
      account = { kind: 'existing', id: named[0]!.id };
      record = named[0]!;
    } else if (!accounts.length) {
      const bank = banks.length === 1 ? banks[0]! : '';
      record = { bank_name: bank, default_currency: config(env).defaultCurrency };
      account = {
        kind: 'new',
        id: crypto.randomUUID() as AccountId,
        label: bank ? `${bank} account` : 'Main account',
        bank_name: bank,
        default_currency: record.default_currency,
      };
    } else return accountQuestion(env, bytes, accounts);
  }
  const layout = await layoutFor(env, bytes, inspected, record!);
  const detected =
    layout &&
    inspected.delimiterChoices.length <= 1 &&
    validateMapping({
      ...layout.mapping,
      encoding: inspected.encoding,
      delimiter: inspected.delimiter,
      headerRecord: inspected.headerRecord,
    });
  const preview = detected ? parseCsv(bytes, detected) : null;
  if (
    !layout ||
    !detected ||
    !preview ||
    preview.issues.length ||
    !preview.rows.length ||
    totalsProblems(statedTotals(inspected.records, inspected.headerRecord), preview.rows).length
  )
    return editor(env, bytes, account, inspected.encoding);
  const parsed = normalizedImport(preview, account.id);
  const identity = await importIdentity(account.id, bytes);
  const prior = await env.DB.prepare('SELECT status,account_key FROM imports WHERE original_key=?')
    .bind(identity.key)
    .first<{ status: string; account_key: string }>();
  requireInput(!prior || prior.account_key === account.id, 'This file already belongs to another account', 409, 'file');
  const replayed = prior?.status === 'complete';
  const overlaps = replayed ? [] : await collisions(env, parsed, identity.id);
  const similar = replayed ? 0 : (await otherAccountCandidates(env, parsed)).length;
  const at = undoAt();
  const id = await importBankCsv(env, {
    bytes,
    parsed,
    mapping: detected,
    accountChoice: account,
    collision: 'keep_existing',
    crossAccountAcknowledged: true,
    at,
  });
  if (!layout.kept) await saveLayout(env, inspected.headers, detected, layout.bank || record!.bank_name, account.id);
  return importedResponse(env, { importId: id, rows: parsed.rows, replayed, at, anyway: overlaps.length, similar });
}

// Import anyway: the payments of an earlier import that were skipped as already imported, taken
// again as extra payments. It is its own import, so it has its own Undo. Payments with a bank ID
// cannot be taken twice and stay skipped.
export function anywayPage(env: Env, params: URLSearchParams): Promise<Response> {
  const imp = params.get('import') ?? '',
    n = Number(params.get('n'));
  requireInput(/^[a-f0-9]{64}$/.test(imp) && Number.isSafeInteger(n) && n > 0, 'Import not found', 404);
  return page(
    'import',
    `<div class="card"><form action="/import/anyway" method="post"><h2>Import anyway</h2><p>${n} ${n === 1 ? 'payment was' : 'payments were'} skipped because ${n === 1 ? 'it looks' : 'they look'} like ${n === 1 ? 'one' : 'ones'} you already imported. If ${n === 1 ? 'it is' : 'they are'} really separate payments, add ${n === 1 ? 'it' : 'them'} as extra payments.</p>${hidden('import', imp)}${button('importAnyway', { tone: 'primary' })} ${buttonLink('cancel', '/payments')}</form></div>`,
    200,
    env,
    { detail: 'Import anyway', head: pageHead('Import anyway') },
  );
}

export async function importAnyway(env: Env, form: FormData): Promise<Response> {
  const imp = String(form.get('import') ?? '');
  const row = await env.DB.prepare(
    "SELECT account_key,original_key,snapshot_json FROM imports WHERE id=? AND status='complete'",
  )
    .bind(imp)
    .first<{ account_key: string; original_key: string; snapshot_json: string }>();
  requireInput(row, 'Import not found', 404);
  const stored = await env.ORIGINALS.get(row.original_key);
  const mapping = (JSON.parse(JSON.parse(row.snapshot_json).settings ?? 'null') as { mapping: unknown } | null)
    ?.mapping;
  requireInput(stored && mapping, 'This import cannot be repeated. Choose the file again.', 409);
  const bytes = new Uint8Array(await stored.arrayBuffer());
  const preview = parseCsv(bytes, validateMapping(mapping));
  const all = normalizedImport(preview, row.account_key);
  const ids = await transactionIds(all.rows);
  const existing = await transactionsById(env, ids);
  const skipped = {
    ...all,
    rows: all.rows.filter((r, i) => !r.external_id && existing.get(ids[i]!)?.import_id !== imp),
  };
  requireInput(skipped.rows.length, 'Nothing was skipped in that import', 409);
  const at = undoAt();
  const again = await importBankCsv(env, {
    bytes,
    parsed: skipped,
    mapping: validateMapping(mapping),
    accountChoice: { kind: 'existing', id: row.account_key as AccountId },
    collision: 'additional',
    crossAccountAcknowledged: true,
    salt: 'anyway',
    at,
  });
  return importedResponse(env, { importId: again, rows: skipped.rows, replayed: false, at, anyway: 0, similar: 0 });
}
