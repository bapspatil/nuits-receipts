#!/usr/bin/env node
// Builds the changelog art from site/art/ (see changelog/art.json): for each
// strip and each SLIP card an AVIF (q55), a WebP (q75), a 256 px WebP
// thumbnail for the scrubber, and a blurred 24 px placeholder written into
// public/changelog-art/manifest.json as a data URL. Fails when an AVIF is over
// its budget, so heavy art cannot slip in unnoticed.
//
//   node scripts/changelog-art.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

const SITE = resolve(import.meta.dirname, "..");
const ART = resolve(SITE, "art");
const OUT = resolve(SITE, "public", "changelog-art");
const config = JSON.parse(readFileSync(resolve(SITE, "changelog", "art.json"), "utf8"));
const KB = 1024;
export const AVIF_BUDGET = 200 * KB;
export const WEBP_BUDGET = 320 * KB;

mkdirSync(OUT, { recursive: true });

// median: a light 3 px median filter for the Codex strips, whose pencil grain
// costs more bytes than it is worth on screen.
async function emit(name, pipeline, { median = 0 } = {}) {
  const png = await (median ? sharp(await pipeline.png().toBuffer()).median(median) : pipeline).png().toBuffer();
  const { width, height } = await sharp(png).metadata();
  const avif = await sharp(png).avif({ quality: 55, effort: 6, chromaSubsampling: "4:2:0" }).toBuffer();
  const webp = await sharp(png).webp({ quality: 75, effort: 6 }).toBuffer();
  const thumb = await sharp(png).resize({ width: 256 }).webp({ quality: 70 }).toBuffer();
  const blur = await sharp(png).resize({ width: 24 }).blur(1.2).webp({ quality: 40 }).toBuffer();
  writeFileSync(resolve(OUT, `${name}.avif`), avif);
  writeFileSync(resolve(OUT, `${name}.webp`), webp);
  writeFileSync(resolve(OUT, `${name}-thumb.webp`), thumb);
  const over = [];
  if (avif.length > AVIF_BUDGET) over.push(`AVIF ${(avif.length / KB).toFixed(0)} KB > ${AVIF_BUDGET / KB} KB`);
  if (webp.length > WEBP_BUDGET) over.push(`WebP ${(webp.length / KB).toFixed(0)} KB > ${WEBP_BUDGET / KB} KB`);
  console.log(`${over.length ? "FAIL" : "ok  "} ${name.padEnd(16)} ${width}x${height} avif ${(avif.length / KB).toFixed(0)} KB, webp ${(webp.length / KB).toFixed(0)} KB, thumb ${(thumb.length / KB).toFixed(0)} KB${over.length ? ` (${over.join(", ")})` : ""}`);
  return { ok: !over.length, entry: { width, height, avif: avif.length, webp: webp.length, blur: `data:image/webp;base64,${blur.toString("base64")}` } };
}

const manifest = { strips: {}, cards: {} };
let ok = true;

for (const [version, strip] of Object.entries(config.strips)) {
  const r = await emit(`strip-${version}`, sharp(resolve(ART, strip.src)), { median: strip.median ?? 3 });
  ok &&= r.ok;
  manifest.strips[version] = r.entry;
}

const sheet = resolve(ART, config.cards.src);
for (const [mood, panel] of Object.entries(config.cards.panels)) {
  const [left, top, width, height] = panel.crop;
  // The sheet's label box (NEUTRAL, PROUD, ...) is painted out in the panel's
  // own paper colour: the mood is the drawing's job, not a caption's.
  const [lx, ly, lw, lh] = panel.label;
  const cover = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" fill="#fefefd"/></svg>`);
  const cropped = await sharp(sheet).extract({ left, top, width, height }).png().toBuffer();
  const r = await emit(`card-${mood}`, sharp(cropped).composite([{ input: cover, top: 0, left: 0 }]));
  ok &&= r.ok;
  manifest.cards[mood] = r.entry;
}

writeFileSync(resolve(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.exit(ok ? 0 : 1);
