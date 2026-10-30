---
title: "Glass UI is our own CSS material, not a library, and never SVG refraction"
author: Bapusaheb
date: 2026-10-30
branch: ux4/base
cost: { minutes: 10, tokens: 110642 }
id: l-505d27a8
scope: repo
status: active
src: agent
touches:
  - src/ui.ts
  - src/tokens.json
---

## Decided
- The owner asked for a glass look inspired by the new macOS Liquid Glass. It is built as a small CSS material in the app's own tokens (translucent warm tint, backdrop blur and saturation, an inner edge highlight, a soft shadow), used only on navigation and floating controls: sidebar, phone tab bar, sticky action bar, bulk bar, Undo banner, menus. Rows, fields and documents stay solid so amounts stay readable.
- It falls back to solid surfaces without backdrop-filter support, under prefers-reduced-transparency, and under prefers-contrast: more.

## Tried and ruled out
- Third-party glass libraries (GlassKit, liquid-glass-component-kit, @real-human/liquid-glass, GlassiFy, water): small projects of unverified upkeep, most bring their own component sets, and the useful part is about 30 lines of CSS.
- SVG displacement refraction via backdrop-filter: url(#filter): Chromium only. Safari, which every iPhone browser uses, renders nothing while @supports reports success, so it can't even be feature-detected.

## Watch out
- Measure text contrast on glass in the worst case, with the darkest and lightest content scrolling underneath, and raise the tint opacity until AA holds.

In the code: the glass tokens land in src/tokens.json and the component CSS in src/ui.ts (PR 11); the mockup is docs/app-v4/mockups/mix.html.
