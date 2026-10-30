import { EXPONENTS, hash, InputError, MAX_CSV_BYTES, minor, money, requireInput } from './domain';
import type { Env } from './env';
import { validateAccountChoice, type AccountChoice } from './accounts';
import {
  parseCsv,
  validateMapping,
  inspectCsv,
  statedTotals,
  headerFingerprint,
  DATE_FORMATS,
  type CsvMapping,
} from './csv';
import { undoAt, type UndoAt } from './undo';
import { suggestMappings } from './presets';
import { columnSample, suggestColumns } from './ai';
import { isXlsx, xlsxToCsv } from './xlsx';
import { isPdf, pdfToCsv } from './pdf';
import {
  collisions,
  exemptByClef,
  importBankCsv,
  importIdentity,
  normalizedImport,
  otherAccountCandidates,
  savedPresets,
  savePreset,
  type ParsedImport,
} from './banking';
import { ariaFor, day, errorLine, escape, input, page, pageHead, select, stepWord } from './ui';
import { failureFor, kept } from './request';
import { withDone } from './events';

export function hidden(name: string, value: unknown): string {
  return `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`;
}
// Plain labels for the CSV fields. Names and values are unchanged.
const LABELS: Record<string, string> = {
  account: 'Which account is this?',
  account_action: 'Import into',
  encoding: 'Text encoding',
  delimiter: 'Column separator',
  header_record: 'Which row has the column names?',
  trailing_records: 'Rows to skip at the end',
  map_booking_date: 'Date column',
  date_format: 'Date format',
  date_time: 'Dates include a time',
  number_decimal: 'Decimal mark',
  number_grouping: 'Thousands separator',
  amount_mode: 'How amounts are shown',
  map_amount: 'Amount column',
  signed_outgoing: 'Money out is shown as',
  map_debit: 'Money out column',
  map_credit: 'Money in column',
  map_direction: 'In or out column',
  direction_debit: 'Words that mean money out',
  direction_credit: 'Words that mean money in',
  currency_mode: 'Currency',
  default_currency: 'Currency for every row',
  map_currency: 'Currency column',
  currency_blank_default: 'Currency when that column is empty',
  map_merchant: 'Paid to column',
  map_reference: 'Reference column',
  map_external_id: 'Transaction ID column',
  map_original_amount: 'Original amount column',
  map_original_currency: 'Original currency column',
  preset_id: 'Layout',
  collision: 'If a payment was already imported',
};
const label = (name: string) => LABELS[name] ?? name.replaceAll('_', ' ');
function options(name: string, values: readonly { value: string; label: string }[], current: unknown): string {
  const shown = String(kept(IMPORT, name, current));
  return `<label>${escape(label(name))}<select name="${name}" id="f-${name}"${ariaFor(IMPORT, name)}>${values.map((v) => `<option value="${escape(v.value)}"${v.value === shown ? ' selected' : ''}>${escape(v.label)}</option>`).join('')}</select>${errorLine(IMPORT, name)}</label>`;
}
// Presets are named after the CSV layout they read, never as a bank product.
export function presetLabel(p: { id: string; bank_name: string; name: string }): string {
  if (p.id.startsWith('builtin-')) return `${p.bank_name} (CSV layout)`;
  return p.bank_name ? `${p.name} · ${p.bank_name} (CSV layout)` : `${p.name} (CSV layout)`;
}
// The first step's form, as the failure scope names it.
export const IMPORT = 'import';
export async function importForm(): Promise<string> {
  const refused = failureFor(IMPORT);
  return `<form action="/import" method="post" enctype="multipart/form-data"><h2>Choose the file</h2>${refused && !refused.field ? errorLine(IMPORT, '') : ''}<div class="fields"><label class="wide">Bank statement (XLSX, CSV or PDF)<input type="file" name="file" accept=".xlsx,.csv,.pdf,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/pdf" required id="f-file"${ariaFor(IMPORT, 'file')}>${errorLine(IMPORT, 'file')}</label></div><p class="small">Booked payments only. We find the account and the columns, and skip what you imported before.</p><button class="btn primary">Import</button></form>`;
}
export function wizard(step: 1 | 2 | 3): string {
  return `<ol class="wizard" aria-label="Import steps">${['Choose file', 'Check', 'Import']
    .map(
      (name, i) =>
        `<li${i + 1 === step ? ' aria-current="step"' : i + 1 < step ? ' class="done"' : ''}>${stepWord(i + 1 === step ? 'now' : i + 1 < step ? 'done' : 'todo')}${name}</li>`,
    )
    .join('')}</ol>`;
}
function bytesFromForm(form: FormData): Uint8Array {
  const file = form.get('file'),
    encoded = form.get('csv');
  requireInput(file instanceof File || typeof encoded === 'string', 'Choose CSV', 422, 'file');
  requireInput(
    !(typeof encoded === 'string') || encoded.length <= 4 * Math.ceil(MAX_CSV_BYTES / 3),
    'CSV too large',
    413,
  );
  requireInput(!(file instanceof File), 'Read file before decoding');
  try {
    const bytes = Uint8Array.from(atob(String(encoded)), (c) => c.charCodeAt(0));
    requireInput(bytes.length <= MAX_CSV_BYTES, 'CSV too large', 413);
    return bytes;
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('Invalid CSV preview data');
  }
}
export async function readBytes(env: Env, form: FormData): Promise<Uint8Array> {
  const file = form.get('file');
  if (file instanceof File) {
    requireInput(file.size <= MAX_CSV_BYTES, 'CSV too large', 413, 'file');
    const bytes = new Uint8Array(await file.arrayBuffer());
    // A spreadsheet or PDF statement becomes a CSV here; every later step reads that CSV.
    if (isXlsx(bytes)) return xlsxToCsv(bytes).catch(fileField);
    if (isPdf(bytes)) return pdfToCsv(env, bytes).catch(fileField);
    return bytes;
  }
  return bytesFromForm(form);
}
function fileField(error: unknown): never {
  if (error instanceof InputError && !error.field) error.field = 'file';
  throw error;
}
function json(value: string | File | null): unknown {
  try {
    return JSON.parse(String(value));
  } catch {
    throw new InputError('Invalid preview settings');
  }
}
// The control behind a refusal of the new-account details, from what the message names.
function accountField(error: unknown): never {
  if (error instanceof InputError && !error.field) {
    const named = /label/i.test(error.message)
      ? 'account_label'
      : /bank/i.test(error.message)
        ? 'bank_name'
        : /currency/i.test(error.message)
          ? 'account_currency'
          : undefined;
    if (named) error.field = named;
  }
  throw error;
}
async function accountFromForm(env: Env, form: FormData): Promise<AccountChoice> {
  if (form.has('account_choice')) return validateAccountChoice(env.DB, json(form.get('account_choice')));
  return validateAccountChoice(
    env.DB,
    form.get('account_action') === 'new'
      ? {
          kind: 'new',
          label: String(form.get('account_label') ?? ''),
          bank_name: String(form.get('bank_name') ?? ''),
          default_currency: String(form.get('account_currency') ?? 'EUR'),
        }
      : { kind: 'existing', id: String(form.get('account') ?? '') },
  ).catch(accountField);
}
function column(form: FormData, key: string, optional = false): number | null {
  const value = String(form.get(key) ?? '');
  if (optional && value === '') return null;
  requireInput(/^\d+$/.test(value), 'Choose a column for every field the file needs', 422, key);
  return Number(value);
}
function mappingFromEditor(form: FormData, base: CsvMapping): CsvMapping {
  const mode = String(form.get('amount_mode')),
    currencyMode = String(form.get('currency_mode'));
  const originalAmount = column(form, 'map_original_amount', true),
    originalCurrency = column(form, 'map_original_currency', true);
  requireInput(
    (originalAmount === null) === (originalCurrency === null),
    'Original amount and currency must both be mapped',
  );
  return validateMapping({
    ...base,
    encoding: form.get('encoding'),
    delimiter: form.get('delimiter'),
    headerRecord: Number(form.get('header_record')),
    trailingRecords: Number(form.get('trailing_records')),
    date: { column: column(form, 'map_booking_date'), format: form.get('date_format'), time: form.get('date_time') },
    number: { decimal: form.get('number_decimal'), grouping: form.get('number_grouping') },
    amount:
      mode === 'signed'
        ? { kind: 'signed', column: column(form, 'map_amount'), outgoing: form.get('signed_outgoing') }
        : mode === 'split'
          ? { kind: 'split', debit: column(form, 'map_debit'), credit: column(form, 'map_credit') }
          : {
              kind: 'direction',
              amount: column(form, 'map_amount'),
              direction: column(form, 'map_direction'),
              debit: String(form.get('direction_debit') ?? '').split('|'),
              credit: String(form.get('direction_credit') ?? '').split('|'),
            },
    currency:
      currencyMode === 'column'
        ? {
            kind: 'column',
            column: column(form, 'map_currency'),
            blankDefault: String(form.get('currency_blank_default') ?? '') || null,
          }
        : { kind: 'default', currency: form.get('default_currency') },
    merchant: column(form, 'map_merchant'),
    reference: column(form, 'map_reference', true),
    externalId: column(form, 'map_external_id', true),
    original: originalAmount === null ? null : { amount: originalAmount, currency: originalCurrency },
  });
}
function mappingEditor(mapping: CsvMapping, headers: string[], currency: string, slashConfirmed = false): string {
  const col = (name: string, current: number | null) =>
    options(
      name,
      [{ value: '', label: 'Not used' }, ...headers.map((h, i) => ({ value: String(i), label: `${i + 1}. ${h}` }))],
      current ?? '',
    );
  const pick = (name: string, values: readonly string[], current: unknown) =>
    select(name, values, current, label(name));
  const a = mapping.amount,
    c = mapping.currency;
  return `<fieldset><legend>The file</legend><div class="fields">${pick('encoding', ['utf-8', 'utf-16le', 'utf-16be', 'windows-1252'], mapping.encoding)}${options(
    'delimiter',
    [
      { value: ',', label: 'Comma' },
      { value: ';', label: 'Semicolon' },
      { value: '\t', label: 'Tab' },
      { value: '|', label: 'Pipe' },
    ],
    mapping.delimiter,
  )}${input('header_record', mapping.headerRecord, 'number', label('header_record'), { hint: '0 is the first row of the file' })}${input('trailing_records', mapping.trailingRecords, 'number', label('trailing_records'))}</div><p class="small">Rows above the column names and skipped rows at the end are listed under the preview.</p></fieldset>
    <fieldset><legend>Dates</legend><div class="fields">${col('map_booking_date', mapping.date.column)}${pick('date_format', DATE_FORMATS, mapping.date.format)}${options(
      'date_time',
      [
        { value: 'none', label: 'No' },
        { value: 'optional', label: 'Sometimes' },
      ],
      mapping.date.time,
    )}</div><label class="check"><input type="checkbox" name="slash_order_confirmed" value="yes"${slashConfirmed ? ' checked' : ''}>The day and month order above is right for dates written with slashes.</label></fieldset>
    <fieldset><legend>Amounts</legend><div class="fields">${pick('number_decimal', ['.', ',', 'dot-or-comma'], mapping.number.decimal)}${pick('number_grouping', ['', '.', ',', 'space', "'"], mapping.number.grouping)}${options(
      'amount_mode',
      [
        { value: 'signed', label: 'One amount column' },
        { value: 'split', label: 'Separate money out and money in columns' },
        { value: 'direction', label: 'An amount column plus an in or out column' },
      ],
      a.kind,
    )}${col('map_amount', a.kind === 'signed' ? a.column : a.kind === 'direction' ? a.amount : null)}${options(
      'signed_outgoing',
      [
        { value: 'negative', label: 'Negative numbers' },
        { value: 'positive', label: 'Positive numbers' },
      ],
      a.kind === 'signed' ? a.outgoing : 'negative',
    )}${col('map_debit', a.kind === 'split' ? a.debit : null)}${col('map_credit', a.kind === 'split' ? a.credit : null)}${col('map_direction', a.kind === 'direction' ? a.direction : null)}${input('direction_debit', a.kind === 'direction' ? a.debit.join('|') : 'OUT', 'text', label('direction_debit'))}${input('direction_credit', a.kind === 'direction' ? a.credit.join('|') : 'IN', 'text', label('direction_credit'))}</div><p class="small">In or out words must match the file exactly; separate several with |. Money out is saved as negative amounts.</p></fieldset>
    <fieldset><legend>Currency and names</legend><div class="fields">${options(
      'currency_mode',
      [
        { value: 'default', label: 'The same for every row' },
        { value: 'column', label: 'Read from a column' },
      ],
      c.kind,
    )}${pick('default_currency', Object.keys(EXPONENTS), c.kind === 'default' ? c.currency : currency)}${col('map_currency', c.kind === 'column' ? c.column : null)}${pick('currency_blank_default', ['', ...Object.keys(EXPONENTS)], c.kind === 'column' ? c.blankDefault : '')}${col('map_merchant', mapping.merchant)}${col('map_reference', mapping.reference)}${col('map_external_id', mapping.externalId)}${col('map_original_amount', mapping.original?.amount ?? null)}${col('map_original_currency', mapping.original?.currency ?? null)}</div></fieldset>`;
}
// What a row problem calls the column it is about.
const ISSUE_FIELDS: Record<string, string> = {
  date: 'date',
  merchant: 'paid to',
  currency: 'currency',
  amount: 'amount',
  original_currency: 'original currency',
  original_amount: 'original amount',
  csv: 'file',
  mapping: 'column settings',
  row: 'columns',
};
type ImportState = { overlaps: string[]; otherAccounts: string[] };
async function currentState(env: Env, parsed: ParsedImport, bytes: Uint8Array): Promise<ImportState> {
  const identity = await importIdentity(parsed.rows[0]!.account_key, bytes);
  const prior = await env.DB.prepare('SELECT account_key FROM imports WHERE original_key=?')
    .bind(identity.key)
    .first<{ account_key: string }>();
  requireInput(
    !prior || prior.account_key === parsed.rows[0]!.account_key,
    'This file already belongs to another account',
    409,
  );
  return {
    overlaps: (await collisions(env, parsed, identity.id)).sort(),
    otherAccounts: await otherAccountCandidates(env, parsed),
  };
}
export function encodedBytes(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
}
async function signature(env: Env, form: FormData, bytes: Uint8Array): Promise<string> {
  const payload = JSON.stringify([
    await hash(bytes),
    ...[
      'mapping',
      'account_choice',
      'collision',
      'acknowledge_other_account',
      'slash_order_confirmed',
      'conflicts',
      'expires',
    ].map((k) => String(form.get(k) ?? '')),
  ]);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.NUITS_PASSWORD ?? ''),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export async function importPreview(env: Env, form: FormData): Promise<Response> {
  const bytes = await readBytes(env, form),
    account = await accountFromForm(env, form);
  const savedAccount =
    account.kind === 'existing'
      ? await env.DB.prepare('SELECT bank_name,default_currency FROM accounts WHERE id=?')
          .bind(account.id)
          .first<{ bank_name: string; default_currency: string }>()
      : account;
  requireInput(savedAccount, 'Account not found', 404);
  const identity = await importIdentity(account.id, bytes);
  const fileOwner = await env.DB.prepare('SELECT account_key FROM imports WHERE original_key=?')
    .bind(identity.key)
    .first<{ account_key: string }>();
  requireInput(!fileOwner || fileOwner.account_key === account.id, 'This file already belongs to another account', 409);
  const currency = savedAccount.default_currency;
  const provided = form.has('mapping') ? validateMapping(json(form.get('mapping'))) : null;
  // A new file has its column names found; after that the chosen row is kept.
  const requestedHeader = form.get('editor') === '1' ? Number(form.get('header_record')) : provided?.headerRecord;
  const encodingValue = String(form.get('encoding') ?? provided?.encoding ?? 'auto');
  requireInput(['auto', 'utf-8', 'utf-16le', 'utf-16be', 'windows-1252'].includes(encodingValue), 'Invalid encoding');
  const encoding =
    encodingValue === 'auto'
      ? undefined
      : validateMapping({ ...(provided ?? fallbackMapping(currency)), encoding: encodingValue }).encoding;
  const explicitDelimiter = form.get('editor') === '1' ? form.get('delimiter') : provided?.delimiter;
  const layout = inspectCsv(bytes, {
    encoding,
    headerRecord: requestedHeader,
    ...(explicitDelimiter
      ? {
          delimiter: validateMapping({ ...(provided ?? fallbackMapping(currency)), delimiter: explicitDelimiter })
            .delimiter,
        }
      : {}),
  });
  const headerRecord = layout.headerRecord;
  const suggestions = [
    ...(await savedPresets(env, layout.headers, savedAccount.bank_name)),
    ...suggestMappings(layout.headers, currency),
  ];
  const selectedId = String(form.get('preset_id') ?? '');
  const selected = suggestions.find((p) => p.id === selectedId);
  requireInput(!selectedId || selectedId === 'custom' || selected, 'Preset is not available for these headers');
  const layoutChanged =
    provided &&
    (provided.headerRecord !== headerRecord ||
      provided.delimiter !== layout.delimiter ||
      provided.encoding !== layout.encoding);
  const changingPreset = !!selected && selectedId !== String(form.get('current_preset') ?? '');
  // A single matching preset is applied automatically; show it as the chosen layout too.
  const autoPreset =
    !changingPreset && suggestions.length === 1 && (layoutChanged || (!provided && !selected))
      ? suggestions[0]!
      : undefined;
  const shownPresetId = autoPreset?.id ?? selectedId;
  // No layout known: ask the model once, and keep its proposal only if the whole file reads with it.
  let proposed: CsvMapping | null = null;
  if (!provided && !selected && !suggestions.length && form.get('editor') !== '1') {
    const sample = columnSample(layout.headers, layout.records.slice(headerRecord + 1));
    const guess = await suggestColumns(env, sample, currency);
    if (guess) {
      try {
        const trial = validateMapping({
          ...guess,
          encoding: layout.encoding,
          delimiter: layout.delimiter,
          headerRecord,
        });
        const read = parseCsv(bytes, trial);
        if (!read.issues.length && read.rows.length) proposed = trial;
      } catch (error) {
        if (!(error instanceof InputError)) throw error;
      }
    }
  }
  let mapping = changingPreset
    ? selected!.mapping
    : autoPreset
      ? autoPreset.mapping
      : proposed
        ? proposed
        : layoutChanged
          ? fallbackMapping(currency)
          : (provided ?? selected?.mapping ?? fallbackMapping(currency));
  if (form.get('editor') === '1' && !changingPreset && !layoutChanged) mapping = mappingFromEditor(form, mapping);
  mapping = validateMapping({
    ...mapping,
    encoding: layout.encoding,
    delimiter: form.get('editor') === '1' ? form.get('delimiter') : (provided?.delimiter ?? layout.delimiter),
    headerRecord,
    trailingRecords: form.has('trailing_records') ? Number(form.get('trailing_records')) : mapping.trailingRecords,
  });
  const preview = parseCsv(bytes, mapping),
    parsed = normalizedImport(preview, account.id),
    problems: string[] = [];
  if (!provided && !selected && !suggestions.length && !proposed)
    problems.push('No preset maps these headers. Map amount and other columns, then update preview.');
  if (provided || selected || autoPreset || proposed)
    problems.push(...totalsProblems(statedTotals(layout.records, headerRecord), preview.rows));
  if (!provided && !selected && suggestions.length > 1 && selectedId !== 'custom')
    problems.push('Several presets match these headers. Select a preset or choose Custom mapping.');
  if (!provided && !explicitDelimiter && layout.delimiterChoices.length > 1)
    problems.push('Delimiter detection is ambiguous. Select the delimiter and update preview.');
  const slash = String(form.get('slash_order_confirmed') ?? '');
  if (mapping.date.format.includes('/') && slash !== 'yes') problems.push('Confirm the selected slash date order.');
  const collision = String(form.get('collision') ?? ''),
    ack = String(form.get('acknowledge_other_account') ?? '');
  requireInput(['', 'keep_existing', 'additional'].includes(collision), 'Invalid collision decision');
  let state: ImportState = { overlaps: [], otherAccounts: [] };
  if (!preview.issues.length && parsed.rows.length) state = await currentState(env, parsed, bytes);
  if (state.overlaps.length && !collision) problems.push('Confirm overlapping transactions before import.');
  if (state.otherAccounts.length && ack !== 'yes')
    problems.push('Similar transactions exist in another account. Confirm account selection.');
  const encoded = encodedBytes(bytes);
  const common =
    hidden('csv', encoded) +
    hidden('account_choice', JSON.stringify(account)) +
    hidden('mapping', JSON.stringify(mapping));
  // No layout chosen yet: the columns come first. Row errors from a guessed mapping would only mislead.
  const unmapped = !provided && !selected && !autoPreset && !proposed && problems.length > 0;
  const issues = unmapped ? [] : preview.issues;
  const errors = issues.length + problems.length;
  const totals = new Map<string, bigint>();
  for (const { value: r } of preview.rows)
    totals.set(r.currency, (totals.get(r.currency) ?? 0n) + BigInt(r.amount_minor));
  const dates = preview.rows.map((r) => r.value.booking_date).sort();
  const preset = suggestions.find((p) => p.id === shownPresetId);
  const status = unmapped
    ? `<p class="lede">${errors === 1 ? '1 problem' : `${errors} problems`} to fix first.</p>`
    : `<p class="lede"><strong>${preset ? `We recognised a ${escape(presetLabel(preset).replace(' (CSV layout)', ''))} export. ` : proposed ? 'Columns read automatically. ' : ''}${preview.rows.length === 1 ? '1 payment' : `${preview.rows.length} payments`}${dates.length ? ` from ${day(dates[0])} to ${day(dates.at(-1))}` : ''}.</strong> ${errors ? `${errors === 1 ? '1 problem' : `${errors} problems`} to fix first.` : 'No problems found.'} <span class="small">Net total ${[...totals].map(([c, v]) => `${escape(c)} ${money(v, c)}`).join(' · ') || '0'}.</span></p>`;
  const warnings =
    errors > 0
      ? `<div class="alert" role="alert">${problems.map((e) => `<p class="warning">${escape(e)}</p>`).join('')}${issues
          .slice(0, 100)
          .map(
            (e) =>
              `<p class="warning">Row ${e.record}, ${escape(ISSUE_FIELDS[e.field] ?? e.field)}: ${escape(e.message)}</p>`,
          )
          .join('')}<p class="small">Adjust how we read the file below, then check it again.</p></div>`
      : '';
  const exclusions = `<p class="small">Shows up to 50 rows; the whole file is checked. Column names on row ${mapping.headerRecord + 1}. Rows left out: ${preview.excludedRecords.length ? preview.excludedRecords.join(', ') : 'none'}.</p>`;
  const table = `<div class="scroll"><table class="stack"><caption class="vh">Payments read from the file</caption><thead><tr><th scope="col">Paid to</th><th scope="col">Row</th><th scope="col">Date</th><th scope="col" class="n">Amount</th><th scope="col">Currency</th></tr></thead><tbody>${preview.rows
    .slice(0, 50)
    .map(
      ({ record, value: r }) =>
        `<tr><td class="lead">${escape(r.merchant)}</td><td data-label="Row">${record}</td><td data-label="Date">${day(r.booking_date)}</td><td class="n" data-label="Amount">${money(r.amount_minor, r.currency)}</td><td data-label="Currency">${escape(r.currency)}</td></tr>`,
    )
    .join('')}</tbody></table></div>`;
  const editor = `<details${errors ? ' open' : ''}><summary>The columns look wrong? Adjust how we read the file</summary><div class="body">${hidden('editor', '1')}${hidden('current_preset', shownPresetId)}<div class="fields">${options('preset_id', [{ value: '', label: 'Choose layout' }, { value: 'custom', label: 'Custom mapping' }, ...suggestions.map((p) => ({ value: p.id, label: presetLabel(p) }))], shownPresetId)}</div>${mappingEditor(mapping, layout.headers, currency, slash === 'yes')}<fieldset><legend>Already imported?</legend><div class="fields">${options(
    'collision',
    [
      { value: '', label: 'Ask me' },
      { value: 'keep_existing', label: 'Skip the ones already imported' },
      { value: 'additional', label: 'Import them as extra payments' },
    ],
    collision,
  )}</div>${state.overlaps.length ? `<p class="warning">${state.overlaps.length} payments without a bank ID look the same as ones from another file. Skip them, or import them as extra payments.</p>` : ''}<label class="check"><input type="checkbox" name="acknowledge_other_account" value="yes"${ack === 'yes' ? ' checked' : ''}>I checked the account. Similar payments in my other accounts are separate payments.</label></fieldset><button class="btn ${errors ? 'primary' : 'secondary'}" formaction="/imports/csv/preview">Check again</button></div></details>`;
  let confirm = '',
    proof = '';
  if (!errors) {
    const fields = new FormData();
    for (const [k, v] of Object.entries({
      mapping: JSON.stringify(mapping),
      account_choice: JSON.stringify(account),
      collision,
      acknowledge_other_account: ack,
      slash_order_confirmed: slash,
      conflicts: await hash(JSON.stringify(state)),
      expires: String(Date.now() + 30 * 60 * 1000),
    }))
      fields.set(k, v);
    fields.set('preview_token', await signature(env, fields, bytes));
    proof = [...fields]
      .filter(([k]) => ['conflicts', 'expires', 'preview_token'].includes(k))
      .map(([k, v]) => hidden(k, v))
      .join('');
    const accountName =
      account.kind === 'new'
        ? account.label
        : await env.DB.prepare('SELECT label FROM accounts WHERE id=?').bind(account.id).first('label');
    confirm = `<div class="card active"><h2>Import into ${escape(accountName)}</h2><p class="hint">Only what you see here is imported.</p><button class="btn primary" formaction="/imports/csv/confirm">Import ${preview.rows.length === 1 ? '1 payment' : `${preview.rows.length} payments`}</button></div>`;
  }
  const markup = `<form action="${errors ? '/imports/csv/preview' : '/imports/csv/confirm'}" method="post" enctype="multipart/form-data">${common}${proof}${unmapped ? editor : `${table}${exclusions}${confirm}${editor}`}</form>`;
  return page('import', wizard(2) + status + warnings + markup, errors ? 422 : 200, env, {
    detail: 'Check the file',
    head: pageHead('Check the file'),
  });
}
// A statement that states its own totals must add up to them before it is imported.
export function totalsProblems(
  stated: ReturnType<typeof statedTotals>,
  rows: ReturnType<typeof parseCsv>['rows'],
): string[] {
  const problems: string[] = [];
  const currencies = new Set(rows.map((r) => r.value.currency));
  for (const side of ['credit', 'debit'] as const) {
    const claim = stated[side];
    if (!claim) continue;
    const read = rows.filter((r) => (side === 'credit' ? r.value.amount_minor > 0 : r.value.amount_minor < 0));
    const sum = read.reduce((total, r) => total + BigInt(r.value.amount_minor), 0n);
    const code = [...currencies][0];
    let claimed: bigint | null = null;
    if (claim.sum !== null && currencies.size === 1 && code) {
      try {
        claimed = BigInt(minor(claim.sum, code));
      } catch {
        claimed = null;
      }
    }
    const word = side === 'credit' ? 'money in' : 'money out';
    if (claim.count !== null && claim.count !== read.length)
      problems.push(`The file lists ${claim.count} ${word} payments, but ${read.length} were read.`);
    else if (claimed !== null && claimed !== sum)
      problems.push(
        `The file totals ${word} at ${money(claimed, code!)} ${code}, but the rows add up to ${money(sum, code!)} ${code}.`,
      );
  }
  // Opening balance plus every row must come to the closing balance.
  const code = [...currencies][0],
    { opening, closing } = stated.balance ?? {};
  if (opening && closing && currencies.size === 1 && code) {
    try {
      const start = BigInt(minor(opening, code)),
        end = BigInt(minor(closing, code));
      const net = rows.reduce((total, r) => total + BigInt(r.value.amount_minor), 0n);
      if (start + net !== end)
        problems.push(
          `The file's balance goes from ${money(start, code)} to ${money(end, code)} ${code}, but the rows add up to ${money(net, code)} ${code}.`,
        );
    } catch {}
  }
  return problems;
}
export function fallbackMapping(currency: string): CsvMapping {
  return {
    version: 1,
    encoding: 'utf-8',
    delimiter: ';',
    headerRecord: 0,
    trailingRecords: 0,
    date: { column: 0, format: 'ISO', time: 'optional' },
    number: { decimal: '.', grouping: '' },
    amount: { kind: 'signed', column: 1, outgoing: 'negative' },
    currency: { kind: 'default', currency },
    merchant: 2,
    reference: null,
    externalId: null,
    original: null,
  };
}
export async function confirmImport(env: Env, form: FormData): Promise<Response> {
  const token = String(form.get('preview_token') ?? ''),
    expires = Number(form.get('expires'));
  requireInput(
    /^[a-f0-9]{64}$/.test(token) &&
      Number.isSafeInteger(expires) &&
      expires >= Date.now() &&
      expires <= Date.now() + 31 * 60 * 1000,
    'Preview expired or missing. Preview again.',
    409,
  );
  const bytes = await readBytes(env, form),
    expected = await signature(env, form, bytes);
  requireInput(
    crypto.subtle.timingSafeEqual(new TextEncoder().encode(token), new TextEncoder().encode(expected)),
    'Preview settings changed. Preview again.',
    409,
  );
  const mapping = validateMapping(json(form.get('mapping'))),
    account = await accountFromForm(env, form);
  if (form.has('signed_outgoing')) {
    try {
      requireInput(
        JSON.stringify(mappingFromEditor(form, mapping)) === JSON.stringify(mapping) &&
          String(form.get('preset_id') ?? '') === String(form.get('current_preset') ?? ''),
        'Mapping fields changed',
      );
    } catch {
      throw new InputError('Mapping fields changed. Update preview before confirming.', 409);
    }
  }
  const preview = parseCsv(bytes, mapping),
    parsed = normalizedImport(preview, account.id);
  requireInput(!preview.issues.length && parsed.rows.length, 'Fix CSV errors before import');
  const identity = await importIdentity(account.id, bytes);
  const prior = await env.DB.prepare('SELECT id,status,account_key FROM imports WHERE original_key=?')
    .bind(identity.key)
    .first<{ id: string; status: string; account_key: string }>();
  requireInput(!prior || prior.account_key === account.id, 'This file already belongs to another account', 409);
  if (prior?.status !== 'complete')
    requireInput(
      (await hash(JSON.stringify(await currentState(env, parsed, bytes)))) === String(form.get('conflicts') ?? ''),
      'Import conflicts changed. Preview again.',
      409,
    );
  const at = undoAt();
  const importedId = await importBankCsv(env, {
    bytes,
    parsed,
    mapping,
    accountChoice: account,
    collision: String(form.get('collision') ?? ''),
    crossAccountAcknowledged: form.get('acknowledge_other_account') === 'yes',
    at,
  });
  // A layout the owner worked out by hand is kept for the next file of this bank.
  if (['', 'custom'].includes(String(form.get('current_preset') ?? '')))
    await saveLayout(env, preview.headers, mapping, account.kind === 'new' ? account.bank_name : '', account.id);
  return importedResponse(env, {
    importId: importedId,
    rows: parsed.rows,
    replayed: prior?.status === 'complete',
    at,
    anyway: 0,
    similar: 0,
  });
}
// Keeps a layout under its header fingerprint, named after the bank and the columns, so the next
// file with these columns needs no detection. A layout already kept for them is left alone, and a
// refusal to save never fails the import.
export async function saveLayout(
  env: Env,
  headers: string[],
  mapping: CsvMapping,
  bank: string,
  account: string,
): Promise<void> {
  try {
    if ((await savedPresets(env, headers)).length) return;
    const name = (
      bank ||
      (await env.DB.prepare('SELECT bank_name FROM accounts WHERE id=?').bind(account).first<string>('bank_name')) ||
      ''
    ).trim();
    const fingerprint = (await headerFingerprint(headers)).slice(0, 6);
    await savePreset(env, { bank_name: name || 'My bank', name: `Layout ${fingerprint}`, headers, mapping });
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
  }
}
// The redirect after an import: what was added and skipped, where this file's payments out stand,
// and what the banner may offer (Undo, Import anyway). at: the time the import's Undo is logged under.
export async function importedResponse(
  env: Env,
  a: {
    importId: string;
    rows: ParsedImport['rows'];
    replayed: boolean;
    at: UndoAt;
    anyway: number;
    similar: number;
  },
): Promise<Response> {
  const inserted = a.replayed
    ? 0
    : Number(
        await env.DB.prepare('SELECT count(*) n FROM bank_transactions WHERE import_id=?').bind(a.importId).first('n'),
      );
  const skipped = a.replayed ? 0 : a.rows.length - inserted;
  // Rows a rule left open that read like a transfer to a person: one capped Clef question.
  if (inserted) await exemptByClef(env, a.importId);
  // Where this file's payments out stand, for the banner.
  const tally = inserted
    ? ((await env.DB.prepare(
        `SELECT total(t.receipt_id IS NOT NULL) matched,total(t.receipt_id IS NULL AND t.receipt_required=0) exempt,total(t.receipt_id IS NULL AND t.receipt_required=1) missing FROM bank_transactions t WHERE t.import_id=? AND t.amount_minor<0 AND NOT EXISTS(SELECT 1 FROM internal_transfers p WHERE p.debit_id=t.id)`,
      )
        .bind(a.importId)
        .first<Record<string, number>>()) ?? {})
    : {};
  return new Response(null, {
    status: 303,
    headers: {
      Location: withDone('imported', `/payments?month=${a.rows[0]!.booking_date.slice(0, 7)}`, {
        inserted,
        skipped,
        replayed: a.replayed ? a.rows.length : 0,
        auto: tally.matched ?? 0,
        np: tally.exempt ?? 0,
        missing: tally.missing ?? 0,
        anyway: a.replayed ? 0 : a.anyway,
        similar: a.replayed ? 0 : a.similar,
        imp: a.importId,
        ...(inserted && !a.replayed ? { at: a.at, op: 'import' } : {}),
      }),
    },
  });
}
