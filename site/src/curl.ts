// The page curl: the signature turn of the changelog book. src/changelog.ts
// loads this only with motion on, at 64rem and wider (or for the strip's Next
// on a phone), when WebGL2 is there and Save-Data is not set. Anything that
// goes wrong on the way (no context, a software rasteriser, a tainted canvas,
// a lost context) hands the turn back to the CSS tear for the rest of the
// visit; the page never waits on this file.
//
// One WebGLRenderer and one canvas, fixed over the viewport under the bar. A
// slip is captured to a texture, the DOM slip hides, and a plane drawn at the
// slip's exact rect curls away (src/shaders/curl.*.glsl). The render runs on
// GSAP's ticker only while a turn is on; between turns nothing draws.
import { gsap } from "gsap";
import {
  CanvasTexture,
  Color,
  DoubleSide,
  LinearFilter,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
} from "three";
import { reader, tear, useEffect, useStripEffect, type TurnEffect } from "./changelog";
import fragmentShader from "./shaders/curl.frag.glsl?raw";
import vertexShader from "./shaders/curl.vert.glsl?raw";

const SOFTWARE = /llvmpipe|lavapipe|swiftshader|software|cpu/i;
const FORCE = new URLSearchParams(location.search).has("fx-force");
const FOV = 30;
// The axis the curl travels: up the slip, leaning 12 degrees left, the way a
// receipt is torn off a printer.
const LEAN = (12 * Math.PI) / 180;
const DURATION = 0.75;

// Drawing pixels per CSS pixel: lighter on a phone.
const ratio = () => Math.min(devicePixelRatio, matchMedia("(max-width: 47.99rem)").matches ? 1.5 : 2);

// The tear curve, cubic-bezier(0.7, 0, 0.2, 1), solved for x by bisection.
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const at = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x: number) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}
const ease = bezier(0.7, 0, 0.2, 1);

let broken = false;
let gl: {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  uniforms: Record<string, { value: unknown }>;
} | null = null;
let tween: gsap.core.Tween | null = null;

function token(name: string) {
  return new Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
}

function create() {
  if (gl) return gl;
  const canvas = document.createElement("canvas");
  canvas.className = "curl";
  canvas.setAttribute("aria-hidden", "true");
  canvas.hidden = true;
  document.body.append(canvas);
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    powerPreference: "low-power",
    // A weak or software GPU fails here and the tear takes over.
    failIfMajorPerformanceCaveat: !FORCE,
    stencil: false,
    premultipliedAlpha: true,
  });
  const context = renderer.getContext();
  const debug = context.getExtension("WEBGL_debug_renderer_info");
  const name = String(context.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : context.RENDERER));
  if (!FORCE && SOFTWARE.test(name)) {
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    throw new Error("software renderer");
  }
  canvas.addEventListener("webglcontextlost", () => {
    broken = true;
    dispose();
  });
  renderer.setPixelRatio(ratio());
  const uniforms = {
    uFront: { value: null as CanvasTexture | null },
    uProgress: { value: 0 },
    uDir: { value: new Vector2(-Math.sin(LEAN), Math.cos(LEAN)) },
    uSpan: { value: new Vector2() },
    uRadius: { value: 40 },
    INK_SOFT: { value: token("--color-ink-soft") },
    SLIP: { value: token("--color-slip") },
  };
  const mesh = new Mesh(
    new PlaneGeometry(1, 1, 1, 1),
    new ShaderMaterial({ uniforms, vertexShader, fragmentShader, side: DoubleSide, transparent: false }),
  );
  const scene = new Scene();
  scene.add(mesh);
  gl = { renderer, scene, camera: new PerspectiveCamera(FOV, 1, 1, 10000), mesh, uniforms };
  return gl;
}

// Disposal: on pagehide, the motion switch going off, or the book closing.
// Everything GPU-side goes, then the context itself.
export function dispose() {
  tween?.progress(1);
  tween = null;
  for (const entry of cache.values()) entry.texture?.dispose();
  cache.clear();
  if (!gl) return;
  gl.mesh.geometry.dispose();
  gl.mesh.material.dispose();
  gl.renderer.dispose();
  gl.renderer.forceContextLoss();
  gl.renderer.domElement.remove();
  gl = null;
}

// --- capture -----------------------------------------------------------------
//
// The slip is drawn by the browser itself: cloned into an SVG foreignObject
// with the page's own stylesheets and fonts inlined (same origin, no network),
// so the tone, the masks and the sound words match the DOM exactly. A browser
// that taints the canvas for this throws at upload, and the tear takes over.

