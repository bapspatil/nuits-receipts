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
    ...'surface-page surface-raised surface-sunken text text-muted text-on-accent border border-strong accent accent-hover danger danger-surface success success-surface focus-ring font-display font-ui font-mono'.split(
      ' ',
    ),
    ...'text-xs text-sm text-base text-lg text-xl text-2xl'.split(' '),
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `space-${n}`),
    ...'radius-sm radius-md radius-pill shadow-raised btn-primary-bg btn-primary-text btn-height nav-height tabbar-height stamp-needs stamp-ok stamp-missing field-height row-height'.split(
      ' ',
    ),
  ];
  for (const name of names) expect(css, name).toContain(`--${name}:`);
});

// site/ is not part of the public template, so this runs only where it exists.
test.skipIf(!existsSync('site/scripts/check-contrast.mjs'))('every contrast claim in the palette holds', () => {
  const run = spawnSync('node', ['site/scripts/check-contrast.mjs', 'src/tokens.json', '--quiet'], {
    encoding: 'utf8',
  });
  expect(run.stderr + run.stdout).toContain('Every contrast claim in the palette holds.');
  expect(run.status).toBe(0);
});
