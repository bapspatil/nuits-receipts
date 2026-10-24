import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { expect, test } from 'vitest';
import worker from '../src/index';
import { config, ConfigError, parseConfig, parseTuning } from '../src/config';
import { DEFAULT_TUNING, withinWindow } from '../src/domain';
import { kindFor } from '../src/receipts';
import { applied, layer, SETTING_VALUE_LIMIT, sourceOf, withSettings, type Row } from '../src/settings';
import { DATA_LINE } from '../src/ui';
import type { Env } from '../src/env';
import { locationOf, request, signed } from './helpers';

const page = async () => (await request('/settings')).text();
const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
// Like a browser: every field of the group's form, repeated names included.
function groupForm(html: string, group: string): FormData {
  const start = html.indexOf(`id="setup-${group}"`),
    block = html.slice(html.indexOf('<form', start), html.indexOf('</form>', start));
  const form = new FormData();
  const attr = (tag: string, name: string) => {
    const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
    return m ? decode(m[1]!) : null;
  };
  for (const [tag] of block.matchAll(/<input\b[^>]*>/g)) {
    const name = attr(tag, 'name');
    if (!name || (attr(tag, 'type') === 'checkbox' && !/\bchecked\b/.test(tag))) continue;
    form.append(name, attr(tag, 'value') ?? '');
  }
  for (const m of block.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g))
    form.append(attr(m[1]!, 'name')!, decode(m[2]!));
  for (const m of block.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
    const options = [...m[2]!.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)];
    const picked = options.find((o) => /\bselected\b/.test(o[1]!)) ?? options[0]!;
    form.append(attr(m[1]!, 'name')!, attr(picked[1]!, 'value') ?? decode(picked[2]!));
  }
  return form;
}
async function save(fields: Record<string, string | string[]>, group: string, origin = 'http://localhost') {
  const form = groupForm(await page(), group);
  for (const [key, value] of Object.entries(fields)) {
    form.delete(key);
    for (const v of Array.isArray(value) ? value : [value]) form.append(key, v);
  }
  return request('/settings/setup', { method: 'POST', body: form, headers: { Origin: origin } });
}
const rows = async () =>
  (await env.DB.prepare("SELECT key,value_json,updated_by FROM settings WHERE key<>'_FEEDBACK_KEY' ORDER BY key").all())
    .results;
const audit = async () =>
  (
    await env.DB.prepare(
      "SELECT key,old_json,new_json,changed_by FROM settings_audit WHERE key<>'_revision' ORDER BY id",
    ).all()
  ).results;
const row = (key: string, value: string): Row => ({
  key,
  value_json: JSON.stringify(value),
  updated_at: '2026-10-22T10:00:00.000Z',
  updated_by: 'owner@example.com',
});

test('with nothing saved, every value comes from the deploy or the default', async () => {
  const layered = await withSettings(env);
  expect(config(layered)).toEqual(parseConfig(env));
  expect(sourceOf(layered, 'SEND_HINT')).toBe('default');
  expect(sourceOf(layered, 'INVOICES_ADDRESS')).toBe('deploy');
  const html = await page();
  expect(html).toContain('<summary><h2>Business</h2>');
  expect(html).toContain('<summary><h2>Email</h2><span class="sum">receipts@example.com</span></summary>');
  expect(html).toContain('<summary><h2>Export</h2>');
  expect(html).toContain('<summary>Review &amp; matching</summary>');
  // A field is its label and control; the help is a tooltip, with no source badge.
  expect(html).toContain('<div class="sl"><label for="f-INVOICES_ADDRESS">Invoice address</label></div>');
  expect(html).toMatch(
    /<label for="f-SEND_HINT">Note under the month download<\/label><\/div><div class="sc"><input name="SEND_HINT" [^>]*title="[^"]+"/,
  );
  expect(html).not.toMatch(/class="src (app|deploy|default)"/);
  expect(html).toContain('Nothing yet.');
  // Deploy-only values are listed read-only, secrets only as set or not.
  expect(html).toContain('<code>APP_BASE_PATH</code>');
  expect(html).not.toContain('local-dummy-password');
  expect(html).not.toMatch(/name="(ACCESS_[A-Z_]+|APP_BASE_PATH|AUTH_USERNAME|NUITS_PASSWORD|AI_MODE)"/);
});

