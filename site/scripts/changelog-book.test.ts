import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseChangelog } from "../../scripts/changelog-parse.mjs";
import { artOf, renderAll, renderScrubber, renderSpread, renderSpreads, titleOf } from "./changelog-book.mjs";
import { checkVersion, fillSlots, readArt } from "./changelog-plugin.mjs";
import { inline, renderJsonLd } from "./changelog-render.mjs";

const frozen = readFileSync(
  join(import.meta.dir, "..", "..", "docs-site", "scripts", "__fixtures__", "CHANGELOG-1.12.2.md"),
  "utf8",
);
const releases = parseChangelog(frozen);
const { art, manifest } = readArt();

const FIXTURE = `# Changelog

## [2.0.0](https://github.com/o/r/compare/v1.1.0...v2.0.0) (2026-11-03)

### Breaking changes

- **bank:** a <b>bold</b> & "quoted" change (#40) ([abcdef1](https://github.com/o/r/commit/abcdef1))

### Features

- see \`code <here>\` and [the docs](https://example.com/docs)

## 1.1.0 (2026-11-02)

### Hotfixes

- **review:** short fix (#39)

## 1.0.0 (2026-11-01)

First release.

### Odds and ends

- something else
`;

const fixture = parseChangelog(FIXTURE, { repo: "o/r" });

test("one spread per release, only the newest shown and its art loaded first", () => {
  const html = renderSpreads(releases, art, manifest);
  expect(html.match(/<article class="spread"/g)).toHaveLength(releases.length);
  expect(html.match(/<article class="spread"[^>]* hidden>/g)).toHaveLength(releases.length - 1);
  expect(html.match(/fetchpriority="high"/g)).toHaveLength(1);
  expect(html.match(/loading="lazy"/g)).toHaveLength(releases.length - 1);
});

test("ids are the versions, unique, and every heading is an h2 with the version", () => {
  const html = renderSpreads(releases, art, manifest);
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  expect(new Set(ids).size).toBe(ids.length);
  for (const r of releases) expect(html).toContain(`<article class="spread" id="${r.version}"`);
  expect(html.match(/<h2/g)).toHaveLength(releases.length);
});

test("every release has its own strip; one without gets a plain page and loads nothing", () => {
  for (const r of releases) expect(artOf(r, art, manifest).type).toBe("strip");
  expect(new Set(releases.map((r) => artOf(r, art, manifest).name)).size).toBe(releases.length);
  const unseen = { ...fixture[1], version: "9.9.9" };
  expect(artOf(unseen, art, manifest)).toEqual({ type: "none" });
  const html = renderSpread(unseen, 1, art, manifest);
  expect(html).toContain('data-art="none"');
  expect(html).not.toContain("<img");
  expect(html).not.toContain("data-thumb");
});

test("text is escaped, inline markdown becomes markup, and no commit link survives", () => {
  const html = renderSpreads(fixture, art, manifest);
  expect(html).toContain("a &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot; change");
  expect(html).toContain("<code>code &lt;here&gt;</code>");
  expect(html).toContain('<a href="https://example.com/docs">the docs</a>');
  expect(html).not.toMatch(/\/(commit|compare)\//);
  expect(inline("**x**")).toBe("<strong>x</strong>");
  expect(inline("[x](javascript:alert(1))")).toBe("[x](javascript:alert(1))");
});

test("titles come from art.json, else the first entry, cut on a word", () => {
  expect(titleOf({ version: "9.9.9", sections: [], intro: [] }, { "9.9.9": "Hand title" })).toBe("Hand title");
  expect(titleOf(fixture[1])).toBe("Short fix");
  const long = { version: "1", intro: [], sections: [{ entries: [{ text: "word ".repeat(30) }] }] };
  expect(titleOf(long).length).toBeLessThanOrEqual(63);
  expect(titleOf(long).endsWith("...")).toBe(true);
});

test("every release links its GitHub release page and nothing else on GitHub", () => {
  const html = renderSpreads(releases, art, manifest);
  const github = [...html.matchAll(/https:\/\/github\.com\/[^"]+/g)].map((m) => m[0]);
  expect(github).toHaveLength(releases.length);
  for (const url of github) expect(url).toMatch(/^https:\/\/github\.com\/bapspatil\/nuits-receipts\/releases\/tag\/v\d+\.\d+\.\d+$/);
});

test("the scrubber runs oldest to newest and marks the newest", () => {
  const html = renderScrubber(fixture);
  expect([...html.matchAll(/>(\d+\.\d+\.\d+)</g)].map((m) => m[1])).toEqual(["1.0.0", "1.1.0", "2.0.0"]);
  expect(html).toContain('<a class="scrub-v" href="#2.0.0" data-i="0" aria-current="true">2.0.0</a>');
  expect(renderAll(fixture)).toContain('<a href="#1.1.0"><span class="all-v">1.1.0</span> <time datetime="2026-11-02">2 Nov 2026</time></a>');
});

test("a spread lists at most five bullets and says how many more", () => {
  const many = { ...fixture[1], sections: [{ kind: "fixes", title: "Fixes", entries: Array.from({ length: 7 }, (_, i) => ({ text: `fix ${i}` })) }] };
  const html = renderSpread(many, 0, art, manifest);
  expect(html.match(/<ul class="rel-bullets">(.*?)<\/ul>/)[1].match(/<li>/g)).toHaveLength(5);
  expect(html).toContain('<p class="rel-more">and 2 more</p>');
});

test("the empty state is one line", () => {
  expect(renderSpreads([], art, manifest)).toBe('<p class="empty">No releases yet.</p>');
});

test("JSON-LD lists every release by its version anchor and escapes markup", () => {
  const json = renderJsonLd(releases);
  expect(json.match(/"@type":"CreativeWork"/g)).toHaveLength(releases.length);
  expect(json).toContain(`"url":"https://receipts.nuits.net/changelog/#${releases[0].version}"`);
  expect(json.slice(35, -9)).not.toContain("<");
});

test("the slots fill and the version check fails a stale changelog", () => {
  const out = fillSlots("<!-- changelog:version --><!-- changelog:scrubber -->", FIXTURE, { art, manifest });
  expect(out.startsWith("2.0.0<ol")).toBe(true);
  expect(() => fillSlots("<!-- changelog:nope -->", FIXTURE, { art, manifest })).toThrow('unknown changelog slot "nope"');
  expect(() => checkVersion(FIXTURE, "2.0.0")).not.toThrow();
  expect(() => checkVersion(FIXTURE, "2.0.1")).toThrow("CHANGELOG.md starts at 2.0.0 but package.json is 2.0.1.");
});

test("every built art file is within budget", () => {
  for (const entry of Object.values(manifest.strips)) {
    expect(entry.avif).toBeLessThanOrEqual(200 * 1024);
    expect(entry.webp).toBeLessThanOrEqual(320 * 1024);
    expect(entry.blur.length).toBeLessThan(2048);
    expect(entry.small).toBe(640);
  }
});
