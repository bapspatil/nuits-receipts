# UX v3, Empathize: personas, jobs and journey maps

Base: v1.5.0 (`df39e01`). Evidence is expert evaluation, not observed users: a cognitive walkthrough of five journeys run by `scripts/ux-journeys.mjs` on a fresh local instance with mock reading, plus a heuristic review of the code. Every number below comes from [`baseline/RESULTS.md`](baseline/RESULTS.md); rerun with `node scripts/ux-journeys.mjs --out docs/app-v3/baseline`.

## Personas

**The owner-operator (primary).** Runs a small company and their own copy of the app. A few dozen receipts a month, one or two bank accounts, one accountant. Works in bursts: forwards receipts as they come, then sits down once, early the next month, to finish the previous month. Knows the app and wants the monthly close to take minutes. Main fears: sending the accountant a wrong month, and the app changing something without saying so.

**The new self-hoster (secondary).** Found the project on GitHub or Product Hunt, pressed Deploy to Cloudflare, signed in for the first time. No bank account set up, no Email Routing, no idea what "Part", "Kind" or "Not exact, still this" mean. Wants to see one receipt read correctly before investing more time.

## Jobs, by frequency

| Job | Who | How often | Journey |
| --- | --- | --- | --- |
| Get receipts in | owner | continuous, passive (email) | a |
| Fix what the reader couldn't read | owner | a few a week, mostly at month end | a |
| Bring in the bank statement and settle every payment | owner | monthly | b |
| Record invoices sent and see them paid | owner | monthly | e |
| Send the month to the accountant | owner | monthly | c |
| Set up and see the first receipt read | self-hoster | once | d |

## Journey maps (measured on v1.5.0)

### a. Mail arrives, every receipt approved. 8 clicks, 9 field edits, 5 screens

| Stage | What they do | What they think | Pain |
| --- | --- | --- | --- |
| Arrive (early October) | Open Home | "What's left for September?" | Home shows **October**: "Check: Nothing yet". September's 3 waiting receipts are only a badge on the nav. |
| Find the work | Review, open the first | "Three to go." | Fine. |
| Fix | Read the original, type the missing numbers | "What does it say?" | Email receipts have no document beside the fields, only "Open original" (a new tab). A receipt number "No receipt number." is as red as a missing total. Fields like VAT % sit in a closed "All fields". |
| Approve | Approve | | Approve moves to the next receipt and says "Approved." Good. |
| Finish | Approve the last one | "Done?" | Lands on an empty Review with no confirmation. |

### b. Bank statement imported, every payment settled. 9 clicks, 3 edits, 7 screens, 1 dead end

| Stage | What they do | What they think | Pain |
| --- | --- | --- | --- |
| Import | Bank, Import statement, choose file, Check the file, Import 6 payments | "Is this the right file?" | Good wizard; "Import done: 6 inserted, 0 skipped, 0 replayed" is system wording. |
| Review the automatic matches | Scan the list | "Did it match these, or did I?" | Automatic and manual matches look the same ("✓ Receipt"). |
| Match the likely one | Pick "Sample Domain Desk" for DOMAINDESK*SAMPLE, Match | "That's obviously it." | **Dead end**: a full error page "Confirm match exceptions". The box "Not exact, still this" sits on every row, and nothing says why this pair isn't exact (seller name differs, one day apart). Go back, choose again, tick, Match. |
| Settle the rest | Not a purchase | | No confirmation, no undo. |

### e. Sales invoice added, money in matched. 6 clicks, 1 edit

| Stage | What they do | What they think | Pain |
| --- | --- | --- | --- |
| Find where invoices go | Receipts, Invoices, Add invoice | "Where do invoices live?" | Invoices are a link inside Receipts; three clicks before the upload. |
| Upload | Add files | | "1 of 1 added. They are being read now." No link to the invoice, no refresh. |
| See it paid | Bank, back to September | "Was it paid?" | It was matched automatically and nothing said so. |

### c. September closed and marked sent. 4 clicks

| Stage | What they do | What they think | Pain |
| --- | --- | --- | --- |
| Open the month | Home, ‹ Sep | | Home opens on the current month, again. |
| Send | Download ZIP, send it outside the app, Mark as sent | "Did I mark it?" | Downloading does not ask whether it was sent; the person must remember to come back. |

### d. First run to first receipt read. 2 clicks, 1 edit

| Stage | What they do | What they think | Pain |
| --- | --- | --- | --- |
| Arrive | Home shows Welcome: Business Done, Email Done, Accountant Set up, an upload | "Nice, short." | |
| First receipt | Upload sample.pdf | "It read it!" | No confirmation, lands on the receipt. **The Welcome checklist disappears** after the first receipt even though Accountant is still not set up, so the person never sees it again. Bank account and Email Routing are not on the list at all. |

## Screens (measured)

All 11 screens pass axe (WCAG 2.2 A and AA rules) with 0 violations at 1440 and 390. Heights in viewports: everything fits in about 1.5 viewports at 390 except the paid invoice page (3.09 at 390, 2.26 at 1440, all 19 fields open).
