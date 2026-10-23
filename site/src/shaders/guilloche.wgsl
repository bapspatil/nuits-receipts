// Guilloche: the engraved line rosette printed on cheques and banknotes,
// because the page is about money paper. Lines only, two palette picks,
// no blending: a pixel is either on a line (GUILLOCHE) or paper (PAPER).
// Prepended at runtime with palette.wgsl, which defines both constants.

struct Uniforms {
  resolution: vec2f,
  // Scroll progress through the hero in [0, 1]. The only motion source:
  // the field never moves unless the reader does.
  phase: f32,
  dpr: f32,
  // 1.0 at the CSS wide breakpoint (64rem), so the rosette sits where the
  // layout leaves room for it rather than where the aspect ratio guesses.
  wide: f32,
}

@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

const TAU = 6.2831853;

// Radial distance in device pixels from this pixel to the nearest of `count`
// phase-shifted copies of a two-harmonic rosette. Measured along the radius,
// so lines thicken where the curve runs steep, which is how engraved
// guilloche looks anyway.
fn rosette(p: vec2f, base: f32, amp: f32, k1: f32, k2: f32, count: f32, turn: f32) -> f32 {
  let r = length(p);
  let th = atan2(p.y, p.x);
  var best = 1e9;
  for (var i = 0.0; i < count; i += 1.0) {
    let s = i / count * TAU;
    let ri = base + amp * (0.62 * sin(k1 * th + s + turn) + 0.38 * sin(k2 * th - s * 2.0));
    best = min(best, abs(r - ri));
  }
  return best;
}

// Horizontal security waves, the background tint of a cheque.
fn waves(p: vec2f, spacing: f32, amp: f32, turn: f32) -> f32 {
  let y = p.y + amp * sin(p.x / (spacing * 3.1) + turn);
  let k = y / spacing;
  return abs(k - round(k)) * spacing;
}

@fragment
fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let res = u.resolution;
  let unit = min(res.x, res.y);
  let wide = u.wide > 0.5;
  // Wide screens: the rosette sits behind the receipt slip on the right.
  // Narrow screens: it rises from the top-right corner behind the headline,
  // which is ink and clears 8:1 on both picks.
  let centre = select(vec2f(res.x * 0.92, res.y * 0.1), vec2f(res.x * 0.78, res.y * 0.5), wide);
  let p = frag.xy - centre;
  let turn = u.phase * TAU * 0.25;

  let w = 0.75 * u.dpr;
  let outer = rosette(p, unit * 0.36, unit * 0.075, 12.0, 5.0, 9.0, turn);
  let inner = rosette(p, unit * 0.2, unit * 0.045, 9.0, 4.0, 7.0, -turn * 1.5);
  let band = waves(frag.xy, 18.0 * u.dpr, 5.0 * u.dpr, turn * 2.0);

  // Quiet zone: the waves stay out from under the copy column, so the headline
  // and the buttons sit on flat paper and the lines only frame them. Text over
  // the rosette is still measured against both picks in tokens.json.
  let quiet = select(frag.y < res.y * 0.72, frag.x < res.x * 0.56, wide);
  let waveHit = band < w && !quiet;
  let onLine = min(outer, inner) < w || waveHit;
  let colour = select(PAPER, GUILLOCHE, onLine);
  return vec4f(colour, 1.0);
}
