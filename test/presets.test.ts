import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { savePreset, savedPresets } from '../src/banking';
import { holviMapping } from '../src/presets';
const headers = ['Date', 'Amount', 'Payee'];
test('saved mappings are suggested by ordered header fingerprint with selected bank first', async () => {
  const mapping = holviMapping(headers, 'EUR');
  const a = await savePreset(env, { bank_name: 'Synthetic A', name: 'Monthly', headers, mapping });
  await savePreset(env, { bank_name: 'Synthetic B', name: 'Monthly', headers, mapping });
  expect((await savedPresets(env, headers, 'Synthetic B')).map((p) => p.bank_name)).toEqual([
    'Synthetic B',
    'Synthetic A',
  ]);
  expect((await savedPresets(env, ['Amount', 'Date', 'Payee'])).length).toBe(0);
  expect((await savedPresets(env, headers))[0]?.mapping).toEqual(mapping);
  await expect(savePreset(env, { bank_name: 'Synthetic A', name: 'monthly', headers, mapping })).rejects.toThrow(
    /exists/i,
  );
  expect(a.revision).toBe(0);
});
test('preset updates require the current revision and cannot change built-ins', async () => {
  const mapping = holviMapping(headers, 'EUR');
  const initial = await savePreset(env, { bank_name: 'Synthetic', name: 'Booked', headers, mapping });
  const updated = await savePreset(env, { ...initial, headers, mapping, revision: 0 });
  expect(updated.revision).toBe(1);
  await expect(savePreset(env, { ...initial, headers, mapping, revision: 0 })).rejects.toThrow(/changed/i);
  await expect(
    savePreset(env, { id: 'builtin-holvi', bank_name: 'Holvi', name: 'Builtin', headers, mapping, revision: 0 }),
  ).rejects.toThrow();
});
