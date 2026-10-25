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

// The brand palette a strip is snapped to (tokens.json): ink, white panels,
// paper gutters and the mint accent. Crimson is never in the art; it lives in
// the overlay, where its use can be controlled.
const PALETTE = [
  [0x0d, 0x3a, 0x36],
  [0xff, 0xff, 0xff],
  [0xe6, 0xef, 0xe9],
  [0x9f, 0xd3, 0xbc],
];

// Every pixel to its nearest palette colour: flat fills, no stray tints, and
// far fewer bytes than the generator's grain.
async function snap(pipeline) {
  const { data, info } = await pipeline.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 3) {
    let best = PALETTE[0];
    let dist = Infinity;
    for (const c of PALETTE) {
      const d = (data[i] - c[0]) ** 2 * 2 + (data[i + 1] - c[1]) ** 2 * 4 + (data[i + 2] - c[2]) ** 2 * 3;
      if (d < dist) [best, dist] = [c, d];
    }
    data[i] = best[0];
    data[i + 1] = best[1];
    data[i + 2] = best[2];
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } });
}

// median: a light median filter for art with pencil grain, which costs more
// bytes than it is worth on screen. palette: snap to the brand palette.
// small: also a 640 px wide AVIF and WebP for phones, so a strip is not
// fetched at full size for a 390 px screen.
const SMALL = 640;
async function emit(name, pipeline, { median = 0, palette = false, small = false } = {}) {
  let png = await (median ? sharp(await pipeline.png().toBuffer()).median(median) : pipeline).png().toBuffer();
  if (palette) png = await (await snap(sharp(png))).png().toBuffer();
  const { width, height } = await sharp(png).metadata();
  const avif = await sharp(png).avif({ quality: 55, effort: 6, chromaSubsampling: "4:2:0" }).toBuffer();
  const webp = await sharp(png).webp({ quality: 75, effort: 6 }).toBuffer();
  const thumb = await sharp(png).resize({ width: 256 }).webp({ quality: 70 }).toBuffer();
  const blur = await sharp(png).resize({ width: 24 }).blur(1.2).webp({ quality: 40 }).toBuffer();
  writeFileSync(resolve(OUT, `${name}.avif`), avif);
  writeFileSync(resolve(OUT, `${name}.webp`), webp);
  writeFileSync(resolve(OUT, `${name}-thumb.webp`), thumb);
  if (small) {
    const resized = await sharp(png).resize({ width: SMALL }).png().toBuffer();
    writeFileSync(resolve(OUT, `${name}-${SMALL}.avif`), await sharp(resized).avif({ quality: 55, effort: 6, chromaSubsampling: "4:2:0" }).toBuffer());
    writeFileSync(resolve(OUT, `${name}-${SMALL}.webp`), await sharp(resized).webp({ quality: 75, effort: 6 }).toBuffer());
  }
  const over = [];
  if (avif.length > AVIF_BUDGET) over.push(`AVIF ${(avif.length / KB).toFixed(0)} KB > ${AVIF_BUDGET / KB} KB`);
  if (webp.length > WEBP_BUDGET) over.push(`WebP ${(webp.length / KB).toFixed(0)} KB > ${WEBP_BUDGET / KB} KB`);
  console.log(`${over.length ? "FAIL" : "ok  "} ${name.padEnd(16)} ${width}x${height} avif ${(avif.length / KB).toFixed(0)} KB, webp ${(webp.length / KB).toFixed(0)} KB, thumb ${(thumb.length / KB).toFixed(0)} KB${over.length ? ` (${over.join(", ")})` : ""}`);
  return { ok: !over.length, entry: { width, height, ...(small ? { small: SMALL } : {}), avif: avif.length, webp: webp.length, blur: `data:image/webp;base64,${blur.toString("base64")}` } };
}

const manifest = { strips: {}, cards: {} };
let ok = true;

for (const [version, strip] of Object.entries(config.strips)) {
  const r = await emit(`strip-${version}`, sharp(resolve(ART, strip.src)), { median: strip.median ?? 3, palette: !!strip.palette, small: true });
  ok &&= r.ok;
  manifest.strips[version] = r.entry;
}

const sheet = resolve(ART, config.cards.src);
for (const [mood, panel] of Object.entries(config.cards.panels)) {
  const [left, top, width, height] = panel.crop;
  // A sheet with labels in its panels (NEUTRAL, PROUD, ...) can paint them
  // out in the panel's paper colour: the mood is the drawing's job.
  const covers = (panel.label ? [panel.label] : []).map(([lx, ly, lw, lh]) => ({
    input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" fill="#ffffff"/></svg>`),
    top: 0,
    left: 0,
  }));
  const cropped = await sharp(sheet).extract({ left, top, width, height }).png().toBuffer();
  const r = await emit(`card-${mood}`, sharp(cropped).composite(covers), { median: config.cards.median ?? 0, palette: !!config.cards.palette });
  ok &&= r.ok;
  manifest.cards[mood] = r.entry;
}

writeFileSync(resolve(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.exit(ok ? 0 : 1);
