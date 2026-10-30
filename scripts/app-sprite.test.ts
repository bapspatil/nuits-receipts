import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { ICON_PATHS, LUCIDE_VERSION as GENERATED } from '../src/icons';
import { ICONS, LUCIDE_VERSION } from './app-sprite.mjs';

test('src/icons.ts holds exactly the icons scripts/app-sprite.mjs lists', () => {
  expect(Object.keys(ICON_PATHS), 'run `bun run sprite`').toEqual(ICONS);
  expect(GENERATED).toBe(LUCIDE_VERSION);
});

test('NOTICE carries the Lucide licence for the version in use', () => {
  expect(readFileSync('NOTICE', 'utf8')).toContain(`lucide-static ${LUCIDE_VERSION}`);
});

test('no icon carries script, style or an event handler', () => {
  expect(JSON.stringify(ICON_PATHS)).not.toMatch(/<script|<style|\son[a-z]+=/i);
});
