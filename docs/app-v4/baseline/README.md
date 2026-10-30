# Baseline: main plus docs, before any UX v4 code

Recorded 2026-10-30 on branch `ux4/harness` (no `src/` changes), mock AI, fresh local database.

## Commands

```sh
node scripts/ux-journeys.mjs --out docs/app-v4/baseline --port 8793
bun run migrate --persist-to .audit/lint-state
node -e "import('./scripts/busy-month.mjs').then(m=>require('node:fs').writeFileSync('.audit/lint-busy.sql', m.busySql('2026-09')))"
bunx wrangler d1 execute DB --local --config wrangler.local.jsonc --persist-to .audit/lint-state --file .audit/lint-busy.sql
bun run dev --persist-to .audit/lint-state --port 8795 --ip 127.0.0.1
AUTH=owner:<password> bun run ui-lint -- --base http://127.0.0.1:8795 --out docs/app-v4/baseline/ui-lint.json
```

## Journeys (RESULTS.md, results.json, screens/)

Journeys a to e are unchanged. Journey f, "Busy month", seeds August (110 ready and 40 needing review receipts, 220 bank rows, 60 of them missing) after a to e and the screen tour, so those keep their small data. The run exits 1: 9 of 12 checks missed.

| Check | Baseline |
| --- | --- |
| Bank has a To do list (`data-list="bank-todo"`) | missed, no such list |
| Bank To do counts all 60 open payments | missed, no `data-total` |
| Bank To do shows the first 50 of 60 open | missed, shows 25 (the first 100 rows' share; 35 are behind Later) |
| Bank refills to 35 rows after 25 are resolved | missed, shows 0 |
| No resolved payment is still listed | passed, trivially: no row is listed at all |
| Bank does not say every payment has a receipt while 35 are open | missed, it does |
| Scroll stays put | missed, 2546 px to 0 |
| Focus is inside the next open row | missed, focus is on the page |
| Receipts has a To do list (`data-list="receipts-todo"`) | missed |
| Receipts To do lists all 19 approvable receipts | passed (on `/review`) |
| The 19 approved receipts are gone from To do | passed |
| The banner offers Undo | missed, none |

Bulk approve on Review approved 19 and skipped 22 that lack a required fact. The axe violations on the two busy pages (`busy-receipts-todo`, `busy-bank-todo`, both widths) are 0.

## Invariants (`test/worklists.test.ts`)

All ten are `test.fails` on this code: inv1 to inv10. None of them passes today, including inv9, because every list read goes through `data-list` and `data-row`, which no page has yet.

## ui-lint (ui-lint.json)

86 findings in 43 groups over 22 page checks (11 pages, 2 viewports): 80 `content-inset`, 4 `text-contrast`, 2 `font-size`. 81 of them are on `/review` (41 at 390, 40 at 1440), mostly the right edge of each row's Discard `summary`.
