#!/usr/bin/env node
// Fills __INLINE_SCRIPT_HASHES__ in dist/_headers with the SHA-256 hash of every
// inline <script> in the built pages, so the Content-Security-Policy can allow
// exactly those scripts and no others. Fails if a page has an inline script
// with an unexpected type, or if the placeholder is missing.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dist = "dist";
const headersPath = join(dist, "_headers");
if (!existsSync(headersPath)) throw new Error("dist/_headers is missing.");
const hashes = new Set();
const pages = readdirSync(dist, { recursive: true }).filter((f) => f.endsWith(".html"));
for (const page of pages) {
  const html = readFileSync(join(dist, page), "utf8");
  for (const [, attrs, body] of html.matchAll(/<script\b((?:(?!\bsrc=)[^>])*)>([\s\S]*?)<\/script>/g)) {
    // Data blocks (JSON-LD) are not executed, so the policy does not cover them.
    if (/type="application\/ld\+json"/.test(attrs)) continue;
    if (/type=/.test(attrs) && !/type="(module|text\/javascript)"/.test(attrs))
      throw new Error(`${page}: inline script with an unexpected type: <script${attrs}>`);
    hashes.add(`'sha256-${createHash("sha256").update(body).digest("base64")}'`);
  }
}
const text = readFileSync(headersPath, "utf8");
if (!text.includes("__INLINE_SCRIPT_HASHES__")) throw new Error("dist/_headers has no __INLINE_SCRIPT_HASHES__ placeholder.");
writeFileSync(headersPath, text.replaceAll("__INLINE_SCRIPT_HASHES__", [...hashes].sort().join(" ")));
console.log(`CSP: ${hashes.size} inline script hash(es) across ${pages.length} pages.`);
