# Architecture

One Cloudflare Worker with server-rendered HTML. No SPA, ORM, cron triggers or queues.

| Module | Role |
| --- | --- |
| `src/index.ts` | HTTP routes, HTTP Basic sign-in (`AUTH_USERNAME`, `NUITS_PASSWORD`), Origin checks on every POST, security headers. |
| `src/config.ts` | Parses and validates the deployment vars into one `AppConfig`. Invalid config fails closed. |
| `src/receipts.ts` | Uploads and email ingestion, storage of originals in R2, the processing lease, corrections and approvals. |
| `src/sender.ts` | Reads Cloudflare's own `Authentication-Results` header to verify the envelope sender (SPF). |
| `src/ai.ts` | Clairic extraction, Clef categorisation and Clef bank column mapping, with a deterministic mock for local use and tests. |
| `src/domain.ts` | Shared types, limits, money and date helpers (integer minor units, never floats). |
| Bank import module | XLSX reading (`src/xlsx.ts`), CSV parsing and mapping, bank rows, matching, FX lookups. |
| `src/ui.ts` | Pages, forms and the CSV export, including the in-app notices. |
| `schema/` | Bootstrap schema for a new installation, applied by `bun run deploy`. |
| `migrations/` | Upgrade chain for databases created before `schema/` (ledger `d1_migrations`). Applied files are never changed. See `migrations/README.md`. |

## Data rules

- Every original is stored once, keyed by its SHA-256, before any processing. Retry re-reads the stored original.
- Extracted facts are nullable. Uncertain or inconsistent values set `needs_review` with reasons; approving needs a reason.
- Manual corrections win over later model output. Revision checks stop stale completions from overwriting edits.
- Bank rows keep their signed amounts. A receipt is linked to at most one payment. Automatic matches need a single candidate on both sides.
- EUR value precedence: manual override, EUR bank match, native EUR, then an ECB reference rate.
- CSV export cells that start with formula characters are escaped.

## Verification

Worker tests run in workerd through `@cloudflare/vitest-pool-workers`, with AI and FX mocked and outbound network forbidden. `scripts/*.test.ts` cover the setup and deploy scripts against a fake Wrangler, schema equivalence, and release tooling. `bun run smoke` drives a local `wrangler dev` server with curl.
