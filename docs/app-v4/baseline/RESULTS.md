# UX journey run

Instance: fresh local database, mock AI, 2026-10-30.

## Journeys

| Journey | Clicks | Field edits | Screens | POSTs with no feedback | Dead-end error pages | Errors fixed in place |
| --- | --- | --- | --- | --- | --- | --- |
| d. First run to first receipt read | 5 | 2 | 5 | 0 | 0 | 0 |
| a. Mail arrives, every receipt approved | 6 | 9 | 5 | 0 | 0 | 0 |
| b. Bank statement imported, every payment settled | 5 | 1 | 5 | 0 | 0 | 0 |
| e. Sales invoice added, money in matched | 5 | 1 | 4 | 0 | 0 | 0 |
| c. September closed and marked sent | 3 | 0 | 2 | 0 | 0 | 0 |
| f. Busy month | 8 | 0 | 6 | 0 | 0 | 0 |

### d. First run to first receipt read

Screens: `/` → `/receipts/:id?done=uploaded` → `/` → `/settings` → `/settings?done=settingsSaved&group=accountant`

- Welcome screen says: Welcome Finish setting up 1 of 5 done DONE: Business name added So invoices you send are told apart from receipts. NEXT: Confirm Email Routing in Cloudflare The
- Landed on /receipts/:id with title "Sample Cloud Lantern Oy"
- Home after the first receipt: Finish setting up 1 of 5 done DONE: Business name added So invoices you send are told apart from receipts. NEXT: Confirm Email Routing in Cloudflare Then forward one receipt to check it. Any email that reaches the app co
- Saved: Saved your accountant.

### a. Mail arrives, every receipt approved

Screens: `/` → `/review` → `/receipts/:id` → `/receipts/:id?done=approved` → `/review?done=approvedLast&month=2026-09&step=import`

- Home on arrival (oldest month not sent): ‹ Aug 2026 September 2026 Oct 2026 › Finish setting up 3 of 5 done DONE: Business name added So invoices you send are told apart from receipts. DONE: Email Routing confirmed An email reached the app, 
- Review lists 3 receipts.
- Approved 3: Sample Coffee Corner, Sample Train Line, Sample Print Shop. Ended on /review.

### b. Bank statement imported, every payment settled

Screens: `/payments` → `/import` → `/imports/csv` → `/payments?month=2026-09&done=imported&inserted=6&skipped=0&replayed=0&auto=4&np=0&missing=1` → `/payments?month=2026-09&done=notPurchase&tx=:id&name=Sample+Missing+Vendor`

- After import: 5 out, 4 matched, 0 not a purchase, 1 missing
- Import banner: Added 6 payments. Paid out: 4 matched, 0 not a purchase, 1 missing. See them
- Finally: 5 out, 4 matched, 1 not a purchase, 0 missing

### e. Sales invoice added, money in matched

Screens: `/receipts` → `/invoices` → `/add?kind=sales` → `/payments`

- After upload: /add says "Add receipts or invoices 1 of 1 added. They are being read now. What are these? Receipts and bills Things the business paid for Invoices you sent Money clients "
- Money-in row: Select Sample Client Oy, 25 Sep Sample Client Oy EUR 125.50 25 Sep Matched automatically Invoice More

### c. September closed and marked sent

Screens: `/` → `/?month=2026-09&done=sent&at=2026-10-30T09%3A22%3A44.185Z`

- Home on arrival (September, the oldest month not sent): ‹ Aug 2026 September 2026 Oct 2026 › September isn't sent yet. It is ready to send. · Go to October DONE: Check All checked DONE: Match All matched NEXT: Send Ready Spent EUR 250.22 Download ZIP (4 KB
- Downloaded receipts-2026-09.zip

### f. Busy month

Screens: `/payments?month=2026-08&view=todo` → `/payments?month=2026-08&show=missing` → `/payments?month=2026-08&show=missing&done=notPurchaseMany&n=25` → `/receipts?view=todo` → `/review` → `/review?done=approvedMany&n=19&skipped=22`

- Bank To do: 25 selected, 0 rows after, 35 still open.

