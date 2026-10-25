// Builds the changelog comic from the repository's CHANGELOG.md at build time,
// so every release is real HTML in dist/changelog/index.html and a new release
// needs no hand work: the next site build picks it up.
//
// The build fails if the newest release in CHANGELOG.md is not the version in
// package.json, so the page can never ship a release behind.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseChangelog, topVersion } from "../../scripts/changelog-parse.mjs";
import { renderAll, renderScrubber, renderSpreads } from "./changelog-book.mjs";
import { renderJsonLd, renderLatest } from "./changelog-render.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const SOURCE = resolve(ROOT, "CHANGELOG.md");
const PACKAGE = resolve(ROOT, "package.json");
const ART = resolve(import.meta.dirname, "..", "changelog", "art.json");
const MANIFEST = resolve(import.meta.dirname, "..", "public", "changelog-art", "manifest.json");

// The art config and what scripts/changelog-art.mjs built from it. The page
// builds without a manifest: every release then prints text only.
export function readArt() {
  const art = JSON.parse(readFileSync(ART, "utf8"));
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : { strips: {} };
  return { art, manifest };
}

export function checkVersion(markdown, version) {
  const top = topVersion(markdown);
  if (top !== version) throw new Error(`CHANGELOG.md starts at ${top} but package.json is ${version}.`);
}

export function fillSlots(html, markdown, { art, manifest }) {
  const releases = parseChangelog(markdown);
  const slots = {
    version: () => renderLatest(releases),
    spreads: () => renderSpreads(releases, art, manifest),
    scrubber: () => renderScrubber(releases),
    all: () => renderAll(releases),
    jsonld: () => renderJsonLd(releases),
  };
  return html.replace(/<!-- changelog:(\w+) -->/g, (all, name) => {
    if (!slots[name]) throw new Error(`unknown changelog slot "${name}"`);
    return slots[name]();
  });
}

export default function changelog() {
  const read = () => readFileSync(SOURCE, "utf8");
  return {
    name: "changelog",
    buildStart() {
      checkVersion(read(), JSON.parse(readFileSync(PACKAGE, "utf8")).version);
    },
    configureServer(server) {
      server.watcher.add(SOURCE);
      server.watcher.on("change", (file) => {
        if (file === SOURCE) server.ws.send({ type: "full-reload" });
      });
    },
    transformIndexHtml(html) {
      if (!html.includes("<!-- changelog:")) return html;
      return fillSlots(html, read(), readArt());
    },
  };
}
