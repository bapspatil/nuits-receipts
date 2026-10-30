---
title: "Which refused forms are shown again in place, and how"
author: Bapusaheb
date: 2026-10-30
branch: ux4/settings
cost: { minutes: 5, tokens: 55387 }
id: l-81466278
scope: repo
status: active
src: agent
touches:
  - src/index.ts
  - src/ui.ts
  - src/views.ts
---

## Decided
- redisplay in src/index.ts answers a refused form (409 or 422) with the page that holds it, the typed values kept and the message at the field. It is now one chain of show(scope, defaultField, target, render). Routes in it: the receipt page and its Mark paid, vendor rules (Settings and the receipt page), account rename, the sender Add row, the OneDrive folder form, own-account transfers, Add, the account question and the import confirm. A route is converted by giving its form a scope, a kept() value and an errorLine, never by a new page.
- A form that repeats on a page (one rule form per rule, one rename per account) gets its ids from fieldId(scope, name), so ids stay unique. An unrefused form renders plain, as before.
- The import confirm re-renders importPreview with the posted form, so the refusal ('Preview settings changed') sits above a fresh preview with a working token.

## Tried and ruled out
- Not converted: the Mark paid form on a list row (it posts view, and has required inputs), bulk bars (they answer JSON and bulk.js shows the error), and the legacy import editor preview (rerunning it throws the same error).
