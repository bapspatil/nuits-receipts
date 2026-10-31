import {
  CanvasTexture,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Object3D,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from "three";

// The pile: every receipt the app holds, drawn as one instanced mesh of paper
// slips. One state object drives it (src/reel.ts scrubs it), and render() is a
// pure function of that object, so a still frame, a scrubbed frame and a
// screenshot of the same state are the same pixels.

export type PileState = {
  arrive: number; // the late slips fall onto the heap (beat 1)
  read: number; // a reading front sweeps the heap and cleans each slip (beat 2)
  file: number; // slips fly into three year stacks (beat 3)
  find: number; // matches lift out of their stacks, the rest go grey (beat 4)
  pull: number; // the found slip flies to the DOM slip's place (end of beat 4)
};

export type Pile = {
  render(): void;
  resize(): void;
  dispose(): void;
};

type Variant = { kind: "receipt" | "divider" | "invoice" | "statement" | "package"; title: string; lines: [string, string][]; total?: [string, string]; year: number; hosting?: boolean; stamp?: string };

const YEARS = [2024, 2025, 2026];

// Made-up sellers only, the same cast as the rest of the page. Each year has
// its own slips, so a slip's printed date always agrees with the stack it is
// filed into.
const VARIANTS: Variant[] = [
  ...YEARS.map((year): Variant => ({ kind: "divider", title: String(year), lines: [], year })),
  { kind: "receipt", title: "Cloud hosting", lines: [["Date", "14 Oct 2026"], ["VAT 25.5%", "€2.55"]], total: ["Total", "€12.55"], year: 2026, hosting: true, stamp: "MATCHED" },
  { kind: "receipt", title: "Cloud hosting", lines: [["Date", "14 Jun 2026"], ["VAT 25.5%", "€2.55"]], total: ["Total", "€12.55"], year: 2026, hosting: true },
  { kind: "receipt", title: "Cloud hosting", lines: [["Date", "14 Mar 2025"], ["VAT 24%", "€2.40"]], total: ["Total", "€12.40"], year: 2025, hosting: true },
  { kind: "receipt", title: "Cloud hosting", lines: [["Date", "14 Nov 2024"], ["VAT 24%", "€1.92"]], total: ["Total", "€9.90"], year: 2024, hosting: true },
  { kind: "receipt", title: "Northline Rail", lines: [["Date", "5 Oct 2026"], ["VAT 14%", "€4.78"]], total: ["Total", "€38.90"], year: 2026 },
  { kind: "receipt", title: "Sample Coffee Roastery", lines: [["Date", "3 Oct 2026"], ["VAT 14%", "€2.26"]], total: ["Total", "€18.40"], year: 2026, stamp: "MATCHED" },
  { kind: "receipt", title: "Harbour Hardware", lines: [["Date", "21 Sep 2026"], ["VAT 25.5%", "€12.62"]], total: ["Total", "€62.10"], year: 2026 },
  { kind: "invoice", title: "Invoice 2026-031", lines: [["To", "Lumen Oy"], ["Due", "30 Oct 2026"]], total: ["Total", "€1,240.00"], year: 2026 },
  { kind: "statement", title: "Bank statement", lines: [["Month", "Sep 2026"], ["Rows", "64"]], year: 2026 },
  { kind: "package", title: "Sent: August", lines: [["ZIP", "41 files"], ["CSV", "index"]], year: 2026, stamp: "SENT" },
  { kind: "receipt", title: "Pixel & Grid Studio", lines: [["Date", "9 Feb 2025"], ["VAT 24%", "€2.90"]], total: ["Total", "€14.99"], year: 2025 },
  { kind: "receipt", title: "Coworking day pass", lines: [["Date", "17 Apr 2025"], ["VAT 24%", "€4.84"]], total: ["Total", "€25.00"], year: 2025, stamp: "MATCHED" },
  { kind: "receipt", title: "Domain renewal", lines: [["Date", "23 May 2025"], ["VAT 24%", "€2.25"]], total: ["Total", "€11.60"], year: 2025 },
  { kind: "receipt", title: "Font licence", lines: [["Date", "2 Aug 2025"], ["VAT 24%", "€8.71"]], total: ["Total", "€45.00"], year: 2025 },
  { kind: "invoice", title: "Invoice 2025-112", lines: [["To", "Kettu Design"], ["Paid", "12 Dec 2025"]], total: ["Total", "€860.00"], year: 2025 },
  { kind: "package", title: "Sent: November", lines: [["ZIP", "37 files"], ["CSV", "index"]], year: 2025, stamp: "SENT" },
  { kind: "receipt", title: "Paper & Pen Co.", lines: [["Date", "8 Jan 2024"], ["VAT 24%", "€1.51"]], total: ["Total", "€7.80"], year: 2024 },
  { kind: "receipt", title: "Mobile plan", lines: [["Date", "1 Jun 2024"], ["VAT 24%", "€3.85"]], total: ["Total", "€19.90"], year: 2024, stamp: "MATCHED" },
  { kind: "receipt", title: "Conference ticket", lines: [["Date", "19 Sep 2024"], ["VAT 10%", "€10.91"]], total: ["Total", "€120.00"], year: 2024 },
  { kind: "receipt", title: "Courier", lines: [["Date", "30 Oct 2024"], ["VAT 24%", "€1.84"]], total: ["Total", "€9.50"], year: 2024 },
  { kind: "statement", title: "Bank statement", lines: [["Month", "Dec 2024"], ["Rows", "52"]], year: 2024 },
  { kind: "receipt", title: "Cloud hosting", lines: [["Date", "14 Jan 2026"], ["VAT 25.5%", "€2.55"]], total: ["Total", "€12.55"], year: 2026, hosting: true },
  { kind: "receipt", title: "Cloud hosting", lines: [["Date", "14 Sep 2025"], ["VAT 25.5%", "€2.55"]], total: ["Total", "€12.55"], year: 2025, hosting: true },
  { kind: "receipt", title: "Cloud hosting", lines: [["Date", "14 Jun 2024"], ["VAT 24%", "€1.92"]], total: ["Total", "€9.90"], year: 2024, hosting: true },
];

const COLS = 6;
const CELL_W = 320;
const CELL_H = 480;
// The torn foot and the divider's tab are drawn inside the cell, so the slip's
// quad is the whole cell and the transparent parts are discarded.
const ASPECT = CELL_H / CELL_W;

function css(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawAtlas(): HTMLCanvasElement {
  const ink = css("--color-ink");
  const soft = css("--color-ink-soft");
  const slip = css("--color-slip");
  const mint = css("--color-mint");
  const line = css("--color-guilloche");
  const stamp = css("--color-stamp");
  const rows = Math.ceil(VARIANTS.length / COLS);
  const c = document.createElement("canvas");
  c.width = COLS * CELL_W;
  c.height = rows * CELL_H;
  const g = c.getContext("2d")!;
  const display = (w: number, px: number) => `${w} ${px}px Bricolage, "Arial Narrow", sans-serif`;
  const ui = (w: number, px: number) => `${w} ${px}px "Instrument Sans", system-ui, sans-serif`;

  VARIANTS.forEach((v, i) => {
    const x0 = (i % COLS) * CELL_W;
    const y0 = Math.floor(i / COLS) * CELL_H;
    g.save();
    g.translate(x0, y0);
    const pad = 26;

    if (v.kind === "divider") {
      // An index card with a tab: the year is the tab's label, the same
      // filing-drawer divider the app draws on Home.
      const tabH = 64;
      g.fillStyle = mint;
      g.beginPath();
      g.roundRect(8, 0, CELL_W * 0.56, tabH + 12, [14, 14, 0, 0]);
      g.fill();
      g.fillRect(8, tabH, CELL_W - 16, CELL_H - tabH - 8);
      g.fillStyle = ink;
      g.font = display(800, 46);
      g.textBaseline = "alphabetic";
      g.fillText(v.title, 30, tabH - 10);
      g.strokeStyle = ink;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(8, tabH + 1.5);
      g.lineTo(CELL_W - 8, tabH + 1.5);
      g.stroke();
      g.restore();
      return;
    }

    // White slip with a zigzag torn foot, edged in guilloche so overlapping
    // slips stay apart without a blended shadow.
    const tooth = 14;
    const bottom = CELL_H - 10;
    g.beginPath();
    g.moveTo(6, 6);
    g.lineTo(CELL_W - 6, 6);
    g.lineTo(CELL_W - 6, bottom - tooth);
    let up = true;
    for (let x = CELL_W - 6; x > 6; x -= tooth) {
      g.lineTo(Math.max(6, x - tooth), up ? bottom : bottom - tooth);
      up = !up;
    }
    g.closePath();
    g.fillStyle = slip;
    g.fill();
    g.strokeStyle = line;
    g.lineWidth = 4;
    g.stroke();

    // The kind as a small label, then the seller in display type.
    g.fillStyle = soft;
    g.font = ui(600, 19);
    g.fillText(v.kind === "receipt" ? "RECEIPT" : v.kind === "invoice" ? "SALES INVOICE" : v.kind === "statement" ? "STATEMENT" : "MONTH PACKAGE", pad, 50);
    g.fillStyle = ink;
    g.font = display(750, 38);
    const words = v.title.split(" ");
    let lineText = "";
    let y = 96;
    for (const w of words) {
      const next = lineText ? `${lineText} ${w}` : w;
      if (g.measureText(next).width > CELL_W - pad * 2 && lineText) {
        g.fillText(lineText, pad, y);
        y += 40;
        lineText = w;
      } else lineText = next;
    }
    g.fillText(lineText, pad, y);
    y += 26;

    g.strokeStyle = ink;
    g.lineWidth = 2;
    g.setLineDash([8, 7]);
    g.beginPath();
    g.moveTo(pad, y);
    g.lineTo(CELL_W - pad, y);
    g.stroke();
    g.setLineDash([]);
    y += 44;

    g.font = ui(500, 24);
    for (const [k, val] of v.lines) {
      g.fillStyle = soft;
      g.textAlign = "left";
      g.fillText(k, pad, y);
      g.fillStyle = ink;
      g.textAlign = "right";
      g.fillText(val, CELL_W - pad, y);
      y += 38;
    }
    g.textAlign = "left";
    if (v.total) {
      g.fillStyle = ink;
      g.fillRect(pad, y - 18, CELL_W - pad * 2, 2);
      y += 20;
      g.font = ui(600, 27);
      g.fillText(v.total[0], pad, y);
      g.textAlign = "right";
      g.fillText(v.total[1], CELL_W - pad, y);
      g.textAlign = "left";
    }

    if (v.stamp) {
      // A stamp carries its word, as everywhere on the page.
      g.save();
      g.translate(CELL_W - 108, CELL_H - 92);
      g.rotate(-0.13);
      g.font = display(800, 30);
      const w = g.measureText(v.stamp).width + 26;
      g.fillStyle = v.stamp === "MATCHED" ? mint : slip;
      g.strokeStyle = v.stamp === "MATCHED" ? ink : stamp;
      g.lineWidth = 4;
      g.beginPath();
      g.roundRect(-w / 2, -24, w, 48, 9);
      g.fill();
      g.stroke();
      g.fillStyle = v.stamp === "MATCHED" ? ink : stamp;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(v.stamp, 0, 2);
      g.restore();
    }
    g.restore();
  });
  return c;
}

// Seeded, so the heap is the same pile on every load and the still image
// rendered by scripts/shoot-pile.mjs matches the first live frame.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type Slip = {
  variant: number;
  year: number;
  late: boolean;
  hx: number; // heap position, in units of the region (0 to 1)
  hy: number;
  rz: number;
  rx: number;
  ry: number;
  stack: number;
  k: number; // place in its stack, 0 is the divider at the back
  delay: number;
  match: boolean;
  found: boolean;
};

const VERT = /* glsl */ `
attribute vec4 aCell;
attribute float aShade;
varying vec2 vUv;
varying float vShade;
void main() {
  vUv = aCell.xy + vec2(uv.x, 1.0 - uv.y) * aCell.zw;
  vShade = aShade;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

// Quantise, then dither: a slip goes grey as a pattern of guilloche dots on its
// white paper, never as a blend, so every pixel stays an exact palette colour
// (ink, slip, mint, guilloche, stamp) apart from the type's own antialiasing.
const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 uDot;
uniform float uCell;
varying vec2 vUv;
varying float vShade;
float bayer(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float i = q.x + q.y * 4.0;
  float m[16];
  m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;
  m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
  for (int k = 0; k < 16; k++) if (float(k) == i) return (m[k] + 0.5) / 16.0;
  return 0.5;
}
void main() {
  vec4 t = texture2D(uAtlas, vUv);
  if (t.a < 0.5) discard;
  vec3 c = t.rgb;
  bool paper = min(c.r, min(c.g, c.b)) > 0.97;
  if (paper && vShade > 0.0 && bayer(gl_FragCoord.xy / uCell) < vShade) c = uDot;
  gl_FragColor = vec4(c, 1.0);
}`;

export function createPile(canvas: HTMLCanvasElement, stage: HTMLElement, state: PileState, narrow: boolean): Pile | null {
  // A software rasteriser draws the pile at a few frames a second, which is
  // worse than the still. ?fx-force lets it through for the tooling.
  const force = new URLSearchParams(location.search).has("fx-force");
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    stencil: false,
    powerPreference: "low-power",
    failIfMajorPerformanceCaveat: !force,
    preserveDrawingBuffer: force,
  });
  const gl = renderer.getContext();
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const gpu = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  if (!renderer.capabilities.isWebGL2 || (!force && /llvmpipe|lavapipe|swiftshader|software|cpu/i.test(gpu))) {
    renderer.dispose();
    renderer.forceContextLoss();
    return null;
  }
  renderer.setClearColor(0x000000, 0);
  const dpr = Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(dpr);

  const atlas = new CanvasTexture(drawAtlas());
  atlas.minFilter = LinearFilter;
  atlas.magFilter = LinearFilter;
  atlas.generateMipmaps = false;
  // Rows are laid out top-down in the canvas and read top-down in the shader.
  atlas.flipY = false;
  atlas.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const rows = Math.ceil(VARIANTS.length / COLS);
  const dot = css("--color-guilloche").match(/[0-9a-f]{2}/gi)!.map((h) => parseInt(h, 16) / 255);
  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: { uAtlas: { value: atlas }, uDot: { value: new Vector3(dot[0], dot[1], dot[2]) }, uCell: { value: 2 * dpr } },
  });

  // Build the slips: a fixed count per year, seven of them hosting invoices
  // (the matches), one of those the receipt the search finds.
  const random = rng(20261014);
  const count = narrow ? 84 : 150;
  const byYear = YEARS.map((y) => VARIANTS.map((v, i) => ({ v, i })).filter(({ v }) => v.year === y && v.kind !== "divider" && !v.hosting));
  const hostingIdx = VARIANTS.map((v, i) => (v.hosting ? i : -1)).filter((i) => i >= 0);
  const slips: Slip[] = [];
  const perStack = [0, 0, 0];
  const yearShare = [0.3, 0.33, 0.37];
  // Seven hosting slips, each a different month, so no two matches repeat.
  const hostingPlan = hostingIdx;
  const hostingAt = new Map<number, number>();
  hostingPlan.forEach((variant, n) => hostingAt.set(Math.floor(((n + 0.5) / hostingPlan.length) * (count - 3)) + 3, variant));

  for (let i = 0; i < count; i++) {
    let variant: number;
    let stack: number;
    if (i < 3) {
      variant = i;
      stack = i;
    } else if (hostingAt.has(i)) {
      variant = hostingAt.get(i)!;
      stack = YEARS.indexOf(VARIANTS[variant].year);
    } else {
      const r = random();
      stack = r < yearShare[0] ? 0 : r < yearShare[0] + yearShare[1] ? 1 : 2;
      const pool = byYear[stack];
      variant = pool[Math.floor(random() * pool.length)].i;
    }
    // Polar sample, denser in the middle, so the heap has a body and an edge.
    const a = random() * Math.PI * 2;
    const d = Math.pow(random(), 0.7);
    slips.push({
      variant,
      year: YEARS[stack],
      late: i >= 3 && random() < 0.3,
      hx: 0.5 + Math.cos(a) * d * 0.3,
      hy: 0.46 + Math.sin(a) * d * 0.26,
      rz: (random() - 0.5) * 1.6,
      rx: (random() - 0.5) * 0.5,
      ry: (random() - 0.5) * 0.5,
      stack,
      k: 0,
      delay: 0,
      match: !!VARIANTS[variant].hosting,
      found: variant === hostingIdx[0],
    });
  }
  // Dividers sit at the back of their stack, everything else behind them in
  // date order of arrival; filing sweeps stack by stack, left to right.
  for (const s of slips) s.k = s.variant < 3 ? 0 : ++perStack[s.stack];
  for (const s of slips) s.delay = clamp01(s.stack * 0.22 + (s.k / (perStack[s.stack] + 1)) * 0.5 + random() * 0.12);

  const geometry = new PlaneGeometry(1, 1);
  const cells = new Float32Array(count * 4);
  slips.forEach((s, i) => {
    const col = s.variant % COLS;
    const row = Math.floor(s.variant / COLS);
    cells.set([col / COLS, row / rows, 1 / COLS, 1 / rows], i * 4);
  });
  const cellAttr = new InstancedBufferAttribute(new Float32Array(cells), 4);
  cellAttr.setUsage(DynamicDrawUsage);
  geometry.setAttribute("aCell", cellAttr);
  const shade = new InstancedBufferAttribute(new Float32Array(count), 1);
  shade.setUsage(DynamicDrawUsage);
  geometry.setAttribute("aShade", shade);

  const mesh = new InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  const scene = new Scene();
  scene.add(mesh);
  const camera = new OrthographicCamera(0, 1, 0, -1, -5000, 5000);

  let W = 0;
  let H = 0;
  const region = { x: 0, y: 0, w: 0, h: 0 };
  const target = { x: 0, y: 0, w: 0, h: 0 };
  let slipW = 0;

  function measure() {
    const s = stage.getBoundingClientRect();
    W = s.width;
    H = s.height;
    const v = stage.querySelector(".reel-visual")!.getBoundingClientRect();
    region.x = v.left - s.left;
    region.y = v.top - s.top;
    region.w = v.width;
    region.h = v.height;
    // The DOM slip's untransformed box: offsetLeft/Top ignore the wipe's
    // transform, so the GL slip lands where the real one will be.
    const f = stage.querySelector<HTMLElement>(".slip-found")!;
    const fr = f.getBoundingClientRect();
    target.w = f.offsetWidth;
    target.h = f.offsetHeight;
    target.x = fr.left - s.left + fr.width / 2;
    target.y = fr.top - s.top + fr.height / 2;
    slipW = Math.min(narrow ? 104 : 176, region.w / (narrow ? 3.4 : 3.7), region.h / 4);
    renderer.setSize(W, H, false);
    camera.left = 0;
    camera.right = W;
    camera.top = 0;
    camera.bottom = -H;
    camera.updateProjectionMatrix();
  }

  const dummy = new Object3D();
  const order = slips.map((_, i) => i);
  const frame = slips.map(() => ({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, shade: 0 }));

  function render() {
    const slipH = slipW * ASPECT;
    const stackGap = region.w / 3;
    // Clear of the search pill at the top of the region; card centres, so
    // half a leaning card (cos 0.62 of its height) sits above and below.
    const top = region.y + 64 + slipH * 0.42;
    const span = Math.max(0, region.h - 64 - slipH * 0.84);
    const lift = slipH * 0.4;

    slips.forEach((s, i) => {
      // Heap.
      let x = region.x + s.hx * region.w;
      let y = region.y + s.hy * region.h;
      let z = i;
      let rz = s.rz;
      let rx = s.rx;
      let ry = s.ry;
      let sx = 1;
      let sy = 1;
      let shadeV = 0.22;

      // Beat 1: the late slips fall in from above the stage, spinning.
      if (s.late) {
        const t = ease(clamp01((state.arrive - s.delay * 0.6) / 0.4));
        y = lerp(-slipH * 1.5 - s.hy * H, y, t);
        rz = lerp(s.rz + 2.4, s.rz, t);
        z += 400 * (1 - t);
      }

      // Beat 2: a reading front sweeps down the heap; a read slip is clean
      // white paper and lies a little straighter.
      const done = clamp01((state.read * 1.3 - s.hy) / 0.25);
      shadeV *= 1 - done;
      rz *= 1 - done * 0.45;
      rx *= 1 - done * 0.6;
      ry *= 1 - done * 0.6;

      // Beat 3: filing. Cards lean back in their drawer, a strip of each
      // showing, the divider's tab above them all.
      if (state.file > 0) {
        const t = ease(clamp01((state.file - s.delay * 0.55) / 0.45));
        const n = perStack[s.stack] + 1;
        const fx = region.x + stackGap * (s.stack + 0.5);
        // Real cards start below the divider's tab, so the year stays readable.
        const tab = s.k > 0 ? slipH * 0.15 : 0;
        const fy = top + tab + (s.k / n) * (span - slipH * 0.15);
        x = lerp(x, fx, t);
        y = lerp(y, fy, t) - Math.sin(t * Math.PI) * slipH * 0.5;
        z = lerp(z, 1000 + s.k, t);
        rz = lerp(rz, 0, t);
        rx = lerp(rx, -0.62, t);
        ry = lerp(ry, 0, t);
      }

      // Beat 4: the search. Matches stand up out of their stacks; the rest
      // turn grey in place.
      if (state.find > 0) {
        const t = ease(clamp01(state.find));
        if (s.match) {
          // Never above the divider's tab: the year stays on show.
          y = Math.max(y - lift * t, Math.min(y, top + slipH * 0.62));
          z += 900 * t;
          rx = lerp(rx, -0.1, t);
        } else shadeV = Math.max(shadeV, 0.55 * t);
      }

      // The found slip flies out to where the DOM slip will be.
      if (s.found && state.pull > 0) {
        const t = ease(clamp01(state.pull));
        x = lerp(x, target.x, t);
        y = lerp(y, target.y, t);
        z = lerp(z, 3000, t);
        rx = lerp(rx, 0, t);
        rz = lerp(rz, 0, t);
        sx = lerp(1, target.w / slipW, t);
        sy = lerp(1, target.h / slipH, t);
      }

      const f = frame[i];
      f.x = x;
      f.y = y;
      f.z = z;
      f.rx = rx;
      f.ry = ry;
      f.rz = rz;
      f.sx = sx;
      f.sy = sy;
      f.shade = shadeV;
    });

    // Painter's order instead of a depth buffer: tilted slips a pixel apart
    // in z would slice through each other, and paper never does that.
    order.sort((a, b) => frame[a].z - frame[b].z);
    order.forEach((i, slot) => {
      const f = frame[i];
      dummy.position.set(f.x, -f.y, 0);
      dummy.rotation.set(f.rx, f.ry, f.rz);
      dummy.scale.set(slipW * f.sx, slipH * f.sy, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(slot, dummy.matrix);
      shade.setX(slot, f.shade);
      cellAttr.setXYZW(slot, cells[i * 4], cells[i * 4 + 1], cells[i * 4 + 2], cells[i * 4 + 3]);
    });
    mesh.instanceMatrix.needsUpdate = true;
    shade.needsUpdate = true;
    cellAttr.needsUpdate = true;
    renderer.render(scene, camera);
  }

  measure();
  return {
    render,
    resize() {
      measure();
      render();
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      atlas.dispose();
      renderer.dispose();
    },
  };
}
