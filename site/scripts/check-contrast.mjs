#!/usr/bin/env node
// Measures every colour pair in the palette and says what each ratio permits.
//
// The point is not the report, it is the assertions. A palette file that says
// `"textOn": ["cream"]` is making a claim, and this script is what turns that
// claim into something that fails a build instead of something that fails a
// reader. Placement arguments become arithmetic, once.
//
// A field counts as a surface, and it is the one this script used to miss. A
// shader that paints two palette colours is two backgrounds under one glyph, so
// a pair that measures 15.56:1 against the base surface can measure 6.30:1 where
// a dot lands and 1.07:1 for a colour that was only ever checked against cream.
// Given the field's picks, every text claim against it is measured against the
// worst one. This script does the arithmetic; it trusts the picks it is handed.
// Get them from scripts/measure-field.mjs, which renders the field headless and
// records what it actually paints, rather than writing them by hand. The numbers
// above came from a page whose hand-written list was wrong.
// See references/design-system.md, "The field is a background".
//
// Usage:
//   node check-contrast.mjs tokens.json            report and enforce
//   node check-contrast.mjs tokens.json --quiet     only report failures
//
// tokens.json shape (see assets/tokens.example.json):
//   color.<name>.hex          required, "#RRGGBB"
//   color.<name>.surface      true if things are placed ON this colour
//   color.<name>.textOn       surfaces this colour is used as body text on
//   color.<name>.largeTextOn  surfaces it is used as large text on (>=24px)
//   color.<name>.indicatorOn  surfaces it is used as a non-text indicator on
//   field.<name>.picks        colour names this field is allowed to paint
//
// A field name may be used anywhere a surface name may be used. It resolves to
// every one of its picks, and the claim has to hold against all of them.

import { readFileSync } from "node:fs";

const [, , file, ...flags] = process.argv;
if (!file) {
  console.error("usage: node check-contrast.mjs <tokens.json> [--quiet]");
  process.exit(2);
}

const quiet = flags.includes("--quiet");
const tokens = JSON.parse(readFileSync(file, "utf8"));
// Underscore keys are the file's own commentary, not tokens. Filtering them here
// rather than at each use means a "_comment" can be added anywhere in the file
// without turning into a colour with no hex or a field with no picks.
const withoutComments = (o) =>
  Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => !k.startsWith("_")));

const colors = withoutComments(tokens.color);
const fields = withoutComments(tokens.field);

// --- WCAG 2.x arithmetic ----------------------------------------------------

