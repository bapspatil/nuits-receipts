# Prototype brief (UX v3)

Every prototype agent reads this file first. It is the contract; the plan is in `docs/app-v3/AUDIT.md` and `docs/app-v3/RESEARCH.md`.

## What these are

Throwaway static HTML that settles design questions before production code. Nothing here ships. The winning visual direction's `tokens.css` carries into `src/ui.ts`, so token names follow the contract below.

## Hard rules

- Plain HTML and CSS. No build step, no framework, no CDN, no web fonts from anywhere but the repo. Link the app fonts with `@font-face` from `../../../../site/public/fonts/bricolage.woff2` and `../../../../site/public/fonts/instrument-sans.woff2` (paths relative to `docs/app-v3/prototypes/<folder>/`).
- No JavaScript. The real app must work without it. Show different states as separate HTML files or as separate sections on one page, never with script.
- Every screen is one HTML file that works at 1440 and at 390 wide with media queries. Touch targets at least 44 px. Inputs at 16 px on phones.
- Text contrast at least 4.5:1 (3:1 only for text 24 px and up). No state by colour alone: every status carries its word. Visible focus on every interactive element.
- No em dash or en dash characters anywhere, in copy or comments. Check with `grep -rnP '\x{2014}|\x{2013}' docs/app-v3/prototypes`.
- No hex values outside `tokens.css`. Components read semantic tokens only.
- Keep the app's voice: deadpan, plain, sentence case, second person ("you", "your accountant"). Amounts as `EUR 125.50`, dates as `13 Sep` or `13 Sep 2026`. Buttons are verbs with objects ("Approve receipt", "Import 6 payments").
- The product is a data tool. No tax or accounting advice, no claims, no mascots, no emoji.

## Token contract

`tokens.css` has three layers in this order. Primitives are free to name. These semantic and component names are fixed so the app can swap directions:

```
Semantic: --surface-page --surface-raised --surface-sunken --text --text-muted --text-on-accent
          --border --border-strong --accent --accent-hover --danger --danger-surface
          --success --success-surface --focus-ring
          --font-display --font-ui --font-mono
          --text-xs --text-sm --text-md --text-lg --text-xl --text-2xl
          --space-1 (4px) --space-2 (8) --space-3 (12) --space-4 (16) --space-5 (24) --space-6 (32) --space-7 (48) --space-8 (64)
          --radius-sm --radius-md --radius-pill --shadow-raised
Component: --btn-primary-bg --btn-primary-text --btn-height --nav-height --tabbar-height
          --stamp-needs --stamp-ok --stamp-missing --field-height --row-height
```

Also write `tokens.json` in the `site/tokens.json` format (`color.<name>.hex`, `surface`, `textOn`) for the colours you use, so `node site/scripts/check-contrast.mjs docs/app-v3/prototypes/<folder>/tokens.json` measures every text pair you claim. It must pass. A dark theme, if your direction has one, goes in the same file under `@media (prefers-color-scheme: dark)` and its pairs go in a second `tokens-dark.json`.

## The data (use exactly this)

App name "Nuits Receipts". Accountant label "Example Accounting Oy". Parts of the business: General, App, Website, Hosting. Kinds: infra, AI APIs, subscriptions, other. Nav: Home, Review, Receipts, Bank, Settings (Review shows a count badge). Footer: "Check every figure. Not tax or accounting advice. No warranty. Not affiliated with Cloudflare or any bank." and "Nuits Receipts v1.5.0".

September 2026 receipts (read by the reader from email):

| Seller | No. | Date | Total | Before VAT | VAT | VAT % | State |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sample Cloud Lantern Oy | SAMPLE-1001 | 4 Sep | EUR 125.50 | 100.00 | 25.50 | 25.5 | Ready, matched to bank automatically |
| Sample Mail Meadow Oy | SAMPLE-1003 | 6 Sep | EUR 50.20 | 40.00 | 10.20 | 25.5 | Ready, matched automatically |
| Sample Domain Desk | SAMPLE-1004 | 12 Sep | EUR 12.00 | 12.00 | 0.00 | 0 | Ready, not matched (bank says DOMAINDESK*SAMPLE on 13 Sep) |
| Sample Coffee Corner | SAMPLE-1005 | no date | EUR 9.12 | 8.00 | 1.12 | 14 | Needs you: no date |
| Sample Train Line | none | 15 Sep | EUR 23.40 | empty | empty | empty | Needs you: before VAT, VAT and receipt number missing |
| Sample Print Shop | none | 18 Sep | empty | empty | empty | empty | Needs you: no amounts, no currency, no number |

The reader's text of the Print Shop receipt (show it as the document, it is what the person reads from): `SAMPLE PRINT SHOP / Receipt / 18.09.2026 / 2 x A2 poster print 30,00 EUR / incl. VAT 25.5% 6,10 / Total 30,00 EUR / Paid by card`.

September bank statement (Bank account, Holvi, imported 24 Oct):

| Date | Paid to | Amount | State |
| --- | --- | --- | --- |
| 7 Sep | Sample Cloud Lantern Oy | EUR -125.50 | Matched automatically |
| 8 Sep | Sample Mail Meadow Oy | EUR -50.20 | Matched automatically |
| 13 Sep | DOMAINDESK*SAMPLE | EUR -12.00 | Missing. Likely: Sample Domain Desk, 12 Sep, EUR 12.00 (seller name differs, 1 day apart) |
| 16 Sep | Sample Train Line | EUR -23.40 | Missing. Its receipt still needs you |
| 20 Sep | Sample Missing Vendor | EUR -9.99 | Missing. No receipt anywhere |
| 25 Sep | Sample Client Oy | EUR 125.50 | Money in. Matched to invoice INV-2026-001 |

Month state for September: Check 3 to go (1 undated), Match 3 missing, Send not ready. Spent so far EUR 211.10 (one receipt not counted, no euro amount yet). Ready-to-send state (for `send.html`): all checked, all matched, EUR 250.22 spent, 6 receipts and 1 invoice, ZIP 4 KB, not sent yet.

## Screens (visual directions)

Each direction folder holds `tokens.css`, `tokens.json`, `NOTES.md` (the idea in five sentences, what it trades away, contrast results pasted from the script), and four screens:

1. `home.html`: September, mid-close. Month switcher, the three steps (Check, Match, Send) with their state, the single next action, the spend summary.
2. `review.html`: the Sample Print Shop receipt needing you. The document next to the fields. Fields the reader got are prefilled and marked as read; the flagged ones (total, before VAT, VAT, VAT %, currency) are the work, and the optional one (receipt number) is visibly lower priority than the required ones. One primary "Approve receipt", progress "3 of 3 to check", a quieter Discard and More.
3. `bank.html`: September, the missing rows first. The likely match for DOMAINDESK as a one-click choice that explains the difference ("seller name differs, 1 day apart"), the Train Line row explaining its receipt needs checking first, the no-receipt row with "Not a purchase" and "Add receipt". Matched rows say whether we matched them or you did.
4. `send.html`: September ready to send. One primary action (Download for Example Accounting Oy), then "Did you send it?" to mark sent; the file list folded.

## Interaction variants (separate folder `interaction/`)

Built in the current v1.5 look (copy the CSS from the app via `docs/app-v3/baseline/screens/*` as reference and from `src/ui.ts` `styles()`), so they compare behaviour, not looks. Files and the question each answers are listed in that folder's brief section of `docs/app-v3/AUDIT.md` (Ideate).
