---
title: "Home's archive: Invoices kept a way in, and global classes leak into SVG"
author: Bapusaheb
date: 2026-10-31
branch: feat/archive-home
cost: { minutes: 77, tokens: 725618 }
id: l-6f850f4d
scope: repo
status: active
src: agent
touches:
  - src/search.ts
  - src/viewer.ts
  - src/archive.ts
  - src/files.ts
  - src/archive-css.ts
  - src/find.ts
  - test/archive.test.ts
  - src/all.ts
  - src/index.ts
  - scripts/ux-journeys.steps.mjs
---

## Decided
- Folding Receipts All into Home removed the only route to the Invoices work list (its tabs lived on All). Invoices is now the third link of the Receipts To do | All switch (`receiptsSwitch` in src/all.ts). The UX journeys caught this; unit tests did not.
- Home renders search first, then this month's close as a compact strip (`.monthband` in src/archive-css.ts), then the archive, so the archive is above the fold.
- Beside an open preview, the folder drawer hides below 1680px; three columns at 1440 crushed the list to one letter per line.
- An Undo offered on Home needs the receipts list's All view: index.ts adds view=all to the banner's params on `/`, and only the undo log's `/undo` takes list fields (events.ts `onList`).

## Watch out
- SVG elements take CSS geometry from classes: a month bar classed `bar` picked up the app header's `.bar` height. Overview bars use `mbar`.
- The app already has a `.find` class (Bank's search row); quick find uses `qfind`.
- View transition names must be CSS idents: archive item keys (`r:<id>`) contain `:`, so rows use the bare receipt id (which list actions land on as `#row-<id>`) or a hyphenated key.
- A lone "other" document must count for Home's first-run check, or Home stays on Welcome.

In the code: src/all.ts receiptsSwitch, src/archive.ts overview and row keys, src/archive-css.ts, src/index.ts banner params, scripts/ux-journeys.steps.mjs journey g.
