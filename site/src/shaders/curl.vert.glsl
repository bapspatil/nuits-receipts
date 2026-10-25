// The page curl (src/curl.ts). The slip is a flat plane in CSS pixels; a line
// sweeps across it along uDir, and everything the line has passed wraps round
// a cylinder of radius uRadius lying on the slip, then lies flat again, face
// down, on the far side of the line. At uProgress 0 nothing has moved, so the
// first frame is the DOM slip pixel for pixel.

uniform float uProgress;
uniform vec2 uDir;
uniform vec2 uSpan;
uniform float uRadius;

varying vec2 vUv;
varying float vShade;

const float pi = 3.14159265;

void main() {
  vUv = uv;
  vec3 p = position;
  float line = mix(uSpan.x, uSpan.y + pi * uRadius + 24.0, uProgress);
  // How far behind the line this point is: past it, the slip has lifted.
  float u = line - dot(p.xy, uDir);
  float shade = 0.0;
  if (u > 0.0) {
    float along;
    if (u < pi * uRadius) {
      float theta = u / uRadius;
      along = -uRadius * sin(theta);
      p.z = uRadius * (1.0 - cos(theta));
      shade = sin(theta);
    } else {
      along = u - pi * uRadius;
      p.z = 2.0 * uRadius;
    }
    p.xy += uDir * (along + u);
  }
  vShade = shade;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
