import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { expect, test, vi } from 'vitest';
import { receiveEmail } from '../src/receipts';
import { parseConfig, parseForwardCopyTo } from '../src/config';
import type { Env } from '../src/env';

const auth = 'Authentication-Results: mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass;\r\n';
const body = (text: string) =>
  new Response(
    auth + ['From: owner@example.com', 'To: receipts@example.com', 'Content-Type: text/plain', '', text].join('\r\n'),
  ).body!;
const count = async () => Number(await env.DB.prepare('SELECT count(*) AS n FROM receipts').first('n'));

test('FORWARD_COPY_TO is off by default and parses one address', () => {
  expect(parseConfig({}).forwardCopyTo).toBe('');
  expect(parseForwardCopyTo('  Copy@Example.com ')).toBe('copy@example.com');
  expect(() => parseForwardCopyTo('a@example.com, b@example.com')).toThrow('FORWARD_COPY_TO');
  expect(() => parseConfig({ FORWARD_COPY_TO: 'nope' })).toThrow('FORWARD_COPY_TO');
});

test('unset FORWARD_COPY_TO never forwards', async () => {
  const forward = vi.fn(async () => ({ messageId: 'x' }));
  const context = createExecutionContext();
  await receiveEmail(
    { from: 'owner@example.com', to: 'receipts@example.com', raw: body('vendor: A'), forward },
    env,
    context,
  );
  await waitOnExecutionContext(context);
  expect(forward).not.toHaveBeenCalled();
  expect(await count()).toBe(1);
});

test('mail from any sender is forwarded once, and allowed mail is still ingested', async () => {
  const forward = vi.fn(async () => ({ messageId: 'x' }));
  const withCopy = { ...env, FORWARD_COPY_TO: 'Copy@Example.net' } as Env;
  const stranger = new ReadableStream<Uint8Array>({ pull() {} });
  await receiveEmail(
    { from: 'codes@unknown.example', to: 'receipts@example.com', raw: stranger, forward },
    withCopy,
    createExecutionContext(),
  );
  await stranger.cancel();
  expect(forward).toHaveBeenCalledTimes(1);
  expect(forward).toHaveBeenCalledWith('copy@example.net');
  expect(await count()).toBe(0);

  const context = createExecutionContext();
  await receiveEmail(
    { from: 'owner@example.com', to: 'receipts@example.com', raw: body('vendor: B'), forward },
    withCopy,
    context,
  );
  await waitOnExecutionContext(context);
  expect(forward).toHaveBeenCalledTimes(2);
  expect(await count()).toBe(1);
});

test('a failed forward never stops ingestion', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const forward = vi.fn(async () => {
    throw new Error('destination address not verified');
  });
  const context = createExecutionContext();
  await receiveEmail(
    { from: 'owner@example.com', to: 'receipts@example.com', raw: body('vendor: C'), forward },
    { ...env, FORWARD_COPY_TO: 'copy@example.net' } as Env,
    context,
  );
  await waitOnExecutionContext(context);
  expect(await count()).toBe(1);
  expect(error.mock.calls.flat().join(' ')).toContain('forward_copy_failed');
  error.mockRestore();
});

test('a failed ingestion still forwards', async () => {
  const forward = vi.fn(async () => ({ messageId: 'x' }));
  const raw = new ReadableStream<Uint8Array>({
    pull() {
      throw new Error('stream broke');
    },
  });
  await expect(
    receiveEmail(
      { from: 'owner@example.com', to: 'receipts@example.com', raw, forward },
      { ...env, FORWARD_COPY_TO: 'copy@example.net' } as Env,
      createExecutionContext(),
    ),
  ).rejects.toThrow('stream broke');
  expect(forward).toHaveBeenCalledTimes(1);
});

test('forwarding to the receiving address is skipped to avoid loops', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const forward = vi.fn(async () => ({ messageId: 'x' }));
  for (const target of ['receipts@example.com', 'alias@example.com']) {
    const raw = new ReadableStream<Uint8Array>({ pull() {} });
    await receiveEmail(
      { from: 'codes@unknown.example', to: 'alias@example.com', raw, forward },
      { ...env, FORWARD_COPY_TO: target } as Env,
      createExecutionContext(),
    );
    await raw.cancel();
  }
  expect(forward).not.toHaveBeenCalled();
  expect(warn.mock.calls.flat().join(' ')).toContain('forward_copy_loop');
  warn.mockRestore();
});
