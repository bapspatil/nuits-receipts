import { env } from 'cloudflare:workers';
import { beforeEach, expect, test } from 'vitest';
import { getReceipt } from '../src/receipts';
import { htmlForm, request, uploadPdf, idFrom } from './helpers';

const rule = (fields: Record<string, string> = {}) =>
  new URLSearchParams({
    vendor_contains: 'Sample Cloud',
    product: 'hosting',
    expense_type: 'infra',
    context_contains: '',
    bank_alias: '',
    priority: '5',
    ...fields,
  });
const post = (path: string, body: URLSearchParams, headers: Record<string, string> = {}) =>
  request(path, { method: 'POST', body, headers });
// Fresh installs ship with sample rules; each test starts without them.
beforeEach(async () => {
  await env.DB.prepare('DELETE FROM vendor_rules').run();
});
const rules = async () =>
  (await env.DB.prepare('SELECT * FROM vendor_rules ORDER BY id').all<Record<string, unknown>>()).results;

test('Settings lists vendor rules with an open Add form when there are none', async () => {
  const html = await (await request('/settings')).text();
  expect(html).toContain('<p>No rules yet.</p><details class="add" open><summary>Add rule</summary>');
  const created = await post('/rules', htmlForm(html, '/rules') as unknown as URLSearchParams);
  // The rendered form alone is not enough: the seller text is required.
  expect(created.status).toBe(422);
  const saved = await post('/rules', rule());
  expect(saved.status).toBe(303);
  expect(saved.headers.get('Location')).toBe('/settings?done=ruleSaved#rules');
  const after = await (await request('/settings?done=ruleSaved')).text();
  expect(after).toContain('<p class="banner" role="status">Rule saved.</p>');
  // One plain row per rule; it opens its own edit form. The saved section is open.
  expect(after).toContain('<details class="sect" open><summary><h2>Vendor rules</h2><span class="sum">1</span>');
  expect(after).toContain('<li><details><summary>Sample Cloud → Hosting, infra · 5</summary>');
  expect(after).toContain('<details class="add"><summary>Add rule</summary>');
});

test('a rule made from a receipt goes back to that receipt', async () => {
  const response = await uploadPdf();
  const receipt = await getReceipt(env, idFrom(response));
  const html = await (await request(`/receipts/${receipt.id}`)).text();
  const form = htmlForm(html, '/rules');
  expect(form.get('return_to')).toBe(`/receipts/${receipt.id}`);
  form.set('vendor_contains', 'Sample Cloud');
  const saved = await request('/rules', { method: 'POST', body: form });
  expect(saved.status).toBe(303);
  expect(saved.headers.get('Location')).toBe(`/receipts/${receipt.id}?done=ruleSaved`);
  // Anything else in return_to is ignored.
  const elsewhere = await post('/rules', rule({ vendor_contains: 'Other', return_to: 'https://evil.example/' }));
  expect(elsewhere.headers.get('Location')).toBe('/settings?done=ruleSaved#rules');
});

test('vendor rules can be edited and deleted from Settings, with the same checks as a new rule', async () => {
  await post('/rules', rule());
  await post('/rules', rule({ vendor_contains: 'Fake Shop', context_contains: 'card', priority: '0' }));
  const [first, second] = await rules();
  const id = first!.id;
  const html = await (await request('/settings')).text();
  const edit = htmlForm(html, `/rules/${id}`);
  expect(edit.get('vendor_contains')).toBe('Sample Cloud');
  expect(edit.get('product')).toBe('hosting');
  expect(html).toContain(`<button class="linkbtn" formaction="/rules/${id}/delete">Delete</button>`);
  // Priority 0 is not shown.
  expect(html).toMatch(/<summary>Fake Shop → [^<·]+<\/summary>/);

  edit.set('vendor_contains', 'Sample Cloud Lantern');
  edit.set('priority', '9');
  const saved = await request(`/rules/${id}`, { method: 'POST', body: edit });
  expect(saved.status).toBe(303);
  expect(saved.headers.get('Location')).toBe('/settings?done=ruleSaved#rules');
  expect((await rules())[0]).toMatchObject({ vendor_contains: 'Sample Cloud Lantern', priority: 9 });

  // Same validation as a new rule.
  expect((await post(`/rules/${id}`, rule({ vendor_contains: ' ' }))).status).toBe(422);
  expect((await post(`/rules/${id}`, rule({ product: 'nope' }))).status).toBe(422);
  expect((await post(`/rules/${id}`, rule({ expense_type: 'nope' }))).status).toBe(422);
  expect((await post(`/rules/${id}`, rule({ priority: '1.5' }))).status).toBe(422);
  expect((await post(`/rules/${id}`, rule({ bank_alias: 'x'.repeat(201) }))).status).toBe(422);
  // Two rules can't share the same seller and context text.
  const clash = await post(`/rules/${id}`, rule({ vendor_contains: 'Fake Shop', context_contains: 'card' }));
  expect(clash.status).toBe(409);
  expect(await clash.text()).toContain('You already have a rule for that seller text');
  expect((await post('/rules', rule({ vendor_contains: 'Fake Shop', context_contains: 'card' }))).status).toBe(409);
  // Unknown or malformed IDs are not found; other sites can't post.
  expect((await post('/rules/999999', rule())).status).toBe(404);
  expect((await post('/rules/999999/delete', new URLSearchParams())).status).toBe(404);
  expect((await post('/rules/abc', rule())).status).toBe(404);
  expect((await post(`/rules/${id}/delete`, new URLSearchParams(), { Origin: 'https://evil.example' })).status).toBe(
    403,
  );
  expect((await post(`/rules/${id}`, rule(), { Origin: 'https://evil.example' })).status).toBe(403);
  expect(await rules()).toHaveLength(2);

  const deleted = await post(`/rules/${id}/delete`, new URLSearchParams());
  expect(deleted.status).toBe(303);
  expect(deleted.headers.get('Location')).toBe('/settings?done=ruleDeleted#rules');
  expect((await rules()).map((r) => r.id)).toEqual([second!.id]);
  expect(await (await request('/settings?done=ruleDeleted')).text()).toContain('Rule deleted.');
});
