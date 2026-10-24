// Settings > Setup: the editable form over src/settings.ts, its save and
// reset handlers. Field names are the setting keys themselves.
import type { Env } from './env';
import { config, ConfigError, parseConfig, TUNING_VARS } from './config';
import { EXPONENTS, InputError, requireInput, type Tuning } from './domain';
import {
  applied,
  currentValue,
  DEPLOY_ONLY,
  deployEnv,
  deployValue,
  FIELD,
  FIELDS,
  GRACE_DAYS,
  GROUPS,
  history,
  normalizeValue,
  PREVIOUS_INVOICES,
  previousInvoicesAddress,
  put,
  saveChanges,
  SETTING_VALUE_LIMIT,
  sourceOf,
  withSettings,
  type Change,
  type Field,
  type Group,
  type SettingKey,
} from './settings';
import { reconcile } from './banking';
import { day, escape } from './ui';

const tuningField = (key: SettingKey) =>
  (Object.entries(TUNING_VARS).find(([, v]) => v.name === key)?.[0] ?? null) as keyof Tuning | null;
function productsJson(products: readonly { id: string; label: string }[]): string {
  return JSON.stringify(products.map((p) => ({ id: p.id, label: p.label })));
}
// The value in force, in the same form a submission is normalised to.
export function effective(env: Env, field: Field): string {
  const settings = config(env);
  const tuning = tuningField(field.key);
  if (tuning) return String(settings.tuning[tuning]);
  if (field.kind === 'products') return productsJson(settings.products);
  if (field.kind === 'product') return settings.defaultProduct;
  if (field.kind === 'currency') return settings.defaultCurrency;
  const value = currentValue(env, field.key);
  return value ? normalizeValue(field, value) : '';
}
function submittedProducts(env: Env, form: FormData): string {
  const ids = form.getAll('product_id').map(String),
    labels = form.getAll('product_label').map(String),
    removed = new Set(form.getAll('product_remove').map(String));
  requireInput(ids.length === labels.length && ids.length <= 200, 'Invalid parts of the business');
  const known = new Set<string>(config(env).products.map((p) => p.id));
  const products = ids
    .map((id, i) => ({ id: id.trim(), label: (labels[i] ?? '').trim() }))
    .filter((p) => known.has(p.id) && !removed.has(p.id))
    .map((p) => ({ id: p.id, label: p.label || p.id }));
  const added = String(form.get('product_new') ?? '').trim();
  if (added) {
    requireInput(!products.some((p) => p.id.toLowerCase() === added.toLowerCase()), `“${added}” is already a part`);
    products.push({ id: added, label: added });
  }
  requireInput(products.length > 0, 'Keep at least one part of the business');
  return productsJson(products);
}
// Who is saving: the Access email, or "password" in password mode.
export async function saveSetup(env: Env, form: FormData, who: string): Promise<string> {
  const group = String(form.get('group') ?? '') as Group;
  requireInput(
    GROUPS.some((g) => g.id === group),
    'Unknown settings group',
  );
  const revision = Number(form.get('revision') ?? -1);
  requireInput(Number.isSafeInteger(revision) && revision >= 0, 'Reload the page and try again');
  const base = deployEnv(env);
  const candidate = Object.create(base) as Record<string, unknown>;
  for (const [key, row] of applied(env).app) put(candidate, key, row.value);
  const changes: Change[] = [];
  for (const field of FIELDS.filter((f) => f.group === group)) {
    let submitted: string;
    if (field.kind === 'products') {
      if (!form.has('product_id')) continue;
      submitted = submittedProducts(env, form);
    } else {
      if (!form.has(field.key)) continue;
      const raw = String(form.get(field.key));
      requireInput(raw.length <= (field.maxLength ?? 400) * 2, `${field.label} is too long`);
      submitted = normalizeValue(field, raw);
    }
    // settings.value_json holds at most SETTING_VALUE_LIMIT characters (a CHECK
    // in the table), so a longer value is refused here, not by a failed write.
    requireInput(JSON.stringify(submitted).length <= SETTING_VALUE_LIMIT, `${field.label} is too long`);
    if (submitted === effective(env, field)) continue;
    if (field.confirm && form.get(`confirm_${field.key}`) !== 'yes')
      throw new InputError(`To change ${field.label}, tick “${field.confirm}”.`);
    const deploy = deployValue(env, field.key);
    const deployNormal = deploy.trim() ? normalizeValue(field, deploy) : '';
    // Back to the deploy value (or, for numbers left empty, the default):
    // drop the app value so a later deploy change takes effect again.
    const value = submitted === deployNormal || (field.kind === 'number' && !submitted) ? null : submitted;
    put(candidate, field.key, value ?? deploy);
    const row = applied(env).app.get(field.key);
    if (value === null && !row) continue;
    changes.push({ key: field.key, value, old: row?.value ?? null });
  }
  if (!changes.length) return `/settings?saved=${group}#setup-${group}`;
  let next;
  try {
    next = parseConfig(candidate as Partial<Env>);
  } catch (error) {
    if (error instanceof ConfigError)
      throw new InputError(error.message.replace(/^Configuration error: |\. See docs.*$/g, ''));
    throw error;
  }
  if (changes.some((c) => c.key === 'PRODUCTS_JSON')) {
    const kept = new Set(next.products.map((p) => p.id));
    const gone = config(env).products.filter((p) => !kept.has(p.id));
    for (const product of gone) {
      const used = await base.DB.prepare(
        'SELECT (SELECT COUNT(*) FROM receipts WHERE product=?)+(SELECT COUNT(*) FROM vendor_rules WHERE product=?) AS n',
      )
        .bind(product.id, product.id)
        .first<{ n: number }>();
      requireInput(
        !used?.n,
        `“${product.label}” is used by ${used?.n} receipt${used?.n === 1 ? '' : 's'} or rule${used?.n === 1 ? '' : 's'}, so it can’t be removed. Rename it instead.`,
      );
    }
  }
  const before = config(env).invoicesAddress;
  if (changes.some((c) => c.key === 'INVOICES_ADDRESS') && before && before !== next.invoicesAddress)
    changes.push({
      key: PREVIOUS_INVOICES,
      value: JSON.stringify({ address: before, until: new Date(Date.now() + GRACE_DAYS * 86400000).toISOString() }),
      old: null,
    });
  await saveChanges(env, changes, who, revision);
  await afterSave(base, changes);
  const routing = changes.some((c) => c.key === 'RECEIPT_ADDRESS' || c.key === 'INVOICES_ADDRESS');
  return `/settings?saved=${group}${routing ? '&routing=1' : ''}#setup-${group}`;
}
export async function resetSetting(env: Env, form: FormData, who: string): Promise<string> {
  const key = String(form.get('reset') ?? '') as SettingKey,
    field = FIELD.get(key);
  requireInput(!!field, 'Unknown setting');
  const revision = Number(form.get('revision') ?? -1);
  requireInput(Number.isSafeInteger(revision) && revision >= 0, 'Reload the page and try again');
  const state = applied(env);
  const stored = state.app.get(key)?.value ?? state.invalid.get(key)?.value;
  if (stored === undefined) return `/settings#setup-${field!.group}`;
  const changes: Change[] = [{ key, value: null, old: stored }];
  if (key === 'INVOICES_ADDRESS') {
    const before = config(env).invoicesAddress,
      after = deployValue(env, key).trim().toLowerCase();
    if (before && before !== after)
      changes.push({
        key: PREVIOUS_INVOICES,
        value: JSON.stringify({ address: before, until: new Date(Date.now() + GRACE_DAYS * 86400000).toISOString() }),
        old: null,
      });
  }
  // A reset leaves a config the deploy alone would produce, which is valid
  // whenever the app is running at all.
  await saveChanges(env, changes, who, revision);
  await afterSave(deployEnv(env), changes);
  return `/settings?reset=${encodeURIComponent(key)}#setup-${field!.group}`;
}
// Wider or narrower matching windows can pair payments that were waiting.
async function afterSave(base: Env, changes: readonly Change[]): Promise<void> {
  const matching = changes.some((c) => {
    const f = FIELD.get(c.key as SettingKey);
    return f && (f.group === 'review' || f.key === 'PAYMENT_TERMS_DAYS');
  });
  if (matching) await reconcile(await withSettings(base));
}

