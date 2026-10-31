#!/usr/bin/env node
// Renders the pile's first frame (the heap, before the late slips arrive) and its
// filed and searched frame, at a wide and a narrow viewport, into
// public/pile/{heap,filed}-{wide,narrow}.webp.
// No WebGL, a software renderer, Save-Data, reduced motion, the switch set to
// off and no JavaScript all show these pixels, and the live canvas starts from
// the same seeded heap, so the hand-over from still to canvas does not jump.
// Run against a preview build: `bun run build && bun run preview`, then `bun run pile`.
import sharp from "sharp";
import { BASE, launch } from "./chrome.mjs";

const out = new URL("../public/pile/", import.meta.url).pathname;
const browser = await launch(false, ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]);
for (const [state, name, width, height] of [
  ["heap", "wide", 1440, 900],
  ["heap", "narrow", 390, 844],
  ["filed", "wide", 1440, 900],
  ["filed", "narrow", 390, 844],
]) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: "no-preference" });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem("motion", "on"));
  await page.goto(`${BASE}?fx-force${state === "filed" ? "&pile=filed" : ""}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".pile[data-ready]", { state: "attached", timeout: 20000 });
  await page.addStyleTag({
    content: ".reel-copy,.query,.slip-found,.bar,.pile-still,.pile-still-filed{visibility:hidden!important} html,body,.reel-stage{background:transparent!important}",
  });
  await page.waitForTimeout(400);
  const box = await page.locator(".reel-visual").boundingBox();
  const png = await page.screenshot({ clip: box, omitBackground: true });
  const file = `${out}${state}-${name}.webp`;
  await sharp(png).webp({ quality: 80, alphaQuality: 90, effort: 6 }).toFile(file);
  console.log(`wrote ${file} (${Math.round(box.width)}x${Math.round(box.height)} css px)`);
  await context.close();
}
await browser.close();
