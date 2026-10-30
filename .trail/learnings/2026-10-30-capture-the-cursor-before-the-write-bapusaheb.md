---
title: Capture the cursor before the write; bulk state is posted in full
author: Bapusaheb
date: 2026-10-30
branch: ux4/worklist-fixes
cost: { minutes: 80, tokens: 688130 }
id: l-c92e0e32
scope: repo
status: active
src: agent
touches:
  - src/worklist.ts
  - src/batch.ts
  - src/index.ts
  - src/views.ts
  - src/bulk.ts
  - src/all.ts
---

## Decided
- An action reads its cursor (cursorOf or cursorFor in src/worklist.ts) before its write, and nextOpen looks on from that key. The write can move the acted-on row: approving an undated receipt while typing its date put it among the dated ones, so a key read after the save skipped every other undated receipt. A page that writes nothing uses standing(def, id), a subquery, so its Next costs no extra wave. Never pass ids read after a write to nextOpen.
- An Undo or Restore lands on what it brought back: cursorFor(..., { at: true }) compares with >=. restoreBatch, unmatchLikely and undoExemptions return the ids they changed (UPDATE ... RETURNING id) for this.
- A bulk bar posts the list's whole state, and postedState refuses anything missing or malformed with 400 "This page is out of date". Do not add a fallback view: the old fallback to To do let a stale All form with a search that matched nothing discard every To do receipt.
- Select-all takes the first BULK_CAP rows in list order on every list, and bulkBar offers "Select the first 500" (data-all) when data-total is higher. data-total is the true count (openCount), never the length of a capped read.
- Every receipt page form posts receiptFields (from, month, q from All) and every route returns through receiptReturn or receiptUrl. Matching from a receipt page returns to it, or moves on like Approve when the match settles a receipt waiting in To do.
- route starts navCounts for receipt pages too, so a receipt page is three D1 waves: settings, getReceipt with the tab counts, the page. getReceipt stays before the page batch because those queries need the receipt's facts.

## Watch out
- D1 refuses a LIKE pattern over 50 bytes (LIKE or GLOB pattern too complex). The All search uses instr for that reason; do not go back to LIKE '%q%'.
- POST /review/merge and /transfers/<id>/undo now read a form, so a bodyless POST answers 400.
