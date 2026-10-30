# Architecture

One Cloudflare Worker with server-rendered HTML. No SPA, ORM, cron triggers or queues.

| Module | Role |
| --- | --- |
| `src/index.ts` | HTTP routes, HTTP Basic sign-in (`AUTH_USERNAME`, `NUITS_PASSWORD`), Origin checks on every POST, security headers. |
| `src/config.ts` | Parses and validates the deployment vars into one `AppConfig`. Invalid config fails closed. |
| `src/receipts.ts` | Uploads and email ingestion, storage of originals in R2, the processing lease, corrections and approvals. |
| `src/sender.ts` | Reads Cloudflare's own `Authentication-Results` header to verify the envelope sender (SPF). |
| `src/ai.ts` | Clairic extraction, Clef categorisation, Clef bank column mapping and Clairic PDF statement rows, with a deterministic mock for local use and tests. |
| `src/matcher.ts`, `src/exempt.ts` | Pure receipt-to-payment matching, and the rules and capped Clef question that mark payments needing no receipt. `reconcile` in `src/banking.ts` runs both. |
| `src/domain.ts` | Shared types, limits, money and date helpers (integer minor units, never floats). |
| Bank import module | XLSX reading (`src/xlsx.ts`), PDF statement reading (`src/pdf.ts`), CSV parsing and mapping, bank rows, matching, FX lookups. |
| `src/ui.ts` | Pages, forms and the CSV export, including the in-app notices. |
| `src/worklist.ts` | The work-list model: list state, the open set, the next open row and every return URL (`listUrl`). |
| `src/undo.ts` | The undo log: which actions can be undone, their snapshots and the restore. |
| `src/actions.ts`, `src/status.ts`, `src/icons.ts`, `src/row.ts` | The control and status registries, the generated Lucide sprite, and the one row every list renders. |
| `src/keys.ts` | Desktop keyboard shortcuts, the `?` sheet and the pending cue on submit, served at `/assets/keys.js`. |
| `schema/` | Bootstrap schema for a new installation, applied by `bun run deploy`. |
| `migrations/` | Upgrade chain for databases created before `schema/` (ledger `d1_migrations`). Applied files are never changed. See `migrations/README.md`. |

## Bulk actions

`src/bulk.ts` renders the one shared select component (row tick boxes, the select tools and the action bar) and the action labels for each list, and builds the client script served at `/assets/bulk.js`. The script embeds the pure selection reducer `select` from the same file, so the tests and the browser run the same code. `src/batch.ts` holds the server side: a registry of ops per route (`/receipts/bulk`, `/payments/bulk`, `/senders/bulk`), one id parser per route at the boundary, and the same per-row guards as the single actions. With `all=1` the server resolves the ids from the list's own filter instead of trusting the page. `BULK_CAP` is 500 ids per request and per `all=1`; ops that call the model (Read again, Move) take `AI_CAP` (10) per request, and the script sends them in chunks. Without JavaScript the tick boxes and bar are a plain form. App pages now send `script-src 'self'`; scripts are files, never inline.

## Service worker

`/sw.js` exists so the app can be installed and show an offline page. It caches no app data and only answers two things: a navigation while the device is offline, and an Android share POST to `/share`, whose files it stashes in Cache Storage for the Add page (which fills the form but never submits). Online requests never pass through it, because a worker in the navigation path can swallow the Basic challenge or the Access redirect. The manifest and worker stay behind sign-in; only the icons and `/favicon.svg` answer without it. If a share POST reaches the Worker instead, it is redirected to `/add` unread.

## Undo

An action that resolves list rows can be undone from the banner, keyed by the action's timestamp (`at`) and name (`op`), never by its ids. `src/undo.ts` holds the registry `CHANGES`: per action, which tables it writes, which rows (picked by `id` or by `receipt_id`) and which columns. Snapshot and restore are generic over that registry, so adding an undoable action is one entry, not new code.

The snapshot lives in the `undo_log` table (`migrations/0011_undo_log.sql`, `schema/0008_undo_log.sql`), one row per action, table and row, with the listed columns before the action (`before_json`) and just after it (`after_json`, `'null'` once deleted).

The same-batch rule: an undoable write goes through `withUndo(env, { at, op, ids }, writes)`, which runs one `DB.batch` with the snapshot before the writes and the after-state seal at the end. The log and the change commit together or not at all, and rows the writes left alone are dropped from the log. Each call also prunes entries older than a day; the Undo link itself lives 15 minutes.

