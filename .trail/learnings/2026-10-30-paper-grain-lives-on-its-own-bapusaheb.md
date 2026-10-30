---
title: Paper grain lives on its own layer so contrast stays measurable
author: Bapusaheb
date: 2026-10-30
branch: ux4/look
id: l-0dc69e05
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
The grain is a fixed .grain div with pointer-events:none and z-index:-1, served from /assets/grain.svg. It is not a background image on html or on the document panel.

## Tried and ruled out
A background-image on html or .doc: axe and ui-lint give up on contrast over background images, which turned every text node into a finding. A data: URL is blocked by the CSP img-src 'self'.

In the code: src/ui.ts GRAIN_SVG and page(); src/index.ts route /assets/grain.svg.
