---
title: "Add is one button in both bars on every page, and one form takes receipts, invoices and other documents"
author: Bapusaheb
date: 2026-10-31
branch: fix/one-add-button
cost: { minutes: 16, tokens: 194799 }
id: l-d492868e
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - docs-site/src/content/docs/reference/changelog.mdx
  - package.json
  - scripts/ui-policy.json
  - src/archive-css.ts
  - src/archive.ts
  - src/files.ts
  - src/viewer.ts
  - src/views.ts
  - test/archive.test.ts
---

## Decided
Adding files has one entry point everywhere: an Add button that is first in the desktop sidebar and the round middle tab of the phone tab bar, on every page, pointing at the one Add page. The owner complained that Add was missing from Home and Receipts To do, appeared on Invoices only in some states, and differed between phone and desktop. The Add page has three kinds (Receipts and bills, Invoices you sent, Other documents) in one form; Other documents go through the same upload as receipts instead of a second form hidden in a fold. A new install's Welcome shows the same form. From the Invoices page, Add opens with Invoices you sent picked.

## Tried and ruled out
Giving the sidebar Add the `btn primary` classes: every screen is tested to have exactly one primary button, and the nav is chrome, so the Add is styled like a primary under its own class instead.

## Watch out
Add is not an entry in the NAV list (that stays the four places); it is a NavKey with its own PAGES entry titled Add, so the Add page highlights Add and has no back crumb. Other documents uploaded this way are named after their file with no date; the owner sets both on the file page.

In the code: src/ui.ts (addHref, nav, tabs, .navadd, .tabadd), src/invoices.ts (addForm, addKind), src/files.ts (storeDocument), src/index.ts (uploadFiles routes kind=other to storeDocument and returns href).