function channel(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// The thresholds are the whole reason this exists. 4.5 is the AA floor for body
// text, 3.0 covers large text and any non-text indicator, and below 3.0 a colour
// is decoration: it may be a fill, and it may never be the only thing carrying a
// meaning.
function verdict(r) {
  if (r >= 7) return { label: "AAA body text", rank: 4 };
  if (r >= 4.5) return { label: "AA body text", rank: 3 };
  if (r >= 3) return { label: "large text and indicators only", rank: 2 };
  return { label: "fills and decoration only", rank: 1 };
}

const fmt = (r) => `${r.toFixed(2)}:1`;

// --- fields -----------------------------------------------------------------

// A field is not one background, it is every colour the shader is allowed to
// pick, and a glyph is wide enough to sit on several of them at once. So a claim
// against a field is a claim against its worst pick, and that is the only honest
// way to read it: the reader does not get to choose which pixel their eye lands
// on.

const names = Object.keys(colors);
const fieldNames = Object.keys(fields);
const setupErrors = [];

for (const [name, field] of Object.entries(fields)) {
  if (colors[name]) {
    setupErrors.push(
      `  "${name}" is both a colour and a field. Names have to be distinct, ` +
        `because a claim naming it would be ambiguous.`,
    );
  }
  const picks = field.picks ?? [];
  if (!picks.length) {
    setupErrors.push(
      `  field "${name}" declares no picks. List the palette colours the shader ` +
        `paints, or the field cannot be measured and text over it is unchecked.`,
    );
  }
  for (const pick of picks) {
    if (!colors[pick]) {
      setupErrors.push(
        `  field "${name}" picks "${pick}", which is not a colour in this file.`,
      );
    }
  }
}

if (setupErrors.length) {
  console.error(`\nThe field declarations are malformed:\n\n${setupErrors.join("\n")}\n`);
  process.exit(2);
}

/** Every background a placement target can put under a glyph. */
function backgroundsOf(target) {
  if (fields[target]) {
    return fields[target].picks.map((p) => ({ name: p, hex: colors[p].hex }));
  }
  if (colors[target]) return [{ name: target, hex: colors[target].hex }];
  return null;
}

/** The worst ratio a colour achieves anywhere on a target, and where. */
function worstOn(hex, target) {
  const backgrounds = backgroundsOf(target);
  let worst = null;
  for (const bg of backgrounds) {
    const r = ratio(hex, bg.hex);
    if (!worst || r < worst.r) worst = { r, pick: bg.name };
  }
  return worst;
}

// --- report -----------------------------------------------------------------

const surfaces = names.filter((n) => colors[n].surface);

if (!surfaces.length) {
  console.error(
    `\nNo colour in ${file} is marked "surface": true.\n\n` +
      `Mark the colours things are placed ON, or every pair below is noise.\n`,
  );
  process.exit(2);
}

if (!quiet) {
  console.log(`\nContrast against each surface, from ${file}\n`);
  for (const surface of surfaces) {
    console.log(`  on ${surface} (${colors[surface].hex})`);
    const rows = names
      .filter((n) => n !== surface)
      .map((n) => ({ name: n, r: ratio(colors[n].hex, colors[surface].hex) }))
      .sort((a, b) => b.r - a.r);
    for (const row of rows) {
      const v = verdict(row.r);
      console.log(
        `    ${row.name.padEnd(12)} ${fmt(row.r).padStart(8)}   ${v.label}`,
      );
    }
    console.log("");
  }
}

if (fieldNames.length && !quiet) {
  console.log(`Contrast on each field, worst pick shown\n`);
  for (const name of fieldNames) {
    const picks = fields[name].picks;
    console.log(`  on ${name} (${picks.join(", ")})`);

    // The swing is the field's own internal contrast, and it is a tax every
    // text colour on the field pays. Measured on a real shipped halftone: cream
    // gap against lavender dot, 2.47:1, which took a 15.56:1 numeral down to
    // 6.30:1 and a softened caption down to 1.07:1. The swing is why a palette
    // that passes every pair above can still produce a page nobody can read.
    const lums = picks.map((p) => ({ p, l: luminance(colors[p].hex) }));
    const light = lums.reduce((a, b) => (a.l > b.l ? a : b));
    const dark = lums.reduce((a, b) => (a.l < b.l ? a : b));
    const swing = ratio(colors[light.p].hex, colors[dark.p].hex);
    console.log(
      `    swing       ${fmt(swing).padStart(8)}   ${light.p} to ${dark.p}, ` +
        `and every text colour here pays it`,
    );

    const rows = names
      .filter((n) => !picks.includes(n))
      .map((n) => ({ name: n, ...worstOn(colors[n].hex, name) }))
      .sort((a, b) => b.r - a.r);
    for (const row of rows) {
      const v = verdict(row.r);
      console.log(
        `    ${row.name.padEnd(12)} ${fmt(row.r).padStart(8)}   ${v.label} ` +
          `(worst on ${row.pick})`,
      );
    }

    if (!rows.some((row) => row.r >= 4.5)) {
      console.log(
        `\n    No colour in this palette clears AA on every pick of ${name}.\n` +
          `    This field cannot carry body text anywhere. Text over it needs an\n` +
          `    opaque plate, or the field has to be held to one pick where the\n` +
          `    text lands. See references/shader-toolkit.md, "Quiet zones".`,
      );
    }
    console.log("");
  }
}

// --- assertions -------------------------------------------------------------

const CLAIMS = [
  { key: "textOn", floor: 4.5, what: "body text" },
  { key: "largeTextOn", floor: 3, what: "large text" },
  { key: "indicatorOn", floor: 3, what: "a non-text indicator" },
];

const failures = [];

for (const [name, token] of Object.entries(colors)) {
  for (const { key, floor, what } of CLAIMS) {
    for (const target of token[key] ?? []) {
      if (!backgroundsOf(target)) {
        failures.push(
          `  ${name}.${key} names "${target}", which is not a colour or a field ` +
            `in this file.`,
        );
        continue;
      }
      const { r, pick } = worstOn(token.hex, target);
      if (r < floor) {
        const where =
          pick === target
            ? `${name} on ${target}`
            : `${name} on ${target} measured against its ${pick} pick`;
        // A field failure gets a different remedy from a surface failure. You
        // cannot invert a field: the shader paints both colours, so there is no
        // "put the text underneath" version of it.
        const remedy = fields[target]
          ? `    The field paints ${pick} under this text. Put the text on an ` +
            `opaque plate, hold the field to one pick where the text lands, or ` +
            `use a colour that clears ${floor}:1 on every pick.`
          : `    Either stop using it that way, or invert: ${target} text on a ` +
            `${name} fill measures the same ratio and is usually the pairing you want.`;
        failures.push(
          `  ${where} measures ${fmt(r)}, under the ${floor}:1 floor for ` +
            `${what}.\n${remedy}`,
        );
      }
    }
  }
}

// A palette almost always contains at least one colour too weak to be text, and
// that is fine. What is not fine is not knowing which. Naming them here means
// the next person cannot discover it by shipping.
const decorative = names.filter(
  (n) =>
    !colors[n].surface &&
    surfaces.every((s) => ratio(colors[n].hex, colors[s].hex) < 3),
);

if (decorative.length && !quiet) {
  console.log("Fills only, on every surface in this palette:");
  for (const n of decorative) {
    console.log(`  ${n}: never text, and never the only thing marking a state.`);
  }
  console.log("");
}

if (failures.length) {
  console.error(`Contrast claims that do not hold:\n\n${failures.join("\n")}\n`);
  process.exit(1);
}

console.log("Every contrast claim in the palette holds.");
