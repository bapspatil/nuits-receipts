---
title: "Pages should wait on D1 once: one query round, cached settings, D1 sessions"
author: Bapusaheb
date: 2026-10-25
branch: perf/fewer-waits
cost: { minutes: 1, tokens: 1983 }
id: l-9af6da5d
scope: repo
status: active
replaces: l-de3ec56f
src: agent
touches:
  - src/banking.ts
  - src/index.ts
  - test/setup.ts
  - src/settings.ts
---

## Decided
- Load a page's independent queries in one Promise.all round, never in a chain. Page time is roughly the number of D1 waits in a row times the D1 latency; building the HTML is cheap. On Payments, load the conditional lookups (open invoices, transfer credits, receipts in Review) unconditionally, because a second round costs more than a few small queries.
- For a month's EUR values, use monthEurValues (src/banking.ts). It looks the data up by month, so it runs alongside the rows instead of after them.
- fetch (src/index.ts) serves a GET on the settings this isolate read last (cachedSettings) while freshSettings reads them again alongside, and builds the page again if the full rows differ. Compare the rows, not a settings_audit stamp: a row edited directly in the database (the tests do this) leaves the audit table unchanged.
- Requests run on a D1 session: first-unconstrained for reads, first-primary for writes, with the bookmark carried in the __Host-d1 cookie, so a page reads at least up to the previous request's writes. Read replication itself is enabled per database in the dashboard.

## Tried and ruled out
- Cancelling the first response's body before serving again: the month ZIP stream's zip library then rejects, and vitest reports unhandled errors. Drop it unread instead; an unread stream never runs.

## Watch out
- test/setup.ts mocks env.DB.withSession with a pass-through so tests that spy on env.DB.prepare still see the queries. test/replication.test.ts uses the real one.
- withDatabase (src/settings.ts) wraps the deploy env per request. Key the settings caches by the deploy env underneath (keyOf/ORIGIN), not by the per-request object, or they never hit.
- To measure, add a fixed delay per D1 call in a vitest-pool bench (one is kept at /tmp/zz-bench.test.ts, outside the repo). Local SQLite alone hides the waits.
