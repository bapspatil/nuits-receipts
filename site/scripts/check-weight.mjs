#!/usr/bin/env node
// Holds the site's script chunks to their gzipped budgets after `vite build`.
// The changelog's curl pulls in three.js, which is easy to let grow: a new
// import from "three" can drag in another few hundred kilobytes and nothing
// else would notice. Budgets are per chunk, by the name Vite gives it.
//
//   node scripts/check-weight.mjs [dist]
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const dist = process.argv[2] ?? new URL("../dist/", import.meta.url).pathname;
const KB = 1024;

// [chunk name, budget, warn at]; sizes gzipped.
const BUDGETS = [
  ["changelog", 10 * KB, 8 * KB],
  ["curl", 6 * KB, 5 * KB],
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
process.exit(failed ? 1 : 0);
