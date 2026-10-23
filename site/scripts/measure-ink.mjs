#!/usr/bin/env node
// Renders src/shaders/ink.glsl in real Chrome (SwiftShader WebGL), counts the
// colours it paints, writes them to tokens.json as field.inkField.picks, and
// saves the settled frames (time 0, scroll progress 1) as the no-WebGL
// fallback images, so the static ink sections and the live ones are the same
// pixels. Exit 1 if the shader paints any colour that is not a palette token.
//
// Needs no server: the shader source and the colours come from the files.
// Re-run after changing the shader or the palette, then `bun run build`.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { launch } from "./chrome.mjs";

const tokens = JSON.parse(readFileSync("tokens.json", "utf8"));
const source = readFileSync("src/shaders/ink.glsl", "utf8");
const byHex = new Map(Object.entries(tokens.color).map(([name, t]) => [t.hex.toUpperCase(), name]));
const rgb = (name) => {
  const n = parseInt(tokens.color[name].hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

// Heights are multiples of the 48px row so a repeat-y seam lands on a row line.
const frames = [
  { file: "ink-rows-narrow", mode: 0, width: 390, height: 1632 },
  { file: "ink-rows-wide", mode: 0, width: 1440, height: 1008 },
  { file: "ink-bleed-narrow", mode: 1, width: 390, height: 720 },
  { file: "ink-bleed-wide", mode: 1, width: 1440, height: 720 },
];

const browser = await launch(true);
const page = await browser.newPage();
await page.setContent("<canvas></canvas>");
const seen = new Map();
let pixels = 0;
for (const f of frames) {
  const data = await page.evaluate(
    ({ source, f, ink, inkSoft }) => {
      const canvas = document.querySelector("canvas");
      canvas.width = f.width;
      canvas.height = f.height;
      const gl = canvas.getContext("webgl", { alpha: false, antialias: false, preserveDrawingBuffer: true });
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }"));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, source));
      gl.linkProgram(p);
      gl.useProgram(p);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.viewport(0, 0, f.width, f.height);
      const u = (n) => gl.getUniformLocation(p, n);
      gl.uniform2f(u("uRes"), f.width, f.height);
      gl.uniform1f(u("uTime"), 0);
      gl.uniform1f(u("uProgress"), 1);
      gl.uniform1f(u("uMode"), f.mode);
      gl.uniform3fv(u("INK"), ink);
      gl.uniform3fv(u("INK_SOFT"), inkSoft);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const out = new Uint8Array(f.width * f.height * 4);
      gl.readPixels(0, 0, f.width, f.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return Array.from(out);
    },
    { source, f, ink: rgb("ink"), inkSoft: rgb("inkSoft") },
  );
  // readPixels is bottom-up; flip into a PNG.
  const png = new PNG({ width: f.width, height: f.height });
  const row = f.width * 4;
  for (let y = 0; y < f.height; y++) {
    const from = (f.height - 1 - y) * row;
    for (let i = 0; i < row; i++) png.data[y * row + i] = data[from + i];
  }
  for (let i = 0; i < png.data.length; i += 4) {
    const hex = "#" + [0, 1, 2].map((k) => png.data[i + k].toString(16).padStart(2, "0")).join("").toUpperCase();
    seen.set(hex, (seen.get(hex) ?? 0) + 1);
  }
  pixels += f.width * f.height;
  writeFileSync(`public/${f.file}.png`, PNG.sync.write(png));
}
await browser.close();

const picks = [];
const strays = [];
for (const [hex, n] of [...seen].sort((a, b) => b[1] - a[1])) {
  const name = byHex.get(hex);
  console.log(`  ${hex} ${name ?? "NOT IN PALETTE"} ${((n / pixels) * 100).toFixed(2)}%`);
  if (!name) strays.push(hex);
  else picks.push(name);
}
if (strays.length) {
  console.error(`The ink shader paints colours outside the palette: ${strays.join(", ")}`);
  process.exit(1);
}
// Two exact colours fit a 1-bit palette PNG. Optional, as in measure-field.mjs.
try {
  execFileSync("python3", ["-c", `
from PIL import Image
for n in ${JSON.stringify(frames.map((f) => f.file))}:
    p = f"public/{n}.png"
    Image.open(p).convert("RGB").quantize(colors=${picks.length}).save(p, optimize=True)
`]);
} catch {
  console.log("  Pillow not available; fallback PNGs left as RGB");
}
tokens.field.inkField.picks = picks;
writeFileSync("tokens.json", JSON.stringify(tokens, null, 2) + "\n");
console.log(`inkField.picks = ${JSON.stringify(picks)}`);
