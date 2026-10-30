---
title: Bank has only To do and All; bulk Not a purchase skips matched rows
author: Bapusaheb
date: 2026-10-30
branch: ux4/bank
cost: { minutes: 30, tokens: 270601 }
id: l-57ff9bab
scope: repo
status: active
src: agent
touches:
  - src/banking.ts
  - src/batch.ts
  - src/views.ts
---

Decided: Bank's Show chips (All, Missing, Matched) became two views, To do and All, per docs/app-v4/CONTRACT.md. The Matched filter is gone; the import banner's See them link opens All, where matched rows carry the Matched status. Old ?show= links fall back to To do. Bulk Not a purchase and Needs receipt add receipt_id IS NULL, because SET_REQUIRED_SQL clears receipt_id and used to drop a match without a word (invariant 10); a matched row counts as skipped in the banner. The bulk return URL gets #row-<next open id> from nextOpenPayment, a Bank-only stand-in until PR 5's generic nextOpen/listUrl replaces it. Watch out: id="transfers" on the first transfer row clashed with id="row-<id>", so the transfer confirm and undo now land on view=all#row-<debit id>.
