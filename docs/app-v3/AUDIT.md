# UX v3, Define: heuristic evaluation and problem statements

Base: v1.5.0 (`df39e01`). Method: Nielsen Norman's 10 usability heuristics, NN/g severity 0 (not a problem) to 4 (catastrophe), from one expert evaluator (an AI agent) plus the measured journeys in [`RESEARCH.md`](RESEARCH.md). "Observed" means the journey script hit it on the live app; "code" means it was read in the source and not exercised. No real users were tested.

## Findings

| # | Heuristic | Screen | Finding | Evidence | Sev | Freq | Persona |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | 1 Visibility | Home | Home opens on the current calendar month. In early October it says "Check: Nothing yet" while September has 3 receipts waiting; only the nav badge says so. | Observed, journey a; `views.ts` home | 3 | Monthly | Owner |
| F2 | 1 Visibility | Bank, receipt, settings | Most actions redirect with no message: match and unmatch, Not a purchase, Needs a receipt, save, account create/rename, transfers, move kind, paid, read again, a rule saved from a receipt, approving the last receipt. | Observed (journey a last approve, journey d upload); code `index.ts:271-457` | 3 | Every session | Both |
| F3 | 1 Visibility | Bank, invoices | Automatic matches look exactly like manual ones ("✓ Receipt"), and the import banner doesn't mention them. The person can't tell what the app decided. | Observed, journeys b and e; `views.ts:686` | 3 | Monthly | Owner |
| F4 | 1 Visibility | Settings, Email | Mail from an ignored sender or failing SPF is logged but never shown anywhere. | Code `inbound.ts:144`, `receipts.ts:447` | 2 | Rare | Both |
| F5 | 1 Visibility | Add, receipt | "They are being read now" and "Refresh" are pull-only; the person has to refresh to see the result. | Observed, journey e; `invoices.ts:346`, `views.ts:530` | 2 | Weekly | Both |
| F6 | 2 Real world | Errors | Validation copy is system wording: "Confirm match exceptions", "Stale receipt. Reload before saving.", "EUR override needs reason", "Complete required facts before approval", "Duplicate chains are not allowed", "Match changed. Reload.". Import rows show raw codes. "Import done: 6 inserted, 0 skipped, 0 replayed". | Observed ("Confirm match exceptions", "Import done"); code `receipts.ts:608-686`, `imports.ts:391` | 3 | Weekly | Both |
| F7 | 3 Control | Bank, receipt, settings | No undo or confirmation for Remove match, Undo transfer, Not a purchase, Not paid, Move to invoices (which drops the match), Disconnect, Delete rule, Remove sender, removing a part. Discard has Undo but it doesn't bring back a removed match. | Code `views.ts:551,683,688,709,1060,1126`, `invoices.ts:215`, `setup.ts:208`, `discard.ts:83-91` | 3 | Weekly | Owner |
| F8 | 4 Consistency | All | One state, several words: "Needs you" / "Needs a look" / "Check"; "Reading" / "Being read"; "Matched" / "Receipt" / "Invoice". Page titles differ from nav (Bank page title "Payments for ..."). /add and invoices light up Receipts. | Code `ui.ts:600-602`, `invoices.ts:61,143`, `views.ts:755` | 2 | Constant | Both |
| F9 | 5 Error prevention | Bank | The exception box "Not exact, still this" is on every match form and unexplained, and leaving it unticked on a non-exact pair ends in a full error page. The app knows the pair isn't exact before the click and doesn't say why. | Observed, journey b dead end | 3 | Monthly | Owner |
| F10 | 5 Error prevention | Review | Optional flags (no receipt number) carry the same red border and `aria-invalid` as required ones, so five of five look like errors. | Observed, `receipt-flagged-1440.png`; `flags.ts:137`, `ui.ts:196` | 2 | Weekly | Owner |
| F11 | 5 Error prevention | Import | "Import into: The account chosen here" is preselected even when no account exists. | Code `imports.ts:64-74` | 1 | Once | Self-hoster |
| F12 | 6 Recognition | Review | Email and PDF receipts have no document next to the fields at desktop width, only "Open original" in a new tab, so the person types from memory. On phones the preview is a 120 px thumbnail. | Observed, `receipt-flagged-1440.png`; `ui.ts:193,308` | 3 | Weekly | Owner |
| F13 | 6 Recognition | Bank | Receipt pickers are long unsearchable selects; the fallback is a "Receipt ID" field in More. Search exists only on Receipts. | Code `views.ts:98-104,712`, `all.ts:208` | 2 | Monthly | Owner |
| F14 | 7 Efficiency | Bank | No way to confirm all likely matches at once; one select + Match per row. No keyboard shortcuts in Review. | Code `views.ts:707` | 2 | Monthly | Owner |
| F15 | 7 Efficiency | Invoices | Invoices sit inside Receipts: three clicks before adding one. | Observed, journey e | 2 | Monthly | Owner |
| F16 | 8 Minimalist | Receipt | A ready receipt or invoice opens with every field (19 for an invoice) expanded: 3.09 viewports at 390. Seven folds on the page. | Observed, `invoice-paid-390.png` | 2 | Weekly | Owner |
| F17 | 8 Minimalist | Import, settings | The "adjust how we read the file" editor has about 26 controls; Settings has 9 folds and 5 separate Save buttons. | Code `imports.ts:204-245`, `setup.ts:269` | 1 | Rare | Self-hoster |
| F18 | 9 Error recovery | Errors | Every validation failure replaces the page with "That didn't work" and "Go back"; Go back reloads the previous page, so typed values are lost. No inline field errors anywhere. | Observed, journey b; `ui.ts:490-501` | 3 | Weekly | Both |
| F19 | 10 Help | Home | The Welcome checklist vanishes after the first receipt even when the accountant isn't set; bank account and Email Routing aren't on it. No glossary for Part, Kind, "Not exact". | Observed, journey d | 2 | Once | Self-hoster |
| F20 | 1 Visibility | Home, Bank | After the month is sent, Bank still offers "Close September" as its primary action. | Observed, `bank-390.png` | 1 | Monthly | Owner |

