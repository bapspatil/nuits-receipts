#!/usr/bin/env node
// Hero and full-page screenshots at 390 and 1440 wide. Hero shots run with
// motion on and the live WebGPU field. Full-page shots use reduced motion,
// because a full-page capture of pinned scenes stitches pin spacers into
// empty bands; reduced motion is the settled end state of every scene.
import { mkdirSync } from "node:fs";
import { BASE, launch } from "./chrome.mjs";

const OUT = process.env.OUT ?? new URL("../../../nuits-receipts-site-shots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await launch(true);
const shots = [
  { file: "mobile-390-hero.png", width: 390, height: 844, scale: 2, full: false },
  { file: "mobile-390-full.png", width: 390, height: 844, scale: 1, full: true },
  { file: "desktop-1440-hero.png", width: 1440, height: 900, scale: 1, full: false },
  { file: "desktop-1440-full.png", width: 1440, height: 900, scale: 1, full: true },
];
for (const s of shots) {
  const context = await browser.newContext({
    viewport: { width: s.width, height: s.height },
    deviceScaleFactor: s.scale,
    reducedMotion: s.full ? "reduce" : "no-preference",
  });
  const page = await context.newPage();
  await page.goto(`${BASE}?fx-force`, { waitUntil: "networkidle" });
  await page.waitForSelector(".pile[data-ready]", { state: "attached" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + s.file, fullPage: s.full });
  console.log(`wrote ${OUT}${s.file}`);
  await context.close();
}
await browser.close();
