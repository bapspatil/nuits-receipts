import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { request, htmlForm, confirmationForm } from './helpers';
import { MAX_CSV_BYTES } from '../src/domain';
async function preview(csv: string, values: Record<string, string> = {}) {
  const form = new FormData();
  form.set('file', new File([csv], 'synthetic.csv'));
  form.set('account', 'holvi');
  for (const [k, v] of Object.entries(values)) form.set(k, v);
  return request('/imports/csv', { method: 'POST', body: form });
}
test('changing a selected saved preset mapping takes effect only after a new preview', async () => {
  const csv = 'Date;Amount;Payee\n2026-09-01;-12.50;Synthetic Shop\n';
  const initial = await preview(csv),
    body = confirmationForm(await initial.text());
  body.set('preset_bank', 'Synthetic');
  body.set('preset_name', 'Monthly');
  expect((await request('/imports/csv/confirm', { method: 'POST', body })).status).toBe(303);
  const saved = await env.DB.prepare('SELECT id FROM bank_presets').first<string>('id');
  const second = await preview(csv.replace('-12.50', '-15.50'), { preset_id: saved! });
  expect(second.status).toBe(200);
  const edit = htmlForm(await second.text(), '/imports/csv/preview');
  edit.set('signed_outgoing', 'positive');
  const updated = await request('/imports/csv/preview', { method: 'POST', body: edit });
  expect(updated.status).toBe(200);
  const final = confirmationForm(await updated.text());
  const mapping = JSON.parse(String(final.get('mapping')));
  expect(mapping.amount.outgoing).toBe('positive');
});
test('preamble layout can be changed in the editor before column mapping', async () => {
  const csv = 'Synthetic preamble\nDate;Amount;Payee\n2026-09-01;-12.50;Synthetic Shop\nSynthetic footer\n';
  const initial = await preview(csv);
  expect(initial.status).toBe(422);
  const edit = htmlForm(await initial.text(), '/imports/csv/preview');
  edit.set('header_record', '1');
  edit.set('trailing_records', '1');
  edit.set('delimiter', ';');
  const updated = await request('/imports/csv/preview', { method: 'POST', body: edit });
  expect(updated.status).toBe(200);
  const body = confirmationForm(await updated.text());
  expect((await request('/imports/csv/confirm', { method: 'POST', body })).status).toBe(303);
  expect(await env.DB.prepare('SELECT count(*) n FROM bank_transactions').first('n')).toBe(1);
});
test('exactly 2 MiB survives multipart preview and bounded base64 confirmation', async () => {
  const head = 'Unused;Date;Amount;Currency;Payee;Note\n';
  const rows = Array.from(
    { length: 5000 },
    (_, i) => `fake-${i};2026-09-01;-1.00;EUR;Synthetic Shop;${'x'.repeat(350)}\n`,
  );
  let csv = head + rows.join('');
  const remaining = MAX_CSV_BYTES - new TextEncoder().encode(csv).length;
  expect(remaining).toBeGreaterThan(0);
  for (let i = 0, left = remaining; left > 0; i++) {
    const size = Math.min(left, 100);
    rows[i % rows.length] = rows[i % rows.length]!.replace('\n', 'x'.repeat(size) + '\n');
    left -= size;
  }
  csv = head + rows.join('');
  expect(new TextEncoder().encode(csv)).toHaveLength(MAX_CSV_BYTES);
  const mapping = {
    version: 1,
    encoding: 'utf-8',
    delimiter: ';',
    headerRecord: 0,
    trailingRecords: 0,
    date: { column: 1, format: 'ISO', time: 'none' },
    number: { decimal: '.', grouping: '' },
    amount: { kind: 'signed', column: 2, outgoing: 'negative' },
    currency: { kind: 'column', column: 3, blankDefault: null },
    merchant: 4,
    reference: null,
    externalId: null,
    original: null,
  };
  const response = await preview(csv, { mapping: JSON.stringify(mapping) });
  expect(response.status).toBe(200);
  const body = confirmationForm(await response.text());
  expect((await request('/imports/csv/confirm', { method: 'POST', body })).status).toBe(303);
  expect(await env.DB.prepare('SELECT count(*) n FROM bank_transactions').first('n')).toBe(5000);
  const overlapping = await preview(csv.replace('-1.00', '-1.0'), {
    mapping: JSON.stringify(mapping),
    collision: 'keep_existing',
  });
  expect(overlapping.status).toBe(200);
  expect(
    (await request('/imports/csv/confirm', { method: 'POST', body: confirmationForm(await overlapping.text()) }))
      .status,
  ).toBe(303);
  expect(await env.DB.prepare('SELECT count(*) n FROM bank_transactions').first('n')).toBe(5000);
  expect(fetch).not.toHaveBeenCalled();
}, 30000);
test('preset picker labels presets as CSV layouts, with no disclaimer of its own', async () => {
  const csv = 'Kirjauspäivä;Saaja;Summa;Valuutta;Viite\n01.09.2026;Synthetic Shop;-12,50;EUR;SYN-1\n';
  const html = await (await preview(csv)).text();
  expect(html).toContain('<option value="builtin-nordea">Nordea (CSV layout)</option>');
  expect(html).toContain('<option value="builtin-op">OP (CSV layout)</option>');
  // The footer carries the not-affiliated line; the picker repeats nothing.
  expect(html.match(/Not affiliated/g)).toHaveLength(1);
  expect(html).not.toContain('Built-in synthetic-tested layout');
});
test('saved presets are labelled as layouts too', async () => {
  const csv = 'Date;Amount;Payee\n2026-09-01;-12.50;Synthetic Shop\n';
  const body = confirmationForm(await (await preview(csv)).text());
  body.set('preset_bank', 'Synthetic');
  body.set('preset_name', 'Monthly');
  expect((await request('/imports/csv/confirm', { method: 'POST', body })).status).toBe(303);
  const html = await (await preview(csv.replace('-12.50', '-13.50'))).text();
  expect(html).toContain('>Monthly · Synthetic (CSV layout)</option>');
  expect(html.match(/Not affiliated/g)).toHaveLength(1);
});

test('an unknown layout asks for the columns first and holds row errors until they are mapped', async () => {
  const csv = 'Ref;When;Sum;Who\nX1;2026-09-01;-12.50;Synthetic Shop\nX2;not a date;-3.00;Other Shop\n';
  const initial = await preview(csv);
  expect(initial.status).toBe(422);
  const html = await initial.text();
  expect(html).toContain('No preset maps these headers.');
  // No row errors from a guessed mapping, and no table of guessed rows.
  expect(html).not.toMatch(/Row \d+, /);
  expect(html).not.toContain('<table class="stack">');
  expect(html).toContain('<details open><summary>The columns look wrong?');
  // Once mapped, the real row errors show.
  const edit = htmlForm(html, '/imports/csv/preview');
  edit.set('map_booking_date', '1');
  edit.set('map_amount', '2');
  edit.set('map_merchant', '3');
  const mapped = await request('/imports/csv/preview', { method: 'POST', body: edit });
  const after = await mapped.text();
  expect(mapped.status).toBe(422);
  expect(after).toMatch(/Row 3, /);
  expect(after).not.toMatch(/Row 2, /);
  expect(after).not.toContain('No preset maps these headers.');
});