Fixed since v1.0 and not repeated here: approve-and-next, readable mapping labels, the five-item nav and phone tab bar, the More page, the invoice upload label, Discard with Undo. H1c (a manual match lost on save) is fixed in PR #7.

Not a problem (severity 0): all 11 screens have 0 axe violations at both widths.

## Point of view and How Might We

1. The owner needs to finish last month in one sitting without losing their place, because the app opens on the wrong month, errors throw away their input, and the last action of each step is silent. **HMW** make every action confirm itself, recover in place, and point to what's next?
2. The owner needs to trust what the app did on its own, because automatic matches, dropped mail and removed matches are invisible and most actions can't be undone. **HMW** make the app's own decisions visible and every change reversible?
3. The owner needs to check a receipt against its original without switching tabs, because the document isn't beside the fields and optional fields look like errors. **HMW** put the document and only the real work side by side?
4. The new self-hoster needs to reach a first matched month without learning the vocabulary, because the checklist disappears early and the terms are unexplained. **HMW** keep setup visible until it is actually done?

## Targets for the redesign (measured by the journey script)

| Metric | v1.5.0 | Target |
| --- | --- | --- |
| a. clicks for 3 flagged receipts | 8 | 6 (arrive, start, 3 approvals, 1 extra at most) |
| b. clicks to import and settle | 9, 1 dead end | 7, 0 dead ends |
| e. clicks to add an invoice and see it paid | 6 | 4 |
| POSTs with no feedback across all journeys | 4 | 0 |
| Dead-end error pages across all journeys | 1 | 0 |
| Screens over 3 viewports at 390 | 1 | 0 |
| axe violations | 0 | 0 |

## Ideate

Each idea answers findings. **(P)** marks the ones prototyped because they are a matter of feel.

1. **Home opens on the oldest month that isn't sent** (F1, F20). Computed, no new state. The current month is one click away. Bank's primary action follows the same rule.
2. **One feedback system with Undo** (F2, F3, F7). Every POST redirects with `?done=<event>`; an `EVENTS` registry maps each event to its message and, when an inverse route exists, an Undo form. Automatic decisions get the same banner ("We matched 3 payments for you. Review"). Confirmation only where nothing can undo (Disconnect, removing a part). **(P)**
3. **Errors in place** (F6, F18, F9). A failing form re-renders with what was typed, a `role=alert` summary linking to each field, and plain words from a `MESSAGES` registry. The match row explains a non-exact pair before the click and asks for the exception there. **(P)**
4. **Review beside the document** (F12, F10, F16). The original (image, PDF or the email text) at full height beside the fields; required flags red, optional ones neutral; a ready receipt opens folded to its summary. Two layouts compete: split view and focus mode. **(P)**
5. **Likely matches in one click, and all at once** (F9, F13, F14). Likely pairs as rows with the reason they're likely and a single Match; "Match all 2 likely" for the rest; a searchable `<input list>` instead of the long select. **(P)**
6. **Invoices next to receipts** (F15). Receipts and Invoices as two tabs of one page with one Add button. **(P)**
7. **A setup checklist that stays until it's done** (F19, F11). Business, receipt email routing confirmed, accountant, a bank account, the first statement. Plus a `/help` glossary built from the flag and message registries.
8. **One vocabulary** (F8). A status registry: Needs you, Reading, Ready, Matched by you, Matched automatically, Missing, Not a purchase, Sent.
9. **Shown mail log** (F4). "Mail we didn't keep" in Settings, Email. The only schema change; last.
10. **Visual refresh** (all). Three directions, see the prototype brief. **(P)**

### Interaction variants (folder `prototypes/interaction/`)

All in the v1.5 look so they compare behaviour, not style.

| File | Question it answers | Findings |
| --- | --- | --- |
| `review-split.html` vs `review-focus.html` | Which review layout gets a flagged receipt approved with fewer clicks and less scrolling, at 1440 and 390? | F10, F12 |
| `home-arrival.html` | Does opening on the oldest unsent month make the next step obvious on 1 October? | F1, F20 |
| `bank-feedback.html` | Banner after a match with Undo, and the automatic-match notice after import. | F2, F3, F7 |
| `bank-likely.html` | Likely-match rows with reasons, "Match all 2 likely", searchable pick for the rest; the non-exact pair explained inline. | F9, F13, F14 |
| `receipt-error.html` | Approve with a field still missing: inline summary and field errors, typed values kept. | F6, F18 |
| `receipts-tabs.html` | Receipts and Invoices as tabs with one Add. | F15 |
| `home-setup.html` | The setup checklist after the first receipt, with what's left. | F19 |
