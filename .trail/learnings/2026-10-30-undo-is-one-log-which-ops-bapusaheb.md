---
title: "Undo is one log; which ops undo, which confirm, and the same-batch rule"
author: Bapusaheb
date: 2026-10-30
branch: ux4/undo
cost: { minutes: 101, tokens: 756297 }
id: l-62a70a61
scope: repo
status: active
src: agent
touches:
  - src/undo.ts
  - src/events.ts
  - src/index.ts
  - src/discard.ts
  - src/batch.ts
  - src/match.ts
  - src/settings.ts
---

## Decided
- Undo is one log for every resolving action: approve (single and bulk), discard, mark paid and not paid, not a purchase and needs a receipt, match, Match all, remove match, delete rule, and a Settings save that removes a sender or a part (op settings). Each writes through withUndo in src/undo.ts, and the banner posts {at, op} plus the page's list state to POST /undo. Adding an undoable action is a CHANGES entry and a withUndo call, never a new route.
- The same-batch rule: the action's own write goes inside withUndo, so the snapshot, the write and the seal commit together. Work the action runs after its batch (cacheFx, reconcile) is outside the log on purpose; APPROVED lists the fx columns so Undo still puts them back, and revision is what tells a later edit apart.
- Read the cursor before the write as before, but an Undo reads its cursor after the restore: it lands on what it brought back, wherever that now stands. undo() returns the restored ids (RETURNING) for this.
- Undo of an approval first unlinks any automatic match made after its at on the receipts it puts back. That match rested on the approved facts. No reconcile runs after an Undo, so the matcher cannot redo what was just undone; the next import or upload may match it again, which is the matcher's normal job.
- Discard no longer asks "Remove match?". Its snapshot holds the bank row by receipt_id and Undo relinks it while that payment is still free (the RELINK guard).
- Settings undo writes settings_audit rows under the person, so the history shows it and older Settings tabs go stale. A key the action created (deploy value before) is deleted again: the snapshot keeps an absent row as 'null'.
- No Undo, a confirm step instead: Move kind (clears client, VAT, paid, manual fields and the match), held-mail Ignore (deletes mail), OneDrive Disconnect (deletes the sign-in). Read again and Move run in AI chunks, so one at per action would not hold.

## Tried and ruled out
- Folding the import's automatic Not a purchase marks into the log: they are written by reconcile in chunks of 50, outside any one batch, and the log restores exempt_by to NULL, which reconcile would mark again. The import's Undo comes with the one-step import (PR 7b), which deletes the import's rows. Until then each mark has Needs a receipt with its own Undo.

## Watch out
- Done params put at and op next to each other; test/helpers locationOf drops that pair so expectations don't carry a timestamp. A test that clicks Undo must load the raw signed Location, not locationOf.
- onList copies kind only as kind=sales (Invoices); matched's kind=receipt is the event's own.
- Undo of remove match leaves its match_rejections row; it only stops the matcher, and the pair is linked again anyway.
