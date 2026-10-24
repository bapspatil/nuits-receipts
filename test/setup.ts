import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, afterEach, vi } from 'vitest';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected outbound network');
    }),
  );
  await env.DB.batch([
    env.DB.prepare('DELETE FROM internal_transfers'),
    env.DB.prepare('DELETE FROM bank_transactions'),
    env.DB.prepare('DELETE FROM imports'),
    env.DB.prepare('DELETE FROM bank_presets'),
    env.DB.prepare('DELETE FROM accounts WHERE is_default=0'),
    ...['holvi', 'race', 'retry-account', 'foreign-recovery'].map((id) =>
      env.DB.prepare(
        "INSERT INTO accounts(id,label,bank_name,default_currency,created_at) VALUES (?,?, 'Synthetic bank','EUR','2026-10-20')",
      ).bind(id, id),
    ),
    env.DB.prepare('DELETE FROM receipts'),
    env.DB.prepare('DELETE FROM vendor_rules'),
    env.DB.prepare(
      "INSERT INTO vendor_rules(vendor_contains,product,expense_type) VALUES ('cloudflare','general','infra'),('openai','general','AI APIs'),('anthropic','general','AI APIs')",
    ),
    env.DB.prepare('DELETE FROM fx_rates'),
    env.DB.prepare('DELETE FROM month_sends'),
    env.DB.prepare('DELETE FROM onedrive_uploads'),
    env.DB.prepare('DELETE FROM onedrive_connection'),
    env.DB.prepare('DELETE FROM settings'),
    env.DB.prepare('DELETE FROM settings_audit'),
    env.DB.prepare('DELETE FROM inbound_mail'),
    env.DB.prepare('DELETE FROM ignored_senders'),
  ]);
  const objects = await env.ORIGINALS.list();
  for (const object of objects.objects) await env.ORIGINALS.delete(object.key);
});
afterEach(() => vi.unstubAllGlobals());
