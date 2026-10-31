# Writing the Nuits Receipts docs

The docs site is a [Nimbus](https://nimbus-docs.com) (Astro) project served at
`https://receipts.nuits.net/docs/`. Pages live in `src/content/docs/` as `.mdx`.
Read `AGENT.md` for Nimbus mechanics; this file covers what to write and how.

## Who reads these docs

- **Self-hosters**: people who deploy their own copy into their own Cloudflare
  account and use it every month. Most pages are for them.
- **Contributors**: developers changing the code, running tests, cutting releases.
- **Accountants**: the person who receives the monthly CSV or ZIP and needs to
  know what is in it and how it was produced.

## Diataxis: four kinds of page, never mixed

Every page is exactly one kind and lives in that kind's folder. If a page starts
to do two jobs, split it and link between them.

| Folder | Kind | The reader is... | Write it as |
| --- | --- | --- | --- |
| `tutorials/` | Tutorial | learning, at study | A lesson with one guaranteed path to a visible result. "We" voice. No choices, no alternatives, no explanation beyond a sentence. Every step produces something the reader can see. Tell them what they will have at the end, up front. |
| `how-to/` | How-to guide | working, has a goal | A recipe for one real task. Title starts with a verb ("Set up email", "Import a bank CSV"). Assumes competence. Lists prerequisites, then numbered steps, then how to check it worked. Links out for background instead of explaining. |
| `reference/` | Reference | working, needs a fact | Dry, complete, structured like the thing it describes (one entry per variable, column, command). Tables. No instructions, no opinions. Accurate to the code, not to old docs. |
| `explanation/` | Explanation | studying, wants to understand | Discussion: why it works this way, trade-offs, limits, design choices, context. Can hold opinions and alternatives. No step-by-step instructions. |

Each folder has an `index.mdx` landing page that says in two sentences what the
section is for and lists its pages with `<CardGrid>`/`<Card href>` or a list.

## Voice and copy rules

- Plain, short sentences. British spelling ("organise", "colour", "licence" as a noun).
  Second person ("you") except tutorials, which may use "we".
- Never an em dash or en dash. Use commas, colons, parentheses, or two sentences.
  Ranges use a hyphen or "to".
- Say what the app does, not what it guarantees. It *suggests* matches, *prepares* a
  CSV, *reads* receipts with AI. Figures are AI-extracted and the user checks them.
  It is not tax, VAT or accounting advice and not a bookkeeping system. It keeps every
  document findable on Home; for retention say exactly "Keep originals as your local law
  requires. Nuits Receipts keeps a copy in your own Cloudflare R2 bucket."
- Banned (the build fails on them): "VAT-compliant", "tax-ready", "audit-proof",
  "100% accurate", "never miss", "guaranteed", "bank-grade", "secure by design",
  "does your bookkeeping", "replaces your accountant", "calculates your VAT",
  "integrates with", "free to run", "compliant", "integration", "partner",
  "official", "never leaves your account", "stays in your account",
  "legally compliant archive", "retention-compliant", "GoBD", "replaces your filing". Say
  "Nuits never sees your data" for the privacy point. Say "connect" or "upload to
  OneDrive" rather than "integration".
- Product name is "Nuits Receipts". Never put "Cloudflare" in the product name.
  Descriptor: "a receipt inbox that runs on Cloudflare Workers".
- Clairic (`@cf/cloudflare/clairic`) is a Cloudflare **preview** model. Say so once, on
  `explanation/how-reading-works` and in `reference/outside-calls`; everywhere else just
  "Clairic". Clef (`@cf/cloudflare/clef`) picks product and expense type when no vendor
  rule matches; your rules always win, and two disagreeing rules send the receipt to review.
- Running cost wording, if you state it: "AI reading costs about 15 cents a month",
  and plan on Workers Paid ($5 a month) if you upload PDFs, because a PDF upload uses
  far more than the Free plan's 10 ms CPU limit. Forwarded email bodies may fit in
  Free. Never say it is free to run.
- Banks: "imports CSV exports from banks that provide one: presets for some layouts and
  a column mapper for others, so you map the columns once". Never say "any bank"
  without a qualifier. Do not name banks as supported unless the code ships a preset
  for them, and say what was tested (Holvi exports so far).
- No invented numbers, testimonials or social proof. If a fact is unknown, say plainly
  that it is not known or not measured, or leave the claim out. Do not leave
  placeholders on a page.
- Never include private details: no Cloudflare account IDs, resource IDs, real
  emails other than hi@brandnuits.com.

## Facts come from the code

Old prose (`README.md`, `docs/*.md`) is a starting point, not the truth. Check
every variable name, default, route, button label and limit against `src/`,
`wrangler.jsonc`, `scripts/` and `test/`. Button and heading labels must match
the UI exactly (UI strings live in `src/views.ts`, `src/ui.ts` and friends).

## Nimbus syntax

Frontmatter: `title` (required, becomes the H1; never repeat it as `#`),
`description` (one line), `sidebar: { order: N, label: "Short" }`.

```mdx
:::note
Admonition types: note, info, tip, caution, warning, important, danger.
:::

:::caution[Custom title]
Body.
:::

<Steps>
  <Step title="Create the bucket">Body in **markdown**.</Step>
  <Step title="Deploy">More.</Step>
</Steps>

<Tabs>
  <TabItem label="Bun">...</TabItem>
  <TabItem label="npm">...</TabItem>
</Tabs>

<CardGrid>
  <Card title="Set up email" href="/how-to/set-up-email/">Forward receipts by email.</Card>
</CardGrid>
```

Code fences take a language and optional `title="wrangler.jsonc"`. Inside JSX
components leave a blank line around markdown content.

Internal links are written **without** the `/docs` base and with a trailing slash:
`[Set up email](/how-to/set-up-email/)`. The `nimbus/internal-link` rule fails the
build on a broken link, so only link to slugs in the page map below.

Screenshots live in `src/assets/screenshots/` and are referenced with a path
relative to the page: from `src/content/docs/how-to/x.mdx` that is
`../../../assets/screenshots/payments.png`, used as the target of an ordinary
Markdown image. Alt text describes what the screen shows.

## Page map

Slugs are file paths under `src/content/docs/` without the extension. Link only to
these. `sidebar.order` follows the order listed.

### Home
- `index`: what Nuits Receipts is, who each section is for, where to start.

### Tutorials
- `tutorials/index`
- `tutorials/deploy-your-own-copy`: Deploy to Cloudflare button, set the password, sign in, see the empty app.
- `tutorials/your-first-month`: upload a receipt, review and approve it, import a bank CSV, see the match, download the month and press I've sent it. Uses the sample files in `scripts/sample-receipts/`.
- `tutorials/run-it-locally`: contributors: clone, install, `.dev.vars`, migrate, `bun run dev`, sign in, upload a sample, run the tests.

### How-to guides
Deploy and configure:
- `how-to/index`
- `how-to/deploy-from-the-command-line` (`bun run setup`, `bun run deploy`, dry run)
- `how-to/set-up-email` (Email Routing, Send to a Worker, allowlist, test)
- `how-to/forward-a-copy-of-incoming-mail` (`FORWARD_COPY_TO`)
- `how-to/keep-sales-invoices` (`INVOICES_ADDRESS`, `SELLER_NAMES`)
- `how-to/protect-the-app-with-cloudflare-access`
- `how-to/upload-the-month-to-onedrive` (Entra app registration, connect, choose folder)
- `how-to/serve-the-app-under-a-path` (custom domain, `APP_BASE_PATH`)
- `how-to/change-settings-in-the-app` (Settings, Setup, source tags, reset)
- `how-to/upgrade-your-deployment`
- `how-to/install-the-app` (install from the browser, offline page, Android share target)
Use it every month:
- `how-to/add-receipts` (upload PDF or photo, forward email)
- `how-to/review-and-approve-a-receipt` (flags, reason on approve, Retry)
- `how-to/import-a-bank-csv` (map columns once, preview, confirm, re-import is a no-op)
- `how-to/resolve-duplicate-warnings`
- `how-to/match-payments-and-receipts` (accept suggestions, exemptions)
- `how-to/pair-an-own-account-transfer`
- `how-to/sort-costs-with-vendor-rules`
- `how-to/send-the-month-to-your-accountant` (ZIP or CSV, I've sent it, changes after sending)
- `how-to/find-any-document` (Home's folders, search syntax, quick find, saved searches, tags, notes, stars, Download folder, other documents)
- `how-to/troubleshoot`
For accountants:
- `how-to/open-a-month-package` (what to open first, how to check totals against originals)
For contributors:
- `how-to/run-the-tests`
- `how-to/measure-extraction-quality` (`bun run eval`)
- `how-to/cut-a-release`

### Reference
- `reference/index`
- `reference/configuration` (every Worker var, secret and binding: name, default, what it does, where it can be changed)
- `reference/commands` (every `bun run` script in the root `package.json`, with flags)
- `reference/export-csv` (every column of the monthly CSV and the sales CSV)
- `reference/month-package` (ZIP layout, file naming, index spreadsheet columns)
- `reference/bank-csv-import` (mapping fields, accepted formats, presets, dedupe rules)
- `reference/receipt-fields-and-flags` (extracted fields, statuses, every review flag and what triggers it)
- `reference/app-pages` (every page in the app: path and what it shows)
- `reference/pdf-viewer` (the viewer's buttons, keys, fallback and assets)
- `reference/keyboard-shortcuts` (every key from `KEY_GROUPS` in `src/keys.ts`, plus the bulk keys)
- `reference/limits` (file sizes, types, Cloudflare plan limits)
- `reference/outside-calls` (every outbound call: who, when, what is sent)
- `reference/data-model` (D1 tables and R2 keys, for contributors)
- `reference/changelog` (summarise or include `CHANGELOG.md`)

### Explanation
- `explanation/index`
- `explanation/how-it-works` (one Worker, R2, D1, Workers AI, no queues or cron)
- `explanation/how-reading-works` (Clairic, VAT arithmetic checked in code, why rows get flagged)
- `explanation/how-costs-are-sorted` (vendor rules, Clef fallback, conflicts)
- `explanation/how-matching-works` (bank rows to approved receipts, suggestions, exemptions, transfers)
- `explanation/currencies-and-reference-rates` (ECB rates via Frankfurter, when a bank match wins)
- `explanation/email-and-sender-trust` (allowlist, SPF, why unproven mail is kept unread)
- `explanation/privacy-and-your-data` (your account, what Nuits sees, logs, outside calls)
- `explanation/running-costs`
- `explanation/what-it-does-not-do` (not bookkeeping, not advice, not a records system; your accountant decides)
- `explanation/for-accountants` (how the figures were produced, what to trust, what to check)
