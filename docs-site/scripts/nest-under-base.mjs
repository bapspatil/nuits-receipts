#!/usr/bin/env node
// Astro writes a `base: "/docs"` build flat into dist/, but the Worker serves
// assets by URL path, so /docs/foo/ must live at dist/docs/foo/. Moves every
// file under dist/docs/ and keeps _headers at the root, where Workers reads it.
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
if (existsSync(headers))
  writeFileSync(headers, readFileSync(headers, "utf8").replace(/^\/_astro\/\*/m, `/${base}/_astro/*`));
console.log(`Nested build under ${dist}/${base}/`);
