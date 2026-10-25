#!/usr/bin/env node
// Cleans Recraft vector output into the site's illustration format: drops
// the C2PA metadata, the full-canvas background and every inline colour, and
// gives each shape a class that motion.css colours from the tokens:
//   ik  ink (dark fills)   pp  slip (white fills)   mt  mint (light greys)
// The viewBox is cropped to a square round the drawing, then svgo runs with
// the site's config. Recraft writes absolute M, L and C commands under a
// zero translate, so the control points bound the drawing.
//
//   node scripts/clean-recraft.mjs <out dir> <file.svg>...
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const [out, ...files] = process.argv.slice(2);
if (!out || !files.length) {
  console.error("usage: node scripts/clean-recraft.mjs <out dir> <file.svg>...");
  process.exit(1);
}
mkdirSync(out, { recursive: true });

const BACKGROUND = /^M 0 0 L (\d+) 0 L \1 \1 L 0 \1 L 0 0 z$/;

function classOf(fill) {
  const [r, g, b] = fill.match(/\d+/g).map(Number);
  const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return y < 0.45 ? "ik" : y > 0.97 ? "pp" : "mt";
}

for (const file of files) {
  const svg = readFileSync(file, "utf8");
  const xs = [];
  const ys = [];
  const paths = [...svg.matchAll(/<path ([^>]*?)\/?>(?:<\/path>)?/g)]
    .map(([, attrs]) => {
      const d = attrs.match(/ ?d="([^"]+)"/)[1];
      if (BACKGROUND.test(d.trim())) return "";
      const n = d.match(/-?[\d.]+/g).map(Number);
      for (let i = 0; i + 1 < n.length; i += 2) xs.push(n[i]), ys.push(n[i + 1]);
      const fill = attrs.match(/fill="([^"]+)"/)?.[1] ?? "rgb(0,0,0)";
      const transform = attrs.match(/transform="([^"]+)"/)?.[1];
      return `<path class="${classOf(fill)}"${transform ? ` transform="${transform}"` : ""} d="${d}"/>`;
    })
    .join("");
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const side = Math.ceil(Math.max(x1 - x0, y1 - y0) * 1.04);
  const viewBox = [Math.floor((x0 + x1 - side) / 2), Math.floor((y0 + y1 - side) / 2), side, side].join(" ");
  const target = join(out, basename(file));
  writeFileSync(
    target,
    `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="ill ill-prop" focusable="false" viewBox="${viewBox}">${paths}</svg>\n`,
  );
}
execFileSync(
  "npx",
  // Whole units: the drawings are about 1,800 units across, so a decimal
  // place only adds bytes to a page that inlines them.
  ["--yes", "svgo@4", "-q", "--config", new URL("../svgo.config.mjs", import.meta.url).pathname, "-p", "0", "-f", out],
  { stdio: "inherit" },
);
for (const file of files) console.log(`${basename(file)}: ${readFileSync(join(out, basename(file))).length} bytes`);
