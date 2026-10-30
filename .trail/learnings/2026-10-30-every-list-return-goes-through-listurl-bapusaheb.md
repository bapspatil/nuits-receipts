---
title: Every list return goes through listUrl and nextOpen
author: Bapusaheb
date: 2026-10-30
branch: ux4/worklist
cost: { minutes: 44, tokens: 336722 }
id: l-db6f361f
scope: repo
status: active
src: agent
touches:
  - src/batch.ts
  - src/index.ts
  - src/views.ts
  - src/events.ts
  - test/worklists.test.ts
---

## Decided
- Every return URL comes from listUrl in src/worklist.ts, and the next open row from nextOpen, one query run after the write. Bank's interim nextOpenPayment, queueAround, backPath, BACK_QUERY and HOME are gone. Forms post the list state under the URL's own names (view, month, upto, show, q); nothing posts a return path any more except Restore's back and the held-mail back, and both are parsed into a ListState and rebuilt, never followed as sent.
- Which list an action returns to comes from the route, never from the request: listState ignores a posted list key. The one exception is /receipts/bulk, where list=invoices picks Invoices. A posted list=bank on a receipts route can't send you to Bank.
- The receipt page always walks Receipts To do under its month: from=all only picks the list the crumb and an empty To do land on. Approve wraps within the month, Skip doesn't, Discard from a page opened from To do moves on like Approve.
- Until PR 6, GET /receipts?view=todo renders reviewPage with the month filter and upto, so the To do URL already works. /review is the same page with no filter.
- Held-mail actions return without a #row- anchor on purpose: the mail sits above the receipt rows, and an anchor would scroll past the mail still left.
- An Undo form carries the list state of the page it is shown on (events.ts onList), so undoing a single Not a purchase returns to the same view.

## Watch out
- inv5 still expected the month's To do to be the 3 dated receipts after the contract amendment added undated ones to every month's To do. It was test.fails, so nobody saw it. It now asserts undated first, then the month's own, and wraps to the first undated.
- Row-value comparison (key) > (SELECT key ...) needs NULL-free keys: the receipts order uses coalesce(issue_date,'') after issue_date IS NOT NULL, or undated rows would compare as NULL and never count as "after".

## Not done here
- Read again, Move kind, Mark paid and Save rule on a receipt page still return to /receipts/<id> without from and month.
- Matching from a receipt page still lands on Bank, not on the receipt's list.

In the code: src/worklist.ts (listState, listUrl, nextOpen, openPlace, landing), src/batch.ts runBulk, src/index.ts /discard, /restore and the receipt POST, src/views.ts receiptPage (one Promise.all round).
