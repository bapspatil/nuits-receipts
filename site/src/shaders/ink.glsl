// Dot-matrix print on the two ink sections, How it works and the close. The
// receipts these readers chase came out of thermal and dot-matrix printers, so
// the second field is printed dots, not engraved lines like the hero's.
//
// Two palette picks, hard select, no blending: a pixel is either a dot
// (INK_SOFT) or the section's own ink (INK). Density is ordered-dithered with a
// Bayer matrix rather than mixed, so the canvas never paints a colour the
// contrast check has not measured, and paper text clears 6.88:1 on both picks.
//
// Everything is computed per CSS pixel on a 6px cell grid with a 3px square dot,
// and the canvas is drawn at 1 device pixel per CSS pixel with
// image-rendering: pixelated. So the pattern is identical at every DPR, the
// fallback PNG is the same pixels, and a 3x phone does a ninth of the work.
//
// GLSL ES 1.00 so the same source runs on a WebGL2 or a WebGL1 context.
// The colours arrive as uniforms read from the CSS custom properties, so no hex
// lives here; generate-tokens.mjs --check-shader verifies the names.

precision highp float;

uniform vec2 uRes;       // canvas size in CSS pixels
uniform float uTime;     // seconds of ambient loop; frozen means a still frame
uniform float uProgress; // scroll progress through the host section, 0 to 1
uniform float uMode;     // 0: rows (How it works), 1: bleed (the close)
uniform vec3 INK;
uniform vec3 INK_SOFT;

const float pitch = 6.0;
const float dotSize = 3.0;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Ordered thresholds in [0, 1). The fract-dot form needs no array, which
// GLSL ES 1.00 cannot index with a runtime value anyway.
float bayer2(vec2 a) {
  a = floor(a);
  return fract(dot(a, vec2(0.5, a.y * 0.75)));
}

float bayer4(vec2 a) {
  return bayer2(0.5 * a) * 0.25 + bayer2(a);
}

// Printed lines streaming left to right into ledger rows, in whole-cell steps
// like a print head. Sparse on the left where the copy sits, dense on the right.
float rows(vec2 cell, vec2 px) {
  float row = floor(cell.y / 8.0);
  float ry = mod(cell.y, 8.0);
  float env = smoothstep(0.1, 1.0, px.x / uRes.x);
  if (ry > 6.5) {
    // The rule under each row: every other cell, dithered in with the rows.
    return step(mod(cell.x, 2.0), 0.5) * step(bayer4(cell) + 0.02, env * env);
  }
  if (ry < 2.5 || ry > 4.5) return 0.0;
  float speed = 2.0 + floor(hash(vec2(row, 7.0)) * 4.0);
  float x = cell.x - floor(uTime * speed);
  float word = floor(x / 6.0);
  float present = step(0.42, hash(vec2(word, row)));
  float gap = step(mod(x, 6.0), 4.5);
  return present * gap * step(bayer4(cell) + 0.02, env * 0.95);
}

// Ink soaking into paper from the right edge. It spreads as the section scrolls
// in (uProgress) and its edge breathes slowly with time.
float bleed(vec2 cell, vec2 px) {
  float t = uTime * 0.04;
  // Rotated and domain-warped, so the blot edge never follows the noise grid.
  vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * cell * 0.045;
  vec2 warp = vec2(noise(q + vec2(t, 3.1)), noise(q - vec2(5.2, t))) * 2.2;
  float n = noise(q + warp) * 0.65 + noise(q * 2.3 - warp + t) * 0.35;
  float d = length((px - vec2(uRes.x, uRes.y * 0.55)) / max(uRes.x, 1.0));
  float spread = mix(0.2, 0.55, clamp(uProgress * 1.6, 0.0, 1.0));
  float v = n * 0.9 + (spread - d) * 1.4;
  float density = smoothstep(0.25, 0.85, v) * 0.6;
  return step(bayer4(cell) + 0.02, density);
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 cell = floor(px / pitch);
  vec2 inCell = mod(px, pitch);
  float dotMask = step(inCell.x, dotSize - 0.5) * step(inCell.y, dotSize - 0.5);
  float on = uMode < 0.5 ? rows(cell, px) : bleed(cell, px);
  gl_FragColor = vec4(dotMask * on > 0.5 ? INK_SOFT : INK, 1.0);
}
