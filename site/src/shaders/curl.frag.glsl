// The curl's paper (src/curl.ts). The front is the slip as captured; the back
// is bare thermal paper with the print showing through. Shading on the curve is a 4x4 Bayer dither between
// two token colours, never a blend, so every pixel stays an exact palette
// colour, the same rule as the ink field.

uniform sampler2D uFront;
uniform vec3 INK_SOFT;
uniform vec3 SLIP;

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

void main() {
  vec4 front = texture2D(uFront, vUv);
  if (front.a < 0.5) discard;

  float t = bayer(gl_FragCoord.xy);
  vec3 color;
  if (gl_FrontFacing) {
    color = t < vShade * 0.4 ? INK_SOFT : front.rgb;
  } else {
    // Thermal paper shows the print through: the front's ink, mirrored,
    // as a sparse dither on the bare back.
    float through = dot(front.rgb, vec3(0.2126, 0.7152, 0.0722)) < 0.35 ? 0.3 : 0.0;
    color = t < max(0.1 + vShade * 0.35, through) ? INK_SOFT : SLIP;
  }
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
