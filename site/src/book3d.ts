// The 3D book: the changelog's page turn in three.js, timed by GSAP.
// src/changelog.ts loads this after first paint, only on a wide screen with
// motion on, WebGL2 there, Save-Data off and a device with memory to spare.
// Anything that goes wrong (no context, a software rasteriser, a tainted
// canvas, a lost context, a slow GPU) hands the turn back to the CSS slide for
// the rest of the visit; the page never waits on this file.
//
// One canvas, fixed over the viewport. Each spread is captured to a texture
// (the DOM drawn into an SVG foreignObject). For a turn, a flat plane holds
// the page that stays, and a leaf lifts off the other page, bends and lands
// on the far side showing the arriving page (src/shaders/book.*.glsl). The DOM
// under it already shows the arriving spread. Nothing draws between turns.
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
import { artUrl, reader, slide, type Turn } from "./changelog";
import fragmentShader from "./shaders/book.frag.glsl?raw";
import vertexShader from "./shaders/book.vert.glsl?raw";

const SOFTWARE = /llvmpipe|lavapipe|swiftshader|software|cpu/i;
const FORCE = new URLSearchParams(location.search).has("fx-force");
const FOV = 30;
const DURATION = 0.9;
// How far the free edge lags the spine, in radians across the leaf, at mid-turn.
const BEND = 0.6;
// Below this, the GPU is too slow for the book: the slide takes over.
const MIN_FPS = 40;
const wide = matchMedia("(min-width: 64rem) and (min-height: 37.5rem)");
const ratio = () => Math.min(devicePixelRatio, 2);

let broken = false;
let tween: gsap.core.Tween | null = null;

type Page = { mesh: Mesh<PlaneGeometry, ShaderMaterial>; u: Record<string, { value: unknown }> };
let gl: { renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera; leaf: Page; still: Page } | null = null;

function token(name: string) {
  return new Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
}

function page(scene: Scene, z: number): Page {
  const u = {
    uFrom: { value: null as CanvasTexture | null },
    uTo: { value: null as CanvasTexture | null },
    uFromLeft: { value: 1 },
    uSpine: { value: 0.5 },
    uTheta: { value: 0 },
    uBend: { value: 0 },
    uSize: { value: new Vector2(1, 1) },
    INK_SOFT: { value: token("--color-ink-soft") },
  };
  const mesh = new Mesh(new PlaneGeometry(1, 1, 48, 1), new ShaderMaterial({ uniforms: u, vertexShader, fragmentShader, side: DoubleSide }));
  mesh.position.z = z;
  scene.add(mesh);
  return { mesh, u };
}

function create() {
  if (gl) return gl;
  const canvas = document.createElement("canvas");
  canvas.className = "book3d";
  canvas.setAttribute("aria-hidden", "true");
  canvas.hidden = true;
  document.body.append(canvas);
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
    failIfMajorPerformanceCaveat: !FORCE,
    stencil: false,
    // ?fx-force is for testing: keep frames so a screenshot can read them.
    preserveDrawingBuffer: FORCE,
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
  canvas.addEventListener("webglcontextlost", () => fail());
  renderer.setPixelRatio(ratio());
  const scene = new Scene();
  gl = { renderer, scene, camera: new PerspectiveCamera(FOV, 1, 1, 10000), still: page(scene, -0.5), leaf: page(scene, 0) };
  return gl;
}

export function dispose() {
  tween?.progress(1);
  tween = null;
  for (const shot of cache.values()) shot.texture?.dispose();
  cache.clear();
  if (!gl) return;
  for (const p of [gl.leaf, gl.still]) {
    p.mesh.geometry.dispose();
    p.mesh.material.dispose();
  }
  gl.renderer.dispose();
  gl.renderer.forceContextLoss();
  gl.renderer.domElement.remove();
  gl = null;
}

function fail() {
  broken = true;
  reader.useTurn(null);
  dispose();
}

// --- capture -----------------------------------------------------------------
//
// The spread is drawn by the browser itself: cloned into an SVG foreignObject
// with the page's own stylesheets, fonts and art inlined (same origin, from
// the cache), so type and art match the DOM. Hidden spreads are captured too:
// all spreads share one size, so the open one gives the box.

