#!/usr/bin/env node
// tokens.json in, every other representation of the brand out.
//
// The CSS the page is painted with and the WGSL the canvas behind it is painted
// with have to be the same numbers, or there is a visible seam exactly where
// they meet and neither side looks wrong on its own. Generating both from one
// file is the only way to make that impossible rather than unlikely.
//
// Usage:
//   node generate-tokens.mjs tokens.json \
//     --css src/styles/theme.css \
//     --wgsl src/shaders/palette.wgsl \
//     --swift Sources/DesignSystem/Tokens.generated.swift \
//     --check-shader "src/shaders/*.wgsl"
//
// Every output carries a do-not-edit banner naming this script and the source.
// Without it someone edits the output, the next run wipes it, and the loss is
// silent.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const [, , file, ...argv] = process.argv;
if (!file) {
  console.error(
    "usage: node generate-tokens.mjs <tokens.json> [--css out] [--wgsl out] " +
      "[--swift out] [--check-shader path-or-glob]",
  );
  process.exit(2);
}

function flag(name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
}

const tokens = JSON.parse(readFileSync(file, "utf8"));
const colors = tokens.color ?? {};
const type = tokens.type ?? {};
const radius = tokens.radius ?? {};
const font = tokens.font ?? {};
const spacing = tokens.spacing ?? {};

const banner = (comment) =>
  `${comment} Generated from ${file} by generate-tokens.mjs. Do not edit by hand.\n` +
  `${comment} Change the source and run the generator again.\n`;

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

// The WGSL identifier for a token name.
//
// NOT `name.toUpperCase()`, which is what this used to be and what quietly
// breaks on any name that is not a single word. A camelCase token emits as
// SURFACERAISED, which compiles and is unreadable; a kebab-case one emits as
// SURFACE-RAISED, which does not compile at all, and the failure surfaces as a
// shader that silently never draws rather than as a bad token name. Both were
// invisible while the example palette happened to use only single words.
//
// Screaming snake is also what --check-shader scans for, so the two agree.
const wgslName = (s) => kebab(s).replace(/-/g, "_").toUpperCase();

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  console.log(`wrote ${path}`);
}

// --- Shader palette check ---------------------------------------------------
//
// The defect this was written for: the shipped fields shader referenced CREAM,
// SAND, TAUPE, LINE, ACCENT and INK while the tokens file defined ink, cream,
// paper, sakura, yuzu, slate and hairline. Four of the six names existed
// nowhere, and nothing anywhere failed. The compiler does catch it, but only
// once somebody assembles that exact pair of files and runs them on a device,
// which is both far too late and far away from the file that is wrong.
//
// This runs before anything is written, so a broken reference stops the build
// rather than leaving a fresh palette next to a shader that cannot use it.
//
// The scan is deliberately literal. Every clever version of it trades a real
// failure for false alarms, and a checker that cries wolf is a checker somebody
// stops passing within the week.

/**
 * WGSL comments, blanked out to spaces so nothing in prose reads as a
 * reference, and so line and column offsets survive for any future message.
 * Block comments nest in WGSL, unlike C, so this counts depth.
 */
function stripComments(src) {
  const out = [];
  let i = 0;
  let depth = 0;
  let line = false;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (!line && depth === 0 && two === "//") {
      line = true;
      out.push("  ");
      i += 2;
      continue;
    }
    if (!line && two === "/*") {
      depth++;
      out.push("  ");
      i += 2;
      continue;
    }
    if (!line && depth > 0 && two === "*/") {
      depth--;
      out.push("  ");
      i += 2;
      continue;
    }
    const c = src[i];
    if (c === "\n") line = false;
    out.push(depth > 0 || line ? (c === "\n" ? "\n" : " ") : c);
    i++;
  }
  return out.join("");
}

// WGSL's own keywords are all lower case, so a SCREAMING_SNAKE name is almost
// never the language's. These are the handful of reserved words that are not,
// listed so a shader using one is never reported as a missing colour.
const WGSL_RESERVED = new Set(["NULL", "Self", "TRUE", "FALSE"]);

