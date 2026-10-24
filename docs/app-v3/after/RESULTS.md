# UX journey run

Instance: fresh local database, mock AI, 2026-10-24.

## Journeys

| Journey | Clicks | Field edits | Screens | POSTs with no feedback | Dead-end error pages | Errors fixed in place |
| --- | --- | --- | --- | --- | --- | --- |
| d. First run to first receipt read | 2 | 1 | 2 | 0 | 0 | 0 |
| a. Mail arrives, every receipt approved | 6 | 9 | 5 | 0 | 0 | 0 |
| b. Bank statement imported, every payment settled | 8 | 2 | 7 | 0 | 0 | 1 |
| e. Sales invoice added, money in matched | 6 | 1 | 5 | 0 | 0 | 0 |
| c. September closed and marked sent | 4 | 0 | 3 | 0 | 0 | 0 |

### d. First run to first receipt read

Screens: `/` → `/receipts/:id?done=uploaded`

- Welcome screen says: Welcome Business Done Email Done Accountant Set up Receipt (PDF or photo) Upload Add several Or forward to receipts@example.com
- Landed on /receipts/:id with title "Sample Cloud Lantern Oy"
- No accountant step on Home after the first receipt.

### a. Mail arrives, every receipt approved

Screens: `/` → `/review` → `/receipts/:id` → `/receipts/:id?done=approved` → `/review?done=approvedLast&month=2026-09&step=import`

- Home on arrival (current month): ‹ Sep October 2026 Nov › Check Nothing yet Match No statement Send Nothing yet Add receipts
- Review lists 3 receipts.
- Approved 3: Sample Coffee Corner, Sample Train Line, Sample Print Shop. Ended on /review.

### b. Bank statement imported, every payment settled

Screens: `/payments` → `/import` → `/imports/csv` → `/payments?month=2026-09&done=imported&inserted=6&skipped=0&replayed=0` → `/matches` → `/payments?month=2026-09&done=matched&tx=:id&rid=:id&name=DOMAINDESK*SAMPLE&kind=receipt` → `/payments?month=2026-09&done=notPurchase&tx=:id&name=Sample+Missing+Vendor`

Fixed in place: `/matches (422)`

- After import: 5 out, 3 matched, 2 missing
- Matching without the exception box: "Nothing was saved. This receipt and payment don't line up exactly. Tick the box to match them anyway. Go to it"
- Finally: 5 out, 4 matched, 0 missing

### e. Sales invoice added, money in matched

Screens: `/receipts` → `/invoices` → `/add?kind=sales` → `/payments` → `/payments?month=2026-09`

- After upload: /add says "Add receipts or invoices 1 of 1 added. They are being read now. What are these? Receipts and bills Things the business paid for Invoices you sent Money clients "
- Money-in row: Sample Client Oy EUR 125.50 25 Sep Invoice More

### c. September closed and marked sent

Screens: `/` → `/?month=2026-09` → `/?month=2026-09&done=sent`

- Home for September: ‹ Aug September 2026 Oct › Check Done Match Done Send Ready Spent EUR 250.22 Download ZIP (4 KB) Mark as sent CSV Check every row before sending this to your accountant. In the ZIP By part 6 receipts,
- Downloaded receipts-2026-09.zip

## Screens

| Screen | Width | Height (viewports) | axe violations |
| --- | --- | --- | --- |
| [receipt-flagged](screens/receipt-flagged-1440.png) | 1440 | 1.52 | 0 |
| [receipt-flagged](screens/receipt-flagged-390.png) | 390 | 2.09 | 0 |
| [home-sep](screens/home-sep-1440.png) | 1440 | 1.16 | 0 |
| [home-sep](screens/home-sep-390.png) | 390 | 1.37 | 0 |
| [home-oct](screens/home-oct-1440.png) | 1440 | 1 | 0 |
| [home-oct](screens/home-oct-390.png) | 390 | 1 | 0 |
| [review](screens/review-1440.png) | 1440 | 1 | 0 |
| [review](screens/review-390.png) | 390 | 1 | 0 |
| [receipts](screens/receipts-1440.png) | 1440 | 1.47 | 0 |
| [receipts](screens/receipts-390.png) | 390 | 1.61 | 0 |
| [receipt-ready](screens/receipt-ready-1440.png) | 1440 | 1 | 0 |
| [receipt-ready](screens/receipt-ready-390.png) | 390 | 1.16 | 0 |
| [invoice-paid](screens/invoice-paid-1440.png) | 1440 | 1.06 | 0 |
| [invoice-paid](screens/invoice-paid-390.png) | 390 | 1.59 | 0 |
| [bank](screens/bank-1440.png) | 1440 | 1.32 | 0 |
| [bank](screens/bank-390.png) | 390 | 1.36 | 0 |
| [import](screens/import-1440.png) | 1440 | 1.06 | 0 |
| [import](screens/import-390.png) | 390 | 1.42 | 0 |
| [add](screens/add-1440.png) | 1440 | 1 | 0 |
| [add](screens/add-390.png) | 390 | 1.06 | 0 |
| [invoices](screens/invoices-1440.png) | 1440 | 1 | 0 |
| [invoices](screens/invoices-390.png) | 390 | 1 | 0 |
| [settings](screens/settings-1440.png) | 1440 | 1 | 0 |
| [settings](screens/settings-390.png) | 390 | 1 | 0 |
