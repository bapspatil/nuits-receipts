---
title: "Home has no view transition: morphing its named rows froze Chrome for seconds"
author: Bapusaheb
date: 2026-10-31
branch: main
cost: { minutes: 17, tokens: 76151 }
id: l-0fa12c53
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - docs-site/src/content/docs/reference/changelog.mdx
  - package.json
  - DESIGN.md
  - README.md
  - bun.lock
  - docs-site/WRITING.md
  - docs-site/scripts/check-copy.mjs
  - docs-site/src/content/docs/explanation/index.mdx
  - docs-site/src/content/docs/explanation/what-it-does-not-do.mdx
---

## Decided
- Home ships without the cross-document view transition (@view-transition). Opening a document changes Home's layout (the folder list hides, a preview column appears), and with about 50 rows each carrying a view-transition-name, Chrome spent over 6 seconds of style recalculation per click. Without it a click is about 150 ms.
- A row links to its own #row- anchor, keeping the page cursor (before=), so the list keeps its place beside the preview; Back to the list returns to the same row. On a phone, an open document hides the search and month strip so it starts at the top.

## Tried and ruled out
- Keeping the transition and trimming it: any transition that names every row pays the cost; the receipts To do and Bank lists keep theirs because their layout does not change under the rows.

## Watch out
- Measure with Chrome's Performance.getMetrics (RecalcStyleDuration) around a click; the server answered in 17 ms the whole time, so timing the request alone hides this.

In the code: src/views.ts home() style (no VIEW_TRANSITION_CSS), src/archive.ts rowKey and cursorParam, src/archive-css.ts phone :has(.arch.opened), test/live.test.ts.
