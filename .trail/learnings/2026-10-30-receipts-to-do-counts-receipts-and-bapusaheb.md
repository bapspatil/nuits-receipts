---
title: "Receipts To do counts receipts and overdue invoices; held mail sits above it, outside the total"
author: Bapusaheb
date: 2026-10-30
branch: ux4/receipts-todo
cost: { minutes: 68, tokens: 648019 }
id: l-78397a0b
scope: repo
status: active
src: agent
touches:
  - src/all.ts
  - src/worklist.ts
  - src/ui.ts
  - src/views.ts
  - src/index.ts
---

## Decided
- Receipts To do is one walk: receipts needing review plus overdue sales invoices. Overdue is computed in SQL inside the list's open set with payment terms bound as a parameter, so paging, counts, Approve's next row and Start checking all see the same set. Approve or Start checking can land on an overdue invoice.
- Held mail from unknown senders is shown above the list with Allow and a confirmed Ignore, not as rows in it. It has no bulk bar (one bar per page) and is not in data-total or the To do switch count, so the contract's count of open rows stays a count of things the walk visits. The list header and the nav badge do add held mail, so the switch can say 32 while the header says 35 to do.
- Delete email is gone: Ignore deletes the waiting mail and logs what the sender sends later, which covered every reason to delete.
- Each view keeps one primary. Rows lost their own primary and Discard; Receipts To do has Start checking (N) in the header, and Bank got Start matching (N) for the same reason, since removing the row-0 primary left it with none.
- Settings folds Senders, Ignored and Mail we didn't keep into one Email senders section; #mail is an anchor inside it.

## Watch out
- /review/merge answers 302 for POST too, so an old form merges nothing. The merge form now posts to /receipts/merge.
- /invoices and /receipts?kind=sales are the invoices list in All; a bare /receipts with show or q and no view is treated as All so old links keep their filter.

In the code: src/worklist.ts OVERDUE and RECEIPTS.open, src/all.ts todoPage and heldRow, src/ui.ts countNav and viewSwitch, src/views.ts sendersPart.
