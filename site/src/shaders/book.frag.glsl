// The leaf's paper (src/book3d.ts). The side it started on shows the page it
// was; the other side the page it lands as, both as captured from the DOM.
// The page that stays put is drawn with it too, flat and unshaded.
// Shading is a 4x4 Bayer dither towards INK_SOFT, never a blend, so every
// shaded pixel is an exact palette colour, the same rule as the ink field.

uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform float uFromLeft; // 1 when the leaf starts on the left page
uniform float uSpine; // the spine's place across the texture, 0 to 1
uniform float uPlain; // 1 on a phone: the leaf's back is plain paper
uniform vec3 PAPER;

varying vec2 vUv;
varying float vShade;

float bayer(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float i = q.x + q.y * 4.0;
  // The 4x4 Bayer matrix, row by row, as thresholds in (0, 1).
  float m = 0.0;
  if (i < 0.5) m = 0.0; else if (i < 1.5) m = 8.0; else if (i < 2.5) m = 2.0; else if (i < 3.5) m = 10.0;
  else if (i < 4.5) m = 12.0; else if (i < 5.5) m = 4.0; else if (i < 6.5) m = 14.0; else if (i < 7.5) m = 6.0;
  else if (i < 8.5) m = 3.0; else if (i < 9.5) m = 11.0; else if (i < 10.5) m = 1.0; else if (i < 11.5) m = 9.0;
  else if (i < 12.5) m = 15.0; else if (i < 13.5) m = 7.0; else if (i < 14.5) m = 13.0; else m = 5.0;
  return (m + 0.5) / 16.0;
}

uniform vec3 INK_SOFT;

void main() {
  // Lying on the left page the leaf is seen from its back face (the plane is
  // mirrored there), on the right from its front.
  bool starting = gl_FrontFacing == (uFromLeft < 0.5);
  bool left = starting ? uFromLeft > 0.5 : uFromLeft < 0.5;
  // Each texture is a whole spread, rounded out to whole pixels, so the spine
  // sits at uSpine across it. u runs from the spine to the page's outer edge.
  float x = left ? uSpine * (1.0 - vUv.x) : uSpine + vUv.x * (1.0 - uSpine);
  vec2 st = vec2(x, vUv.y);
  vec3 color = starting ? texture2D(uFrom, st).rgb : (uPlain > 0.5 ? PAPER : texture2D(uTo, st).rgb);
  // Standing up from the page, the leaf takes a dither of shade.
  if (bayer(gl_FragCoord.xy) < vShade * 0.22) color = INK_SOFT;
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
