---
title: Page slowness came from D1 queries awaited one by one; receipt_id was already indexed
author: Bapusaheb
date: 2026-10-25
branch: perf/faster-pages
cost: { minutes: 9, tokens: 91249 }
id: l-080fcb8f
scope: repo
status: active
replaces: l-cef23045
src: agent
touches:
  - src/banking.ts
  - src/views.ts
  - src/ui.ts
  - src/index.ts
  - wrangler.jsonc
  - schema/0001_template.sql
---

## Decided
- Pages were slow because each one waited on D1 queries run in sequence, and the Worker could run far from the database. The framework was not the cause, so moving to TanStack Start or Vinext was ruled out: it would keep the same D1 query pattern and drop the no-JS, strict-CSP design.
- Use eurValues (src/banking.ts) for any list of rows. It answers the whole list with one D1 batch: matched payments and ECB rate dates, each found through a JSON list read with json_each, so there is no 100-parameter limit. Keep eurValue for a single row only.
- monthState and home (src/views.ts) load independent queries with Promise.all.
- navCounts (src/ui.ts) is memoized per request in requestState.counts. route (src/index.ts) starts it for TAB_PAGES right after sign-in, so the counts load alongside the page's own queries.
- wrangler.jsonc sets Smart Placement.
- Tab pre-loading uses a Speculation-Rules response header pointing to /assets/speculation-rules.json, not an inline script, so HTML_CSP needs no script-src.

## Tried and ruled out
- Adding an index on bank_transactions(receipt_id): the column is declared UNIQUE in schema/0001_template.sql, so SQLite already indexes it (sqlite_autoindex_bank_transactions_2). The per-row cost was the round trips, not table scans.

## Watch out
- Local wrangler dev uses SQLite on disk with almost no latency, so it hides round-trip cost. Measure against a deployed instance.
- Existing deployments that use wrangler.production.jsonc only get Smart Placement once they add "placement": {"mode": "smart"} by hand. setup.mjs copies wrangler.jsonc, so new installs get it.
- Whether Chrome uses a prefetched page sent with Cache-Control: private, no-store is not confirmed. Check the DevTools Speculative loads panel on a deployed instance.
