import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';

test('D1 rejects invalid status and R2 preserves exact bytes', async () => {
  await expect(
    env.DB.prepare(
      `INSERT INTO receipts
    (id, original_key, filename, media_type, source, received_at, status)
    VALUES ('x','receipts/x','x.pdf','application/pdf','upload','2026-01-01','invalid')`,
    ).run(),
  ).rejects.toThrow();
  const bytes = new Uint8Array([0, 255, 42]);
  await env.ORIGINALS.put('test', bytes);
  const stored = await env.ORIGINALS.get('test');
  expect(stored).not.toBeNull();
  expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(bytes);
});

test('D1 enforces duplicate graph integrity during concurrent edits', async () => {
  for (const id of ['a', 'b', 'c'])
    await env.DB.prepare(
      `INSERT INTO receipts(id,original_key,filename,media_type,source,received_at,status) VALUES (?,?,'sample.txt','text/plain','upload','2026-09-01','needs_review')`,
    )
      .bind(id, 'receipts/' + id)
      .run();
  await env.DB.prepare("UPDATE receipts SET duplicate_of='b' WHERE id='a'").run();
  await expect(env.DB.prepare("UPDATE receipts SET duplicate_of='a' WHERE id='b'").run()).rejects.toThrow();
  await expect(env.DB.prepare("UPDATE receipts SET duplicate_of='c' WHERE id='b'").run()).rejects.toThrow();
  await expect(env.DB.prepare("UPDATE receipts SET duplicate_of='a' WHERE id='c'").run()).rejects.toThrow();
});
