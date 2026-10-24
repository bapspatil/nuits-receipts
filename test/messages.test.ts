import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { InputError } from '../src/domain';
import { INTERNAL, MESSAGES } from '../src/messages';

const sources: Record<string, string> = JSON.parse(env.SOURCE_FILES);

// The string literals in the message argument of every requireInput(cond, message)
// and new InputError(message) in src/. A message built with ${...} is not a
// literal and is skipped; so is a snake_case review code (see flags.test.ts).
function thrownMessages(): Map<string, string> {
  const found = new Map<string, string>();
  for (const [file, text] of Object.entries(sources)) {
    for (const call of text.matchAll(/\b(requireInput|new InputError)\(/g)) {
      const args: string[] = [];
      let depth = 1,
        start = call.index + call[0].length,
        quote = '',
        i = start;
      for (; i < text.length && depth > 0; i++) {
        const c = text[i]!;
        if (quote) {
          if (c === '\\') i++;
          else if (c === quote) quote = '';
          continue;
        }
        if (c === "'" || c === '"' || c === '`') quote = c;
        else if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) {
          depth--;
          if (depth === 0) args.push(text.slice(start, i));
        } else if (c === ',' && depth === 1) {
          args.push(text.slice(start, i));
          start = i + 1;
        }
      }
      const message = call[1] === 'requireInput' ? args[1] : args[0];
      if (!message) continue;
      for (const literal of message.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`([^`$]*)`/g)) {
        const value = (literal[1] ?? literal[2] ?? literal[3] ?? '').replace(/\\(['"`\\])/g, '$1');
        if (value.length > 1 && !/^[a-z]+(_[a-z]+)+$/.test(value)) found.set(value, file);
      }
    }
  }
  return found;
}

test('every literal message the app throws has plain words, or is listed as internal', () => {
  const thrown = thrownMessages();
  // Spot-check the scan itself so a broken parser cannot pass silently.
  for (const known of [
    'Confirm match exceptions',
    'Stale receipt. Reload before saving.',
    'Payment not found',
    'Choose CSV',
    'Money in can only be matched to an invoice you sent',
    'Invalid extraction envelope',
  ])
    expect(thrown.has(known), known).toBe(true);
  const missing = [...thrown].filter(([m]) => !(m in MESSAGES) && !INTERNAL.includes(m)).map(([m, f]) => `${f}: ${m}`);
  expect(missing).toEqual([]);
});

test('no entry is left over after its call site changed', () => {
  const thrown = thrownMessages();
  expect([...Object.keys(MESSAGES), ...INTERNAL].filter((m) => !thrown.has(m))).toEqual([]);
});

test('the plain words are plain: a sentence, no long dashes, no leftover jargon', () => {
  for (const [key, text] of Object.entries(MESSAGES)) {
    expect(text, key).toMatch(/^[A-Z]/);
    expect(text, key).toMatch(/[.?!"]$|https:\/\/$/);
    expect(text, key).not.toMatch(new RegExp('[\\u2013\\u2014]'));
    expect(text, key).not.toMatch(/\b(canonical|manifest|snapshot|mapping|stale|revision)\b/i);
  }
});

test('InputError shows the plain words, keeps the status and the field, and passes unknown text through', () => {
  const refused = new InputError('Confirm match exceptions', 422, 'confirm_exception');
  expect(refused.message).toBe(
    "This receipt and payment don't line up exactly. Choose Match anyway if they belong together.",
  );
  expect(refused.status).toBe(422);
  expect(refused.field).toBe('confirm_exception');
  expect(new InputError('Something nobody wrote down').message).toBe('Something nobody wrote down');
  expect(new InputError('toString').message).toBe('toString');
});
