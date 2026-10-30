---
title: "One-step import: detection order and the import Undo refusal rule"
author: Bapusaheb
date: 2026-10-30
branch: ux4/import
cost: { minutes: 112, tokens: 906377 }
id: l-a7153856
scope: repo
status: active
src: agent
touches:
  - src/one-step.ts
  - src/undo.ts
  - src/banking.ts
  - src/imports.ts
---

## Decided
- Detection order in src/one-step.ts importOneStep. Account: the one chosen on the account question, else the only account, else the account whose bank_name is the bank the layout names, else a new account named for that bank when there are none, else ask. Layout: saved bank_presets for the header fingerprint (the account's bank first), else the built-in layout (builtin-holvi is the catch-all and loses to a layout made for the exact columns; Nordea and OP share one mapping so they are one answer), else the model's proposal when it reads the whole file and has no slash date, else the column editor. Bytes that are not UTF-8 read as Windows-1252.
- The editor (/imports/csv preview and confirm) still opens when rows have errors, printed totals do not add up, the delimiter is ambiguous or a slash date order is unconfirmed. Its two ticks stay gates there; in the one step they are warnings (skip, and a count of look-alikes in other accounts).
- Saved layouts: only a model proposal or a hand-made editor mapping is saved. Saving a built-in one would make the editor list two presets for the same headers and raise Several presets match.
- Import Undo (src/undo.ts undoImport) deletes the import's bank_transactions, internal_transfers, match_rejections and the imports row. imports.status has a CHECK of pending or complete, so there is no undone status; deleting the row also lets the same file import afresh. It refuses with nothing removed when any row has match_method manual or exempt_by owner; the deletes repeat that check so a decision between the count and the batch still stops them. Automatic matches and automatic Not a purchase marks do not stop it.
- Import anyway re-runs only the rows the first import skipped, as a second import with a salt in importIdentity, because the same bytes under the same account is the same import id and a replay. Rows with a bank ID cannot be taken twice (unique account_key, external_id), so they stay skipped and no Import anyway is offered for them.

## Tried and ruled out
- Putting the chunked reconcile marks in the log: reconcile and Clef marks run in chunks of 50 after the import batch, so they cannot share its batch. Deleting the rows is the Undo for them.

## Watch out
- The same bytes into another account are refused (imports.original_key is unique), so a look-alike test needs a different file.