/**
 * The SCREAMING_SNAKE names a shader reads but does not declare.
 *
 * Four exclusions, each earning its place: names the shader declares itself (a
 * shader's own QUIET_ZONE_SLOTS is not a colour), names reached through a dot (a
 * struct member), names followed by `(` (a call), and names followed by `:` (a
 * declaration or a parameter). Anything ambiguous is left out rather than
 * reported: a reference this misses still fails at compile time at the point of
 * use, whereas a name reported wrongly teaches the reader to ignore the check.
 */
function paletteReferences(src) {
  const code = stripComments(src);

  const declared = new Set();
  const declaring = /\b(?:const|let|var|override|fn|struct|alias)\b(?:<[^>\n]*>)?\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const m of code.matchAll(declaring)) declared.add(m[1]);

  const found = new Set();
  const ident = /[A-Za-z_][A-Za-z0-9_]*/g;
  for (const m of code.matchAll(ident)) {
    const name = m[0];
    if (!/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(name)) continue;
    if (name.length < 2) continue;
    if (WGSL_RESERVED.has(name) || declared.has(name)) continue;
    const before = code.slice(0, m.index).trimEnd();
    if (before.endsWith(".")) continue;
    const after = code.slice(m.index + name.length).trimStart();
    if (after.startsWith("(") || after.startsWith(":")) continue;
    found.add(name);
  }
  return found;
}

/**
 * Glob expansion, kept tiny on purpose: `*` and `?` in the final path segment
 * and nothing else. The shell usually expands the pattern before this script
 * sees it, so this only covers the quoted case. Supporting `**` or braces would
 * mean maintaining a second shell. A pattern that matches nothing is an error,
 * because a check that silently scans zero files is how this kind of gate dies.
 */
function expand(pattern) {
  const base = basename(pattern);
  if (!/[*?]/.test(base)) return [pattern];
  const dir = dirname(pattern);
  const rx = new RegExp(
    `^${base
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")}$`,
  );
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    console.error(
      `Cannot read ${dir} to expand "${pattern}". Only the last path segment ` +
        `may contain a wildcard.`,
    );
    process.exit(2);
  }
  const hits = names.filter((n) => rx.test(n)).sort();
  if (!hits.length) {
    console.error(`"${pattern}" matched no files, so nothing was checked.`);
    process.exit(2);
  }
  return hits.map((n) => join(dir, n));
}

if (flag("check-shader")) {
  const paths = flag("check-shader")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap(expand);

  // The names the generator will actually declare, so the check measures the
  // emitted chunk rather than a second idea of what the palette is.
  const defined = new Set(Object.keys(colors).map(wgslName));

  const missing = new Map(); // NAME -> files that reference it
  const referenced = new Set();

  for (const path of paths) {
    let src;
    try {
      src = readFileSync(path, "utf8");
    } catch {
      console.error(`Cannot read shader ${path}.`);
      process.exit(2);
    }
    for (const name of paletteReferences(src)) {
      if (defined.has(name)) {
        referenced.add(name);
      } else {
        if (!missing.has(name)) missing.set(name, []);
        missing.get(name).push(path);
      }
    }
  }

  console.log(`checked ${paths.length} shader file(s) against ${file}`);

  // A colour nothing paints is worth saying out loud and worth nothing more.
  // It is the normal state of a CSS-only colour, so it cannot be an error, but
  // it is also exactly what a renamed colour looks like the moment before
  // somebody notices the field went flat.
  const unused = [...defined].filter((n) => !referenced.has(n));
  if (unused.length) {
    console.warn(
      `\n${file} defines ${unused.length} colour(s) no scanned shader ` +
        `references: ${unused.join(", ")}.\n` +
        `Fine for a colour that only ever appears in CSS. A typo if one of ` +
        `them was meant to be painted.\n`,
    );
  }

  if (missing.size) {
    const rows = [...missing.entries()].map(
      ([name, where]) => `  ${name} referenced by ${[...new Set(where)].join(", ")}`,
    );
    console.error(
      `\nShader palette names that ${file} does not define:\n\n` +
        `${rows.join("\n")}\n\n` +
        `The generated chunk declares one const per colour in the tokens file, ` +
        `so a name\nthat is not in the tokens file is declared nowhere. Add the ` +
        `colour, or rename\nthe reference in the shader.\n`,
    );
    process.exit(2);
  }
}

