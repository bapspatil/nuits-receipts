# Interaction prototypes: walkthrough

Counting rule, same as `scripts/ux-journeys.mjs`: every navigation, button or link press and every fold opened counts 1 click. Typing or selecting is a field edit. v1.5.0 numbers come from `docs/app-v3/baseline/RESULTS.md` and `RESEARCH.md`. v3 numbers are counted by hand on these static files, so they are a design count, not a measured run. Axe: 0 violations on all 8 files at 1440 and 390 (`shots/REPORT.md`).

## Clicks per task

| File | Task | v1.5.0 | Prototype | Notes |
| --- | --- | --- | --- | --- |
| review-split | Approve the Print Shop receipt | 2 clicks (open the All fields fold, Approve), 5 edits | 1 click (Approve receipt), 5 edits | VAT % and the other fields are visible, no fold. Counted from the script: the Print Shop corrections need a hidden field. |
| review-focus | Approve the Print Shop receipt | 2 clicks, 5 edits | 6 clicks (5 Next, Approve), 5 edits | One Next per question. Each extra flag costs a click. |
| review-split | Journey a, three flagged receipts | 8 clicks | 5 (Home, Check 3 receipts, 3 Approve) | v1.5 is Home, Review, open first, 3 Approve, 2 folds. Home opening on September removes the Review click; no folds remove the other two. Target was 6. |
| review-focus | Journey a, three flagged receipts | 8 clicks | 14 (2 arrive, then Coffee 2, Train 4, Print Shop 6) | Coffee has 1 flag, Train 3, Print Shop 5. |
| home-arrival | Journey c, close and send September | 4 (Home, Sep, Download, Mark as sent) | 3 | The "Sep" click goes away. Journey a loses the Review click (see above). |
| bank-feedback | Know what happened after a match, undo a mistake | 0 feedback, no undo (4 silent POSTs across journeys) | 0 extra clicks to see it, 1 click (Undo) to reverse | After import it also says "We matched 2 for you: Review them", and rows say "Matched automatically" or "Matched by you". |
| bank-likely | Journey b, import and settle | 9 clicks, 1 dead end | 6 (Bank, Import statement, Check the file, Import 6 payments, Match all 1 likely, Not a purchase), 0 dead ends | The DOMAINDESK match alone is 4 clicks and 2 selects in v1.5 (select, Match, dead end, Go back, select, tick, Match), now 1 click and 0 edits. Target was 7. |
| bank-likely | Match a row with no suggestion | select from a long list, Match | type in the search box (1 edit), pick, Match (1 click) | Same click count, but the list is searchable. |
| receipt-error | Approve with Total empty, then fix it | 3 clicks (Approve, Go back, Approve), 5 edits (typed values lost) | 2 clicks (Approve, Approve), 1 edit | v1.5 is inferred from finding F18 (observed on the match form, same error page), not run on this form. |
| receipts-tabs | Journey e, add an invoice and see it paid | 6 (Receipts, Invoices, Add, Add files, Bank, month link) | 6 with tabs alone | Tabs replace a link by a tab: no click saved. Add 5 if Bank opens on the oldest unsent month (no month click), 4 if Receipts also remembers the last tab. The win is that Invoices is visible, not a click. |
| home-setup | Set the accountant after the first receipt | not on Home; about 3 clicks by code (Settings, open the Accountant fold, Save), estimate | 2 (checklist row, Save) | The row links to the field and the list stays until all five are done. v1.5 loses the checklist after the first receipt. |

## Review layouts at 1440 and 390 (Print Shop receipt)

Heights are `scrollHeight` over the viewport height (900 at 1440, 844 at 390), from a Playwright run of the files, including the prototype note at the top (about 0.1 viewport).

| | review-split | review-focus (whole file, stacked) | review-focus (one step) | v1.5.0 receipt-flagged |
| --- | --- | --- | --- | --- |
| 1440 | 1.47 viewports | 3.03 | 0.38 (337 px) | 1.18 |
| 390 | 2.39 viewports | 5.05 | 0.76 (559 to 640 px) | 1.48 |

- Split at 1440: the document is sticky on the left, fields on the right, and the action bar stays at the bottom. The document is always in view; scrolling is about half a viewport, and Approve never leaves the screen.
- Split at 390: the document comes first at full height, then the fields. Reaching Total means passing the whole document (about 0.6 viewport), then scrolling fields, so it is the long one. The sticky bar keeps Approve and "3 of 3" visible.
- Focus: each step fits one screen at both widths (the stacked file is long only because the sections are shown for reading). At 390 a step is 0.76 viewport, so the highlighted line and the field are on one screen with no scrolling.

Reading: split wins on clicks (1 vs 6 for Print Shop, 5 vs 14 for journey a) and on 1440 height. Focus wins on phone scrolling (0 vs about 1.4 viewports of scroll) and on attention (one question). The cost of focus is clicks that grow with the number of flags. A middle option to test: split on wide screens, focus on phones.

## Not settled by these files

- Next in review-focus is a link, so nothing is saved until Approve. In the app, pressing Enter in a step would need to mean Next, not Approve.
- The sticky action bar in review-split appears mid-page in full-page screenshots; in a real viewport it sits at the bottom.
- Click counts for receipt-error and home-setup in v1.5.0 are inferred, not run.