let styles: Promise<string> | null = null;

async function inline(url: string) {
  const blob = await (await fetch(url)).blob();
  return new Promise<string>((done) => {
    const reader = new FileReader();
    reader.onload = () => done(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function css() {
  styles ??= (async () => {
    const rules: string[] = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) rules.push(rule.cssText);
      } catch {}
    }
    let text = rules.join("\n");
    const fonts = [...new Set([...text.matchAll(/url\("?([^")]+\.woff2)"?\)/g)].map((m) => m[1]))];
    for (const font of fonts) text = text.split(font).join(await inline(new URL(font, location.href).href));
    // The capture is the slip alone: no roll behind it, nothing moving.
    return `${text}\n.rel-pages::before,.rel-pages::after{display:none!important}\n` +
      // An image holds its animations at their first frame: show the end state.
      `*,*::before,*::after{animation:none!important;transition:none!important}`;
  })();
  return styles;
}

type Shot = { key: string; canvas: HTMLCanvasElement; texture?: CanvasTexture };

// The slip's box rounded out to whole pixels, and where in it the slip sits.
// The capture lays the slip out at the same fraction of a pixel as the page
// does, so text and tone snap to the same pixels and frame 0 matches.
function frame(rect: DOMRect) {
  const x = Math.floor(rect.left);
  const y = Math.floor(rect.top);
  const w = Math.ceil(rect.right) - x;
  const h = Math.ceil(rect.bottom) - y;
  return { x, y, w, h, dx: rect.left - x, dy: rect.top - y, width: rect.width, height: rect.height };
}
const cache = new Map<HTMLElement, Shot>();

async function capture(slip: HTMLElement, rect: DOMRect): Promise<Shot> {
  const { w, h, dx, dy, width, height } = frame(rect);
  const key = [dx, dy, width, height, innerWidth].join();
  const hit = cache.get(slip);
  if (hit && hit.key === key) {
    cache.delete(slip);
    cache.set(slip, hit);
    return hit;
  }
  if (hit) {
    hit.texture?.dispose();
    cache.delete(slip);
  }
  await document.fonts.ready;
  const clone = slip.cloneNode(true) as HTMLElement;
  clone.removeAttribute("hidden");
  clone.removeAttribute("id");
  clone.classList.remove("is-top", "is-leaving", "is-entering", "is-tearing", "is-tearing-back", "is-curling");
  clone.style.cssText +=
    `;position:relative;left:${dx}px;top:${dy}px;width:${width}px;height:${height}px;margin:0;translate:none;rotate:none`;
  const markup = new XMLSerializer().serializeToString(clone);
  // The image is its own viewport: it takes the window's size, so the page's
  // media queries and vw and vh units resolve as they do on screen, and the
  // page's own mode (book or strip) carries over. The slip is cropped out.
  const vw = innerWidth;
  const vh = Math.max(innerHeight, h);
  const mode = document.documentElement.dataset.book === undefined ? "" : ' data-book="" data-reader=""';
  const html =
    `<html xmlns="http://www.w3.org/1999/xhtml"${mode} data-motion="off" lang="en">` +
    `<head><style>${(await css()).replace(/</g, "\\3c ")}</style></head>` +
    `<body style="margin:0;background:none"><div class="release" style="display:block;margin:0;padding:0;background:none">` +
    `<div class="rel-pages" style="display:block;width:${w}px;height:${h}px">${markup}</div></div></body></html>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}">` +
    `<foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  // One texel per drawn pixel, so frame 0 matches the DOM; the long edge at
  // most 2048.
  const scale = Math.min(ratio(), 2048 / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d")!.drawImage(image, 0, 0, w, h, 0, 0, canvas.width, canvas.height);
  const shot = { key, canvas };
  cache.set(slip, shot);
  // Keep the last three.
  while (cache.size > 3) {
    const [oldest, entry] = cache.entries().next().value!;
    entry.texture?.dispose();
    cache.delete(oldest);
  }
  return shot;
}

// --- the curl ------------------------------------------------------------------

async function curl(slip: HTMLElement, forward: boolean, onStart?: () => void) {
  const rect = slip.getBoundingClientRect();
  if (!rect.width || !rect.height) throw new Error("slip has no box");
  const { x, y, w, h } = frame(rect);
  const shot = await capture(slip, rect);
  const g = create();
  const { renderer, camera, mesh, uniforms } = g;

  if (!shot.texture) {
    shot.texture = new CanvasTexture(shot.canvas);
    shot.texture.colorSpace = SRGBColorSpace;
    // Mipmaps average thin strokes into grey; the plane never shrinks far.
    shot.texture.generateMipmaps = false;
    shot.texture.minFilter = LinearFilter;
  }
  // Throws on a tainted canvas: the caller falls back to the tear.
  renderer.initTexture(shot.texture);

  // The fixed canvas's box, not innerWidth: a scrollbar would stretch the frame.
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  renderer.setSize(vw, vh, false);
  camera.aspect = vw / vh;
  camera.position.set(0, 0, vh / 2 / Math.tan((FOV * Math.PI) / 360));
  camera.updateProjectionMatrix();
  // The plane is built in CSS pixels at the slip's size, so the shader's
  // span and radius are pixels too.
  const { parameters } = mesh.geometry;
  if (parameters.width !== w || parameters.height !== h) {
    const segments = matchMedia("(max-width: 47.99rem)").matches ? 24 : 32;
    mesh.geometry.dispose();
    mesh.geometry = new PlaneGeometry(w, h, segments, segments);
  }
  // Whole pixels, so texels land on pixels and nothing is resampled.
  mesh.position.set(x + w / 2 - vw / 2, vh / 2 - (y + h / 2), 0);
  const dir = uniforms.uDir.value as Vector2;
  const corners = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [-w / 2, h / 2],
    [w / 2, h / 2],
  ].map(([x, y]) => x * dir.x + y * dir.y);
  (uniforms.uSpan.value as Vector2).set(Math.min(...corners), Math.max(...corners));
  uniforms.uFront.value = shot.texture;

  const draw = (p: number) => {
    uniforms.uProgress.value = p;
    uniforms.uRadius.value = h * (0.12 - 0.07 * p);
    renderer.render(g.scene, camera);
  };
  const progress = { value: forward ? 0 : 1 };
  draw(progress.value);
  renderer.domElement.hidden = false;
  slip.classList.add("is-curling");
  onStart?.();

  const hurry = () => tween && gsap.to(tween, { progress: 1, duration: 0.12, ease: "none" });
  const resize = () => tween?.progress(1);
  addEventListener("changelog:hurry", hurry);
  addEventListener("resize", resize);
  try {
    await new Promise<void>((done) => {
      tween = gsap.to(progress, {
        value: forward ? 1 : 0,
        duration: DURATION,
        ease,
        onUpdate: () => draw(progress.value),
        onComplete: done,
      });
    });
  } finally {
    tween = null;
    removeEventListener("changelog:hurry", hurry);
    removeEventListener("resize", resize);
    renderer.domElement.hidden = true;
    slip.classList.remove("is-curling");
  }
}

// The book: Next curls the slip leaving off the roll; Back brings the earlier
// slip down onto it. The cover is not a slip, so it keeps the tear.
const turn: TurnEffect = async (from, to, dir, begin) => {
  const moving = reader.slipOf(dir === 1 ? from : to);
  if (broken || !moving.classList.contains("page")) return tear(from, to, dir, begin);
  try {
    // Going on, the sheet has lifted off the head's side a quarter of the way
    // in; going back, the arriving sheet covers the slip past halfway.
    await curl(moving, dir === 1, () => begin(DURATION * (dir === 1 ? 250 : 550)));
  } catch {
    broken = true;
    dispose();
    return tear(from, to, dir, begin);
  }
};

// The strip, on a phone: the slip at the foot of a release curls away when
// its Next is tapped, then the page scrolls on. It comes back once the curl
// is done; on the strip every slip stays on the roll.
async function strip(slip: HTMLElement) {
  if (broken) return;
  try {
    await curl(slip, true);
  } catch {
    broken = true;
    dispose();
  }
}

// Capture ahead, so a press of Next or Back finds its texture ready.
function warm() {
  if (broken) return;
  const leaves = reader.leaves;
  const around = [leaves[reader.current], leaves[reader.current - 1]].filter(Boolean).map((l) => reader.slipOf(l));
  const idle = (fn: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(fn) : setTimeout(fn, 200));
  idle(() => {
    for (const slip of around) {
      if (!slip.classList.contains("page")) continue;
      const rect = slip.getBoundingClientRect();
      if (rect.width && rect.height) void capture(slip, rect).catch(() => {});
    }
  });
}

export function attach() {
  // The curl clears the slip's head area later than the tear does.
  useEffect(turn);
  useStripEffect(strip);
  warm();
  addEventListener("changelog:turned", warm);
  addEventListener("pagehide", dispose);
  addEventListener("changelog:motion", (e) => {
    if ((e as CustomEvent).detail === "off") dispose();
  });
  addEventListener("changelog:mode", dispose);
}
