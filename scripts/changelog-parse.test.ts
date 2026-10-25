import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseChangelog, slugFor, stripLinks, topVersion } from './changelog-parse.mjs';
import { renderChangelogEntry } from './version.mjs';

const real = readFileSync(join(import.meta.dir, '..', 'CHANGELOG.md'), 'utf8');
const frozen = readFileSync(
  join(import.meta.dir, '..', 'docs-site', 'scripts', '__fixtures__', 'CHANGELOG-1.12.2.md'),
  'utf8',
);

test('CHANGELOG.md at 1.12.2 reads as 18 releases, newest first', () => {
  const releases = parseChangelog(frozen);
  expect(releases).toHaveLength(18);
  expect(releases[0].version).toBe('1.12.2');
  expect(releases[0].date).toBe('2026-10-25');
  expect(releases.at(-1).version).toBe('1.0.1');
  expect(releases[0].slug).toBe('v1-12-2');
  expect(releases[0].releaseUrl).toBe('https://github.com/bapspatil/nuits-receipts/releases/tag/v1.12.2');
});

test('the live CHANGELOG.md parses and starts at its top version', () => {
  const releases = parseChangelog(real);
  expect(releases[0].version).toBe(topVersion(real));
});

test('both heading shapes, every section kind, intro prose and labels', () => {
  const byVersion = Object.fromEntries(parseChangelog(frozen).map((r) => [r.version, r]));
  expect(byVersion['1.12.2'].sections[0]).toEqual({
    kind: 'hotfixes',
    title: 'Hotfixes',
    entries: [
      { scope: 'ui', label: null, text: 'spacing, font and tap-target pass across app, site and docs', pr: 20 },
    ],
  });
  expect(byVersion['1.11.0'].sections[0].kind).toBe('ui');
  expect(byVersion['1.12.0'].sections[0].kind).toBe('features');
  expect(byVersion['1.3.0'].date).toBe('2026-10-24');
  expect(byVersion['1.3.0'].sections[0].entries).toHaveLength(5);
  expect(byVersion['1.0.2'].sections.map((s) => s.kind)).toEqual(['fixes', 'docs']);
  expect(byVersion['1.0.2'].sections[0].entries[0].label).toBe('Settings');
  expect(byVersion['1.0.2'].sections[0].entries[1].text).toBe(
    'Month package: the "changes" package no longer replaces the full month index.',
  );
  expect(byVersion['1.1.0'].sections[1].entries[0].label).toBe('Docs');
  expect(byVersion['1.0.1'].intro).toEqual([
    'First public release. Earlier development history is not part of this repository.',
  ]);
  expect(byVersion['1.0.1'].sections[0].entries).toHaveLength(9);
  expect(byVersion['1.0.1'].sections[0].entries.every((e) => e.scope === null && e.pr === null)).toBe(true);
  expect(byVersion['1.5.0'].sections[0].entries[0]).toEqual({
    scope: null,
    label: null,
    text: 'Discard receipts in Review, with undo, restore and bulk select',
    pr: 6,
  });
});

test('no commit or compare link survives anywhere', () => {
  const json = JSON.stringify(parseChangelog(frozen));
  expect(json).not.toMatch(/github\.com\/[^"]*\/(?:commit|compare)\//);
  expect(json).not.toContain('([');
});

test('a mid-text PR ref stays text; other links stay links', () => {
  const [r] = parseChangelog(
    '## 2.0.0 (2026-11-01)\n\n### Features\n\n- see #12 in [the docs](https://example.com/d) and [abc](https://github.com/o/r/commit/abc1234)\n',
  );
  expect(r.sections[0].entries[0]).toEqual({
    scope: null,
    label: null,
    text: 'see #12 in [the docs](https://example.com/d) and abc',
    pr: null,
  });
});

test('CRLF, a missing date, an unknown section and a compare-only line', () => {
  const md =
    '# Changelog\r\n\r\nIntro.\r\n\r\n## 0.7.0\r\n\r\n[Compare v0.6.0 to v0.7.0](https://github.com/o/r/compare/v0.6.0...v0.7.0)\r\n\r\n### Odds and ends\r\n\r\n- a thing\r\n';
  const [r] = parseChangelog(md);
  expect(r).toMatchObject({ version: '0.7.0', date: null, intro: [] });
  expect(r.sections[0]).toEqual({
    kind: 'other',
    title: 'Odds and ends',
    entries: [{ scope: null, label: null, text: 'a thing', pr: null }],
  });
});

test('a duplicate version or a heading that is not a version fails with its line', () => {
  expect(() => parseChangelog('## 1.0.0 (2026-01-01)\n\n## 1.0.0 (2026-01-02)\n')).toThrow(
    'CHANGELOG.md:3: 1.0.0 appears twice.',
  );
  expect(() => parseChangelog('## Unreleased\n')).toThrow('CHANGELOG.md:1:');
});

test('an entry rendered by version.mjs parses back', () => {
  const block = renderChangelogEntry({
    version: '1.13.0',
    date: '2026-11-02',
    repositoryUrl: 'https://github.com/o/r',
    previousTag: 'v1.12.2',
    sections: {
      breaking: [{ scope: 'bank', description: 'a breaking one (#30)', sha: 'a'.repeat(40) }],
      features: [{ scope: null, description: 'a feature (#31)', sha: 'b'.repeat(40) }],
      ui: [{ scope: 'ui', description: 'a restyle', sha: 'c'.repeat(40) }],
      hotfixes: [{ scope: 'review', description: 'a fix (#33)', sha: 'd'.repeat(40) }],
    },
  });
  const [r] = parseChangelog(block, { repo: 'o/r' });
  expect(r.version).toBe('1.13.0');
  expect(r.sections.map((s) => s.kind)).toEqual(['breaking', 'features', 'ui', 'hotfixes']);
  expect(r.sections[0].entries[0]).toEqual({ scope: 'bank', label: null, text: 'a breaking one', pr: 30 });
  expect(r.sections[2].entries[0]).toEqual({ scope: 'ui', label: null, text: 'a restyle', pr: null });
});

test('stripLinks and slugFor', () => {
  expect(stripLinks('- x ([abc1234](https://github.com/o/r/commit/abc1234))')).toBe('- x');
  expect(slugFor('1.12.2')).toBe('v1-12-2');
});
