#!/usr/bin/env node
// Copy gate for every page: the sources and, once built, dist/. Fails on long
// dashes, on the claims the legal review (20 Oct 2026, sections 3, 5
// and 6) rules out, and on email capture. Lists every TODO placeholder. With
// --production it also fails while any placeholder remains, so a preview can
// ship with them and the launch build cannot.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const htmlUnder = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true })
        .filter((f) => f.endsWith(".html"))
        .map((f) => join(dir, f))
    : [];

const sources = ["index.html", "404.html", "privacy/index.html", "changelog/index.html", "src/og.html", "src/og-changelog.html", ...htmlUnder("src/partials")].filter((f) => existsSync(f));
const files = [...sources, ...htmlUnder("dist")];

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
  "legally compliant archive",
  "retention-compliant",
  "GoBD",
  "replaces your filing",
];
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const banned = [
  ...phrases.map((p) => [new RegExp(escape(p), "i"), `banned phrase "${p}"`]),
  [/[\u2013\u2014]/, "long dash (use a comma, colon, period or hyphen)"],
  [/\belf\b|\belves\b|\belfin\b/i, "elf reference"],
  [/\bcompliant\b/i, "compliance claim"],
  // "any bank", "Any-bank", "any\u00a0bank", "anybank" and "any banks"; only "with any bank" (as in
  // "not affiliated with any bank") is allowed.
  [/(?<!with )\bany[\s\u00a0\u2010-\u2015-]*bank/i, 'unqualified "any bank" or "any-bank" (say: banks that export CSV, presets for some, a column mapper for others)'],
  [/\b(integration|partner(ship)?|official)\b/i, "integration, partner or official wording"],
  [/never leaves your account|stays in your (own )?account/i, "data-locality claim (say: Nuits never sees your data)"],
  [/github\.com\/[\w.-]+\/[\w.-]+-private\b/i, "mention of the private repository (its pages are not public)"],
  [/github\.com\/[\w.-]+\/[\w.-]+\/(?:commit|compare)\//i, "link to a commit or compare page (404 for visitors)"],
  // The repository root and a release tag page are the only GitHub pages the
  // site links to; the changelog's Release links are the tag pages.
  [/github\.com\/bapspatil\/nuits-receipts\/(?!releases\/tag\/v\d+\.\d+\.\d+(?![\w.]))[\w.-]/i, "GitHub link other than the repository root or a release tag page"],
  [/Cloudflare Receipts|Receipts for Cloudflare|CF-Receipts/i, "Cloudflare in the product name"],
  [/your own receipt inbox on Cloudflare/i, "old descriptor with Cloudflare in it"],
  [/type="email"|<form\b|waitlist|email me updates/i, "email capture"],
  [/\btestimonial|\btrusted by\b|\bthousands of\b/i, "invented social proof"],
];

// The maintainer confirmed this wording on 20 Oct 2026 (Act 458/2002 s.7). Every built
// page must carry it exactly, so an edit to the footer partial cannot quietly
// drop or reword the trader identification.
const TRADER = "Nuits, sole trader (Bapusaheb Shankaragouda Patil), Business ID 3584845-8, Helsinki, hi@brandnuits.com";
const TRADER_MAILTO = 'href="mailto:hi@brandnuits.com"';

// Copy review, round 4: the hero states the cost exactly this way, and the
// Clairic preview disclaimer appears exactly twice on the home page, once in
// How it works and once in the small print. Every other mention is plain
// "Clairic", so the caveat reads as a statement rather than as a tic.
const HERO_COST = "AI reading costs about 15 cents a month. You may need Workers Paid ($5) for PDFs.";
const PREVIEW = /preview model/gi;
const region = (html, open) => {
  const start = html.indexOf(open);
  return start === -1 ? null : [start, html.indexOf("</section>", start)];
};

let failed = false;
const todos = [];
for (const file of htmlUnder("dist")) {
  const html = readFileSync(file, "utf8");
  const how = region(html, '<section class="scene how');
  const small = region(html, '<section class="smallprint"');
  const inside = (r, i) => r && i > r[0] && i < r[1];
  const hits = [...html.matchAll(PREVIEW)].map((m) => m.index);
  const inHow = hits.filter((i) => inside(how, i)).length;
  const inSmall = hits.filter((i) => inside(small, i)).length;
  const stray = hits.length - inHow - inSmall;
  if (inSmall !== 1 || stray !== 0 || (how && inHow !== 1)) {
    console.error(
      `${file}: Clairic preview disclaimer must appear once in How it works and once in the small print ` +
        `(found ${inHow} in How it works, ${inSmall} in small print, ${stray} elsewhere)`,
    );
    failed = true;
  }
  if (how) {
    const hero = html.match(/<p class="hero-cost[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1].replace(/\s+/g, " ").trim();
    if (hero !== HERO_COST) {
      console.error(`${file}: hero cost line is not exactly "${HERO_COST}" (found: ${hero ?? "none"})`);
      failed = true;
    }
  }
  const trader = html.match(/<p class="trader">([\s\S]*?)<\/p>/);
  const text = trader?.[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  if (text !== TRADER || !trader[1].includes(TRADER_MAILTO)) {
    console.error(`${file}: trader line is not exactly "${TRADER}" with a mailto link (found: ${text ?? "none"})`);
    failed = true;
  }
}
for (const file of files) {
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    for (const [re, why] of banned) {
      if (re.test(line)) {
        console.error(`${file}:${i + 1}: ${why}: ${line.trim().slice(0, 140)}`);
        failed = true;
      }
    }
    if (sources.includes(file))
      for (const m of line.matchAll(/\[TODO:[^\]]+\]|data-todo="([^"]+)"/g)) todos.push(`${file}:${i + 1}: ${m[0]}`);
  });
}

console.log(`Checked ${files.length} files. ${todos.length} TODO markers:`);
for (const t of todos) console.log(`  ${t}`);
if (process.argv.includes("--production") && todos.length) {
  console.error("Placeholders remain; not a launch build.");
  failed = true;
}
process.exit(failed ? 1 : 0);
