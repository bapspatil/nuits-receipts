import { PALETTE } from './tokens';

const glyph = `<path d="M5 2h14v19l-2.33-1.5L14.33 21 12 19.5 9.67 21l-2.34-1.5L5 21z" fill="${PALETTE.petrol900}"/><path d="M8 7h8M8 10.5h8M8 14h5" stroke="${PALETTE.paper}" stroke-width="1.6" stroke-linecap="round"/>`;
// The tab icon, the same file as site/public/favicon.svg. Served at /favicon.svg.
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="${PALETTE.paper}"/>${glyph}</svg>`;
// Full-bleed paper with the glyph scaled about the centre, for icons the OS masks itself.
const bleed = (scale: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="${PALETTE.paper}"/><g transform="translate(12 12) scale(${scale}) translate(-12 -12)">${glyph}</g></svg>`;

// Everything the install icons are rendered from. scripts/app-icons.mjs renders these into
// src/app-icons.ts, and a test fails when this changes without a re-render.
export const ICON_SOURCES = {
  any: FAVICON_SVG,
  // Android crops to a circle of 40% of the width: the glyph stays well inside it.
  maskable: bleed(0.8),
  // iOS rounds the corners itself, so the glyph can be larger.
  apple: bleed(1),
} as const;
