#!/usr/bin/env node
// Renders the hero field in real Chrome (SwiftShader WebGPU), counts the
// colours it paints, and writes them to tokens.json as field.heroField.picks,
// so check-contrast.mjs measures what the page paints rather than a claim.
// Replaces the skill's vgpu/Dawn version, because this site drives WebGPU
// directly and the browser is the renderer that matters.
//
// It also saves the frames as the no-WebGPU fallback images, so the static
// hero and the live one are the same pixels.
//
// Needs the site served at SITE_URL (default http://localhost:4321/).
// Exit 1 if the field paints any colour that is not an exact palette token.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { BASE, launch } from "./chrome.mjs";

const COVERAGE_FLOOR = 0.0002;
const tokens = JSON.parse(readFileSync("tokens.json", "utf8"));
const byHex = new Map(
  Object.entries(tokens.color).map(([name, t]) => [t.hex.toUpperCase(), name]),
);

const shots = [
  { name: "wide", width: 1440, height: 900, scale: 1 },
  { name: "narrow", width: 390, height: 844, scale: 2 },
];

const browser = await launch(true);
const seen = new Map();
let pixels = 0;
for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.scale });
  await page.goto(`${BASE}?fx-force`);
  await page.waitForSelector(".field[data-ready]", { state: "attached", timeout: 15000 });
  await page.addStyleTag({ content: "body > :not(main), main > :not(.hero), .hero > :not(.field) { visibility: hidden !important; } .hero { background: none !important; }" });
  await page.waitForTimeout(300);
  const buffer = await page.locator(".field").screenshot();
  writeFileSync(`public/field-fallback-${s.name}.png`, buffer);
  const png = PNG.sync.read(buffer);
  for (let i = 0; i < png.data.length; i += 4) {
    const hex = "#" + [0, 1, 2].map((k) => png.data[i + k].toString(16).padStart(2, "0")).join("").toUpperCase();
    seen.set(hex, (seen.get(hex) ?? 0) + 1);
  }
  pixels += png.width * png.height;
  await page.close();
}
await browser.close();

const picks = [];
const strays = [];
for (const [hex, n] of [...seen].sort((a, b) => b[1] - a[1])) {
  const share = n / pixels;
  const name = byHex.get(hex);
  if (share < COVERAGE_FLOOR) {
    console.log(`  ignored ${hex} at ${(share * 100).toFixed(4)}% (under the coverage floor)`);
    continue;
  }
  if (!name) strays.push(`${hex} at ${(share * 100).toFixed(2)}%`);
  else picks.push(name);
  console.log(`  ${hex} ${name ?? "NOT IN PALETTE"} ${(share * 100).toFixed(2)}%`);
}
if (strays.length) {
  console.error(`The field paints colours outside the palette: ${strays.join(", ")}`);
  process.exit(1);
}
// Two exact colours fit a 1-bit palette PNG, which halves the fallback bytes
// without changing a pixel. Optional: without Pillow the RGB files stay.
try {
  execFileSync("python3", ["-c", `
from PIL import Image
for n in ["wide", "narrow"]:
    p = f"public/field-fallback-{n}.png"
    Image.open(p).convert("RGB").quantize(colors=${picks.length}).save(p, optimize=True)
`]);
} catch {
  console.log("  Pillow not available; fallback PNGs left as RGB");
}

tokens.field.heroField.picks = picks;
writeFileSync("tokens.json", JSON.stringify(tokens, null, 2) + "\n");
console.log(`heroField.picks = ${JSON.stringify(picks)}`);
