---
title: "Glass opacity is the lowest that keeps text readable, checked flat before blur"
author: Bapusaheb
date: 2026-10-30
branch: ux4/look
id: l-bf5b8caa
scope: repo
status: active
src: agent
touches:
  - NOTICE
  - scripts/app-tokens.mjs
  - scripts/app-tokens.test.ts
  - scripts/ui-policy.json
  - scripts/ux-journeys.steps.mjs
  - src/all.ts
  - src/fonts.ts
  - src/imports.ts
  - src/index.ts
  - src/invoices.ts
---

## Decided
The glass surfaces (sidebar, tab capsule, bulk and action bars, banner, segmented thumb) are paper0 at alpha 0.85. That is the lowest alpha, in steps of .01, at which ink, muted, petrol and success text still reach 4.5:1 over the darkest thing that can scroll under them (petrol950, ink950, petrol900, paperField, paper50). Composites are measured flat, before blur, so blur only helps.

## Watch out
axe and ui-lint cannot measure contrast through translucent glass, so the tokens test is the proof. Lowering the alpha fails scripts/app-tokens.test.ts on purpose. Solid fallbacks apply under @supports not backdrop-filter, prefers-reduced-transparency and prefers-contrast:more.

In the code: src/tokens.json glass block and the colours with an "over" key; scripts/app-tokens.mjs; scripts/ui-policy.json exception for "nav.tabs a *".
