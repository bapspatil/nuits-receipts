import { expect, test } from 'vitest';
import { headerFields, senderVerdict } from '../src/sender';

const mail = (...headers: string[]) => new TextEncoder().encode([...headers, '', 'body'].join('\r\n'));
const CF = 'Authentication-Results: mx.cloudflare.net;';

test('Cloudflare SPF pass for the envelope sender passes', () => {
  expect(senderVerdict(mail(`${CF} spf=pass; dkim=pass; dmarc=pass;`, 'From: a@b.c'), 'Owner@Example.com')).toBe(
    'pass',
  );
  expect(
    senderVerdict(
      mail(
        'Received-SPF: pass (mx.cloudflare.net: domain of owner@example.com designates 1.2.3.4 as permitted sender)',
        '   helo="mx.example.net"; envelope-from="owner@example.com";',
        `${CF} spf=pass smtp.mailfrom=owner@example.com; dkim=none; dmarc=none`,
      ),
      'owner@example.com',
    ),
  ).toBe('pass');
});
test('folded header lines and comments are handled', () => {
  expect(senderVerdict(mail(CF, '\tspf=pass (mx.cloudflare.net: ok; really) ;', '  dkim=none'), 'x@y.z')).toBe('pass');
});
test('SPF fail, softfail or DMARC fail is a fail', () => {
  expect(senderVerdict(mail(`${CF} spf=softfail; dkim=pass; dmarc=none`), 'sender@example.net')).toBe('fail');
  expect(senderVerdict(mail(`${CF} spf=fail; dkim=none; dmarc=none`), 'sender@example.net')).toBe('fail');
  expect(senderVerdict(mail(`${CF} spf=none; dkim=pass; dmarc=fail`), 'sender@example.net')).toBe('fail');
});
test('SPF pass for a different address does not authenticate the envelope', () => {
  expect(
    senderVerdict(mail(`${CF} spf=pass smtp.mailfrom=attacker@evil.example; dkim=none`), 'bookkeeping@example.org'),
  ).toBe('unknown');
  expect(
    senderVerdict(
      mail('Received-SPF: pass (mx.cloudflare.net: x) envelope-from="attacker@evil.example";', `${CF} spf=pass`),
      'bookkeeping@example.org',
    ),
  ).toBe('fail');
});
test('only the topmost Cloudflare result counts; forged lower headers are ignored', () => {
  expect(
    senderVerdict(mail(`${CF} spf=softfail; dkim=none; dmarc=none`, `${CF} spf=pass; dkim=pass; dmarc=pass`), 'a@b.c'),
  ).toBe('fail');
  expect(senderVerdict(mail('Authentication-Results: mx.google.com; spf=pass'), 'a@b.c')).toBe('unknown');
  expect(senderVerdict(mail('Authentication-Results: mx.cloudflare.net.evil.example; spf=pass'), 'a@b.c')).toBe(
    'unknown',
  );
  expect(
    senderVerdict(mail('ARC-Authentication-Results: i=1; mx.cloudflare.net; spf=pass smtp.mailfrom=a@b.c'), 'a@b.c'),
  ).toBe('unknown');
});
test('headers in the body are not read and DKIM-only mail stays unknown', () => {
  const bytes = new TextEncoder().encode(`Subject: hi\r\n\r\n${CF} spf=pass\r\n`);
  expect(senderVerdict(bytes, 'a@b.c')).toBe('unknown');
  expect(senderVerdict(mail(`${CF} spf=none; dkim=pass; dmarc=pass`), 'a@b.c')).toBe('unknown');
  expect(headerFields(bytes)).toEqual([['subject', 'hi']]);
});
