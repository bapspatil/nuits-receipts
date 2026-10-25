import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseChangelog } from "../../scripts/changelog-parse.mjs";
import { checkVersion, fillSlots } from "./changelog-plugin.mjs";
import { inline, paginate, renderBook, renderIndex, renderJsonLd, renderRelease, spans } from "./changelog-render.mjs";

const frozen = readFileSync(
  join(import.meta.dir, "..", "..", "docs-site", "scripts", "__fixtures__", "CHANGELOG-1.12.2.md"),
  "utf8",
);
const releases = parseChangelog(frozen);
const byVersion = Object.fromEntries(releases.map((r) => [r.version, r]));

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

test("a three-release fixture renders to the same HTML every time", () => {
  const html = renderBook(parseChangelog(FIXTURE, { repo: "o/r" }));
  expect(html).toMatchSnapshot();
});

test("1.0.1 splits into three slips and no slip holds more than 4 units or 560 characters", () => {
  expect(paginate(byVersion["1.0.1"])).toHaveLength(3);
  for (const r of releases)
    for (const page of paginate(r)) {
      expect(page.units).toBeLessThanOrEqual(4);
      if (page.items.length > 1) expect(page.chars).toBeLessThanOrEqual(560);
    }
});

test("a section running onto the next slip repeats its stamp as cont.", () => {
  const html = renderRelease(byVersion["1.0.1"]);
  expect(html.match(/class="cont"/g)?.length).toBe(2);
});

test("panels are shared out evenly, so no slip holds one orphan line", () => {
  expect(paginate(byVersion["1.3.0"]).map((p) => p.items.length)).toEqual([3, 2]);
  for (const r of releases) {
    const pages = paginate(r);
    if (pages.length > 1) expect(Math.min(...pages.map((p) => p.units))).toBeGreaterThan(1);
  }
});

test("each release head carries its tally of stamps", () => {
  expect(renderRelease(byVersion["1.0.2"])).toContain(
    '<ul class="rel-tally"><li><span class="stamp cl-chip" data-kind="fixes">Fixed</span> <span class="tally-n">4</span></li><li><span class="stamp cl-chip" data-kind="docs">Docs</span> <span class="tally-n">4</span></li></ul>',
  );
});

test("text is escaped, inline markdown becomes markup, and no commit link survives", () => {
  const html = renderBook(parseChangelog(FIXTURE, { repo: "o/r" }));
  expect(html).toContain("a &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot; change");
  expect(html).toContain("<code>code &lt;here&gt;</code>");
  expect(html).toContain('<a href="https://example.com/docs">the docs</a>');
  expect(html).not.toMatch(/\/(commit|compare)\//);
  expect(inline("**x**")).toBe("<strong>x</strong>");
  expect(inline("[x](javascript:alert(1))")).toBe("[x](javascript:alert(1))");
});

test("ids are unique, headings run h2 then h3, and sound words sit outside headings", () => {
  const html = renderBook(releases);
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  expect(new Set(ids).size).toBe(ids.length);
  expect(html).not.toMatch(/<h[1-6][^>]*>[^<]*<span class="sfx"/);
  for (const article of html.split("<article").slice(1)) {
    const h3 = article.indexOf("<h3");
    if (h3 > -1) expect(article.indexOf("<h2")).toBeLessThan(h3);
  }
  expect(html.match(/<h2/g)).toHaveLength(18);
  expect(html.match(/class="impact" aria-hidden="true" style="[^"]*"><span class="sfx">/g)?.length).toBeGreaterThan(0);
});

test("every release links its GitHub release page and nothing else on GitHub", () => {
  const html = renderBook(releases);
  const github = [...html.matchAll(/https:\/\/github\.com\/[^"]+/g)].map((m) => m[0]);
  expect(github).toHaveLength(18);
  for (const url of github) expect(url).toMatch(/^https:\/\/github\.com\/bapspatil\/nuits-receipts\/releases\/tag\/v\d+\.\d+\.\d+$/);
});

test("spans fill rows of six", () => {
  const item = (n: number, size = "s") => ({ size, entry: { text: "x".repeat(n) } });
  expect(spans([item(10), item(70)])).toEqual([2, 4]);
  expect(spans([item(30), item(40)])).toEqual([3, 3]);
  expect(spans([item(200, "l"), item(10), item(10), item(10)])).toEqual([6, 3, 3, 6]);
});

test("the empty state is one line", () => {
  expect(renderBook([])).toBe('<p class="empty">No releases yet.</p>');
  expect(renderIndex([])).toBe('<p class="empty">No releases yet.</p>');
});

test("JSON-LD lists every release and escapes markup", () => {
  const json = renderJsonLd(releases);
  expect(json.match(/"@type":"CreativeWork"/g)).toHaveLength(18);
  expect(json.slice(35, -9)).not.toContain("<");
});

test("the slots fill and the version check fails a stale changelog", () => {
  const out = fillSlots("<!-- changelog:version --><!-- changelog:index -->", FIXTURE, "#355650");
  expect(out.startsWith("2.0.0<ol")).toBe(true);
  expect(out).toContain('<h3 class="index-date"><time datetime="2026-11-03">3 Nov 2026</time></h3>');
  expect(out).toContain('<a href="#v2-0-0"><span class="index-v">2.0.0</span> <span class="stamp cl-chip" data-kind="breaking">Breaking</span> <span class="stamp cl-chip" data-kind="features">New</span></a>');
  expect(() => fillSlots("<!-- changelog:nope -->", FIXTURE, "#355650")).toThrow('unknown changelog slot "nope"');
  expect(() => checkVersion(FIXTURE, "2.0.0")).not.toThrow();
  expect(() => checkVersion(FIXTURE, "2.0.1")).toThrow("CHANGELOG.md starts at 2.0.0 but package.json is 2.0.1.");
});
