import { expect, test } from "bun:test";
import { docsChangelog, topVersion } from "./sync-changelog.mjs";

const SOURCE = `# Changelog

Intro that is not copied.

## [1.0.1](https://github.com/o/r/compare/v1.0.0...v1.0.1) (2026-10-23)

### Hotfixes

- **ui:** fix a thing (#24) ([03524cd](https://github.com/o/r/commit/03524cd1efdbc9bbe683fe956d4b5738f17f519d))
- see [the docs](https://example.com/docs) and <angle> and {braces} and \`<code>\`

## 0.7.0 (2026-10-22)

[Compare v0.6.0 to v0.7.0](https://github.com/o/r/compare/v0.6.0...v0.7.0)

First stable release.
`;

test("the docs changelog keeps headings and text and drops commit and compare links", () => {
  const page = docsChangelog(SOURCE);
  expect(page).toContain("## 1.0.1 (2026-10-23)");
  expect(page).toContain("- **ui:** fix a thing (#24)\n");
  expect(page).toContain("## 0.7.0 (2026-10-22)\n\nFirst stable release.");
  expect(page).toContain("[the docs](https://example.com/docs)");
  expect(page).toContain("&lt;angle> and \\{braces} and `<code>`");
  expect(page).not.toMatch(/github\.com|Intro that is not copied|Compare v0\.6\.0/);
  expect(page.startsWith("---\ntitle: Changelog\n")).toBe(true);
});

test("the newest entry version is read from the heading, with or without a link", () => {
  expect(topVersion(SOURCE)).toBe("1.0.1");
  expect(topVersion("## 2.3.4 (2026-01-01)\n")).toBe("2.3.4");
  expect(topVersion("# Changelog\n")).toBeNull();
});
