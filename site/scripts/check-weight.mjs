#!/usr/bin/env node
// Holds the site's script chunks to their gzipped budgets after `vite build`.
// The changelog's 3D book pulls in three.js, which is easy to let grow. Budgets
// are per chunk, by the name Vite gives it, plus the changelog's
// first view as a whole (docs: the redesign plan's performance budget).
//
//   node scripts/check-weight.mjs [dist]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const dist = process.argv[2] ?? new URL("../dist/", import.meta.url).pathname;
const KB = 1024;

// [chunk name, budget, warn at]; sizes gzipped.
const BUDGETS = [
  ["changelog", 10 * KB, 8 * KB],
  ["book3d", 6 * KB, 5 * KB],
  ["gsap", 35 * KB, 30 * KB],
  ["three", 160 * KB, 140 * KB],
];

const assets = join(dist, "assets");
const files = readdirSync(assets).filter((f) => f.endsWith(".js"));
let failed = false;
for (const [name, budget, warn] of BUDGETS) {
  const file = files.find((f) => f.startsWith(`${name}-`));
  if (!file) {
    console.error(`check-weight: no ${name} chunk in ${assets}`);
    failed = true;
    continue;
  }
  const size = gzipSync(readFileSync(join(assets, file)), { level: 9 }).length;
  const line = `${name.padEnd(10)} ${(size / KB).toFixed(1).padStart(6)} KB gzipped (budget ${budget / KB} KB)`;
  if (size > budget) {
    console.error(`FAIL ${line}`);
    failed = true;
  } else console.log(`${size > warn ? "WARN" : "ok  "} ${line}`);
}
// The changelog's first view: what the browser fetches before it is idle.
// The HTML, its stylesheet, entry script and preloads (gzipped, as served),
// the preloaded fonts and the newest release's art (as stored).
const FIRST_VIEW = 550 * KB;
const CRITICAL = 60 * KB;
const page = readFileSync(join(dist, "changelog", "index.html"), "utf8");
const refs = (re) => [...page.matchAll(re)].map((m) => m[1]);
const text = [
  ...refs(/<link rel="stylesheet"[^>]*href="([^"]+)"/g),
  ...refs(/<script type="module"[^>]*src="([^"]+)"/g),
  ...refs(/<link rel="modulepreload"[^>]*href="([^"]+)"/g),
];
const binary = [
  ...refs(/<link rel="preload" href="([^"]+)" as="font"/g),
  ...refs(/<source type="image\/avif" srcset="([^"]+)"><img[^>]*fetchpriority="high"/g),
];
const gz = (f) => gzipSync(readFileSync(join(dist, f)), { level: 9 }).length;
const critical = gzipSync(page, { level: 9 }).length + text.reduce((n, f) => n + gz(f), 0);
const total = critical + binary.reduce((n, f) => n + statSync(join(dist, f)).size, 0);
for (const [label, size, budget] of [
  ["changelog HTML, CSS and JS", critical, CRITICAL],
  ["changelog first view", total, FIRST_VIEW],
]) {
  const line = `${label.padEnd(27)} ${(size / KB).toFixed(1).padStart(6)} KB (budget ${budget / KB} KB)`;
  if (size > budget) {
    console.error(`FAIL ${line}`);
    failed = true;
  } else console.log(`ok   ${line}`);
}
process.exit(failed ? 1 : 0);
