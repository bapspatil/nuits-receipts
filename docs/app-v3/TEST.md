# UX v3, Test: what the prototypes showed

No real users were tested, so this report rests on three proxies. Each one is labelled below.

1. **Walkthrough.** I counted clicks by hand on the static files. See [`prototypes/interaction/WALKTHROUGH.md`](prototypes/interaction/WALKTHROUGH.md).
2. **Two blind heuristic reviewers.** One ran on Opus and one on Sonnet, both at medium effort.
   - The visual directions were shown to them as X, Y and Z; neither knew which one we prefer.
   - Their inputs were the 1440 and 390 screenshots, the audit and the brief.
   - Where the two agree, I treat it as the signal. Where only one says something, it is a lead to check, not a finding.
3. **Machine checks.** axe (WCAG 2.2 A and AA) on every screen, and `site/scripts/check-contrast.mjs` on every palette.

The 5-person think-aloud in [`USABILITY-TEST.md`](USABILITY-TEST.md) has been written but not yet run.

The blind labels map to the directions as follows:

| Label | Direction |
| --- | --- |
| X | C, Paper desk |
| Y | A, Ledger evolved |
| Z | B, Swiss workbench |

## 1. Interaction variants, decided by the numbers

These counts are design counts from the walkthrough. Each target comes from [`AUDIT.md`](AUDIT.md).

| Question | Decision | v1.5.0 | Prototype | Target |
| --- | --- | --- | --- | --- |
| Review layout | **Split view at every width.** Focus mode is dropped. | Journey a: 8 clicks | Split: 5 clicks. Focus: 14 clicks | 6 |
| Where Home opens | **The oldest month that hasn't been sent** | Journey c: 4 clicks | 3 clicks | not set |
| Settling the bank | **Likely-match rows, plus "Match all" and a searchable picker** | Journey b: 9 clicks, 1 dead end | 6 clicks, 0 dead ends | 7, 0 |
| After an action | **A banner with Undo, from one `EVENTS` registry** | 4 silent POSTs; no undo | 0 silent POSTs on Bank; Undo is 1 click | 0 |
| Validation failure | **Errors shown in place, with typed values kept** | 3 clicks; 5 edits lost (inferred) | 2 clicks, 1 edit | 0 dead ends |
| Where invoices live | **Receipts and Invoices as two tabs** | Journey e: 6 clicks | 6 with tabs alone; 5 if Bank opens on the oldest unsent month; 4 if the tab is remembered | 4 |
| Setup | **A checklist that stays until all five steps are done** | Checklist vanishes; about 3 clicks (estimate) | 2 clicks | not set |

**Why split and not the hybrid.** WALKTHROUGH.md suggested split view on wide screens and focus mode on phones. Both reviewers rejected focus mode at both widths, on their own.
- Focus mode costs 6 taps for each receipt; split view costs 1. Over three receipts that is 18 taps against a target of 6.
- Focus mode's one advantage is that the document stays beside each question. Split view keeps that on desktop.
- On phones, I take on the scrolling cost of split view and fix it with the changes listed under "Act on".

## 2. Visual directions

### Scores

Each heuristic is scored 1 to 5, so the heuristic total is out of 50. Brand and Mobile (390 px) are out of 5 each.

| | Opus heuristics | Sonnet heuristics | Heuristic total | Brand | Mobile |
| --- | --- | --- | --- | --- | --- |
| A Ledger evolved (Y) | 36 | 40 | 76 | 4 + 4 | 4 + 3 |
| C Paper desk (X) | 39 | 37 | 76 | 5 + 5 | 4 + 4 |
| B Swiss workbench (Z) | 36 | 36 | 72 | 3 + 2 | 3 + 4 |

The reviewers disagree on first place:
- **Opus** ranks C, A, B.
- **Sonnet** ranks A, B, C.

They agree that B has the weakest brand ("generic admin look") and is never the first choice.

### Why the reviewers split on C

Opus put C first mainly because C's Bank screen is the only one that shows the after-action states: the match banner with Undo, and Send after the month is marked sent. That is a difference in behaviour, not in visual direction. Those states come from the interaction decisions above whichever direction wins.

Without that, the two reviewers describe the same trade:

**C (Paper desk).** It has the most personality, and the receipt is annotated beside its fields. But it is the longest direction. Both reviewers found two problems:
- Its fields are spaced to line up with the receipt lines, which pushes Approve to about y 1500 at 1440.
- Its rotated, condensed stamps are hard to scan.

Its Bank screen is 3.60 viewports tall at 390, the only direction screen over the 3-viewport target.

**A (Ledger evolved).** It is the most consistent system: one badge vocabulary and the shortest pages, with no screen over 2.4 viewports. It has a sticky Approve and a working dark theme. Both reviewers flagged two things:
- The Sample Client Oy invoice is labelled "Matched by you" when it was matched automatically. This is a data mistake in the prototype, not a flaw in the direction.
- On phones the sticky bar and the tab bar sit on top of each other.

**B (Swiss workbench).** It is the most readable, and its likely-match screen is the best of the three: a Name, Date and Amount table with "Differs", "1 day apart" and "Same". But it barely carries the brand. At 390, Approve on Review is about 2,000 px down and is not sticky.

### My recommendation: A, with two parts taken from the others

The visual direction is your call. My recommendation is A (Ledger evolved) as the base, plus two additions:

- **From C:** label each line of the receipt with the field it feeds, beside the document.
- **From B:** show a likely match as a three-column comparison.