// --- CSS --------------------------------------------------------------------
//
// Emitted as a plain `:root` block. Vendored from the cinematic-frontend skill,
// whose original emits a Tailwind v4 `@theme` block: without Tailwind a browser
// drops that unknown at-rule whole, and every var() on the page resolves to
// nothing. This site has no Tailwind.
// Type steps carry their line height, weight and letter spacing as sibling
// properties, because a size without its leading is how a heading ends up at the
// right size and a browser default rhythm.

if (flag("css")) {
  const lines = [
    `/* Generated from ${file} by generate-tokens.mjs. Do not edit by hand.`,
    `   Change the source and run the generator again. */`,
    "",
    ":root {",
  ];

  lines.push("  /* Colour */");
  for (const [name, t] of Object.entries(colors)) {
    if (t.role) lines.push(`  /* ${t.hex}. ${t.role} */`);
    lines.push(`  --color-${kebab(name)}: ${t.hex};`);
  }

  if (Object.keys(font).length) {
    lines.push("", "  /* Families */");
    for (const [name, stack] of Object.entries(font)) {
      lines.push(`  --font-${kebab(name)}: ${stack};`);
    }
  }

  if (Object.keys(type).length) {
    lines.push("", "  /* Type scale. Size, leading, weight and tracking travel together. */");
    for (const [name, t] of Object.entries(type)) {
      const key = kebab(name);
      lines.push(`  --text-${key}: ${t.size / 16}rem;`);
      if (t.leading) lines.push(`  --text-${key}--line-height: ${(t.leading / t.size).toFixed(4)};`);
      if (t.weight) lines.push(`  --text-${key}--font-weight: ${t.weight};`);
      if (t.tracking !== undefined) lines.push(`  --text-${key}--letter-spacing: ${t.tracking}em;`);
    }
  }

  // The whole numeric spacing scale is derived from one number: `p-4` resolves
  // to calc(var(--spacing) * 4). So the base is the only thing that belongs in
  // this namespace. Emitting a --spacing-<n> per ramp step would pin those
  // particular numbers and leave every other number derived, which is how you
  // get p-6 and p-24 both measuring 24px with nothing in the class name to say
  // so. The ramp is a rule about which multipliers are allowed, not a set of
  // new values, so it is written as the comment above the base.
  if (spacing.base) {
    const steps = spacing.steps ?? [];
    lines.push("", `  /* Spacing. Everything is a multiple of ${spacing.base}px.`);
    if (steps.length) {
      const mult = steps.map((px) => px / spacing.base).join(", ");
      lines.push(`     The ramp is ${steps.join(", ")}px, which is ${mult} on this scale,`);
      lines.push(`     and a step off the ramp is a decision, not a default. */`);
    } else {
      lines.push(`     A step off the scale is a decision, not a default. */`);
    }
    lines.push(`  --spacing: ${spacing.base / 16}rem;`);
  }

  if (Object.keys(radius).length) {
    lines.push("", "  /* Radius */");
    for (const [name, px] of Object.entries(radius)) {
      lines.push(`  --radius-${kebab(name)}: ${px >= 999 ? "999px" : `${px / 16}rem`};`);
    }
  }

  if (tokens.shadow) {
    lines.push("", "  /* The one shadow in the system. If something needs separation and does");
    lines.push("     not qualify for this, it gets a hairline. */");
    for (const [name, value] of Object.entries(tokens.shadow)) {
      lines.push(`  --shadow-${kebab(name)}: ${value};`);
    }
  }

  lines.push("}", "");
  write(flag("css"), lines.join("\n"));
}