const dataUrls = new Map<string, Promise<string>>();
function inline(url: string) {
  let hit = dataUrls.get(url);
  if (!hit) {
    hit = fetch(url)
      .then((r) => r.blob())
      .then((blob) => new Promise<string>((done) => {
        const r = new FileReader();
        r.onload = () => done(String(r.result));
        r.readAsDataURL(blob);
      }));
    dataUrls.set(url, hit);
  }
  return hit;
}

let styles: Promise<string> | null = null;
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
    // An image holds its animations at their first frame: show the end state.
    return `${text}\n*,*::before,*::after{animation:none!important;transition:none!important}`;
  })();
  return styles;
}

type Shot = { key: string; canvas: HTMLCanvasElement; texture?: CanvasTexture };
const cache = new Map<number, Shot>();

// The spread's box rounded out to whole pixels, and where in it the spread
// sits. The capture lays the spread out at the same fraction of a pixel as
// the page does, so texels land on pixels and frame 0 matches the DOM.
function frame(rect: DOMRect) {
  const x = Math.floor(rect.left);
  const y = Math.floor(rect.top);
  const w = Math.ceil(rect.right) - x;
  const h = Math.ceil(rect.bottom) - y;
  return { x, y, w, h, dx: rect.left - x, dy: rect.top - y };
}

