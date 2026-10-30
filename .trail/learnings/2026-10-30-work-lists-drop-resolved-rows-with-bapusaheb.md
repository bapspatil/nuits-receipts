---
title: Work lists drop resolved rows with Undo and refill open-first
author: Bapusaheb
date: 2026-10-30
branch: ux4/base
cost: { minutes: 1, tokens: 4027 }
id: l-ff5b441a
scope: repo
status: active
src: agent
touches:
  - src/all.ts
  - src/views.ts
  - src/bulk.ts
---

## Decided
- In every work list (Receipts To do, Bank To do), a resolved row leaves the list and the next open row moves up. A banner says what happened and offers Undo. Done rows live in the All view, not in To do.
- To do lists are open-first with no offset paging. The page shows the first 50 open rows of a fixed open-first order, and "Show 50 more" raises the limit. When rows resolve, the next ones refill the page. The All view browses newest first with a keyset cursor (before=<date>_<id>), never an offset.
- Review is merged into Receipts as a "To do | All" switch, and Bank gets the same switch. /review answers with a 302, not a 301, so a revert can't strand cached redirects.
- Every button shows an icon plus its label, one icon per meaning.

## Tried and ruled out
- Leaving resolved rows in place, marked done: the list never shrinks, so open work stays buried under finished work.
- Numbered pages, or Earlier/Later offset links: offset paging strands open items on later pages as the set shrinks, which is exactly the "Later" bug the owner hit.
- Turbo 8 morphing for in-place updates: every POST redirects to a fresh signed ?done= URL, so Turbo makes a normal visit, not a morph. It also adds about 90 KB and re-runs every body script.

## Watch out
- Undo can't carry row ids in the signed banner URL (500 ids is about 32 KB, and the link expires after 15 minutes). Undo keys on the action's timestamp instead, as discard and Match all already do.

In the code: src/all.ts allRows/allWhere, src/views.ts payments, src/bulk.ts client script (location.assign after a bulk post), src/events.ts backPath, src/signing.ts TTL.
