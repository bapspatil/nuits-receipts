# After: the UX v4 stack, PRs 1 to 13

Recorded 2026-10-30 on branch `ux4/release` (the stack tip, `91531de`), mock AI, fresh local database. Compare with [the baseline](../baseline/README.md), which ran the same commands on `main` before any UX v4 code.

## Commands

```sh
node scripts/ux-journeys.mjs --out docs/app-v4/after --port 8841
bun run migrate --persist-to .audit/lint-state
node -e "import('./scripts/busy-month.mjs').then(m=>require('node:fs').writeFileSync('.audit/lint-busy.sql', m.busySql('2026-09')))"
bunx wrangler d1 execute DB --local --config wrangler.local.jsonc --persist-to .audit/lint-state --file .audit/lint-busy.sql
bun run dev --persist-to .audit/lint-state --port 8842 --ip 127.0.0.1
AUTH=owner:<password> bun run ui-lint -- --base http://127.0.0.1:8842 --out docs/app-v4/after/ui-lint.json
```

The journey run writes `screens/`. The busy-data shots from PR 11 are in `look/`, linked from [look.md](look.md), so this run does not overwrite them.

## The three complaints

| Complaint | Before | After |
| --- | --- | --- |
| Review's first row looks like a button | Row 0 on Review, held mail and Bank's first missing row had `class="btn primary"`, on purpose, as the screen's one primary ([review-1440](../baseline/screens/review-1440.png)). | No list row holds a primary. The page's one primary is "Start checking (N)" in the list header ([receipts-todo-1440](screens/receipts-todo-1440.png), [busy](look/receipts-todo-1440.png)). `test/actions.test.ts` renders every page and fails on a primary inside a row. |
| Bulk actions show no resolution | Bulk on Receipts reloaded the same URL with the same offset, so a resolved row stayed where it was. No banner offered Undo. | Journey f bulk-approves 11 receipts on Receipts To do: all 11 leave the list, the banner offers Undo, and Undo brings all 11 back. On Bank, 50 resolved rows leave and the next 10 move up. The next row lands 48 px from where the acted row stood, with focus inside it ([live.md](live.md)). |
| Bank's Later strands open payments | Bank showed 25 of the month's 60 missing payments. The other 35 sat behind Later, and after the 25 were settled the page showed 0 rows and said "Every payment has a receipt." | Bank To do lists open payments first, month-wide: `data-total` is 60 and the page shows the first 50. After bulk Not a purchase on all 50, the other 10 fill the page, and the "all done" line appears only at 0. There is no Earlier or Later. |

## Journeys (RESULTS.md, results.json, screens/)

The run exits 0. Journey f has 21 checks, up from 12, and all pass (baseline: 3 of 12).

| Journey | Clicks before | Clicks after | Screens before | Screens after |
| --- | --- | --- | --- | --- |
| d. First run to first receipt read | 5 | 5 | 5 | 5 |
| a. Mail arrives, every receipt approved | 6 | 6 | 5 | 6 |
| b. Bank statement imported, every payment settled | 5 | 4 | 5 | 4 |
| e. Sales invoice added, money in matched | 5 | 7 | 4 | 6 |
| c. September closed and marked sent | 3 | 3 | 2 | 2 |
| f. Busy month | 8 | 8 | 6 | 6 |

- **b** loses a click and a screen: the import is one step, with no Check the file page.
- **e** gains two clicks. Invoices is no longer a tab; the journey reaches it through Receipts, All, then the Invoices switch. Bank also opens on To do, so the money-in row needs All.
- **a** gains a screen without a click: each Approve banner URL now names the receipt (`name=`), so the second and third approvals count as two screens where the baseline's identical `done=approved` URLs counted as one.
- **f** approves 11, not 19, because only required facts put a receipt in To do (PR 3). Its one "POST with no feedback" is a harness artifact (inferred from `scripts/ux-journeys.steps.mjs`): the Undo click records its screen without `settle()`, so the next plain `goto` inherits the Undo's redirect flag. The Undo itself landed on `done=undone`, which has a banner.

## Invariants (`test/worklists.test.ts`)

All ten invariants pass as plain `test`, in 11 tests (inv3 has a Bank and a Receipts case). None is `test.fails` any more. Baseline: all ten were `test.fails`.

## Accessibility

axe: 0 violations on all 40 screens (20 pages at 1440 and 390), including the busy Receipts To do and Bank To do. Baseline: 0 on 40.

## ui-lint (ui-lint.json)

5 findings in 4 groups over 20 page checks (10 pages, 2 viewports), down from 86 over 22 in the baseline. `/review` is gone, which removes the 81 findings it held.

| Rule | Count | Where |
| --- | --- | --- |
| `font-size` | 2 | `.setup h2 span` on Home, at both widths. In the baseline too. |
| `content-inset` | 2 | Home's `details.finished` fold of done setup steps (PR 12, `src/checklist.ts:101`): its `summary` sits 4 px from the panel edge, at both widths. |
| `text-contrast` | 1 | `/help` at 390, a `dd` in a fold of the third section: "could not be measured" because the element overlaps another. Not a measured failure. |

[look.md](look.md) recorded 2 findings after PR 11. The 3 new ones arrived with PRs 12 and 13 and are left open for a follow-up.
