import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { render } from './app-tokens.mjs';

const tokens = JSON.parse(readFileSync('src/tokens.json', 'utf8'));

test('src/tokens.ts is what scripts/app-tokens.mjs writes from src/tokens.json', () => {
  expect(readFileSync('src/tokens.ts', 'utf8'), 'run `bun run tokens`').toBe(render(tokens));
});

test('every semantic and component name a later PR will swap exists', () => {
  const css = readFileSync('src/tokens.ts', 'utf8');
  const names = [
    ...'surface-page surface-raised surface-sunken text text-muted text-on-accent border border-strong accent accent-hover danger danger-surface success success-surface focus-ring warn warn-surface info info-surface glass glass-filter glass-border font-display font-ui font-num font-mono'.split(
      ' ',
    ),
    ...'text-xs text-sm text-base text-lg text-xl text-2xl'.split(' '),
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `space-${n}`),
    ...'radius-sm radius-md radius-lg radius-glass radius-pill shadow-raised shadow-glass shadow-glass-edge btn-primary-bg btn-primary-text btn-height sidebar-width tabbar-height stamp-needs stamp-ok stamp-missing field-height row-height'.split(
      ' ',
    ),
  ];
  for (const name of names) expect(css, name).toContain(`--${name}:`);
});

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const over = (top: string, alpha: number, under: string) => {
  const [a, b] = [channels(top), channels(under)];
  return (
    '#' +
    a
      .map((v, i) =>
        Math.round(v * alpha + b[i]! * (1 - alpha))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
      .toUpperCase()
  );
};
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex)
    .map((c) => c / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

test('the glass tint is the lowest alpha, in steps of .01, that keeps every label on it at AA', () => {
  const { tint, alpha, labels, under } = tokens.glass;
  const hex = (name: string) => tokens.color[name].hex as string;
  const passes = (a: number) =>
    (under as string[]).every((u) =>
      (labels as string[]).every((f) => ratio(hex(f), over(hex(tint), a, hex(u))) >= 4.5),
    );
  expect(passes(alpha)).toBe(true);
  expect(passes(Math.round((alpha - 0.01) * 100) / 100)).toBe(false);
  // The measured-only colours are that tint over their backdrop, so check-contrast measures the real glass.
  for (const [name, c] of Object.entries<{ hex: string; over?: string }>(tokens.color))
    if (c.over) expect(c.hex, name).toBe(over(hex(tint), alpha, hex(c.over)));
});

// site/ is not part of the public template, so this runs only where it exists.
test.skipIf(!existsSync('site/scripts/check-contrast.mjs'))('every contrast claim in the palette holds', () => {
  const run = spawnSync('node', ['site/scripts/check-contrast.mjs', 'src/tokens.json', '--quiet'], {
    encoding: 'utf8',
  });
  expect(run.stderr + run.stdout).toContain('Every contrast claim in the palette holds.');
  expect(run.status).toBe(0);
});