test('a saved value wins over the deploy value, is audited, and Reset goes back', async () => {
  const response = await save({ APP_NAME: 'Example Books', ACCOUNTANT_LABEL: 'ignored: other group' }, 'business');
  expect(response.status).toBe(303);
  expect(locationOf(response)).toBe('/settings?done=settingsSaved&group=business#setup-business');
  expect(await rows()).toEqual([{ key: 'APP_NAME', value_json: '"Example Books"', updated_by: 'password' }]);
  const html = await page();
  expect(html).toContain('Example Books</a>'); // the header brand
  expect(html).toContain('<button class="linkbtn" form="reset-APP_NAME" name="reset" value="APP_NAME">Reset');
  expect(await audit()).toEqual([
    { key: 'APP_NAME', old_json: null, new_json: '"Example Books"', changed_by: 'password' },
  ]);
  expect(html).toContain('Change history (1)');

  // Saving the value that is already in force writes nothing.
  await save({}, 'business');
  expect(await audit()).toHaveLength(1);

  const form = groupForm(html, 'business');
  form.set('reset', 'APP_NAME');
  const reset = await request('/settings/setup/reset', { method: 'POST', body: form });
  expect(reset.status).toBe(303);
  expect(await rows()).toEqual([]);
  expect((await audit()).at(-1)).toEqual({
    key: 'APP_NAME',
    old_json: '"Example Books"',
    new_json: null,
    changed_by: 'password',
  });
  expect(await page()).not.toContain('form="reset-APP_NAME"');
});

test('Reset posts its own small form, so Enter in a field still means Save', async () => {
  await save({ APP_NAME: 'Example Books' }, 'business');
  const html = await page();
  const start = html.indexOf('id="setup-business"'),
    form = html.slice(html.indexOf('<form', start), html.indexOf('</form>', start));
  // Enter submits with the form's first own submit button; form="…" buttons
  // belong to another form.
  const own = [...form.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]).filter((b) => !/\bform="/.test(b));
  expect(own[0]).toBe('<button class="btn secondary">');
  expect(form).toContain('<button class="linkbtn" form="reset-APP_NAME" name="reset" value="APP_NAME">Reset');
  const reset = html.match(
    /<form id="reset-APP_NAME" action="\/settings\/setup\/reset" method="post" hidden>(.*?)<\/form>/,
  )!;
  const body = new FormData();
  body.set('revision', reset[1]!.match(/name="revision" value="(\d+)"/)![1]!);
  body.set('reset', 'APP_NAME');
  const response = await request('/settings/setup/reset', { method: 'POST', body });
  expect(locationOf(response)).toBe(
    '/settings?done=settingReset&label=App+name&group=business&to=deploy#setup-business',
  );
  expect(await rows()).toEqual([]);
  expect(
    await (await request(await signed('/settings?done=settingReset&label=App+name&group=business&to=deploy'))).text(),
  ).toContain('App name is back to the value set when deployed.');
});

