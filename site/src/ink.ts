import source from "./shaders/ink.glsl?raw";

export type Ink = { setAnimated(on: boolean): void };

const SOFTWARE = /llvmpipe|lavapipe|swiftshader|software|cpu/i;
const VERTEX = "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }";
// About 30 frames a second: the dots step a whole cell at a time, so more
// frames only cost battery.
const FRAME_MS = 33;

function token(name: string): [number, number, number] {
  const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim().slice(1);
  const n = parseInt(hex, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// One canvas and one WebGL context for both ink sections. The canvas is moved
// into whichever host is on screen (moving a canvas keeps its context), so the
// page never holds two contexts and never renders a section nobody can see.
// Resolves to null whenever the scene should not run; the hosts then keep the
// pre-rendered fallback image from scripts/measure-ink.mjs.
export function startInk(hosts: HTMLElement[]): Ink | null {
  const canvas = document.createElement("canvas");
  canvas.className = "ink-field";
  canvas.setAttribute("aria-hidden", "true");
  const options = { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "low-power" } as const;
  const gl = (canvas.getContext("webgl2", options) ?? canvas.getContext("webgl", options)) as WebGLRenderingContext | null;
  if (!gl) return null;
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  // A software rasteriser stutters, which is worse than the still image.
  if (!new URLSearchParams(location.search).has("fx-force") && SOFTWARE.test(renderer)) return null;

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, source));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (name: string) => gl.getUniformLocation(program, name);
  const [uRes, uTime, uProgress, uMode] = ["uRes", "uTime", "uProgress", "uMode"].map(u);
  gl.uniform3fv(u("INK"), token("--color-ink"));
  gl.uniform3fv(u("INK_SOFT"), token("--color-ink-soft"));

  const visible = new Set<HTMLElement>();
  let host: HTMLElement | null = null;
  let animated = false;
  let time = 0;
  let last = 0;
  let raf = 0;
  let lost = false;

  function draw() {
    if (!host || lost) return;
    // One device pixel per CSS pixel: the dot grid is defined in CSS pixels
    // and the canvas is shown pixelated, so a higher DPR adds nothing.
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl!.viewport(0, 0, w, h);
    }
    const rect = host.getBoundingClientRect();
    const progress = Math.min(1, Math.max(0, (innerHeight - rect.top) / (innerHeight + rect.height)));
    gl!.uniform2f(uRes, w, h);
    gl!.uniform1f(uTime, time);
    gl!.uniform1f(uProgress, animated ? progress : 1);
    gl!.uniform1f(uMode, host.classList.contains("close") ? 1 : 0);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    canvas.dataset.ready = "";
  }

  function tick(now: number) {
    raf = 0;
    if (!running()) return;
    if (now - last >= FRAME_MS) {
      if (last) time += Math.min(now - last, 100) / 1000;
      last = now;
      draw();
    }
    raf = requestAnimationFrame(tick);
  }

  const running = () => animated && host !== null && !document.hidden && !lost;
  function sync() {
    if (running() && !raf) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  }

  // The host is the on-screen ink section; the canvas follows it.
  function adopt(next: HTMLElement | null) {
    if (next === host) return;
    host = next;
    if (!host) return;
    host.prepend(canvas);
    delete canvas.dataset.ready;
    draw();
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visible.add(e.target as HTMLElement);
        else visible.delete(e.target as HTMLElement);
      }
      adopt(hosts.find((h) => visible.has(h)) ?? null);
      sync();
    },
    { rootMargin: "25% 0px" },
  );
  hosts.forEach((h) => io.observe(h));
  new ResizeObserver(() => draw()).observe(document.documentElement);
  addEventListener("scroll", () => !animated || draw(), { passive: true });
  document.addEventListener("visibilitychange", sync);
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    lost = true;
    delete canvas.dataset.ready;
  });

  return {
    // Motion off: no loop and no scroll response. The canvas steps aside and
    // the fallback image, the same settled frame, shows instead.
    setAnimated(on) {
      animated = on;
      canvas.hidden = !on;
      if (on) draw();
      sync();
    },
  };
}
