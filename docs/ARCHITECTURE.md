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
| `schema/` | Bootstrap schema for a new installation, applied by `bun run deploy`. |
| `migrations/` | Upgrade chain for databases created before `schema/` (ledger `d1_migrations`). Applied files are never changed. See `migrations/README.md`. |

## Bulk actions

`src/bulk.ts` renders the one shared select component (row tick boxes, the select tools and the action bar) and the action labels for each list, and builds the client script served at `/assets/bulk.js`. The script embeds the pure selection reducer `select` from the same file, so the tests and the browser run the same code. `src/batch.ts` holds the server side: a registry of ops per route (`/receipts/bulk`, `/payments/bulk`, `/senders/bulk`), one id parser per route at the boundary, and the same per-row guards as the single actions. With `all=1` the server resolves the ids from the list's own filter instead of trusting the page. `BULK_CAP` is 500 ids per request and per `all=1`; ops that call the model (Read again, Move) take `AI_CAP` (10) per request, and the script sends them in chunks. Without JavaScript the tick boxes and bar are a plain form. App pages now send `script-src 'self'`; scripts are files, never inline.

## Undo

An action that resolves list rows can be undone from the banner, keyed by the action's timestamp (`at`) and name (`op`), never by its ids. `src/undo.ts` holds the registry `CHANGES`: per action, which tables it writes, which rows (picked by `id` or by `receipt_id`) and which columns. Snapshot and restore are generic over that registry, so adding an undoable action is one entry, not new code.

The snapshot lives in the `undo_log` table (`migrations/0011_undo_log.sql`, `schema/0008_undo_log.sql`), one row per action, table and row, with the listed columns before the action (`before_json`) and just after it (`after_json`, `'null'` once deleted).

The same-batch rule: an undoable write goes through `withUndo(env, { at, op, ids }, writes)`, which runs one `DB.batch` with the snapshot before the writes and the after-state seal at the end. The log and the change commit together or not at all, and rows the writes left alone are dropped from the log. Each call also prunes entries older than a day; the Undo link itself lives 15 minutes.

`undo(env, at, op)` restores in one batch and forgets the action. It skips a row that changed again since (by `revision` on receipts, by the restored columns elsewhere), never brings back a row deleted since, and links a payment back to its receipt only while that receipt is live and unmatched. Undo restores `revision` too, so a month sent before the action reads as sent again.

## Data rules

- Every original is stored once, keyed by its SHA-256, before any processing. Retry re-reads the stored original.
- Extracted facts are nullable. Uncertain or inconsistent values set `needs_review` with reasons; approving needs a reason.
- Manual corrections win over later model output. Revision checks stop stale completions from overwriting edits.
- Bank rows keep their signed amounts. A receipt is linked to at most one payment. Automatic matching (`src/matcher.ts`) ranks every fitting pair and links best first; an equal-score choice between different rows is left as a suggestion. Automatic "Not a purchase" marks (`src/exempt.ts`) never override an owner's choice.
- EUR value precedence: manual override, EUR bank match, native EUR, then an ECB reference rate.
- CSV export cells that start with formula characters are escaped.

## Verification

Worker tests run in workerd through `@cloudflare/vitest-pool-workers`, with AI and FX mocked and outbound network forbidden. `scripts/*.test.ts` cover the setup and deploy scripts against a fake Wrangler, schema equivalence, and release tooling. `bun run smoke` drives a local `wrangler dev` server with curl.
