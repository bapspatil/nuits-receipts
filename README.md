# Nuits Receipts

A self-hosted receipt and invoice reader that runs on Cloudflare Workers. You deploy it into your own Cloudflare account. It:

- reads vendor, amounts, VAT and dates from your receipts (PDF uploads, photos, or receipts you forward by email);
- suggests matches between receipts and bank transactions, and flags payments that have no receipt yet;
- imports bank CSV exports; you map the columns once ([import guide](https://receipts.nuits.net/docs/how-to/import-a-bank-csv/), [limits](https://receipts.nuits.net/docs/reference/limits/));
- prepares a monthly CSV you can send to your accountant.

You review everything; nothing is filed or submitted for you. It helps you get organised before you hand things to your accountant.

> Nuits Receipts organises receipts and prepares a CSV for your accountant. It is not tax, VAT or accounting advice, and it does not do your bookkeeping. Figures are AI-extracted and you should check them.

**Documentation: <https://receipts.nuits.net/docs/>.** Start with the [tutorials](https://receipts.nuits.net/docs/tutorials/), find a task in the [how-to guides](https://receipts.nuits.net/docs/how-to/), look things up in the [reference](https://receipts.nuits.net/docs/reference/), or read [how it works](https://receipts.nuits.net/docs/explanation/).

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bapspatil/nuits-receipts)

## No warranty

> **No warranty. Not financial, tax or accounting advice.**
> Nuits Receipts is free, open-source software provided "as is", without warranties or conditions of any kind, as set out in the Apache License 2.0 (sections 7 and 8). It reads documents with an AI extraction model (Cloudflare Workers AI "Clairic", currently a preview model), and it can misread or miss vendors, amounts, VAT, dates and currencies. Bank matching is a suggestion, not a reconciliation you can rely on without checking.
> You are responsible for checking every figure, for your own bookkeeping, tax and VAT filings, and for keeping your original receipts as your local accounting law requires. Nuits Receipts is not an archive or a bookkeeping system. Ask your accountant or tax adviser about anything that matters.
> You run it in your own Cloudflare account. Nuits does not receive, store or have access to your documents or data. You are responsible for your deployment, its security, its costs and the personal data in your receipts.
> To the extent permitted by applicable law, Bapusaheb Shankaragouda Patil / Nuits is not liable for any loss arising from use of the software. Nothing in this notice limits liability that cannot be limited by law.

## How it works

One Worker, server-rendered HTML, no cron jobs or queues:

- Originals go to a private R2 bucket; extracted rows go to D1.
- Extraction uses Cloudflare's Clairic model on Workers AI (`@cf/cloudflare/clairic`). Cloudflare labels it a **preview** model, so its availability, behaviour and price may change. VAT arithmetic is checked in code, and uncertain rows are marked for review.
- Each cost gets a product and an expense type from your vendor rules, falling back to Cloudflare's Clef model (`@cf/cloudflare/clef`).
- Bank rows from your CSV, XLSX or PDF statements are matched to receipts automatically, by exact amount, original currency, ECB estimate or a small tip, and obvious non-purchases (tax, bank fees, cash, own transfers) are marked for you. Foreign-currency receipts without a bank match get an ECB reference rate.
- Home shows the month: what still needs a check, which payments lack a receipt, and costs in EUR by product and type. It exports a CSV or a ZIP with every original and an index spreadsheet. Optionally it uploads the same files to a OneDrive folder.
- Five places, the same on a computer and a phone: **Home**, **Review** (what needs a check), **Receipts** (every document, plus invoices you sent), **Bank** (statements, matches and own-account transfers) and **Settings**.

## Deploy

### With the button

1. Click **Deploy to Cloudflare** above. Cloudflare copies this repository into your GitHub or GitLab account, lets you rename the Worker, the D1 database and the R2 bucket, and creates them in your account.
2. When asked for `NUITS_PASSWORD`, enter a password of at least 16 characters that you use nowhere else. Example values are refused.
3. Adjust the Worker variables if you like (sign-in name, products, the label on the export link). They are described in the [configuration reference](https://receipts.nuits.net/docs/reference/configuration/).
4. The build runs `bun run deploy`, which applies the database schema to the `DB` binding and then deploys. Open the `workers.dev` URL and sign in as `owner` (or the name you set).

The button does not set up email. Uploads work without it; see [Email](#email) to add it.

### By hand

Requires Bun 1.4.2 or later (or Node 20+ for the scripts) and a Cloudflare account.

```sh
bun install --frozen-lockfile
bunx wrangler login
bun run setup     # asks for names, senders and products, finds or creates D1, deploys, then asks for NUITS_PASSWORD
```

`bun run setup` writes your settings and resolved database ID to `wrangler.production.jsonc`, which is gitignored. Later deploys are `bun run deploy`. It refuses to reuse an existing database that holds other data, applies migrations before deploying, and stops if they fail. `bun run deploy -- --dry-run` checks and bundles without touching your account. Details: [Deploy from the command line](https://receipts.nuits.net/docs/how-to/deploy-from-the-command-line/).

### Email

Email is optional. It needs a domain on Cloudflare DNS with Email Routing and a **Send to a Worker** rule for your receipt address; only the senders you allow are read, and mail from anyone else waits in Review until you approve or ignore the sender. Follow [Set up email](https://receipts.nuits.net/docs/how-to/set-up-email/), and see [Forward a copy of incoming mail](https://receipts.nuits.net/docs/how-to/forward-a-copy-of-incoming-mail/) and [Keep sales invoices](https://receipts.nuits.net/docs/how-to/keep-sales-invoices/) for the optional extras.

## Use it

Add receipts, review what was read, import a bank CSV, check the suggested matches, then download the month for your accountant and press the "I've sent" button. [Your first month](https://receipts.nuits.net/docs/tutorials/your-first-month/) walks through it once with sample files; the [how-to guides](https://receipts.nuits.net/docs/how-to/) cover each step.

## Marketing site

The project's home page and `/privacy/` live in `site/`, a static Vite build with its own `package.json` and an assets-only `site/wrangler.jsonc` that also serves the demo video. You do not need it to run the app. To preview it: `cd site && bun install && bun run build && bun run preview`. The routes in `site/wrangler.jsonc` are the maintainer's domain, so change or remove them before deploying your own copy.

## Documentation site

The documentation is in `docs-site/`, a [Nimbus](https://nimbus-docs.com) (Astro) project served at <https://receipts.nuits.net/docs/>. `cd docs-site && bun install && bun run dev`; writing rules are in [docs-site/WRITING.md](docs-site/WRITING.md).

## Privacy and outside calls

- The app runs in your own Cloudflare account. Nuits never sees your data. There is no telemetry, analytics, update check, licence server or sign-up.
- **Cloudflare Workers AI** receives each document's text or image and its email context (for Clairic), and vendor and line-item context (for Clef). This happens under your Cloudflare account and terms.
- **Cloudflare Access** (optional, see [Protect the app with Cloudflare Access](https://receipts.nuits.net/docs/how-to/protect-the-app-with-cloudflare-access/)): in Access mode the Worker fetches your team's public signing keys from `https://<team>/cdn-cgi/access/certs`. Nothing is sent.
- **Frankfurter** (`https://api.frankfurter.dev/v2/rates`, ECB reference rates) receives a currency code and dates when a foreign-currency receipt needs a reference rate. No receipt content is sent.
- **Microsoft Graph** (optional, off unless configured, see [Upload the month to OneDrive](https://receipts.nuits.net/docs/how-to/upload-the-month-to-onedrive/)): only after you connect a Microsoft account in Settings, the Worker signs in at `login.microsoftonline.com` and uploads the month's receipt files and index spreadsheet to the OneDrive folder you chose, through `graph.microsoft.com`. Nothing is sent before you connect, and Disconnect deletes the stored sign-in. The month ZIP download makes no outside calls.
- **Logs:** Workers observability is on at 100% sampling (`wrangler.jsonc`). Logs stay in your Cloudflare account and contain request metadata and short reason codes, never receipt content. Lower `head_sampling_rate` if you prefer.
- No data residency or account confinement is promised beyond what your Cloudflare configuration provides.
- Receipts contain other people's personal data (sellers, staff names, partial card numbers, addresses). You are the controller of that data and decide how long to keep it.

## Limits, costs and troubleshooting

- [Limits](https://receipts.nuits.net/docs/reference/limits/): one user per deployment, file sizes and types, bank CSV formats, and the Cloudflare plan limits you may hit.
- [Running costs](https://receipts.nuits.net/docs/explanation/running-costs/): AI reading costs about 15 cents a month; plan on Workers Paid ($5 a month) if you upload PDFs. R2 needs a payment method on your Cloudflare account.
- [Troubleshoot](https://receipts.nuits.net/docs/how-to/troubleshoot/): including a first build that fails at the D1 migrations step.

## Develop

```sh
bun install --frozen-lockfile
cp .dev.vars.example .dev.vars   # set any NUITS_PASSWORD for local use
bun run migrate                  # local D1 only
bun run dev                      # http://localhost:8787, user "owner"
```

`bun run dev` uses `wrangler.local.jsonc`: local D1 and R2, no AI binding, `AI_MODE=mock`, synthetic `example.com` senders. It needs no Cloudflare sign-in.

```sh
bun run typecheck
bun run lint
bun run test          # Worker tests in workerd; AI and FX mocked, network forbidden
bun run test:scripts  # setup, deploy, schema and release tooling (bun test)
bun run smoke         # with `bun run dev` running: auth, upload, import, matching, export, email
```

`scripts/sample-receipts/` holds synthetic receipts and a synthetic bank CSV; none of it is real financial data. `bun run samples` regenerates them. Releases follow Conventional Commits: [docs/RELEASING.md](docs/RELEASING.md), [CHANGELOG.md](CHANGELOG.md). Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [How it works](https://receipts.nuits.net/docs/explanation/how-it-works/).

## License and trademarks

Apache License 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE). The licence does not grant rights to the "Nuits" or "Nuits Receipts" names (section 6); forks should use their own name.

Holvi, Nordea, OP, Revolut, Wise, N26 and other bank names are trademarks of their respective owners. Nuits Receipts is not affiliated with or endorsed by any of them.

Cloudflare, the Cloudflare logo, and Cloudflare Workers are trademarks and/or registered trademarks of Cloudflare, Inc. in the United States and other jurisdictions. Nuits Receipts is an independent project and is not affiliated with or endorsed by Cloudflare.