`undo(env, at, op)` restores in one batch and forgets the action. It skips a row that changed again since (by `revision` on receipts, by the restored columns elsewhere), never brings back a row deleted since, and links a payment back to its receipt only while that receipt is live and unmatched. Undo restores `revision` too, so a month sent before the action reads as sent again. It returns the ids it put back. Undoing an approval first takes off any automatic match made after it, since that match rested on the approved facts. Settings (`op: 'settings'`) go back with an audit row each, so the history shows the Undo and an older Settings tab is refused on save.

Every Undo posts to `POST /undo` with `at`, `op` and the list state of the page the banner is on (`events.ts` `onList`). It lands on the first row it brought back: the receipt page for receipts when the banner was on one, Bank for payments, Settings for rules and settings. Its own banner (`undone`) says what came back and offers no Undo.

Which actions are undoable: Approve (single and bulk), Discard (with the match it removed), Mark paid and Not paid, Not a purchase and Needs a receipt, Match, Match all, Remove match, Delete rule, and a Settings save that removes a sender or a part. Read again and Move run in chunks and call the model, so they have no Undo; Move, held-mail Ignore and OneDrive Disconnect lose data and ask first instead. The own-account transfer keeps its own Undo route.

## Bank import

`/import` is a file field and Import (`src/one-step.ts`). It finds the account and the layout and imports, asking only when it cannot. Account, first hit: the one chosen on the account question, the only account, the account whose bank the layout names, a new account named for that bank when there is none, else the question. Layout, first hit: a layout saved for these header names (`bank_presets`, keyed by header fingerprint; the account's bank first), the built-in layout for them, the model's proposal when it reads the whole file, else the column editor (`/imports/csv`, signed preview and confirm), which also opens when the rows have errors, the printed totals do not add up, or the delimiter or a slash date order is ambiguous. A file that is not UTF-8 is read as Windows-1252.

Payments already in the account (same bank ID or same facts) are skipped and counted. The banner says "Skipped N already imported" and, when some had no bank ID, offers Import anyway (`/import/anyway`), which adds those as extra payments in a second import of the same file (`importIdentity` takes a salt). A payment that looks like one in another account is imported and counted in the banner. A layout the model proposed or the owner worked out in the editor is saved on success; built-in and saved layouts are not saved again.

The import's completion goes through `withUndo` as `op: 'import'` with the import id. Its Undo (`undoImport` in `src/undo.ts`) deletes the import's payments with their transfer pairs, automatic marks and match rejections, and the import itself, so the same file imports afresh. It refuses, and removes nothing, when any of its payments was since matched by hand or marked Not a purchase by the owner. The chunked `reconcile` after an import stays outside the log (it writes in chunks of 50); deleting the rows is what undoes it.

## Work lists

Receipts and Bank each render one work list in two views, To do and All, from one model in `src/worklist.ts`. `ListState` is the list (`receipts`, `invoices` or `bank`), the view, the month, the search and `upto`. `ListDef` holds, per list, its stable order (ending in `id`) and its open set as an SQL predicate with its own binds. Receipts To do is a receipt that needs a required fact or a sales invoice past its due date, and Bank To do is money out with no receipt that is not a transfer leg. Mail from new senders shows above Receipts To do as its own rows, outside the count.

- **To do** filters in SQL and renders the first `upto` rows (50, then "Show 50 more", at most `BULK_CAP`, 500). There is no offset, so a resolved row drops out and the next open row moves up. The header count, the To do and All switch counts, select-all and the bulk bar all read the same predicate, month-wide.
- **All** is for browsing. Receipts All pages newest first with a keyset cursor (Older, Newest), never an offset. Bank All lists the whole month, oldest first, and moves by month.
- **Every action returns through `listUrl`**, single or bulk: the same list, view, month and search, the signed `done=` event, and `#row-<id>` of the next open row. `nextOpen` runs after the save, from where the acted-on row stood before it (the cursor is captured before the write). Approve on a receipt goes to the next open receipt in the same filter; Skip on the last one ends on the list. A bulk post whose list state is missing answers 400, never a guessed list.
- `/review` and `/review/merge` answer 302 to Receipts To do.

The observable contract (`data-list`, `data-total`, `data-row`, the URLs) is in `docs/app-v4/CONTRACT.md`, and `test/worklists.test.ts` holds the ten list invariants on a seeded busy month.

## Live updates

A resolved row leaves by a cross-document view transition, with no script moving the page: `@view-transition { navigation: auto }` (`VIEW_TRANSITION_CSS` in `src/ui.ts`, off under reduced motion), an inline `view-transition-name` per row, `scroll-margin-top` on rows and the `#row-<next>` fragment. The server stays the source of truth; every POST answers 303 to its list. It won the bakeoff against a fetch-and-swap script because it ships no new script and behaves the same without one; Turbo was ruled out before it, since every POST lands on a fresh signed URL. The focused row is described by the banner (`aria-describedby`), and the page title starts with the event, since a live region present at load is not reliably read out. A second submit of an already resolved row redirects quietly, with no second banner. `bulk.js` posts with `redirect: 'manual'`, so a lapsed sign-in is never downloaded as a page.

## Controls, statuses and icons

Every button and button-link renders from `ACTIONS` in `src/actions.ts`: one label, one Lucide icon and one tone per action key, shared by single buttons, the bulk bar and Undo. Only a view's one main action is primary ("Start checking", "Start matching"), and it sits in the list header, never in a row. Undoable actions are secondary or ghost; red is only for permanent delete behind a confirm step. `STATUS` in `src/status.ts` gives each state one word, tone and icon (Needs you, Reading, New sender, Overdue, Missing, Ready, Matched, Not a purchase, Sent, Discarded, Duplicate, Paid, Unpaid), and Help's "Words you see" is typed over its keys. `src/icons.ts` is generated by `bun run sprite` (`scripts/app-sprite.mjs`) from `lucide-static` and emitted once per page as an inline `<symbol>` sprite. `test/actions.test.ts` renders every page and fails when a button lacks an icon or a word, or a row holds a primary.

`row()` in `src/row.ts` is the one row component: tick box, title (a link stretched over the row), meta line, amount, status and row actions. Receipts To do and All, held mail, Bank and the Settings lists all use it.

## The look

The look is the Mix from `docs/app-v4/mockups/`: Warm paper's palette and type (Bricolage Grotesque, Instrument Sans, DM Mono numerals, stamp statuses) on Native's layout (a sidebar on a computer, a tab bar on a phone, grouped lists, segmented controls). `src/tokens.json` is the source of the CSS custom properties; `bun run tokens` writes `src/tokens.ts`, and `scripts/app-tokens.test.ts` measures every contrast claim. Navigation and floating controls use a glass material in our own CSS (`backdrop-filter`), with solid fallbacks for browsers without it, reduced transparency and more contrast. Its alpha, 0.85, is the lowest at which text passes 4.5:1 over the darkest backdrop.

## Keyboard

`src/keys.ts` adds one keydown listener and one submit listener on every page, served at `/assets/keys.js`: `j` and `k` move between rows, `Enter` opens one, `a` and `s` approve and skip on a receipt, `u` posts the banner's Undo, `/` focuses search and `?` opens the sheet. `x` and Escape stay in `bulk.js`. The keys are off while typing and on touch-only devices. The same table (`KEY_GROUPS`) prints the sheet and the Help page. A post form's submit button shows a pending cue so a second press does nothing.

## Data rules

- Every original is stored once, keyed by its SHA-256, before any processing. Retry re-reads the stored original.
- Extracted facts are nullable. Uncertain or inconsistent values set `needs_review` with reasons; approving needs a reason.
- Manual corrections win over later model output. Revision checks stop stale completions from overwriting edits.
- Bank rows keep their signed amounts. A receipt is linked to at most one payment. Automatic matching (`src/matcher.ts`) ranks every fitting pair and links best first; an equal-score choice between different rows is left as a suggestion. Automatic "Not a purchase" marks (`src/exempt.ts`) never override an owner's choice.
- EUR value precedence: manual override, EUR bank match, native EUR, then an ECB reference rate.
- CSV export cells that start with formula characters are escaped.

## Verification

Worker tests run in workerd through `@cloudflare/vitest-pool-workers`, with AI and FX mocked and outbound network forbidden. `scripts/*.test.ts` cover the setup and deploy scripts against a fake Wrangler, schema equivalence, and release tooling. `bun run smoke` drives a local `wrangler dev` server with curl.
