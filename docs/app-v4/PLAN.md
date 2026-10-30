# UX v4: work lists that behave, and buttons you can tell apart

## Context

Goal (the user's): finish the monthly close without fighting the lists. Resolved items must visibly leave, open items must rise to the top and refill the page, "next" must land on the right item, Review rows must share one style, and every button gets an icon plus its label. Beyond the named bugs, audit the rest of the app and fix what is broken against UX principles.

Why now: several UX iterations (v3 foundations #10, review split #11, setup #14, bulk #38) fixed screens one at a time, and the list behaviour is still wrong.

**Simplify everywhere (the user's directive, 2026-10-30).** "The app is too complicated to use right now." Subtraction leads every phase. Cut, merge or automate concepts, controls and settings first, and polish only what survives. Every cut is listed in the Cut list below and approved by the user before code.

## Decisions taken with the user (2026-10-30)

| Question | Answer |
| --- | --- |
| What happens to a resolved row | It leaves the list with Undo. The next open item moves up. Done items sit behind a filter. |
| Paging | Open items first, the page auto-refills as items resolve. No Earlier/Later on the work queue. |
| Icons | Icon plus label on every button. |
| Device priority | Desktop and phone equally. |
| Visual scope | A fresh visual direction. Two mockups (Native app, Warm paper), both keeping the petrol green, before building. |
| Keyboard | Shortcuts on desktop, discoverable with `?`. |
| Look (picked after the mockups) | A mix: Warm paper's look (palette, Bricolage and Instrument Sans, DM Mono numerals, stamp statuses) on Native's layout (left sidebar on desktop, frosted tab bar on phones, rounded grouped lists, segmented control). Mocked as `docs/app-v4/mockups/mix.html` before PR 11. Navigation and floating controls use a glass material in our own CSS, inspired by macOS Liquid Glass, with solid fallbacks; no third-party library and no SVG refraction (Chromium only). |
| Tabs | Merge Review into Receipts. Receipts and Bank each get the same "To do \| All" switch, with To do as the default. Nav becomes Home, Receipts, Bank, Settings, and the badge moves to Receipts. `/review` redirects to `/receipts?view=todo`. |

First implementation step: save these decisions as a trail learning (`trail note --title "Work lists drop resolved rows with Undo and refill open-first"`), with the dropped options under "Tried and ruled out": rows that stay marked done (rejected: the list never shrinks, so open work stays buried) and numbered pages (rejected: offset paging strands open items on later pages as the set shrinks). Plan mode blocks writing it now.

Second learning to save at the same time (`trail note --title "List bugs come from each screen building its own list, and the journey seed is too small to show them"`). Under "Watch out": Bank pages the month before it filters Missing, so open payments hide behind Later. Review's filled first row was a deliberate "one primary" choice, not a CSS slip. The UX journey seed (3 receipts, 6 payments) never crosses a page, so it cannot catch list regressions. Point "In the code:" at `src/views.ts:786,833`, `src/views.ts:288`, `src/all.ts:84,104` and `scripts/ux-journeys.steps.mjs`.

Third learning (`trail note --title "Which simplifications the owner approved and which they kept"`). Under "Decided", the approved cuts in the Cut list below. Under "Tried and ruled out", the cuts the owner turned down: automatic mark-as-sent on download, automatic duplicate merge, hiding Kind and vendor rules, automatic transfer pairing, receipt-or-invoice detection on Add, removing the Accountant field, the thresholds or the Email Routing ticks. That stops the next session from proposing them again.

## Findings

### The three named complaints

1. **Review's first row is a button.** Deliberate: `src/views.ts:288,294` gives row 0 `class="btn primary"` as "the screen's one primary", styled by `src/ui.ts:210`, locked by `test/app-shell.test.ts:861`. Same trick on held mail (`src/all.ts:183`) and Bank's first missing row (`src/views.ts:939-943`). Nothing labels it "start here", and under `?reason=` it points at the filter's first row while Approve walks the unfiltered queue.
2. **Bulk on Receipts changes nothing visible.** `src/bulk.ts:399` does a full `location.assign` back to the same URL, offset included. Receipts is a date-ordered archive: `ORDER BY received_at DESC` (`src/all.ts:104`), default filter includes Ready and Needs-you rows alike (`src/all.ts:84`), and Ready rows carry no mark (`src/all.ts:268-273`). A resolved row stays exactly where it was.
3. **Bank's Later strands open payments.** SQL pages all of a month's rows oldest-first, 100 at a time (`src/views.ts:786`), then filters Missing in JS after paging (`src/views.ts:833,857`). A missing payment at row 101 stays behind Later however many page-1 rows you settle. A page with no open rows says "Every payment has a receipt." while the month still has missing ones (`src/views.ts:999`). Chip counts mix per-page and per-month numbers (`src/views.ts:983-993`); select-all and Match all use different sets again (`src/banking.ts:921-937`, `src/views.ts:844`).

### Next-item advancement

- Approve/Skip computes next from `reviewQueue` before the save and ignores `?reason=` (`src/index.ts:425-438`, `src/views.ts:373`). Skip on the last item wraps and loops.
- Bank single actions return to `/payments?month=` with show and offset dropped, and rows have no `id`, so the page lands at the top (`src/index.ts:492,581,611,623,630`).
- Held mail, Review row Discard and Receipts Restore return to fixed URLs and drop filter, month, search and offset.

### Every list is built differently

| List | Sort | Filter applied in | Paging | Row markup |
| --- | --- | --- | --- | --- |
| Review | oldest first | JS | none, cap 500 | `ul.list.checks` |
| Held mail | newest first | SQL | none, cap 50 | `section.held` block |
| Receipts | newest first | SQL | 50, offset | `ul.list.all` |
| Invoices | oldest first | JS | none, cap 500 | `ul.list.all` |
| Bank | oldest first | JS after paging | 100, offset | `ol.pays li.pay` |
| Settings lists | A-Z or newest | SQL | none | `ul.rowlist li.srow` |

Status marks differ too: a red word (Review), a stamp, tag or nothing (Receipts), a stamp plus red bar (Bank). Bulk actions keep filter and page; single actions mostly drop them.

## Root cause

**The premise every past iteration shared:** each screen can be fixed on its own, with its own query, sort, filter, paging and return URL. Four iterations (#10, #11, #14, #38) each fixed screens one at a time against that premise. The evidence above contradicts it. Six lists use three sort orders, three filtering strategies, two paging schemes and four row layouts, and every action picks its own return URL. No single place says what "open", "done" and "next" mean for a list, so each fix lands on one screen and the next screen regresses.

**Why the regressions went unseen:** the journey harness (`scripts/ux-journeys.mjs`, `scripts/ux-journeys.steps.mjs`) seeds 3 receipts and 6 payments. It never crosses a page boundary, never bulk-acts on a mixed list, and never checks where a resolved row went. The gate could not fail on these bugs.

**Fix at the root:** one work-list model that every list screen renders from, plus a harness seeded with a busy month that asserts list invariants. Screen-level fixes on top of the old premise would be iteration five.

## Design

### 1. One work-list model (`src/worklist.ts`, new)

The data shape every list screen renders from, so "open", "next", counts, select-all and the return URL have one definition:

```ts
type ListKey = 'receipts' | 'bank' | 'senders';   // Receipts To do holds receipts, held mail and overdue invoices
type ListState = { key: ListKey; view: 'todo' | 'all'; filter: string | null; month: string | null; q: string; upto: number };
type ListDef<Row> = {
  key: ListKey;
  open: string;          // SQL predicate: needs the owner
  order: string;         // stable ORDER BY ending in id; open rows first
  where(s: ListState): { sql: string; binds: unknown[] };   // filter in SQL, never after paging
  row(r: Row, s: ListState): RowView;                       // one row component for every list
  actions: readonly ActionKey[];                            // shared with bulk.ts and batch.ts
};
```

- **To do view (default):** `WHERE open AND filter ORDER BY order LIMIT 500` (BULK_CAP), rendering the first `upto` rows. There is no offset. `upto` starts at 50, and "Show 50 more" raises it. Resolved rows drop out on the next render, and the next open rows move up. The header shows "50 of 132 to do". Select-all, Match all and bulk ops all work on the same 500-row set.
- **All view (browse):** newest first, keyset paging (`?before=<date>_<id>`, "Older"). It never strands rows, because the cursor is a value, not a count. Its query runs only when `view=all`, inside the same `Promise.all` round.
- **`nextOpen(def, state, currentKey)`:** one SQL query run after the save, `ORDER BY (key > :cur) DESC, key LIMIT 1`, so it wraps in a single round. `?reason=` compiles to `EXISTS(SELECT 1 FROM json_each(review_reasons_json) WHERE value IN (...))` from the flag table. The receipt URL carries its list state (`/receipts/:id?from=todo&reason=amount`), so "N of M" and Next use the same filter. This replaces `queueAround` (callers `src/index.ts:239,430`, `src/views.ts:402`) and fixes the stale-next, filter-ignoring and Skip-loop bugs. Skip on the last item ends on the list, not on item 1.
- **`listUrl(state, { done, next })`:** the only way any action, single or bulk, builds its return URL. It keeps filter, month and search, never carries an offset, adds `#row-<nextId>`, and goes through `rebase`/`withBase` for base-path installs. It replaces `backPath` (`src/events.ts:81`, callers `src/index.ts:250,257`, `src/batch.ts:206`, `src/events.ts:200`), the `BACK_QUERY` and `HOME` tables, and the fixed returns at `src/index.ts:121,383,395,421,425,492,581,611,623,630`, `src/batch.ts:284,290,342`, and the hard-coded discard and restore `back` values (`src/views.ts:294,718`, `src/all.ts:275`). It also removes the `batch.ts` to `views.ts` import cycle.
- **Counts:** every chip and the bulk "select all" count come from the same `where()`, month-wide. This removes Bank's per-page versus per-month mismatch.
- **D1 rounds:** every list page loads its queries in one `Promise.all` round, per the existing learning. Two chained rounds get fixed on the way: `settled()`/`monthState` in Bank (`src/views.ts:1017`) and `invoicesPage` (`src/invoices.ts:106-121`). The receipt page's six chained waits (`src/views.ts:380-420`) fold into one round together with `nextOpen` and the count.

**Bank goes first, and is smaller than it looked.** "Open" already exists in SQL as `SHOW_SQL.missing` (`src/banking.ts:915`, used by `showRows` at `:930`, bulk select-all at `src/batch.ts:279` and bulk Match at `:246`). It is equivalent to the JS `unmatched` predicate, because confirming a transfer sets `receipt_required=0` on both legs. Only `payments()` ignores it. Money-in rows with open invoices keep their match controls but sit in All, not To do.

**Receipts To do** spans every month and both kinds, as Review does today. Invoices carry an Invoice tag. The kind switch (Receipts \| Invoices) and the month arrows appear only in All, so there are never two stacked switches. Home's Check row links to `/receipts?view=todo&month=M`, so To do takes an optional month filter.

**URLs:** `/receipts` defaults to `view=todo`. To do is `/receipts?view=todo&reason=&month=&upto=`. All is `/receipts?view=all&kind=&show=&month=&q=&before=`. `/review` and `/review/merge` answer with a 302 (not a 301), matching the existing `moved()` helper (`src/index.ts:163-167`), so a revert can't strand cached redirects.

### 2. Rows leave with Undo

- The server stays the source of truth. Each POST redirects (303) to `listUrl(...)` with a `done=` event. The existing EVENTS registry (`src/events.ts`) renders "Approved 14 receipts · Undo" in a `role="status"` banner. It stays until the next action, so nothing times out (WCAG 2.2.1). The signed `done=` URL expires after 15 minutes (`src/signing.ts:13`), so after a reload past that the banner is gone. That's acceptable.
- **Undo keys on the action, not the ids.** 500 ids would not fit in a signed URL (about 32 KB). One migration, `migrations/0008_undo.sql` plus the matching `schema/` change: `undo_log(at TEXT, op TEXT, row_id TEXT, before_json TEXT, PRIMARY KEY(at,row_id))`. Each op writes its snapshot in the same `DB.batch` as the mutation, and Undo is `POST /undo {at, op}`. This generalises what discard (`restoreBatch(at)`, `src/discard.ts:87`) and Match all (`unmatchLikely(at)`, `src/match.ts:202`) already do. Chunked AI ops (Read again, Move) are not undoable, so one `at` per action holds.
- **What gets Undo, what gets a confirm** (from the inverse audit):

  | Op | Plan |
  | --- | --- |
  | Approve (single and bulk) | Undo via `undo_log`, which restores `manual_fields_json`, `review_reasons_json` and status. Watch that Undo bumps `revision`, which marks an already-sent month "changed" (`src/arrival.ts:39`). |
  | Discard | Undo already exists. Extend the snapshot with the removed `bank_transactions.receipt_id` and re-link it if that row is still unmatched. |
  | Not a purchase, Needs a receipt, Unmatch (bulk) | Undo via `undo_log`, which restores `receipt_required`, `exempt_by` and `receipt_id`. |
  | Bulk Not a purchase on matched rows | A bug today: `SET_REQUIRED_SQL` drops matches silently (`src/batch.ts:226-236`). Exclude matched rows in the filter. |
  | Mark paid (bulk), Delete rule, Remove part, Sender remove | Undo via a snapshot. |
  | Move kind | A confirm step, because it is lossy. It clears client, VAT, paid, manual fields and the match (`src/receipts.ts:843-853`). |
  | Held mail Ignore and Delete, Disconnect | A confirm step, because they destroy data. `discardHeld` deletes the R2 originals (`src/inbound.ts:378-397`), and Disconnect deletes the tokens (`src/onedrive.ts:237`). |
  | Read again | No Undo. It doesn't resolve anything. |

- Without script this already behaves correctly: the row is gone, the next one is in its place, and the banner offers Undo.
- With script, the update happens in place: the resolved rows animate out, the rest close the gap, scroll and focus stay put, and focus moves to the row that took the resolved row's place. **How** is settled by a two-way prototype bakeoff, not by guessing:
  - **A.** PRG plus cross-document View Transitions (`@view-transition { navigation: auto }`, a `view-transition-name` per row in inline `style`) and a `#row-` fragment, with `autofocus` on the next row. No new script. It must show that the transition fires after POST→303→GET and after `bulk.js`'s `location.assign`. It must also measure scroll drift (the next row's viewport offset against the resolved row's), check Safari, and confirm that Firefox degrades cleanly.
  - **B.** An owned `/assets/live.js` in the `bulk.ts` style. It POSTs with fetch, parses the redirected page, and swaps `<main>` plus the header badge inside `document.startViewTransition`. It intercepts only forms marked `data-live`, so the ZIP and CSV downloads, `/originals`, `/upload` and the import wizard are untouched. It must show that `bulk.js` and `settings.js` re-init cleanly through an `init(root)`, that 4xx in-place errors (`src/index.ts:752`) swap in, how the Back button behaves, and that the banner gets announced.
  - **Ruled out: Turbo 8 morph.** Every POST redirects to a fresh signed `?done=…&iat&sig` URL, so Turbo would make a normal visit, not a morphing refresh (inferred from Turbo 8's same-URL rule). It would also add about 90 KB and duplicate the Speculation Rules prefetch. Downloads and multipart flows would need excluding, every body script would re-run on each visit, and its snapshot cache can bring an Undo banner back on Back.

  Both prototypes run on the busy-month seed and are judged on six things: scroll kept, focus on the next row, the animation, bytes shipped, the Back button, and no-JS parity.

### 3. One row, one button, one icon per meaning

- **`row()` component:** checkbox, title, meta line, amount, status badge and row actions. Review, Receipts, Invoices, Bank, held mail and Settings lists all use it, replacing four layouts (`.list li`, `.held`, `.pay`, `.srow`).
- **The row-0 primary goes.** Its job moves to one page-level primary in the header: "Start checking (12)" opens the first open item. Delete the rule at `src/ui.ts:210` and update `test/app-shell.test.ts:861`.
- **Status registry:** one word, one colour and one icon per state (Needs you, Reading, Ready, Matched by you, Matched automatically, Missing, Not a purchase, Sent), shared by badges, chips and the banner.
- **`src/icons.ts`:** Lucide paths (ISC, notice added to `NOTICE`), emitted once per page as an inline `<symbol>` sprite and referenced with `<use href="#i-...">`, with `aria-hidden` and `focusable="false"`. It extends the existing `svg()` tab-icon helper (`src/ui.ts:512-519`).
- **`ACTIONS` registry:** maps each action key to its label, icon and tone, and feeds single buttons, bulk bar actions (`BulkAction` in `src/bulk.ts:11`) and Undo, so one icon means one thing everywhere. Approve is `check`, Discard `x`, Undo `undo-2`, Match `link`, Unmatch `unlink`, Not a purchase `ban`, Needs a receipt `file-question-mark`, Read again `scan-text`, Move to invoices `folder-input`, Mark paid `banknote`, Download ZIP `download`, Mark as sent `mail-check`, Upload `upload`, Import statement `import`, Delete `trash-2` (permanent delete only), Open original `external-link`.
- **Tone rules:** one primary per view. Undoable actions are secondary, never red. Red only for permanent delete, behind the existing `<details>` confirm step. Icon-only only for prev/next chevrons and close, each with `aria-label` and `title`.

### 4. Fresh visual direction

You chose two feels to mock: **Native app** (system font, rounded controls, grouped inset lists, translucent bars) and **Warm paper** (off-white tones, tabular receipt numerals, soft status colours). Both keep the petrol green accent. These directions are mocked as static HTML over the new row, button and banner components, using the busy-month data at 1440 and 390 widths. You pick one. The pick lands as a token change (`src/tokens.json`, `scripts/app-tokens.mjs`) plus component CSS in `src/ui.ts`, so it touches no page logic.

### 5. Keyboard (desktop)

A small `/assets/keys.js`: `j`/`k` move between rows, `x` selects, `Enter` opens, `a` approves on a receipt, `u` undoes the last action, `/` searches, `?` lists the shortcuts. It is off while typing and inert on touch-only devices.

### 6. Other audit findings, folded into the components above

Of the prior audit's F1-F20, 12 are fixed, 6 partly fixed (F6, F7, F8, F12, F14, F18) and 2 still open (F5, F17). New findings that change the plan, by severity:

| Sev | Issue | Fix |
| --- | --- | --- |
| 3 | The same action is styled differently in different places (Discard, Read again, Move, CSV, Match, Restore, Save, Remove match), and emphasis depends on a row's position, not on the action (`src/views.ts:905,944`, `src/all.ts:183`) | `ACTIONS` registry owns label, icon and tone. Rendering takes an action key, never a class. |
| 3 | Single destructive actions look harmless, and `.linkbtn` buttons look like links (`src/ui.ts:152`) | Tone rules above. Delete `.linkbtn` and give its uses a ghost tone with an icon. |
| 3 | Secondary buttons look like empty text inputs, and tabs, chips, month arrows and Search are all the same white box (`src/ui.ts:144,146,176,212,437`) | Distinct shapes per control type in the new visual direction: segmented control, filter chip, input and button. |
| 3 | PDFs show as extracted text, not as the document (`src/views.ts:694-705`) | **Out of scope here.** The inline route refuses PDFs on purpose (`src/index.ts:~441`), and `HTML_CSP` has `default-src 'none'` with no `frame-src` (`src/index.ts:730-733`). Embedding needs its own security review. That is a follow-up issue, not part of this stack. |
| 3 | Matching from a receipt page dumps you on Bank, out of the queue (`src/views.ts:680`, `src/index.ts:575-581`) | `listUrl` with the receipt's list state as the return target. |
| 3 | Discard chips submit on one click, and Undo doesn't bring back a removed match (`src/discard.ts:65-108`) | Keep one click, and make Undo restore the match too. |
| 3 | No Undo or confirm for Delete rule, Disconnect, Remove sender, removing a part, Ignore (deletes mail), Delete email, Move to invoices (`src/events.ts:151-241`, `src/all.ts:184`) | Inverse ops where the data allows. A confirm step only where it doesn't (Disconnect, permanent delete). |
| 3 | Errors appear in place on 6 routes only; others get "That didn't work" and lose what was typed (`src/index.ts:736-812`) | Extend the in-place error path to every form route. |
| 2 | After Approve, the banner says only "Approved.", with no name and no Undo (`src/events.ts:125`) | "Approved Sample Coffee. Undo" on the next receipt. |
| 2 | The banner's `role=status` is in the DOM at load, so screen readers likely won't announce it (`src/ui.ts:620`) | Keep the live region empty at load and fill it, or announce from the live-update script. |
| 2 | Reading status only updates on Refresh (F5) | The live-update script polls while any row is Reading. |
| 2 | No pending state on most submits, so double submits are possible | A shared pending state in the live-update script. The server treats "already resolved" as a quiet redirect. |
| 2 | Red covers errors, warnings, Needs you, Missing, badges and notes. There is no warning or info token (`src/tokens.json`) | Add warning and info roles in the visual direction. `.alert` is for errors only. |
| 2 | Three step-marker styles, labels drifting ("Needs receipt" and "Needs a receipt"), two upload screens ("Upload" and "Add files") | Status registry plus `ACTIONS` registry. One upload screen. |
| 2 | Home's setup checklist lists done rows and pushes the month down; Home can stick on a misdated old month (`src/arrival.ts:36-45`) | Collapse done rows. Arrival skips months whose only open item is undated. |
| 2 | Settings has 10 folds with secondary Saves (F17) | Group into fewer sections, each with a primary Save. |
| 1-2 | The receipt page says "5 to check" and "1 of 1 to check" together, More holds 7 unrelated actions, and the phone action bar hides while typing | Rename the field count "5 fields to fill". Split More into a document group and a status group. Keep Approve reachable on phones. |

## Cut list

From the simplification inventory (about 30 concepts, around 31 controls on Review for 10 rows, about 45 on a receipt page including folds, and 31 in the import editor).

**Approved by you (2026-10-30):**

| Cut | What changes | Lands in |
| --- | --- | --- |
| Only required facts go to To do | The To do predicate counts a receipt only when it has a *required* reason, via `json_each(review_reasons_json)` against the flag table's required codes. Existing rows need no data migration. Going forward, `src/receipts.ts:329` sets `needs_review` only for required reasons; optional reasons (no receipt number, an unsure Part or Kind) stay on the receipt as a note. The three reason chips on To do go. | PR 3 |
| One-click Discard, no reason | Discard runs straight away, with Undo. The reason chips and the `<details>` step go (`src/discard.ts:99-109`, `src/bulk.ts:167-174`); old reasons stay readable. The "Remove match?" question on matched receipts stays until PR 7, whose Undo restores the match, and then goes. | PR 3, PR 7 |
| Hide Part while there is one | The Part field, Home's "By part", Part flags and the Parts settings stay hidden until a second part exists. "Add a part" lives under Settings, Business. | PR 3 |
| One-step bank import | Choose a file, press Import. The account is chosen automatically when there is one account or a known layout or bank, and you're asked only when it's unclear. Rows already imported are skipped, and the banner offers "import anyway". The two ticks become warnings. The layout is saved automatically, and the 31-control editor opens only when detection fails. A new import Undo deletes that import's rows through `undo_log`. | After PR 7 |
| Unknown senders in To do | Held mail shows as To do rows with Allow and Ignore. Delete email goes, because Ignore covers it. Ignore keeps a confirm step, since `discardHeld` deletes the stored originals (`src/inbound.ts:378-397`). Settings' Senders, Ignored and "Mail we didn't keep" merge into one Email senders list. | PR 6 |
| Overdue invoices in To do | Sales invoices past `issue_date + payment terms` and unpaid join Receipts To do, computed in SQL with the terms bound as a parameter. Unpaid invoices that aren't yet due stay in All. | PR 6 |
| Settings: 5 sections, one Save | Business, Email, Bank, Sending, Advanced. One Save for the page replaces the per-group Saves and the unsaved-changes guard (`src/setup.ts:280,367-390`). The thresholds move under Advanced. | PR 12 |

**No-risk cuts I'm making without asking** (pure interface, no behaviour lost): checkboxes always visible, so `?select=1` and the Select toggle go (`src/bulk.ts:118-121`). "Match anyway" is relabelled Match, keeping its one-line reason (the exception is already a hidden field, `src/views.ts:680,885`). "Matched automatically" and "Matched by you" merge into Matched, and the Auto chip goes, since the import banner already counts automatic matches. Bank rows show Match, Not a purchase and More. The Statements fold, Technical details, the Receipts Reading/Duplicate/Discarded chips and "N dated ›" move behind one More or go. Help shrinks to the words still on screen.

**Kept, because you didn't approve cutting them:** the separate Mark as sent step, the manual Merge duplicates button, Kind and vendor rules on the receipt page, manual own-account transfers, the receipt or invoice choice on Add, the Accountant field, the thresholds (moved under Advanced but still editable), and the Email Routing ticks.

## Phases

Playbook: figure-it-out (cross-cutting, multi-PR), running Feature steps inside each PR. Each PR lands on its own, verifies before the next starts, and flips its own invariants from `test.fails` to `test`. The shared files (`src/views.ts`, `src/index.ts`, `src/ui.ts`, `src/batch.ts`) force most PRs into sequence. Only the harness and the mockups run in parallel from day one.

| # | PR | Deletes | Adds | Verified by |
| --- | --- | --- | --- | --- |
| 0 | Save the three trail learnings above | | `.trail/learnings/*` | `git status` |
| 1 | **Harness** (parallel) | | `test/busy-month.ts` seed; `test/worklists.test.ts` invariants as `test.fails`; `rec.check()` in `scripts/ux-journeys.mjs` that exits non-zero on misses; busy seed through `wrangler d1 execute` after migrate; journey "f. Busy month"; axe on busy pages | Baseline on `main` recorded in `docs/app-v4/baseline/`; the starred invariants fail there |
| 2 | **Visual mockups** (parallel, needs your pick) | | `docs/app-v4/mockups/{native,paper}.html`: To do list, receipt review and Bank, at 1440 and 390, with busy data, icons and the new components | You pick one |
| 3 | **Cuts** (subtraction first) | Select mode, discard reasons, the optional-reason To do trigger and reason chips, Part while there's one, "Match anyway", the auto/manual match split, the Statements fold, Technical details, extra Receipts chips | The required-reason To do predicate | Tests updated; journeys a-f still pass; Review row control count (inventory: about 31 for 10 rows) at least halved, measured by the journey |
| 4 | **Bank open-first** (riskiest unknown) | Offset, Earlier/Later, `bankScope.offset` (`src/batch.ts:212`), page-local counts, the offset assertion in `test/bulk-bank.test.ts:232-235` | To do \| All on Bank from `SHOW_SQL.missing`; keyset All; `monthState` folded into the one round | Invariants 1-3 and 10 |
| 5 | **`src/worklist.ts`**: `nextOpen`, `listUrl` | `queueAround`, `backPath`, `BACK_QUERY`, `HOME`, every fixed return | One return path for every action; list state on receipt URLs | Invariants 4-7; `test/base-path.test.ts` case per new redirect |
| 6 | **Review merged into Receipts** | `reviewPage`, the `review` nav key and page, the row-0 primary (`src/ui.ts:210`, `src/views.ts:294`, `src/all.ts:183`, `src/views.ts:939-943`), the held-mail section and Delete email, the three Settings sender lists | To do \| All on Receipts with held mail and overdue invoices as To do rows, 302s from `/review*`, badge on Receipts, one Email senders list | About 17 test files updated; journeys a-f |
| 7 | **Undo log** | Ad hoc per-op undo paths that `undo_log` replaces, and the "Remove match?" question on Discard | `0008_undo.sql`, schema, `POST /undo`, inverses per the table above, confirm steps for lossy ops, the bulk Not-a-purchase filter fix | Invariant 8; per-op undo round-trip tests, including Discard bringing back its match |
| 7b | **One-step import** | The account selects, the two ticks, the optional Save layout fold, the editor on the happy path | Automatic account and layout, skip-already-imported, an import Undo | Import tests across the existing fixtures (`test/fixtures`); journey b drops to 2 clicks for the import itself |
| 8 | **Live-update bakeoff** (two throwaway branches, not merged) | | Prototypes A and B | Scored on the six criteria; the winner is written up in `docs/app-v4/DECISION.md` |
| 9 | **Live updates** (the winner) | `location.assign` in `bulk.js` | Rows animate out, scroll and focus kept, banner announced, pending state, polling while Reading | Journey f: no acted-on id left, `scrollY` drift under 200 px, focus inside the next row |
| 10 | **Icons, ACTIONS and status registries** | `.linkbtn`, position-based tones, label drift | `src/icons.ts` sprite (Lucide, ISC notice in `NOTICE`), `ACTIONS`, a single `STATUS` with icon and tone | A structural test that every rendered `<button>` has an icon and a label and that no list row contains a `primary` |
| 11 | **One row component and the chosen look** | `.held`, `.pay`, `.srow`, the 3 step-marker styles, unused tokens | `row()`, the token set from your pick, warning and info roles | Screens at 1440 and 390; axe 0 |
| 12 | **Settings and remaining audit fixes** | 10 Settings folds and per-group Saves; full-page "That didn't work" on the routes that still use it | 5 Settings sections with one Save; in-place errors on every form route; done rows collapsed in the Home checklist; the arrival fix; Approve reachable on phones | Settings tests; inline-error tests per route |
| 13 | **Keyboard** | | `keys.js`, reusing `bulk.js`'s `x` and Escape; a `?` sheet | Keyboard check in the journeys |
| 14 | **Release** | | Docs (README, `docs/ARCHITECTURE.md`, Help glossary), CHANGELOG, version bump, the after run in `docs/app-v4/after/` | `bun run check`; journeys green |

**Who builds it.** One owner subagent per PR (`pstack:poteto-agent`, sonnet/medium per the model rule; opus/medium for PRs 4-7, which carry the model and the migration). The mockups go to a design subagent (opus/medium). Each owner gets this plan, the PR row, the invariants it must flip, and the files it may not touch. I review every diff. Before PR 5 lands, `interrogate` runs on the work-list model, because every later PR builds on it.

## Verification

- **Gate per PR:** `bun run check` (typecheck, prettier, vitest in workerd, script tests). The PR's own invariants flip from `test.fails` to `test` and pass.
- **List invariants** (`test/worklists.test.ts`, busy-month seed of 150 receipts, 40 needing review, and 220 bank rows with 60 missing, 35 of them past row 100). Starred ones fail on `main` today.
  1. *Bank To do shows `min(upto, missing)` rows, including ones past row 100.
  2. *After bulk-exempting every visible missing row, the next ones appear, and the page doesn't claim "Every payment has a receipt".
  3. *Chip counts equal `showCounts`, and the bulk total equals the rendered "N to do".
  4. *A single Not a purchase keeps the view and ends at `#row-<nextOpenId>`.
  5. *Approve on a receipt opened from To do (`from=todo`, optionally `month=M`) lands on the next open item in the same order and filter, computed after the save. (The reason chips are cut, so `month` is the only To do filter.)
  6. *Skip on the last item ends on the list.
  7. *Discard from a month-filtered To do keeps the month.
  8. *Bulk-approve Undo brings all the rows back into To do.
  9. A resolved id never renders in To do, and the order is stable.
  10. *Bulk Not a purchase never drops a match silently.
- **Journeys:** `node scripts/ux-journeys.mjs --out docs/app-v4/after` runs journeys a-f with `rec.check` assertions and exits non-zero on any miss. Journey f drives the busy month: bulk on Bank To do, bulk approve on Receipts To do, then Undo. It checks refill, that no acted-on id remains, scroll drift and focus.
- **Structure as a gate:** an app-shell test renders every page and asserts that each `<button>` has an icon and a text label, that no list row holds a `primary`, and that no two actions share an icon.
- **Real-surface check:** drive the local app (`bun run dev`, seeded busy month) with the browse skill at 1440 and 390. Reproduce your three complaints on `main` and confirm each is gone on the branch, with before and after screenshots in `docs/app-v4/`.
- **Base path and accessibility:** a `test/base-path.test.ts` case for every new redirect, and axe at 0 violations on the busy pages at both widths.
- **Copy:** grep every changed file for U+2014 and U+2013 (`grep -rnP '\x{2014}|\x{2013}'`), per the no-dash rule.
