#!/usr/bin/env node
// Copy gate for the docs: the same rules as site/scripts/check-copy.mjs (legal
// review of 20 Oct 2026, sections 3, 5 and 6), applied to every page
// source and, once built, to the HTML in dist/. Also checks that every built
// page carries the trader identification line (Act 458/2002 s.7) and that any
// running-cost statement uses the approved wording.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const under = (dir, ext) =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true })
        .filter((f) => ext.some((e) => f.endsWith(e)))
        .map((f) => join(dir, f))
    : [];

// Page sources plus the components we own. The scaffolded Nimbus components
// stay as upstream ships them so `nimbus-docs diff` keeps working; whatever
// they render is still checked in dist/.
const sources = [...under("src/content", [".md", ".mdx"]), "src/components/Footer.astro", "src/components/Header.astro"];
const built = under("dist", [".html"]);

const phrases = [
  "VAT-compliant",
  "tax-ready",
  "audit-proof",
  "100% accurate",
  "never miss",
  "guaranteed",
  "bank-grade",
  "secure by design",
  "does your bookkeeping",
  "replaces your accountant",
  "calculates your VAT",
  "integrates with",
  "upvote",
  "free to run",
];
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const banned = [
  ...phrases.map((p) => [new RegExp(escape(p), "i"), `banned phrase "${p}"`]),
  [/[\u2013\u2014]/, "long dash (use a comma, colon, period or hyphen)"],
  [/\belf\b|\belves\b|\belfin\b/i, "elf reference"],
  [/\bcompliant\b/i, "compliance claim"],
  [/(?<!with )\bany bank\b/i, 'unqualified "any bank" (say: banks that export CSV, presets for some, a column mapper for others)'],
  [/never leaves your account|stays in your (own )?account/i, "data-locality claim (say: Nuits never sees your data)"],
  [/Cloudflare Receipts|Receipts for Cloudflare|CF-Receipts/i, "Cloudflare in the product name"],
  [/\btestimonial|\btrusted by\b|\bthousands of\b/i, "invented social proof"],
];
// Prose-only rules: framework markup legitimately says "integration" and
// "official" in class names and scripts, so these run on page sources only.
const proseOnly = [
  [/\b(integration|partner(ship)?|official)\b/i, "integration, partner or official wording"],
  [/waitlist|email me updates/i, "email capture"],
];

const TRADER = "Nuits, sole trader (Bapusaheb Shankaragouda Patil), Business ID 3584845-8, Helsinki, hi@brandnuits.com";
const COST = /15 cents/;
const COST_LINE = "about 15 cents a month";

let failed = false;
const fail = (msg) => {
  console.error(msg);
  failed = true;
};
const todos = [];
for (const file of [...sources, ...built]) {
  const isSource = sources.includes(file);
  const text = readFileSync(file, "utf8");
  text.split("\n").forEach((line, i) => {
    const plain = isSource ? line : line.replace(/<script[\s\S]*?<\/script>/g, "");
    for (const [re, why] of isSource ? [...banned, ...proseOnly] : banned)
      if (re.test(plain)) fail(`${file}:${i + 1}: ${why}: ${plain.trim().slice(0, 140)}`);
    if (isSource && COST.test(line) && !line.includes(COST_LINE))
      fail(`${file}:${i + 1}: running cost must read "${COST_LINE}"`);
    if (isSource) for (const m of line.matchAll(/\[TODO:[^\]]+\]/g)) todos.push(`${file}:${i + 1}: ${m[0]}`);
  });
}
for (const file of built) {
  if (file.endsWith("404.html")) continue;
  const html = readFileSync(file, "utf8");
  const trader = html.match(/<p class="trader">([\s\S]*?)<\/p>/);
  const text = trader?.[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  if (text !== TRADER || !trader[1].includes('href="mailto:hi@brandnuits.com"'))
    fail(`${file}: trader line is not exactly "${TRADER}" with a mailto link (found: ${text ?? "none"})`);
}

console.log(`Checked ${sources.length} sources and ${built.length} built pages. ${todos.length} TODO markers:`);
for (const t of todos) console.log(`  ${t}`);
if (process.argv.includes("--production") && todos.length) fail("Placeholders remain; not a launch build.");
process.exit(failed ? 1 : 0);