// --- WGSL -------------------------------------------------------------------
//
// The output is a plain WGSL chunk that src/field.ts prepends to the field
// shader. The skill's original emits a vgpu module with `export` on every
// declaration; this site drives WebGPU directly, and standard WGSL has no
// `export` keyword, so that version fails to compile here.
//
// WGSL has no version directive, so nobody owns a first-token rule. It has no
// preprocessor either, which is the same sentence from the other side: there is
// no directive to expand, so what is written here is exactly what the compiler
// reads.
//
// The module stays pure. No `@group`, no `@binding`, no `override`, no entry
// point, because a non-entry module that declares its own bindings is rejected
// with VGPU-RESOLVE-MODULE-BINDING, and that failure surfaces in whoever
// imported it rather than in the file that caused it.
//
// Unused colours cost nothing. The resolver drops declarations unreachable from
// the entry point, so a fourteen-colour palette imported for three of them
// compiles to three.
//
// The values are the tokens divided by 255 and nothing else. There is no colour
// management anywhere in the pipeline, by design, so what is written here is
// what lands in the framebuffer. That is measured, not assumed: an offscreen
// target() defaults to rgba8unorm rather than the -srgb variant, and all seven
// example palette colours round-trip through a headless render byte for byte.
// The moment anything converts, these numbers stop being the brand.

if (flag("wgsl")) {
  const lines = [banner("//"), ""];
  const entries = Object.entries(colors);
  const pad = Math.max(...entries.map(([n]) => wgslName(n).length));

  const f = (n) => (n / 255).toFixed(5);
  for (const [name, t] of entries) {
    const n = parseInt(t.hex.replace("#", ""), 16);
    const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(f).join(", ");
    // A WGSL `const` is a true compile-time constant and its type is inferred,
    // so these fold into the code that uses them and cost no load.
    lines.push(
      `const ${wgslName(name).padEnd(pad)} = vec3f(${rgb}); // ${t.hex}`,
    );
  }

  // An indexed accessor, so a shader can pick a palette entry by a band index
  // without branching on a name. Written as a chain rather than an array lookup
  // because a value-typed fixed-size array in WGSL cannot be indexed by a
  // runtime index at all: indexing needs a memory location, so the array would
  // have to be copied into a `var` first and that copy is paid on every call.
  lines.push("", "// Pick a palette entry by index. Clamped, so an out-of-range");
  lines.push("// band index yields an end colour rather than black.");
  lines.push(`fn paletteAt(i: f32) -> vec3f {`);
  lines.push(`  let k = clamp(i, 0.0, ${(entries.length - 1).toFixed(1)});`);
  entries.forEach(([name], idx) => {
    if (idx === 0) lines.push(`  if k < 0.5 { return ${wgslName(name)}; }`);
    else if (idx < entries.length - 1)
      lines.push(`  if k < ${(idx + 0.5).toFixed(1)} { return ${wgslName(name)}; }`);
    else lines.push(`  return ${wgslName(name)};`);
  });
  lines.push("}", "");

  write(flag("wgsl"), lines.join("\n"));
}

// --- Swift ------------------------------------------------------------------

if (flag("swift")) {
  const f = (n) => (n / 255).toFixed(5);
  const lines = [banner("//"), "", "import SwiftUI", "", "public enum Tokens {", "  public enum Palette {"];
  for (const [name, t] of Object.entries(colors)) {
    const n = parseInt(t.hex.replace("#", ""), 16);
    if (t.role) lines.push(`    /// ${t.hex}. ${t.role}`);
    lines.push(
      `    public static let ${name} = Color(.sRGB, red: ${f((n >> 16) & 255)}, ` +
        `green: ${f((n >> 8) & 255)}, blue: ${f(n & 255)}, opacity: 1)`,
    );
  }
  lines.push("  }", "}", "");
  write(flag("swift"), lines.join("\n"));
}

if (!flag("css") && !flag("wgsl") && !flag("swift") && !flag("check-shader")) {
  console.error(
    "Nothing to do. Pass at least one of --css, --wgsl, --swift, --check-shader.",
  );
  process.exit(2);
}