My reasons for A:
- It is the only direction where every screen fits the height target.
- It already has the dark theme.
- It keeps the cheque-paper brand that `site/tokens.json` and the public site share, so the app and the site still look like one product.

## 3. Synthesis of the review findings

### Act on (both reviewers, or one with clear evidence)

1. **The split view's sticky bar covers the last field.** Both reviewers say the Receipt number field sits under the bar. Fix: pad the form by the bar's height. On phones, hide the tab bar while on Review so only one fixed bar remains.
2. **The numbered badges on the receipt confuse the pairing.** Both reviewers saw the Total line carry "1 3" and the numbers run out of line order. Fix: label each highlighted line with its field name ("Total", "VAT") instead of a number.
3. **One matched state shows two different labels.** The Client Oy invoice is "Matched automatically" in one file and "Matched by you" in another (both reviewers). Fix: a single status registry (idea 8) and one shared source of fixture data.
4. **The move from Review to Bank isn't designed** (both). Approving the last receipt of the month should say so, then point to the Match step. This goes in the Review flow PR.
5. **The undated receipt isn't drawn** (both). Coffee Corner has no date, and no design says which month it falls in. Review needs a date field marked "Which month does this belong to?", and Home should count it as undated.
6. **Undo covers matching only** (both). Not a purchase, Remove match and Mark as sent also need Undo through `EVENTS`. A confirmation step applies only where no inverse route exists.
7. **Unmatched rows still use the long select** in `bank-feedback.html` (both). That brings F13 back. The searchable picker from `bank-likely.html` replaces the select everywhere.
8. **"Match all" accepts non-exact pairs without showing them** (Sonnet), and its singular copy is broken: "Match all 1 likely" (Opus). Fix:
   - List every pair that "Match all" will accept, each with its reason.
   - Pluralise the copy properly, so a single pair reads "Match the likely one".
9. **The inline error page marks every required field red**, whether filled in or not (Opus). That brings F10 back. Fix: only the field that failed gets red and `aria-invalid`.
10. **An example uses a decimal point next to a receipt that uses a comma** (Opus). The receipt shows "30,00" while the example reads "30.00". Fix: accept both, and echo the receipt's own format in the example.
11. **"Add" has no object** on the tabs page (both). Fix: "Add receipt" or "Add invoice", following the open tab.
12. **The setup checklist rows read like breadcrumbs** (both). "Settings, Email, Routing confirmed" should become an action ("Confirm Email Routing in Cloudflare") linked to the exact field. The `/help` glossary explains Email Routing.
13. **The same dot means two different things** (Opus). A filled dot means "current" on home-arrival and "done" on home-setup. Fix: one step-marker vocabulary in the status registry.

### Consider

- **Changes after sending.** Opus notes that v1.5.0 already has "Changed since you sent it, Download changes", yet none of the directions draws it. Keep it in the Navigation and month PR, in the new look.
- **Keyboard flow in Review.** Approve already moves to the next receipt, and Enter submits. Adding shortcuts would need script, so leave them out unless the think-aloud asks for them.
- **Rejected mail as a reason for a Missing row** (Opus). Idea 9, the ignored-emails log, covers it. A Missing row could link to that log when mail from a similar sender was dropped.

### Noted, out of scope for v3

- **Emailing the ZIP to the accountant from the app.** This would make the app send mail on the owner's behalf, which is a product change. It is not a UX fix.
- **Checking the statement for date gaps or a second account before sending.** Worth a later issue.
- **Non-EUR receipts.** Only their error copy changes, through `MESSAGES`.

### Dismissed

- **C's Home miscounts payments.** Its copy says "two of the bank's missing payments can match". The copy is wrong, but it is a slip in the prototype's text. In the app, this copy is computed from the data.
- **Content that appears mid-page in full-page screenshots.** The sticky bars and the stacked "State 2" demo sections are capture artifacts:
  - review-focus at 5.05 viewports and bank-feedback at 3.10 at 390 both contain stacked states.
  - Neither is a single screen.

## 4. Machine checks

**axe.** There are 0 violations at both 1440 and 390, on all of these:
- A light, 8 shots.
- A dark, 8 shots.
- B, 8 shots.
- C, 8 shots.
- The interaction variants, 16 shots.

The per-screen tables are in each folder's `shots/REPORT*.md`.

**Contrast.** `check-contrast.mjs` reports "Every contrast claim in the palette holds" for:
- `a-ledger/tokens.json`
- `a-ledger/tokens-dark.json`
- `b-swiss/tokens.json`
- `c-desk/tokens.json`

**Height at 390.** The target is 3 viewports or less.

| Direction | Tallest screen (viewports at 390) |
| --- | --- |
| A | 2.40 (Bank) |
| B | 2.88 (Review) |
| C | 3.60 (Bank, over target) |

**Keyboard.** Every interactive element has a visible focus style; the reviewers checked this on the screenshots and I checked it in the CSS. Tabbing through review, approve and next can only be tested on the real form, so it moves to the Review flow PR's verification step.

## 5. Next

1. You pick the visual direction: A, B, C, or my recommended A with the two parts from C and B.
2. Then the implementation PRs follow, in the plan's order:
   - Foundations
   - Review flow
   - Matching and undo
   - Navigation and month
   - Setup and help
   - Visual rollout
   - Ignored-emails log

   Each PR folds in the matching "Act on" items above, and each one ends with `bun run check` and a rerun of `node scripts/ux-journeys.mjs --out docs/app-v3/after`.