async function capture(i: number, rect: DOMRect): Promise<Shot> {
  const { w, h, dx, dy } = frame(rect);
  const key = [w, h, dx, dy, rect.width, rect.height, innerWidth, innerHeight].join();
  const hit = cache.get(i);
  if (hit && hit.key === key) {
    cache.delete(i);
    cache.set(i, hit);
    return hit;
  }
  hit?.texture?.dispose();
  cache.delete(i);
  await document.fonts.ready;
  const spread = reader.spreads[i];
  const clone = spread.cloneNode(true) as HTMLElement;
  clone.removeAttribute("hidden");
  clone.removeAttribute("id");
  clone.classList.remove("is-leaving", "is-arriving");
  clone.style.cssText += `;position:relative;left:${dx}px;top:${dy}px;width:${rect.width}px;height:${rect.height}px;margin:0;box-shadow:none`;
  const picture = clone.querySelector("picture");
  const img = clone.querySelector<HTMLImageElement>(".art-img");
  if (picture && img) {
    const flat = document.createElement("img");
    for (const a of ["class", "width", "height", "alt"]) flat.setAttribute(a, img.getAttribute(a) ?? "");
    flat.src = await inline(new URL(artUrl(i), location.href).href);
    picture.replaceWith(flat);
  }
  const markup = new XMLSerializer().serializeToString(clone);
  // The image is its own viewport at the window's size, so media queries and
  // viewport units resolve as they do on screen.
  const vw = innerWidth;
  const vh = Math.max(innerHeight, h);
  const html =
    `<html xmlns="http://www.w3.org/1999/xhtml" data-motion="off" data-ready="" lang="en">` +
    `<head><style>${(await css()).replace(/</g, "\\3c ")}</style></head>` +
    `<body style="margin:0;background:none"><div class="book" style="display:grid;width:${w}px;height:${h}px;margin:0">${markup}</div></body></html>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}">` +
    `<foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const scale = Math.min(ratio(), 4096 / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d")!.drawImage(image, 0, 0, w, h, 0, 0, canvas.width, canvas.height);
  const shot: Shot = { key, canvas };
  cache.set(i, shot);
  // Keep the open spread and its two neighbours.
  while (cache.size > 3) {
    const [oldest, entry] = cache.entries().next().value!;
    entry.texture?.dispose();
    cache.delete(oldest);
  }
  return shot;
}

function texture(shot: Shot, renderer: WebGLRenderer) {
  if (!shot.texture) {
    shot.texture = new CanvasTexture(shot.canvas);
    shot.texture.colorSpace = SRGBColorSpace;
    shot.texture.generateMipmaps = false;
    shot.texture.minFilter = LinearFilter;
    shot.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  }
  // Throws on a tainted canvas: the caller falls back to the slide.
  renderer.initTexture(shot.texture);
  return shot.texture;
}

// --- the turn -----------------------------------------------------------------

const turn: Turn = async (from, to, dir) => {
  if (broken || !wide.matches) return slide(from, to, dir);
  const i = reader.spreads.indexOf(from);
  const j = reader.spreads.indexOf(to);
  // Hold the leaving spread on screen until the textures are ready.
  from.removeAttribute("hidden");
  to.setAttribute("hidden", "");
  const rect = from.getBoundingClientRect();
  let shown = false;
  try {
    if (!rect.width || !rect.height) throw new Error("no box");
    const [a, b] = await Promise.all([capture(i, rect), capture(j, rect)]);
    const g = create();
    const { renderer, camera, scene, leaf, still } = g;
    const fromTex = texture(a, renderer);
    const toTex = texture(b, renderer);

    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    renderer.setSize(vw, vh, false);
    camera.aspect = vw / vh;
    camera.position.set(0, 0, vh / 2 / Math.tan((FOV * Math.PI) / 360));
    camera.updateProjectionMatrix();
    // The spine, in the camera's pixels, and where it falls in the texture.
    const r = from.getBoundingClientRect();
    const f = frame(r);
    const spine = r.left + r.width / 2;
    const widths = [spine - f.x, f.x + f.w - spine];
    // Older (dir 1): the art page lifts and lands on the right; newer: the
    // notes page lifts and lands on the left. The other page of the leaving
    // spread stays put until the leaf covers it.
    const older = dir === 1;
    for (const [p, left] of [
      [leaf, older],
      [still, !older],
    ] as const) {
      p.mesh.position.x = spine - vw / 2;
      p.mesh.position.y = vh / 2 - (f.y + f.h / 2);
      (p.u.uSize.value as Vector2).set(widths[left ? 0 : 1], f.h);
      p.u.uSpine.value = (spine - f.x) / f.w;
    }
    Object.assign(leaf.u.uFrom, { value: fromTex });
    Object.assign(leaf.u.uTo, { value: toTex });
    leaf.u.uFromLeft.value = older ? 1 : 0;
    Object.assign(still.u.uFrom, { value: fromTex });
    Object.assign(still.u.uTo, { value: fromTex });
    still.u.uFromLeft.value = older ? 0 : 1;
    still.u.uTheta.value = older ? 0 : Math.PI;
    still.u.uBend.value = 0;

    const draw = (p: number) => {
      leaf.u.uTheta.value = older ? Math.PI * (1 - p) : Math.PI * p;
      leaf.u.uBend.value = (older ? BEND : -BEND) * Math.sin(Math.PI * p);
      renderer.render(scene, camera);
    };
    draw(0);
    renderer.domElement.hidden = false;
    shown = true;
    from.setAttribute("hidden", "");
    to.removeAttribute("hidden");

    const progress = { value: 0 };
    const frames: number[] = [];
    const hurry = () => tween && gsap.to(tween, { progress: 1, duration: 0.15, ease: "none" });
    const resize = () => tween?.progress(1);
    addEventListener("changelog:hurry", hurry);
    addEventListener("resize", resize);
    try {
      await new Promise<void>((done) => {
        tween = gsap.to(progress, {
          value: 1,
          duration: DURATION,
          ease: "power2.inOut",
          onUpdate: () => {
            frames.push(performance.now());
            draw(progress.value);
          },
          onComplete: done,
        });
      });
    } finally {
      tween = null;
      removeEventListener("changelog:hurry", hurry);
      removeEventListener("resize", resize);
    }
    // A GPU that could not keep up gets the slide from now on.
    if (frames.length > 8 && !FORCE) {
      const span = frames.at(-1)! - frames[3];
      if ((frames.length - 4) / (span / 1000) < MIN_FPS) fail();
    }
  } catch {
    fail();
    to.removeAttribute("hidden");
    from.setAttribute("hidden", "");
    if (!shown) return slide(from, to, dir);
  } finally {
    if (gl) gl.renderer.domElement.hidden = true;
  }
  warm();
};

// Capture ahead, so a turn finds its textures ready.
function warm() {
  if (broken) return;
  const idle = (fn: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 300));
  idle(async () => {
    if (!wide.matches) return;
    const at = reader.current;
    const rect = reader.spreads[at].getBoundingClientRect();
    if (!rect.width) return;
    for (const k of [at, at + 1, at - 1]) {
      if (k < 0 || k >= reader.spreads.length) continue;
      try {
        await capture(k, rect);
      } catch {}
    }
  });
}

export function attach() {
  try {
    create();
  } catch {
    return fail();
  }
  reader.useTurn(turn);
  warm();
  addEventListener("pagehide", dispose);
  addEventListener("changelog:motion", (e) => {
    if ((e as CustomEvent).detail === "off") dispose();
  });
}
