---
title: Which simplifications the owner approved and which they kept
author: Bapusaheb
date: 2026-10-30
branch: ux4/base
cost: { minutes: 1, tokens: 2394 }
id: l-3ebc4dfb
scope: repo
status: active
src: agent
touches:
  - src/views.ts
  - src/discard.ts
  - src/imports.ts
  - src/settings.ts
---

## Decided
The owner asked to simplify everywhere and approved these cuts:
- A receipt goes to To do only for a missing or wrong required fact. Optional issues (no receipt number, unsure Part or Kind) stay as a note.
- Discard is one click with Undo, with no reason to pick.
- Part is hidden while there is only one part.
- Bank import is one step: the account and layout are chosen automatically, already-imported rows are skipped, and the column editor opens only when detection fails.
- Mail from unknown senders shows as To do rows with Allow and Ignore. The three sender lists in Settings become one.
- Overdue sales invoices show in To do.
- Settings has 5 sections with one Save.

## Tried and ruled out
The owner turned these down, so don't propose them again without asking:
- Marking a month sent automatically when its ZIP is downloaded.
- Merging duplicates automatically (the Merge button stays).
- Hiding Kind and vendor rules from the receipt page.
- Pairing own-account transfers automatically.
- Detecting receipt or invoice on Add (the choice stays).
- Removing the Accountant field, moving the review thresholds out of the UI, or removing the Email Routing ticks.

In the code: src/receipts.ts (needs_review assignment), src/discard.ts, src/imports.ts, src/settings.ts and src/setup.ts.
