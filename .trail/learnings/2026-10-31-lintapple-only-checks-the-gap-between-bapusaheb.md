---
title: "Lintapple only checks the gap between blocks it is told to, so ui-lint marks every stack and opens every fold"
author: Bapusaheb
date: 2026-10-31
branch: fix/send-step-gaps
cost: { minutes: 10, tokens: 82514 }
id: l-bd55af69
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - docs-site/src/content/docs/reference/changelog.mdx
  - package.json
  - README.md
  - docs-site/src/content/docs/how-to/add-receipts.mdx
  - docs-site/src/content/docs/how-to/find-any-document.mdx
  - docs-site/src/content/docs/how-to/keep-sales-invoices.mdx
  - docs-site/src/content/docs/tutorials/your-first-month.mdx
  - src/actions.ts
  - src/files.ts
---

## Decided
Lintapple's layout-gap rule only measures the children of elements marked data-ui-stack, and skips anything inside a closed details. The app has no such marks and keeps the Send step and most of Settings in folds, so a button sitting flush on the box under it (the Send step's "Mark October as sent" on "In the ZIP") passed ui-lint at budget 0. ui-lint now prepares each page before checkPage: it marks every column-flowing element in main that has two or more block children as a stack, opens every fold, and then lintapple measures them. Fix a finding by giving the element that touches its own margin or a gap, so its box matches what the eye sees.

## Tried and ruled out
Marking stacks by hand in the markup: easy to forget on the next page, which is how this slipped. Marking everything without exceptions: Settings and Help sections, folder tabs and ruled field rows touch by design and flooded the report.

## Watch out
Lintapple measures element boxes, not ink. A wrapper whose spacing comes from an inner margin (an inline-flex child, for example) reads as 0px; move the margin to the wrapper. It also counts a visually hidden heading as visible, and axe cannot read the background under the floating phone tab bar, so ui-lint makes hidden headings inert and puts the tab bar in the page flow for the check. A menu that opens over the page (a row's More) is left shut.

In the code: scripts/ui-lint.mjs (markStacks: skips details, joined details.sect groups, rows ruled apart by borders, tables and lists).
