# UX journey run

Instance: fresh local database, mock AI, 2026-10-30.

## Journeys

| Journey | Clicks | Field edits | Screens | POSTs with no feedback | Dead-end error pages | Errors fixed in place |
| --- | --- | --- | --- | --- | --- | --- |
| d. First run to first receipt read | 5 | 2 | 5 | 0 | 0 | 0 |
| a. Mail arrives, every receipt approved | 6 | 9 | 6 | 0 | 0 | 0 |
| b. Bank statement imported, every payment settled | 4 | 1 | 4 | 0 | 0 | 0 |
| e. Sales invoice added, money in matched | 7 | 1 | 6 | 0 | 0 | 0 |
| c. September closed and marked sent | 3 | 0 | 2 | 0 | 0 | 0 |
| f. Busy month | 8 | 0 | 6 | 1 | 0 | 0 |

### d. First run to first receipt read

Screens: `/` → `/receipts/:id?done=uploaded` → `/` → `/settings` → `/settings?done=settingsSaved&group=accountant`

- Welcome screen says: Welcome Finish setting up 1 of 5 done NEXT: Confirm Email Routing in Cloudflare Then forward one receipt to check it. Any email that reaches the app completes t
- Landed on /receipts/:id with title "Sample Cloud Lantern Oy"
- Home after the first receipt: Finish setting up 1 of 5 done NEXT: Confirm Email Routing in Cloudflare Then forward one receipt to check it. Any email that reaches the app completes this. TO DO: Name your accountant So each month says who it goes to. 
- Saved: Saved your accountant.

### a. Mail arrives, every receipt approved

Screens: `/` → `/receipts?view=todo&month=2026-09` → `/receipts/:id?from=todo&month=2026-09` → `/receipts/:id?from=todo&month=2026-09&done=approved&at=2026-10-30T21%3A20%3A44.563Z&op=approve&name=Sample+Coffee+Corner` → `/receipts/:id?from=todo&month=2026-09&done=approved&at=2026-10-30T21%3A20%3A45.055Z&op=approve&name=Sample+Train+Line` → `/receipts?view=todo&month=2026-09&done=approvedLast&month=2026-09&step=import&at=2026-10-30T21%3A20%3A45.421Z&op=approve&name=Sample+Print+Shop`

- Home on arrival (oldest month not sent): Aug 2026 September 2026 Oct 2026 Finish setting up 3 of 5 done NEXT: Add your bank account So payments from your statement have a home. TO DO: Import your first bank statement So the app can match pay
- Receipts To do lists 4 receipts.
- Approved 3: Sample Coffee Corner, Sample Train Line, Sample Print Shop. Ended on /receipts.

### b. Bank statement imported, every payment settled

Screens: `/payments` → `/import` → `/payments?month=2026-09&done=imported&inserted=6&skipped=0&replayed=0&auto=4&np=0&missing=1&anyway=0&similar=0&imp=:id&at=2026-10-30T21%3A20%3A46.391Z&op=import` → `/payments?month=2026-09&view=todo&done=notPurchase&name=Sample+Missing+Vendor&at=2026-10-30T21%3A20%3A46.542Z&op=exempt`

- After import: 5 out, 4 matched, 0 not a purchase, 1 missing
- Import banner: Added 6 payments. Paid out: 4 matched, 0 not a purchase, 1 missing. See them Undo
- Finally: 5 out, 4 matched, 1 not a purchase, 0 missing

### e. Sales invoice added, money in matched

Screens: `/receipts` → `/receipts?view=all` → `/receipts?view=all&kind=sales` → `/add?kind=sales` → `/payments` → `/payments?month=2026-09&view=all`

- After upload: /add says "‹ Invoices Add receipts or invoices 1 of 1 added. They are being read now. What are these? Receipts and bills Things the business paid for Invoices you sent Mon"
- Money-in row: Select Sample Client Oy, 25 Sep 25 Sep Sample Client Oy MATCHED Invoice EUR 125.50 More

### c. September closed and marked sent

Screens: `/` → `/?month=2026-09&done=sent&at=2026-10-30T21%3A20%3A50.439Z`

- Home on arrival (September, the oldest month not sent): Aug 2026 September 2026 Oct 2026 September isn't sent yet. It is ready to send. · Go to October DONE: Check All checked DONE: Match All matched NEXT: Send Ready Spent EUR 250.22 Download ZIP (4 KB) CS
- Downloaded receipts-2026-09.zip

