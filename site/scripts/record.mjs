#!/usr/bin/env node
// Screen recordings of a smooth top-to-bottom scroll at desktop 1440x900 and
// mobile 390x844, motion on, with the live WebGL pile
// (SwiftShader, via ?fx-force). Writes scroll-desktop.webm and
// scroll-mobile.webm into OUT, plus .mp4 copies when ffmpeg is on the PATH.
//
// Needs the built site served at SITE_URL (default http://localhost:4321/).
// SECONDS sets the scroll duration (default 30).
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { BASE, launch } from "./chrome.mjs";

const OUT = process.env.OUT ?? new URL("../../../nuits-receipts-site-shots/", import.meta.url).pathname;
const SECONDS = Number(process.env.SECONDS ?? 30);
const takes = [
  { name: "scroll-desktop", width: 1440, height: 900 },
  { name: "scroll-mobile", width: 390, height: 844 },
];

mkdirSync(OUT, { recursive: true });
const browser = await launch(true);
for (const t of takes) {
  const dir = `${OUT}.video-${t.name}`;
  const context = await browser.newContext({
    viewport: { width: t.width, height: t.height },
    recordVideo: { dir, size: { width: t.width, height: t.height } },
  });
  const page = await context.newPage();
  await page.goto(`${BASE}?fx-force`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  // One scrollTo per animation frame along an ease-in-out curve, so the
  // recording shows the scrubbed scenes the way a steady reader would.
  await page.evaluate(
    (ms) =>
      new Promise((done) => {
        const max = document.documentElement.scrollHeight - innerHeight;
        const start = performance.now();
        const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
        const step = (now) => {
          const p = Math.min(1, (now - start) / ms);
          scrollTo(0, ease(p) * max);
          p < 1 ? requestAnimationFrame(step) : done();
        };
        requestAnimationFrame(step);
      }),
    SECONDS * 1000,
  );
  await page.waitForTimeout(1500);
  const video = page.video();
  await context.close();
  const webm = `${OUT}${t.name}.webm`;
  renameSync(await video.path(), webm);
  rmSync(dir, { recursive: true, force: true });
  console.log(`wrote ${webm}`);
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", "-movflags", "+faststart", `${OUT}${t.name}.mp4`]);
    console.log(`wrote ${OUT}${t.name}.mp4`);
  } catch {
    console.log("  ffmpeg not available; webm only");
  }
}
await browser.close();
