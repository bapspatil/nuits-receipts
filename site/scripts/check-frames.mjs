#!/usr/bin/env node
// Scrolls the page in small steps (0.3 of a viewport) at 390 and 1440 wide,
// in three modes, screenshots every frame and fails on any blank state:
//
//   on       motion on, SwiftShader WebGPU and WebGL, so the live fields run
//   reduce   prefers-reduced-motion, the static end state of everything
//   nowebgl  motion on in a browser with WebGL and WebGPU disabled, so every
//            canvas falls back to its pre-rendered image
//
// Pages: the home page, and /changelog/. At 1440 the changelog is the book,
// so instead of scrolling it turns with Next through every slip and shoots
// each settled page, then scrolls the last one to the footer. At 390 it is
// the strip and scrolls like the home page.
//
// A frame fails when:
//   - the whole viewport is near-uniform, or has no visible text;
//   - a watched element (headings, illustrations, slips, steps, facts) that
//     is substantially on screen is a flat box in the screenshot, or, for a
//     heading, has no visible words. This is the check for the new motion
//     layer: a split heading, a draw-on icon or a rising slip must never be an
//     empty or invisible shape while it is in view;
//   - an ink section (How it works, the close) is on screen without its
//     dot-matrix print, live or fallback: no exact inkSoft dots in its box.
//
// Needs the built site served at SITE_URL (default http://localhost:4321/).
// PAGES=/,/changelog/ limits or extends the pages.
// Frames go to OUT (default ../../nuits-receipts-site-shots/frames).
// MODES=on,reduce limits the run.
import { mkdirSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { BASE, launch } from "./chrome.mjs";

const OUT = process.env.OUT ?? new URL("../../../nuits-receipts-site-shots/frames/", import.meta.url).pathname;
const MIN_STDDEV = 6;
// A frame that is 99% one colour still has about 13,000 pixels of something
// at 1440x900, which is a paragraph. Above that it is a stall. 97% flagged
// honest frames of a dark scene with one row of copy on it.
const MAX_DOMINANT = 0.99;
// An element crop flatter than this is an empty box: a white slip with
// nothing on it measures under 1, one line of body text measures over 20.
const MIN_ELEMENT_STDDEV = 3;
// The ink print puts about 2% exact inkSoft dots in its sparsest band.
const MIN_INK_DOTS = 0.002;
const INK_SOFT = [0x35, 0x56, 0x50];
// Mid-scrub, not settled: the scrub smoothing is 0.6 s, so this catches frames
// while pinned scenes are still moving.
const SETTLE_MS = 180;
const STEP = 0.3;

const WATCHED = [
  ".hero-title",
  ".scene .title",
  ".close-title",
  ".ill",
  ".slip",
  ".step",
  ".fact",
  ".statement",
  ".disclaimer",
  ".cl-title",
  ".rel-version",
  ".panel",
  ".cl-stamp",
  ".rel-foot",
];

const modes = (process.env.MODES ?? "on,reduce,nowebgl").split(",");
const pages = (process.env.PAGES ?? "/,/changelog/").split(",");
const runs = pages.flatMap((path) =>
  [390, 1440].flatMap((width) => modes.map((motion) => ({ path, width, height: width === 390 ? 844 : 900, motion }))),
);

function stats(png, box) {
  const x0 = Math.max(0, Math.floor(box?.x ?? 0));
  const y0 = Math.max(0, Math.floor(box?.y ?? 0));
  const x1 = Math.min(png.width, Math.ceil(box ? box.x + box.w : png.width));
  const y1 = Math.min(png.height, Math.ceil(box ? box.y + box.h : png.height));
  const counts = new Map();
  let sum = 0;
  let sumSq = 0;
  let ink = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * png.width + x) * 4;
      const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]];
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += l;
      sumSq += l * l;
      n++;
      if (r === INK_SOFT[0] && g === INK_SOFT[1] && b === INK_SOFT[2]) ink++;
      const key = (r << 16) | (g << 8) | b;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const mean = sum / Math.max(n, 1);
  return {
    stddev: Math.sqrt(Math.max(0, sumSq / Math.max(n, 1) - mean * mean)),
    dominant: n ? Math.max(...counts.values()) / n : 1,
    ink: n ? ink / n : 0,
  };
}

// Runs in the page. Visible text counts text nodes whose element is not
// hidden, transparent or clipped away entirely; watched boxes are the
// on-screen part of each watched element that is at least 40% (or 160px) in.
function inspect(watched) {
  const hidden = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.05) return true;
      if (/inset\((100%|calc\(100%)/.test(cs.clipPath)) return true;
      if (e.hidden || cs.contentVisibility === "hidden") return true;
      if (e.closest("[aria-hidden='true']") === e && e.tagName !== "svg") return true;
    }
    return false;
  };
  const onScreen = (r) => r.width >= 1 && r.height >= 1 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  const textIn = (root) => {
    let count = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const el = node.parentElement;
      if (!el || seen.has(el) || !node.textContent.trim()) continue;
      seen.add(el);
      const range = document.createRange();
      range.selectNodeContents(node);
      if (onScreen(range.getBoundingClientRect()) && !hidden(el)) count++;
    }
    return count;
  };
  const boxes = [];
  for (const el of document.querySelectorAll(watched.join(","))) {
    const r = el.getBoundingClientRect();
    const isText = el.matches(".hero-title, .title, .close-title, .cl-title, .rel-version");
    // A slip waiting its turn in the book is not on show.
    if (el.closest("[hidden]")) continue;
    // A hidden heading is exactly the failure, so headings are never skipped.
    if (!onScreen(r) || (!isText && hidden(el))) continue;
    const x = Math.max(0, r.left);
    const y = Math.max(0, r.top);
    const w = Math.min(innerWidth, r.right) - x;
    const h = Math.min(innerHeight, r.bottom) - y;
    // Skip slivers clipped by either viewport edge: a strip of an icon's empty
    // margin peeking in from the side of the horizontal steps is not a state.
    if (h < Math.min(160, r.height * 0.4) || w < Math.min(160, r.width * 0.4)) continue;
    boxes.push({ name: el.className.baseVal ?? el.className, x, y, w, h, text: isText ? (hidden(el) ? 0 : textIn(el)) : null });
  }
  const ink = [];
  for (const el of document.querySelectorAll(".how, .close")) {
    const r = el.getBoundingClientRect();
    const y = Math.max(0, r.top);
    const h = Math.min(innerHeight, r.bottom) - y;
    if (h >= 200) ink.push({ name: el.className, x: 0, y, w: innerWidth, h, live: !!el.querySelector(".ink-field[data-ready]:not([hidden])") });
  }
  return { text: textIn(document.body), boxes, ink };
}