### f. Busy month

Screens: `/payments?month=2026-08&view=todo` → `/payments?month=2026-08&view=todo&done=notPurchaseMany&n=50&at=2026-10-30T21%3A21%3A17.047Z&op=exempt` → `/receipts?view=todo` → `/receipts?view=todo&done=approvedMany&n=11&at=2026-10-30T21%3A21%3A17.408Z&op=approve&skipped=22` → `/receipts?view=todo&done=undone&op=approve&n=11` → `/receipts?view=todo`

No feedback after: `/receipts?view=todo`

- Bank To do: 50 selected, 10 rows after, 10 still open.

Checks: 21 of 21 passed.

## Screens

| Screen | Width | Height (viewports) | axe violations |
| --- | --- | --- | --- |
| [receipt-flagged](screens/receipt-flagged-1440.png) | 1440 | 1.62 | 0 |
| [receipt-flagged](screens/receipt-flagged-390.png) | 390 | 2.37 | 0 |
| [home-sep](screens/home-sep-1440.png) | 1440 | 1.18 | 0 |
| [home-sep](screens/home-sep-390.png) | 390 | 1.66 | 0 |
| [home-arrival](screens/home-arrival-1440.png) | 1440 | 1.22 | 0 |
| [home-arrival](screens/home-arrival-390.png) | 390 | 1.73 | 0 |
| [home-oct](screens/home-oct-1440.png) | 1440 | 1 | 0 |
| [home-oct](screens/home-oct-390.png) | 390 | 1 | 0 |
| [receipts-todo](screens/receipts-todo-1440.png) | 1440 | 1 | 0 |
| [receipts-todo](screens/receipts-todo-390.png) | 390 | 1 | 0 |
| [receipts](screens/receipts-1440.png) | 1440 | 1.4 | 0 |
| [receipts](screens/receipts-390.png) | 390 | 1.68 | 0 |
| [receipt-ready](screens/receipt-ready-1440.png) | 1440 | 1.62 | 0 |
| [receipt-ready](screens/receipt-ready-390.png) | 390 | 2.37 | 0 |
| [invoice-paid](screens/invoice-paid-1440.png) | 1440 | 1.11 | 0 |
| [invoice-paid](screens/invoice-paid-390.png) | 390 | 1.81 | 0 |
| [bank](screens/bank-1440.png) | 1440 | 1.13 | 0 |
| [bank](screens/bank-390.png) | 390 | 1.68 | 0 |
| [import](screens/import-1440.png) | 1440 | 1 | 0 |
| [import](screens/import-390.png) | 390 | 1 | 0 |
| [add](screens/add-1440.png) | 1440 | 1 | 0 |
| [add](screens/add-390.png) | 390 | 1.27 | 0 |
| [invoices](screens/invoices-1440.png) | 1440 | 1 | 0 |
| [invoices](screens/invoices-390.png) | 390 | 1.07 | 0 |
| [settings](screens/settings-1440.png) | 1440 | 1 | 0 |
| [settings](screens/settings-390.png) | 390 | 1.04 | 0 |
| [settings-mail](screens/settings-mail-1440.png) | 1440 | 1.98 | 0 |
| [settings-mail](screens/settings-mail-390.png) | 390 | 2.66 | 0 |
| [bank-likely](screens/bank-likely-1440.png) | 1440 | 2.58 | 0 |
| [bank-likely](screens/bank-likely-390.png) | 390 | 3.22 | 0 |
| [help](screens/help-1440.png) | 1440 | 2.18 | 0 |
| [help](screens/help-390.png) | 390 | 3.15 | 0 |
| [help-flags](screens/help-flags-1440.png) | 1440 | 2.38 | 0 |
| [help-flags](screens/help-flags-390.png) | 390 | 3.46 | 0 |
| [home-setup](screens/home-setup-1440.png) | 1440 | 1.42 | 0 |
| [home-setup](screens/home-setup-390.png) | 390 | 1.92 | 0 |
| [busy-receipts-todo](screens/busy-receipts-todo-1440.png) | 1440 | 3.41 | 0 |
| [busy-receipts-todo](screens/busy-receipts-todo-390.png) | 390 | 4.91 | 0 |
| [busy-bank-todo](screens/busy-bank-todo-1440.png) | 1440 | 15.15 | 0 |
| [busy-bank-todo](screens/busy-bank-todo-390.png) | 390 | 22.31 | 0 |
