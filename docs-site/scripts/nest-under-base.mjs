#!/usr/bin/env node
// Astro writes a `base: "/docs"` build flat into dist/, but the Worker serves
// assets by URL path, so /docs/foo/ must live at dist/docs/foo/. Moves every
// file under dist/docs/ and keeps _headers at the root, where Workers reads it.
// The rules in _headers are written for the site root (`/*`, `/_astro/*`) and
// are rewritten to sit under /docs.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dist = "dist";
const base = "docs";
if (existsSync(join(dist, base, "index.html"))) process.exit(0);
const target = join(dist, `${base}.tmp`);
mkdirSync(target);
for (const name of readdirSync(dist)) {
  if (name === "_headers" || name === `${base}.tmp`) continue;
  renameSync(join(dist, name), join(target, name));
}
renameSync(target, join(dist, base));
const headers = join(dist, "_headers");
if (existsSync(headers)) {
  let text = readFileSync(headers, "utf8");
  // "/_astro/*" -> "/docs/_astro/*"; "/*" -> "/docs" and "/docs/*" (a bare "/*"
  // would also match /docs-adjacent paths of other routes on the zone).
  text = text.replace(/^\/_astro\/\*/m, `/${base}/_astro/*`);
  const all = /^\/\*\n((?:[ \t]+.*\n?)+)/m.exec(text);
  if (all) text = text.replace(all[0], `/${base}\n${all[1]}\n/${base}/*\n${all[1]}`);
  writeFileSync(headers, text);
}
console.log(`Nested build under ${dist}/${base}/`);
