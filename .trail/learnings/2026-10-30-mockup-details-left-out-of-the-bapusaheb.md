---
title: Mockup details left out of the Mix look on purpose
author: Bapusaheb
date: 2026-10-30
branch: ux4/look
id: l-6b6759be
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
- To do rows in `src/all.ts` have no per-row Approve or Discard: no row holds a primary, and list semantics stay put. The bulk bar and the receipt page carry them.
- One STATUS badge per `row()`. A matched Bank row in `src/views.ts` that still needs checking shows Matched plus a "Check the receipt" link, not a second stamp.
- Stamps are 12px, not the mockup's 11px, because 12px is the app's type floor in `scripts/ui-policy.json`.
- Bank keeps its Search, Match and Not a purchase forms under the row (the `below` slot of `row()`), not in the actions column.
- No column heads; the row links as a whole through a stretched title link in `src/ui.ts`.

In the code: `src/row.ts`; `docs/app-v4/after/look.md` lists the same with screenshots.