test('the page is one fold per section, one Save per group and history tucked away', async () => {
  await save({ APP_NAME: 'Example Books' }, 'business');
  const html = await page();
  const targets = [
    ...html.matchAll(
      /<details class="sect"[^>]*><summary><h2>[^<]+<\/h2>(?:<span class="sum">[^<]*<\/span>)?<\/summary><div class="body" id="([a-z-]+)">/g,
    ),
  ].map((m) => m[1]);
  expect(targets).toEqual([
    'setup-business',
    'setup-email',
    'senders',
    'accounts',
    'rules',
    'setup-accountant',
    ...(config(env).oneDrive ? ['onedrive'] : []),
    'advanced',
    'about',
  ]);
  // Everything starts folded; no side nav, no source legend.
  expect(html).not.toContain('<details class="sect" open>');
  expect(html).not.toContain('class="snav"');
  expect(html).not.toContain('Where values come from');
  // Imports and transfers are bookkeeping, so they moved to Bank; the old anchors say so.
  expect(html).toContain(
    '<p class="small moved" id="imports">Imported statements moved to <a href="/payments#imports">Bank</a>.</p>',
  );
  expect(html).toContain(
    '<p class="small moved" id="transfers">Own-account transfers moved to <a href="/payments#transfers">Bank</a>.</p>',
  );
  // Every group form has exactly one button of its own: Save.
  const forms = [...html.matchAll(/<form action="\/settings\/setup" method="post"[^>]*>([\s\S]*?)<\/form>/g)];
  expect(forms).toHaveLength(5);
  for (const [, body] of forms) {
    const own = [...body!.matchAll(/<button\b([^>]*)>([^<]*)/g)].filter(([, attrs]) => !/\bform="/.test(attrs!));
    expect(own.map(([, , text]) => text)).toEqual(['Save']);
  }
  // Deploy-only values and history start collapsed.
  expect(html).toContain('<details class="group" id="setup-deploy"><summary>Set when deployed</summary>');
  expect(html).toContain('<details class="group" id="setup-history"><summary>Change history (1)</summary>');
  // Allowed senders are edited in Senders only, not as a second list in Email.
  expect(html).not.toContain('name="ALLOWED_SENDER_EMAILS"');
  // Address fields keep their confirm box, shown by CSS only once the value differs.
  expect(html).toMatch(
    /<form action="\/settings\/setup" method="post" class="setup-form" novalidate><input type="hidden" name="group" value="email">/,
  );
  expect(html).toMatch(/id="f-RECEIPT_ADDRESS" title="[^"]+" pattern="receipts@example\\\.com" required/);
  expect(html).toMatch(/id="f-FORWARD_COPY_TO"[^>]*>.*?name="confirm_FORWARD_COPY_TO" value="yes"/);
  expect(html).toContain('.setup-form .srow:has(:invalid) .confirm{display:flex}');
  expect(html).not.toContain('<details class="why"><summary>Why');
});

test('About carries the full notice, the licence and the trademark lines', async () => {
  const about = (await page()).match(/<div class="body" id="about">([\s\S]*?)<\/div><\/details>/)![1]!;
  expect(about).toContain(DATA_LINE.replace("'", '&#39;'));
  expect(DATA_LINE).toBe("Runs in your own Cloudflare account. Nuits doesn't receive or store your data.");
  expect(about).toContain('<strong>No warranty. Not financial, tax or accounting advice.</strong>');
  expect(about).toContain('without warranties or conditions of any kind, as set out in the Apache License 2.0');
  expect(about).toContain('Nothing in this notice limits liability that cannot be limited by law.');
  expect(about).toContain('Nuits Receipts is not affiliated with or endorsed by any of them.');
  expect(about).toContain(
    'Nuits Receipts is an independent project and is not affiliated with or endorsed by Cloudflare.',
  );
  expect(about).toContain('Licence: Apache-2.0.');
  expect(about).not.toMatch(/no access|have access/i);
  const linked = await (
    await worker.fetch(
      new Request('http://localhost/settings', {
        headers: { Authorization: 'Basic ' + btoa('owner:local-dummy-password') },
      }),
      { ...env, SOURCE_REPOSITORY: 'https://example.com/books' } as Env,
    )
  ).text();
  expect(linked).toContain('Licence: <a href="https://example.com/books/blob/main/LICENSE">Apache-2.0</a>.');
});

test('saving the deploy value again removes the app value', async () => {
  await save({ SELLER_NAMES: 'Example Studio Oy, Example Person' }, 'business');
  expect(config(await withSettings(env)).sellerNames).toEqual(['Example Studio Oy', 'Example Person']);
  await save({ SELLER_NAMES: 'Example Studio Oy' }, 'business');
  expect(await rows()).toEqual([]);
  expect(sourceOf(await withSettings(env), 'SELLER_NAMES')).toBe('deploy');
});

test('an invalid saved value is ignored with a warning, never a 503', async () => {
  await env.DB.prepare(
    "INSERT INTO settings VALUES ('EXPORT_PREFIX','\"bad prefix!\"','2026-10-22T10:00:00Z','x'),('APP_NAME','\"Example Books\"','2026-10-22T10:00:00Z','x'),('ACCOUNTANT_LABEL','42','2026-10-22T10:00:00Z','x')",
  ).run();
  const response = await request('/settings');
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain('Example Books</a>');
  expect(html).toMatch(/The saved value <code>bad prefix!<\/code> isn’t valid/);
  const layered = await withSettings(env);
  expect(config(layered).exportPrefix).toBe('receipts');
  expect(config(layered).accountantLabel).toBe('your accountant');
  expect([...applied(layered).invalid.keys()].sort()).toEqual(['ACCOUNTANT_LABEL', 'EXPORT_PREFIX']);
  expect((await request('/')).status).toBe(200);
});

test('deploy-time keys in the table are never read', async () => {
  await env.DB.prepare(
    "INSERT INTO settings VALUES ('APP_BASE_PATH','\"/elsewhere\"','now','x'),('ACCESS_ALLOWED_EMAILS','\"attacker@example.com\"','now','x'),('NUITS_PASSWORD','\"x\"','now','x'),('AI_MODE','\"live\"','now','x')",
  ).run();
  const layered = await withSettings(env);
  expect(layered.APP_BASE_PATH).toBe(env.APP_BASE_PATH);
  expect(layered.NUITS_PASSWORD).toBe(env.NUITS_PASSWORD);
  expect(layered.AI_MODE).toBe('mock');
  expect(config(layered).access).toBeNull();
  expect((await request('/settings')).status).toBe(200);
});

test('risky email settings need the confirm box, and invalid values are refused', async () => {
  const refused = await save({ FORWARD_COPY_TO: 'copy@example.net' }, 'email');
  expect(refused.status).toBe(422);
  expect(await refused.text()).toContain('tick “This address is a verified destination in Email Routing”');
  expect(await rows()).toEqual([]);

  const bad = await save({ FORWARD_COPY_TO: 'not an address', confirm_FORWARD_COPY_TO: 'yes' }, 'email');
  expect(bad.status).toBe(422);
  expect(await bad.text()).toContain('FORWARD_COPY_TO must be a single email address or empty');

  const same = await save({ INVOICES_ADDRESS: 'receipts@example.com', confirm_INVOICES_ADDRESS: 'yes' }, 'email');
  expect(same.status).toBe(422);

  const ok = await save(
    {
      FORWARD_COPY_TO: 'Copy@Example.net',
      confirm_FORWARD_COPY_TO: 'yes',
      ALLOWED_SENDER_EMAILS: 'owner@example.com\nnew@example.org',
      confirm_ALLOWED_SENDER_EMAILS: 'yes',
    },
    'email',
  );
  expect(ok.status).toBe(303);
  const settings = config(await withSettings(env));
  expect(settings.forwardCopyTo).toBe('copy@example.net');
  expect([...settings.allowedSenders]).toEqual(['owner@example.com', 'new@example.org']);
});

test('the email handler reads in-app senders and forward-copy target', async () => {
  await save(
    {
      ALLOWED_SENDER_EMAILS: 'fresh@example.org',
      confirm_ALLOWED_SENDER_EMAILS: 'yes',
      FORWARD_COPY_TO: 'copy@example.net',
      confirm_FORWARD_COPY_TO: 'yes',
    },
    'email',
  );
  const forwarded: string[] = [];
  const mail = (from: string) => ({
    from,
    to: 'receipts@example.com',
    raw: new Response(
      'Authentication-Results: mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass;\r\n' +
        [`From: ${from}`, 'To: receipts@example.com', 'Content-Type: text/plain', '', 'vendor: A'].join('\r\n'),
    ).body!,
    forward: async (to: string) => {
      forwarded.push(to);
      return { messageId: 'x' };
    },
  });
  const count = async () => Number(await env.DB.prepare('SELECT count(*) AS n FROM receipts').first('n'));
  let context = createExecutionContext();
  await worker.email(mail('owner@example.com') as never, env, context);
  await waitOnExecutionContext(context);
  expect(await count()).toBe(0);
  context = createExecutionContext();
  await worker.email(mail('fresh@example.org') as never, env, context);
  await waitOnExecutionContext(context);
  expect(await count()).toBe(1);
  expect(forwarded).toEqual(['copy@example.net', 'copy@example.net']);
});

test('a changed invoice address shows the routing checklist and keeps the old one for 30 days', async () => {
  const response = await save({ INVOICES_ADDRESS: 'sales@example.com', confirm_INVOICES_ADDRESS: 'yes' }, 'email');
  expect(locationOf(response)).toBe('/settings?routing=1&done=settingsSaved&group=email#setup-email');
  const html = await (await request(await signed('/settings?routing=1&done=settingsSaved&group=email'))).text();
  expect(html).toContain('Now update Cloudflare Email Routing');
  expect(html).toContain('<code>sales@example.com</code>');
  expect(html).toContain('Mail to <code>invoices@example.com</code> still counts as an invoice for 30 days.');
  const layered = await withSettings(env);
  expect(kindFor(layered, 'sales@example.com')).toBe('sales');
  expect(kindFor(layered, 'Invoices@Example.com')).toBe('sales');
  expect(kindFor(layered, 'receipts@example.com')).toBe('expense');
  // After the grace period the old address is a receipt address like any other.
  await env.DB.prepare(
    "UPDATE settings SET value_json=json_set(value_json,'$.until','2020-01-01T00:00:00.000Z') WHERE key='INVOICES_ADDRESS_PREVIOUS'",
  ).run();
  expect(kindFor(await withSettings(env), 'invoices@example.com')).toBe('expense');
});

test('a stale form gets 409 and a cross-origin post 403', async () => {
  const html = await page();
  const form = groupForm(html, 'business');
  await save({ APP_NAME: 'First tab' }, 'business');
  form.set('APP_NAME', 'Second tab');
  const stale = await request('/settings/setup', { method: 'POST', body: form });
  expect(stale.status).toBe(409);
  expect(config(await withSettings(env)).appName).toBe('First tab');
  const cross = await save({ APP_NAME: 'Evil' }, 'business', 'https://evil.example');
  expect(cross.status).toBe(403);
  expect(config(await withSettings(env)).appName).toBe('First tab');
});

test('parts of the business: rename and add freely, remove only when unused', async () => {
  await env.DB.prepare(
    "INSERT INTO receipts (id,original_key,filename,media_type,source,received_at,status,product) VALUES ('r1','k','a.pdf','application/pdf','upload','2026-10-01','ready','app')",
  ).run();
  const used = await save({ product_remove: 'app' }, 'business');
  expect(used.status).toBe(422);
  expect(await used.text()).toContain('“App” is used by 1 receipt');
  const ok = await save(
    {
      product_label: ['General', 'Mobile app', 'Website', 'Hosting'],
      product_remove: 'website',
      product_new: 'Consulting',
      DEFAULT_PRODUCT: 'Consulting',
    },
    'business',
  );
  expect(ok.status).toBe(303);
  const settings = config(await withSettings(env));
  expect(settings.products).toEqual([
    { id: 'general', label: 'General' },
    { id: 'app', label: 'Mobile app' },
    { id: 'hosting', label: 'Hosting' },
    { id: 'Consulting', label: 'Consulting' },
  ]);
  expect(settings.defaultProduct).toBe('Consulting');
  const html = await page();
  expect(html).toContain('<option value="Consulting" selected>Consulting</option>');
});

test('advanced thresholds are bounded and change matching', async () => {
  const out = await save({ MATCH_DAYS_AFTER: '500' }, 'review');
  expect(out.status).toBe(422);
  expect(await out.text()).toContain('MATCH_DAYS_AFTER must be a whole number from 1 to 180');
  expect((await save({ REVIEW_MIN_CONFIDENCE: '0.2' }, 'review')).status).toBe(422);
  expect((await save({ MATCH_DAYS_AFTER: '90', REVIEW_MIN_CONFIDENCE: '0.8' }, 'review')).status).toBe(303);
  const tuning = config(await withSettings(env)).tuning;
  expect(tuning).toEqual({ ...DEFAULT_TUNING, matchDaysAfter: 90, minFieldConfidence: 0.8 });
  expect(withinWindow('2026-01-01', '2026-03-01')).toBe(false);
  expect(withinWindow('2026-01-01', '2026-03-01', tuning)).toBe(true);
  // The Advanced fold opens when something in it was changed.
  expect(await page()).toMatch(/<details class="group" id="setup-review" open>/);
  // Leaving a number empty goes back to the deploy value or default.
  await save({ MATCH_DAYS_AFTER: '' }, 'review');
  expect(config(await withSettings(env)).tuning.matchDaysAfter).toBe(45);
});

test('thresholds can also come from Worker vars, validated the same way', () => {
  expect(parseTuning({ PAYMENT_TERMS_DAYS: '14' }).paymentTermsDays).toBe(14);
  expect(() => parseTuning({ MATCH_NAME_SIMILARITY: '2' })).toThrow(ConfigError);
  expect(() => parseTuning({ MATCH_DAYS_BEFORE: '1.5' })).toThrow('whole number');
  expect(() => parseConfig({ DEFAULT_CURRENCY: 'XXX' })).toThrow('DEFAULT_CURRENCY');
});

test('layer checks values in order and skips one that breaks the ones before it', () => {
  const base = { ...env, INVOICES_ADDRESS: '' } as Env;
  const layered = layer(
    base,
    [row('RECEIPT_ADDRESS', 'in@example.com'), row('INVOICES_ADDRESS', 'in@example.com'), row('APP_NAME', 'X')],
    3,
  );
  expect(config(layered).receiptAddress).toBe('in@example.com');
  expect(config(layered).invoicesAddress).toBe('');
  expect(config(layered).appName).toBe('X');
  expect(applied(layered).invalid.get('INVOICES_ADDRESS')?.error).toContain('must differ');
  expect(applied(layered).revision).toBe(3);
});

test('a missing settings table leaves the deploy values in force', async () => {
  const broken = {
    ...env,
    DB: {
      batch: async () => {
        throw new Error('no such table: settings');
      },
    },
  } as unknown as Env;
  expect(await withSettings(broken)).toBe(broken);
});

test('an allowed-senders list too long for the settings table is refused, not a server error', async () => {
  // 100 addresses of 250 characters are about 25,000 characters, and
  // settings.value_json holds at most 20,000.
  const list = Array.from({ length: 100 }, (_, i) => `${String(i).padStart(3, '0')}${'a'.repeat(235)}@example.org`);
  const response = await save(
    { ALLOWED_SENDER_EMAILS: list.join('\n'), confirm_ALLOWED_SENDER_EMAILS: 'yes' },
    'email',
  );
  expect(response.status).toBe(422);
  expect(await response.text()).toContain('Allowed senders is too long');
  expect((await rows()).some((r) => r.key === 'ALLOWED_SENDER_EMAILS')).toBe(false);
});

test('the most allowed senders of the longest length always fit settings.value_json', async () => {
  // 75 x 254 characters is the largest list the config accepts (MAX_ALLOWED_SENDERS).
  const list = Array.from({ length: 75 }, (_, i) => `${String(i).padStart(2, '0')}${'a'.repeat(240)}@example.org`);
  expect(list.every((a) => a.length === 254)).toBe(true);
  const response = await save(
    { ALLOWED_SENDER_EMAILS: list.join('\n'), confirm_ALLOWED_SENDER_EMAILS: 'yes' },
    'email',
  );
  expect(response.status).toBe(303);
  const stored = (await rows()).find((r) => r.key === 'ALLOWED_SENDER_EMAILS');
  expect(String(stored?.value_json).length).toBeLessThanOrEqual(SETTING_VALUE_LIMIT);
});

test('more than 75 allowed senders are refused with a clear message', async () => {
  const list = Array.from({ length: 76 }, (_, i) => `person${i}@example.org`);
  const response = await save(
    { ALLOWED_SENDER_EMAILS: list.join('\n'), confirm_ALLOWED_SENDER_EMAILS: 'yes' },
    'email',
  );
  expect(response.status).toBe(422);
  expect(await response.text()).toContain('at most 75 email addresses');
  expect((await rows()).some((r) => r.key === 'ALLOWED_SENDER_EMAILS')).toBe(false);
});
