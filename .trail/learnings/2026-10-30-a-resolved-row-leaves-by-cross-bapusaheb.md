---
title: "A resolved row leaves by cross-document transition: rows are named inline, not by auto"
author: Bapusaheb
date: 2026-10-30
branch: ux4/live
cost: { minutes: 30, tokens: 211411 }
id: l-296073d9
scope: repo
status: active
src: agent
touches:
  - docs/ARCHITECTURE.md
  - src/bulk.ts
  - src/views.ts
  - test/app-shell.test.ts
  - test/onedrive.test.ts
  - src/batch.ts
  - src/discard.ts
  - src/events.ts
  - src/inbound.ts
  - src/index.ts
---

## Decided
- No script moves the page. @view-transition, scroll-margin-top on rows and the #row-<next> fragment (rows are tabindex=-1) do it; the rule is in VIEW_TRANSITION_CSS and only Receipts To do, Bank and the receipt page pass it as their style option, because both documents of a navigation must carry it.
- The focused row is described by the banner (aria-describedby, only when the page has one) and the title starts with the event, since a live region present at load is not reliably spoken. After Approve the redirect fragment is firstToFill(next receipt): its first empty required field, else #main (tabindex=-1).
- A second submit is quiet: Approve or Skip with a stale revision (or a discarded receipt) and Not a purchase on an owner-exempt payment redirect to the list with no done=, so no second banner or undo.

## Tried and ruled out
- view-transition-name:auto (a row's id as its name): in Chrome 151 the rows did not animate (2 groups on a 50-row list). Inline r-<id> names give 51 groups.
- Bulk 'double download': at this base the bulk bar asks for JSON and gets the location in the body, so the list is fetched once. fetch with redirect manual hides Location, so it cannot be assigned; bulk.js now sends an opaque redirect to its own address.
- Journey f's scrollY check: a bulk of the whole page cannot keep scrollY and focus the next row. It now measures the next row against where the first resolved row on screen stood.

## Watch out
- Safari and Firefox were not run. VoiceOver reading of the banner is unchecked.
- scroll-margin-top is --nav-height plus --space-4 although the header is not sticky yet; PR 11 may make it so.
