// Builds the changelog comic from the repository's CHANGELOG.md at build time,
// so every release is real HTML in dist/changelog/index.html and a new release
// needs no hand work: the next site build picks it up.
//
// The build fails if the newest release in CHANGELOG.md is not the version in
// package.json, so the page can never ship a release behind.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseChangelog, topVersion } from "../../scripts/changelog-parse.mjs";
import { renderBook, renderIndex, renderJsonLd, renderLatest, renderTones } from "./changelog-render.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const SOURCE = resolve(ROOT, "CHANGELOG.md");
const PACKAGE = resolve(ROOT, "package.json");
const TOKENS = resolve(import.meta.dirname, "..", "tokens.json");
const PROPS = resolve(import.meta.dirname, "..", "src", "assets", "svg", "props");

// The props that exist, by name. The page builds without any.
export function readProps(dir = PROPS) {
  if (!existsSync(dir)) return {};
  const files = readdirSync(dir).filter((f) => f.endsWith(".svg"));
  return Object.fromEntries(files.map((f) => [basename(f, ".svg"), readFileSync(resolve(dir, f), "utf8").trim()]));
}

export function checkVersion(markdown, version) {
  const top = topVersion(markdown);
  if (top !== version) throw new Error(`CHANGELOG.md starts at ${top} but package.json is ${version}.`);
}

export function fillSlots(html, markdown, inkSoft, props = {}) {
  const releases = parseChangelog(markdown);
  const slots = {
    version: () => renderLatest(releases),
    index: () => renderIndex(releases),
    book: () => renderBook(releases, props),
    jsonld: () => renderJsonLd(releases),
    tones: () => renderTones(inkSoft),
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
      const inkSoft = JSON.parse(readFileSync(TOKENS, "utf8")).color.inkSoft.hex;
      return fillSlots(html, read(), inkSoft, readProps());
    },
  };
}
