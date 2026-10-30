---
title: Controls and statuses come from two registries and the sprite is derived from the page
author: Bapusaheb
date: 2026-10-30
branch: ux4/icons
id: l-ef7d48d4
scope: repo
status: active
src: agent
touches:
  - test/live.test.ts
  - src/actions.ts
  - src/icons.ts
  - scripts/app-icons.mjs
  - test/actions.test.ts
---

## Decided
Every control renders from the ACTIONS registry (button, buttonLink, buttonSummary) and every state from STATUS (statusMark). The page sprite is derived by scanning the final HTML for use href, so it holds exactly the icons the page references. Match all is secondary because Start matching is the Bank primary. Bulk bar actions are never primary.

## Tried and ruled out
Converting the Reading banner Refresh link and the All-row refresh anchor to buttons: test/live.test.ts pins the plain link, so they stay links. Restyling step markers here: PR 11 lists them under Deletes.

## Watch out
buttonLink escapes its href itself, so pass raw URLs, never the output of link(). The sprite svg carries no xmlns because a test forbids http(s):// in pages.

In the code: src/actions.ts, src/icons.ts, scripts/app-icons.mjs, test/actions.test.ts.
