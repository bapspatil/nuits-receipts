---
title: A row with an open More menu needs its own z-index
author: Bapusaheb
date: 2026-10-30
branch: ux4/look
id: l-110c1dd0
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
Every list row carries an inline view-transition-name (PR 9), which makes each row its own stacking context. An open More popover on desktop then paints under the next row, and clicks land on that row. The fix is .row:has(>.ra details[open]){z-index:2}.

## Tried and ruled out
Raising the popover's own z-index does nothing: it cannot escape its row's stacking context.

In the code: src/ui.ts styles(), the row rules. Journey f clicks inside the popover and catches a regression.