// ---------- View ----------
// Each field is one row: the label, then the control (its help is a tooltip)
// and, when set here, Reset. One Save per group.
// A pattern of the current value: with the form's novalidate, the field turns
// :invalid as soon as it differs, which is when its confirm box shows (CSS).
function unchanged(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
}
function control(env: Env, field: Field): string {
  const value = effective(env, field),
    name = escape(field.key),
    attrs = `id="f-${name}" title="${escape(field.help)}"${field.confirm ? ` pattern="${escape(unchanged(value))}"${value ? ' required' : ''}` : ''}`;
  const settings = config(env);
  switch (field.kind) {
    case 'textarea':
      return `<textarea name="${name}" rows="2" maxlength="${field.maxLength ?? 300}" ${attrs}>${escape(value)}</textarea>`;
    case 'list':
      return `<textarea name="${name}" rows="${Math.min(8, Math.max(2, value.split(', ').length))}" ${attrs} spellcheck="false" autocomplete="off">${escape(value.split(', ').filter(Boolean).join('\n'))}</textarea>`;
    case 'product':
      return `<select name="${name}" ${attrs}>${settings.products.map((p) => `<option value="${escape(p.id)}"${p.id === settings.defaultProduct ? ' selected' : ''}>${escape(p.label)}</option>`).join('')}</select>`;
    case 'currency':
      return `<select name="${name}" ${attrs}>${Object.keys(EXPONENTS)
        .map((c) => `<option${c === value ? ' selected' : ''}>${c}</option>`)
        .join('')}</select>`;
    case 'number':
      return `<input name="${name}" value="${escape(value)}" type="number" inputmode="decimal" min="${field.min}" max="${field.max}" step="${field.step}" ${attrs}>`;
    case 'products':
      return `<ul class="plain parts" role="group" aria-labelledby="${name}-label">${settings.products
        .map(
          (p) =>
            `<li><input type="hidden" name="product_id" value="${escape(p.id)}"><label class="vh" for="part-${escape(p.id)}">Name for ${escape(p.label)}</label><input id="part-${escape(p.id)}" name="product_label" value="${escape(p.label)}" maxlength="100"><label class="check"><input type="checkbox" name="product_remove" value="${escape(p.id)}"> Remove<span class="vh"> ${escape(p.label)}</span></label></li>`,
        )
        .join(
          '',
        )}<li><label class="vh" for="part-new">Add a part</label><input id="part-new" name="product_new" placeholder="Add a part, for example Consulting" maxlength="100"></li></ul>`;
    default:
      return `<input name="${name}" value="${escape(value)}" type="${field.kind === 'email' ? 'email' : 'text'}"${field.maxLength ? ` maxlength="${field.maxLength}"` : ''} ${attrs}${field.kind === 'email' ? ' autocomplete="off" spellcheck="false"' : ''}>`;
  }
}
// Reset submits a small form of its own (resetForms), so Enter in a field
// still submits Save rather than the first Reset in the group.
function resetButton(field: Field, text: string): string {
  return `<button class="linkbtn" form="reset-${field.key}" name="reset" value="${field.key}">${text}<span class="vh"> ${escape(field.label)}</span></button>`;
}
function fieldRow(env: Env, field: Field): string {
  const state = applied(env),
    source = sourceOf(env, field.key),
    invalid = state.invalid.get(field.key),
    deploy = deployValue(env, field.key).trim(),
    key = field.key,
    label = escape(field.label);
  const name =
    field.kind === 'products'
      ? `<span class="flabel" id="${key}-label">${label}</span>`
      : `<label for="f-${key}">${label}</label>`;
  const bad = invalid
    ? `<p class="warning" role="alert">The saved value <code>${escape(invalid.value.slice(0, 80))}</code> isn’t valid (${escape(invalid.error)}), so the ${deploy ? 'deploy value' : 'default'} is used. ${resetButton(field, 'Clear it')}</p>`
    : '';
  const confirm = field.confirm
    ? `<div class="confirm"><label class="check"><input type="checkbox" name="confirm_${key}" value="yes"> ${escape(field.confirm)}</label></div>`
    : '';
  const meta = source === 'app' ? `<p class="meta">${resetButton(field, 'Reset')}</p>` : '';
  return `<div class="srow${invalid ? ' bad' : ''}"><div class="sl">${name}</div><div class="sc">${control(env, field)}${bad}${confirm}${meta}</div></div>`;
}
function resetForms(env: Env, fields: readonly Field[]): string {
  const state = applied(env);
  return fields
    .filter((f) => state.app.has(f.key) || state.invalid.has(f.key))
    .map(
      (f) =>
        `<form id="reset-${f.key}" action="/settings/setup/reset" method="post" hidden><input type="hidden" name="revision" value="${state.revision}"></form>`,
    )
    .join('');
}
// Allowed senders are edited row by row in Senders, so Email leaves the list out.
function groupForm(env: Env, group: (typeof GROUPS)[number], card: boolean): string {
  const fields = FIELDS.filter((f) => f.group === group.id && f.key !== 'ALLOWED_SENDER_EMAILS');
  return `<form action="/settings/setup" method="post" class="setup-form${card ? ' card' : ''}"${fields.some((f) => f.confirm) ? ' novalidate' : ''}><input type="hidden" name="group" value="${group.id}"><input type="hidden" name="revision" value="${applied(env).revision}">${fields.map((f) => fieldRow(env, f)).join('')}<div class="save"><button class="btn secondary">Save</button></div></form>${resetForms(env, fields)}`;
}
const AUDIT_LABEL = new Map(FIELDS.map((f) => [f.key as string, f.label]));
function auditValue(json: string | null, key: string): string {
  if (json === null) return '<em>deploy/default</em>';
  let value: unknown = json;
  try {
    value = JSON.parse(json);
  } catch {
    /* shown raw */
  }
  if (key === 'PRODUCTS_JSON' && typeof value === 'string')
    try {
      value = (JSON.parse(value) as { label: string }[]).map((p) => p.label).join(', ');
    } catch {
      /* shown raw */
    }
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text ? `<code>${escape(text.length > 80 ? text.slice(0, 77) + '…' : text)}</code>` : '<em>empty</em>';
}
// The editable groups, each with its own save notice, and the Advanced
// section: review tuning, integrations, deploy-only values and history.
export async function setupParts(
  env: Env,
  params: URLSearchParams,
): Promise<{ business: string; email: string; accountant: string; advanced: string }> {
  const settings = config(env),
    state = applied(env),
    rows = await history(env);
  const reset = params.get('reset'),
    saved = params.get('saved') ?? (reset ? (FIELD.get(reset as SettingKey)?.group ?? null) : null);
  const notice = (group: Group) =>
    group === 'email' && params.get('routing') === '1'
      ? `<div class="alert" role="status"><p><strong>Saved. Now update Cloudflare Email Routing.</strong> The app can’t do this for you.</p><ol><li>In Cloudflare, Email &gt; Email Routing &gt; Routing rules, add a custom address with the action <strong>Send to a Worker</strong> for ${[
          settings.receiptAddress,
          settings.invoicesAddress,
        ]
          .filter(Boolean)
          .map((a) => `<code>${escape(a)}</code>`)
          .join(
            ' and ',
          )}.</li><li>Send a test from an allowed address and check it arrives.</li><li>Remove the rule for the old address. ${previousInvoicesAddress(env) ? `Mail to <code>${escape(previousInvoicesAddress(env))}</code> still counts as an invoice for ${GRACE_DAYS} days.` : ''}</li></ol></div>`
      : saved === group
        ? `<p class="banner" role="status">${reset ? `${escape(FIELD.get(reset as SettingKey)?.label ?? 'Setting')} is back to the ${sourceOf(env, reset as SettingKey) === 'deploy' ? 'deploy value' : 'default'}.` : 'Saved.'}</p>`
        : '';
  const group = (id: Group) => GROUPS.find((g) => g.id === id)!;
  const top = (id: Group) => `${notice(id)}${groupForm(env, group(id), false)}`;
  const fold = (id: Group) => {
    const changed = FIELDS.some((f) => f.group === id && (state.app.has(f.key) || state.invalid.has(f.key)));
    return `<details class="group" id="setup-${id}"${changed || saved === id ? ' open' : ''}><summary>${escape(group(id).title)}</summary><div class="body">${notice(id)}${groupForm(env, group(id), false)}</div></details>`;
  };
  const base = deployEnv(env) as unknown as Record<string, unknown>;
  const shown = (key: string, secret?: boolean): string => {
    const raw = typeof base[key] === 'string' ? (base[key] as string).trim() : '';
    if (secret) return raw ? 'Set' : 'Not set';
    if (key === 'APP_BASE_PATH') return raw ? `<code>${escape(raw)}</code>` : 'Site root';
    if (key === 'AI_MODE') return raw === 'live' ? 'Workers AI' : escape(raw || 'Not set');
    if (key === 'ACCESS_ALLOWED_EMAILS')
      return settings.access ? escape([...settings.access.emails].join(', ')) : 'Off (password sign-in)';
    return raw ? `<code>${escape(raw)}</code>` : 'Not set';
  };
  const hasOneDrive = !!settings.oneDrive || settings.oneDriveIncomplete;
  const deployOnly = `<details class="group" id="setup-deploy"><summary>Set at deploy</summary><div class="body"><div class="scroll"><table><caption class="vh">Set at deploy</caption><thead><tr><th scope="col">Setting</th><th scope="col">Value</th></tr></thead><tbody>${DEPLOY_ONLY.filter(
    (d) =>
      (!(d.key === 'AUTH_USERNAME' || d.key === 'NUITS_PASSWORD') || !settings.access) &&
      (hasOneDrive || !/^(MS_|ONEDRIVE_)/.test(d.key)),
  )
    .map(
      (d) => `<tr><th scope="row">${escape(d.label)} <code>${d.key}</code></th><td>${shown(d.key, d.secret)}</td></tr>`,
    )
    .join('')}</tbody></table></div></div></details>`;
  const audit = `<details class="group" id="setup-history"><summary>Change history${rows.length ? ` (${rows.length}${rows.length === 20 ? '+' : ''})` : ''}</summary><div class="body">${
    rows.length
      ? `<div class="scroll"><table><caption class="vh">Change history</caption><thead><tr><th scope="col">When</th><th scope="col">Setting</th><th scope="col">From</th><th scope="col">To</th><th scope="col">By</th></tr></thead><tbody>${rows
          .map(
            (r) =>
              `<tr><td>${escape(day(r.changed_at))} ${escape(r.changed_at.slice(11, 16))} UTC</td><td>${escape(AUDIT_LABEL.get(r.key) ?? r.key)}</td><td>${auditValue(r.old_json, r.key)}</td><td>${auditValue(r.new_json, r.key)}</td><td>${escape(r.changed_by)}</td></tr>`,
          )
          .join('')}</tbody></table></div>`
      : '<p>Nothing yet.</p>'
  }</div></details>`;
  return {
    business: top('business'),
    email: top('email'),
    accountant: top('accountant'),
    advanced: `<div class="folds">${fold('review')}${fold('integrations')}${deployOnly}${audit}</div>`,
  };
}