Checks: 3 of 12 passed.
- MISS: Bank has a To do list (data-list="bank-todo")
- MISS: Bank To do counts all 60 open payments (data-total=null)
- MISS: Bank To do shows the first 50 of 60 open payments (shows 25)
- MISS: Bank To do refills to 35 rows after 25 are resolved (shows 0)
- MISS: Bank does not say every payment has a receipt while 35 are open
- MISS: Scroll stays put (2546 to 0 px)
- MISS: Focus is inside the next open row
- MISS: Receipts has a To do list (data-list="receipts-todo")
- MISS: The banner offers Undo

## Screens

| Screen | Width | Height (viewports) | axe violations |
| --- | --- | --- | --- |
| [receipt-flagged](screens/receipt-flagged-1440.png) | 1440 | 1.45 | 0 |
| [receipt-flagged](screens/receipt-flagged-390.png) | 390 | 2.15 | 0 |
| [home-sep](screens/home-sep-1440.png) | 1440 | 1.16 | 0 |
| [home-sep](screens/home-sep-390.png) | 390 | 1.49 | 0 |
| [home-arrival](screens/home-arrival-1440.png) | 1440 | 1.2 | 0 |
| [home-arrival](screens/home-arrival-390.png) | 390 | 1.57 | 0 |
| [home-oct](screens/home-oct-1440.png) | 1440 | 1 | 0 |
| [home-oct](screens/home-oct-390.png) | 390 | 1 | 0 |
| [review](screens/review-1440.png) | 1440 | 1 | 0 |
| [review](screens/review-390.png) | 390 | 1 | 0 |
| [receipts](screens/receipts-1440.png) | 1440 | 1.38 | 0 |
| [receipts](screens/receipts-390.png) | 390 | 1.57 | 0 |
| [receipt-ready](screens/receipt-ready-1440.png) | 1440 | 1 | 0 |
| [receipt-ready](screens/receipt-ready-390.png) | 390 | 1.27 | 0 |
| [invoice-paid](screens/invoice-paid-1440.png) | 1440 | 1.02 | 0 |
| [invoice-paid](screens/invoice-paid-390.png) | 390 | 1.67 | 0 |
| [bank](screens/bank-1440.png) | 1440 | 1.33 | 0 |
| [bank](screens/bank-390.png) | 390 | 1.57 | 0 |
| [import](screens/import-1440.png) | 1440 | 1.03 | 0 |
| [import](screens/import-390.png) | 390 | 1.44 | 0 |
| [add](screens/add-1440.png) | 1440 | 1 | 0 |
| [add](screens/add-390.png) | 390 | 1.08 | 0 |
| [invoices](screens/invoices-1440.png) | 1440 | 1 | 0 |
| [invoices](screens/invoices-390.png) | 390 | 1 | 0 |
| [settings](screens/settings-1440.png) | 1440 | 1 | 0 |
| [settings](screens/settings-390.png) | 390 | 1.04 | 0 |
| [settings-mail](screens/settings-mail-1440.png) | 1440 | 1.16 | 0 |
| [settings-mail](screens/settings-mail-390.png) | 390 | 1.31 | 0 |
| [bank-likely](screens/bank-likely-1440.png) | 1440 | 2.61 | 0 |
| [bank-likely](screens/bank-likely-390.png) | 390 | 2.76 | 0 |
| [help](screens/help-1440.png) | 1440 | 1.58 | 0 |
| [help](screens/help-390.png) | 390 | 2.24 | 0 |
| [help-flags](screens/help-flags-1440.png) | 1440 | 1.78 | 0 |
| [help-flags](screens/help-flags-390.png) | 390 | 2.55 | 0 |
| [home-setup](screens/home-setup-1440.png) | 1440 | 1.6 | 0 |
| [home-setup](screens/home-setup-390.png) | 390 | 2.01 | 0 |
| [busy-receipts-todo](screens/busy-receipts-todo-1440.png) | 1440 | 5.16 | 0 |
| [busy-receipts-todo](screens/busy-receipts-todo-390.png) | 390 | 5.52 | 0 |
| [busy-bank-todo](screens/busy-bank-todo-1440.png) | 1440 | 6.99 | 0 |
| [busy-bank-todo](screens/busy-bank-todo-390.png) | 390 | 7.85 | 0 |
