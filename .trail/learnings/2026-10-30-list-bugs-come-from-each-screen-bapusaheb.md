---
title: "List bugs come from each screen building its own list, and the journey seed is too small to show them"
author: Bapusaheb
date: 2026-10-30
branch: ux4/base
cost: { minutes: 1, tokens: 2394 }
id: l-0acede82
scope: repo
status: active
src: agent
touches:
  - src/views.ts
  - src/all.ts
  - scripts/ux-journeys.steps.mjs
---

## Decided
- Lists get one shared model (open predicate, order, filter in SQL, next item, return URL) instead of per-screen fixes. Four UX rounds fixed screens one at a time and the list behaviour stayed broken, because six lists had three sort orders, three filtering strategies and two paging schemes.

## Watch out
- Bank paged a month 100 rows at a time before filtering Missing in JS, so open payments past row 100 hid behind Later however many earlier rows were settled. Its SQL filter for missing payments (SHOW_SQL.missing) already existed and was used by bulk actions, just not by the page.
- Review's filled first row was a deliberate "one primary per screen" choice, not a CSS slip. It read as a bug because nothing labelled it.
- The UX journey seed had 3 receipts and 6 payments. It never crossed a page boundary, so it could not catch any list regression. Test list behaviour against a busy month.

In the code: src/views.ts:786 (month query with LIMIT/OFFSET), src/views.ts:833 (Missing filter after paging), src/views.ts:288 (row-0 primary), src/all.ts:84 and :104 (default filter and date-only sort), src/banking.ts SHOW_SQL, scripts/ux-journeys.steps.mjs.