mkdirSync(OUT, { recursive: true });
const browsers = {};
const browserFor = async (motion) =>
  (browsers[motion === "nowebgl" ? "off" : "gpu"] ??=
    motion === "nowebgl" ? await launch(false, ["--disable-webgl", "--disable-3d-apis"]) : await launch(true));
const failures = [];
const summary = [];

async function shoot(page, run, tag, index, y, total) {
  const name = `${tag}-${String(index).padStart(3, "0")}.png`;
  const buffer = await page.screenshot();
  writeFileSync(OUT + name, buffer);
  const png = PNG.sync.read(buffer);
  const whole = stats(png);
  const seen = await page.evaluate(inspect, WATCHED);
  const problems = [];
  if (whole.stddev < MIN_STDDEV || whole.dominant > MAX_DOMINANT || seen.text === 0)
    problems.push(`frame stddev ${whole.stddev.toFixed(1)}, dominant ${(whole.dominant * 100).toFixed(1)}%, ${seen.text} text`);
  for (const b of seen.boxes) {
    const s = stats(png, b);
    if (s.stddev < MIN_ELEMENT_STDDEV) problems.push(`"${b.name}" is a flat box (stddev ${s.stddev.toFixed(1)})`);
    if (b.text === 0) problems.push(`"${b.name}" heading has no visible words`);
  }
  let live = 0;
  if (run.path === "/")
    for (const b of seen.ink) {
      if (b.live) live++;
      const s = stats(png, b);
      if (s.ink < MIN_INK_DOTS) problems.push(`"${b.name}" has no dot print (${(s.ink * 100).toFixed(2)}% dots)`);
    }
  summary.push({ frame: name, y, stddev: +whole.stddev.toFixed(1), text: seen.text, watched: seen.boxes.length, problems });
  for (const p of problems) failures.push(`${name}: ${p}`);
  return live;
}

async function scrollThrough(page, run, tag, from = 0, first = 0) {
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = Math.round(run.height * STEP);
  let i = first;
  let live = 0;
  for (let y = from; y <= total - run.height + step - 1; y += step, i++) {
    await page.evaluate((top) => window.scrollTo(0, top), Math.min(y, total - run.height));
    await page.waitForTimeout(SETTLE_MS);
    live += await shoot(page, run, tag, i, y, total);
  }
  return { frames: i - first, live, total };
}

for (const run of runs) {
  const browser = await browserFor(run.motion);
  const context = await browser.newContext({
    viewport: { width: run.width, height: run.height },
    reducedMotion: run.motion === "reduce" ? "reduce" : "no-preference",
  });
  const page = await context.newPage();
  const slug = run.path === "/" ? "home" : run.path.replace(/\W+/g, "");
  const tag = `${slug}-${run.width}-${run.motion}`;
  page.on("pageerror", (e) => failures.push(`${tag}: page error ${e.message}`));
  await page.goto(`${BASE.replace(/\/$/, "")}${run.path}?fx-force`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const isBook = await page.evaluate(() => document.documentElement.dataset.book !== undefined);
  if (isBook) {
    // Turn through every slip, shooting each settled page.
    let i = 0;
    for (;;) {
      await shoot(page, run, tag, i++, 0, 0);
      const last = await page.evaluate(() => document.querySelector(".ctl-next")?.getAttribute("aria-disabled") === "true");
      if (last) break;
      await page.click(".ctl-next");
      await page.waitForTimeout(run.motion === "reduce" ? 150 : 800);
    }
    const rest = await scrollThrough(page, run, tag, Math.round(run.height * STEP), i);
    console.log(`${tag}: ${i} slips turned, then ${rest.frames} scroll frames to the footer`);
  } else {
    const { frames, live, total } = await scrollThrough(page, run, tag);
    if (run.path === "/") {
      // The modes must actually differ: live print with motion on, never without.
      if (run.motion === "on" && live === 0) failures.push(`${tag}: the WebGL ink scene never went live`);
      if (run.motion !== "on" && live > 0) failures.push(`${tag}: the WebGL ink scene ran in ${run.motion} mode`);
    }
    console.log(`${tag}: ${frames} frames, page ${total}px, ${live} frames with live ink`);
  }
  await context.close();
}
for (const b of Object.values(browsers)) await b.close();

writeFileSync(OUT + "summary.json", JSON.stringify({ failures, summary }, null, 2));
const worst = [...summary].sort((a, b) => a.stddev - b.stddev)[0];
console.log(`lowest stddev ${worst.stddev} at ${worst.frame}; fewest text ${Math.min(...summary.map((s) => s.text))}`);
console.log(`watched elements checked: ${summary.reduce((n, s) => n + s.watched, 0)}`);
if (failures.length) {
  console.error(`${failures.length} blank or broken frames:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`All ${summary.length} frames have content.`);
