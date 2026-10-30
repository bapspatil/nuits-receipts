# The Mix look, after PR 11

Paper look on the Native layout, with glass from our own CSS. The shots come from the busy dev seed, with a few rows ticked so the bulk bar shows.

| Screen          | 1440                                                 | 390                                                |
| --------------- | ---------------------------------------------------- | -------------------------------------------------- |
| Receipts, To do | [receipts-todo-1440](screens/receipts-todo-1440.png) | [receipts-todo-390](screens/receipts-todo-390.png) |
| A receipt       | [receipt-1440](screens/receipt-1440.png)             | [receipt-390](screens/receipt-390.png)             |
| Bank, To do     | [bank-todo-1440](screens/bank-todo-1440.png)         | [bank-todo-390](screens/bank-todo-390.png)         |

ui-lint: 2 findings, down from 86 in the baseline. Text contrast: 0. Details are in [ui-lint.json](ui-lint.json).

## How it differs from the mockup, and why

- **Stamps are 12px, not 11px.** 12px is the smallest type size the app allows, and ui-lint checks it.
- **On phones the brand header is hidden.** The glass tab capsule takes over navigation, so the bar at the top would only repeat it.
- **Bank keeps Search, Match and Not a purchase under the row**, not in the actions column. They are forms with inputs, and the column has room for More only.
- **A matched transaction that still needs checking shows one stamp.** It reads Matched with a "Check the receipt" link. The mockup had a second Needs you stamp, but each row holds only one STATUS badge.
- **To do rows have no Approve or Discard buttons.** The mockup shows them on each row, but no row holds a primary and list semantics stay as they are. The bulk bar and the receipt page carry those actions.
- **The whole row is the link.** The title link stretches over the row; the checkbox, status and actions sit above it.
- **No column heads.** Each row labels its own parts, and the heads were only read out as noise.
- **The grain is not on the document panel.** It sits on a fixed layer that the pointer and axe skip, so contrast can still be measured. A background image on the text would hide it.
- **The tab bar labels have a ui-lint exception for contrast.** The tool can't measure through translucent glass. Instead, the glass alpha (0.85) is the lowest value at which ink, muted, petrol and success text pass 4.5:1 over the darkest backdrop, and `scripts/app-tokens.test.ts` checks it.
- **The Mark paid control's accessible name starts with its visible text** ("Mark paid: Seller") so speech input can find it.
- **The vendor rules list keeps its expandable rows** until the Settings restructure in PR 12.

## Left as it was

- The two remaining ui-lint findings are the font size of `.setup h2 span`. They were in the baseline too.
- Only Chromium was checked. Safari, where `-webkit-backdrop-filter` matters, was not.
