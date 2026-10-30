---
title: Receipts To do counts receipts and overdue invoices; held mail sits above it; the old Merge form still merges
author: Bapusaheb
date: 2026-10-30
branch: ux4/receipts-todo-on5
cost: { minutes: 85, tokens: 723263 }
id: l-8df53146
scope: repo
status: active
replaces: l-78397a0b
src: agent
touches:
  - test/worklist-returns.test.ts
  - src/all.ts
  - src/index.ts
  - test/base-path.test.ts
  - scripts/ux-journeys.steps.mjs
  - scripts/ui-lint.mjs
  - scripts/ux-journeys.mjs
  - src/events.ts
  - src/views.ts
  - test/bulk-senders.test.ts
---

## Decided
- Receipts To do is one walk: receipts needing review plus overdue sales invoices. Overdue is computed in SQL inside the list's open set with the payment terms bound as a parameter, so paging, counts, Approve's next row and Start checking all see the same set. Approve or Start checking can land on an overdue invoice.
- A list's open set is one function, open(env, state) returning { sql, binds }, with the month filter folded in. It takes env so a predicate can bind values from config (the payment terms); there is no separate where.
- Held mail from unknown senders is shown above the list with Allow and a confirmed Ignore, not as rows in it. It has no bulk bar (one bar per page) and is not in data-total, the switch count or the list header; the mail section carries its own count. The nav badge does add it.
- Delete email is gone: Ignore deletes the waiting mail and logs what the sender sends later, which covered every reason to delete.
- Each view keeps one primary. Rows lost their own primary and Discard; Receipts To do has Start checking (N) in the header, and Bank got Start matching (N) for the same reason. Discard on To do is the bulk bar's, whose Undo restores by time.
- Settings folds Senders, Ignored and Mail we didn't keep into one Email senders section; #mail is an anchor inside it.

## Watch out
- GET /review/merge answers 302, but a POST to it still runs the merge, like /receipts/merge, so a page left open does not post into a redirect. Both read the posted list fields and return to that To do under its month.
- /invoices and /receipts?kind=sales are the invoices list in All; a bare /receipts with show or q and no view is treated as All so old links keep their filter.

In the code: src/worklist.ts OVERDUE and RECEIPTS.open, src/all.ts todoPage and heldRow, src/index.ts the merge route, src/ui.ts countNav and viewSwitch, src/views.ts sendersPart.
