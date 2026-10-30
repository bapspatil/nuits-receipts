#!/usr/bin/env node
// src/tokens.json in, src/tokens.ts out: the app's CSS custom properties in
// three layers (primitives, semantic, component). scripts/app-tokens.test.ts
// fails when src/tokens.ts is not what this script writes.
//
//   bun run tokens
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

// Every layer is a flat name -> value map. A semantic value names a primitive
// colour; a component value names a semantic token or a primitive, else it is
// a literal. Unknown names stay literal, so "44px" and calc() pass through.
// A colour with `over` is a measurement only (glass composited over a backdrop), never a variable.
// A literal may name a colour in braces, `rgb({ink950}/.1)`, and gets its channels.
export function render(tokens) {
  const colors = Object.fromEntries(Object.entries(tokens.color).filter(([, v]) => !v.over));
  const semantic = tokens.semantic;
  const rgb = (name) => {
    const n = parseInt(colors[name].hex.slice(1), 16);
    return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
  };
  const fill = (value) => value.replace(/\{(\w+)\}/g, (_, name) => rgb(name));
  const ref = (value) => {
    if (value in semantic) return `var(--${kebab(value)})`;
    if (value in colors) return `var(--${kebab(value)})`;
    return fill(value);
  };
  const { tint, alpha } = tokens.glass;
  const group = (title, entries) => `/* ${title} */${entries.map(([k, v]) => `--${k}:${v};`).join('')}`;
  const primitives = [
    ...Object.entries(colors).map(([k, v]) => [kebab(k), v.hex]),
    ...Object.entries(tokens.font).map(([k, v]) => [`font-${k}`, v]),
    ...Object.entries(tokens.text).map(([k, v]) => [`text-${k}`, v]),
    ...Object.entries(tokens.space).map(([k, v]) => [`space-${k}`, v]),
    ...Object.entries(tokens.radius).map(([k, v]) => [`radius-${k}`, v]),
    ...Object.entries(tokens.shadow).map(([k, v]) => [`shadow-${k}`, fill(v)]),
  ];
  const roles = [...Object.entries(semantic).map(([k, v]) => [k, ref(v)]), ['glass', `rgb(${rgb(tint)}/${alpha})`]];
  const components = Object.entries(tokens.component).map(([k, v]) => [k, ref(v)]);
  const phone = Object.entries(tokens.phone ?? {}).map(([k, v]) => [k, ref(v)]);
  const small = phone.length ? `@media(max-width:720px){:root{${phone.map(([k, v]) => `--${k}:${v};`).join('')}}}` : '';
  const css = `:root{${group('primitives', primitives)}${group('semantic', roles)}${group('component', components)}}${small}`;
  const palette = Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, v.hex]));
  return `// Generated from src/tokens.json by scripts/app-tokens.mjs. Do not edit by hand.
// Change the source and run \`bun run tokens\`.

// The :root block of custom properties, in three layers.
export const TOKENS_CSS =
  ${JSON.stringify(css)};

// The primitive colours as hex, for the places CSS variables cannot reach (the tab icon).
export const PALETTE = ${JSON.stringify(palette, null, 2)} as const;
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tokens = JSON.parse(readFileSync('src/tokens.json', 'utf8'));
  writeFileSync('src/tokens.ts', render(tokens));
  console.log('wrote src/tokens.ts');
}
