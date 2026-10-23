#!/usr/bin/env node
// Writes src/assets/svg/seal.svg: a small guilloche seal, the engraved rosette
// printed on cheques, computed from the same two-harmonic curve family as the
// hero field so the two read as one press. Lines only, coloured by class.
// Re-run after changing a constant; the output is committed.
import { writeFileSync } from "node:fs";

const C = 32;
const SAMPLES = 72;
const ring = (base, amp, k1, k2, copies) =>
  Array.from({ length: copies }, (_, c) => {
    const s = (c / copies) * Math.PI * 2;
    const pts = Array.from({ length: SAMPLES }, (_, i) => {
      const th = (i / SAMPLES) * Math.PI * 2;
      const r = base + amp * (0.62 * Math.sin(k1 * th + s) + 0.38 * Math.sin(k2 * th - s * 2));
      return `${(C + r * Math.cos(th)).toFixed(1)} ${(C + r * Math.sin(th)).toFixed(1)}`;
    });
    return `M${pts.join("L")}Z`;
  }).join("");

const svg = `<svg class="ill ill-seal" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <g class="seal-turn">
    <path class="ln-seal" d="${ring(22, 5, 9, 4, 3)}"/>
    <path class="ln-seal" d="${ring(12, 3, 6, 3, 2)}"/>
  </g>
  <circle class="ln-seal" cx="32" cy="32" r="30"/>
</svg>
`;
writeFileSync(new URL("../src/assets/svg/seal.svg", import.meta.url), svg);
console.log(`wrote seal.svg, ${svg.length} bytes`);
