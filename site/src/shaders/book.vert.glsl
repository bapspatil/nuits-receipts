// The turning leaf of the changelog book (src/book3d.ts). The plane is built
// as a grid of (u, v) in [0, 1]: u runs from the spine (0) to the free edge
// (1), v from the foot to the head. The leaf rotates about the spine by
// uTheta (pi lies flat on the left page, 0 on the right) and bends as it goes:
// the tangent angle along the leaf is uTheta + uBend * u, so the free edge
// lags the spine, the way paper does. Positions are in CSS pixels.

uniform float uTheta;
uniform float uBend;
uniform vec2 uSize; // page width, page height

varying vec2 vUv;
varying float vShade;

void main() {
  float u = uv.x;
  float a = uTheta + uBend * u;
  float w = uSize.x;
  vec3 p;
  // The arc from the spine, integrated in closed form; straight when unbent.
  if (abs(uBend) < 1e-3) {
    p = vec3(w * u * cos(uTheta), 0.0, w * u * sin(uTheta));
  } else {
    p = vec3(w * (sin(a) - sin(uTheta)) / uBend, 0.0, w * (cos(uTheta) - cos(a)) / uBend);
  }
  p.y = (uv.y - 0.5) * uSize.y;
  vUv = uv;
  // Light from the viewer: a leaf standing up from the page is darker.
  vShade = 1.0 - abs(cos(a));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
