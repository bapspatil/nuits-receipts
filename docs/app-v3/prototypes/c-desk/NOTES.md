# Direction C, Paper desk

## The idea

The receipt slip is the main object on every screen: white paper, a torn foot, the brand's petrol ink and cheque-paper mint. On Review the receipt is printed line by line and each field sits in the margin on the same row as the line it came from, so "Total 30,00 EUR" is level with the Total field. Fields the reader got are highlighted mint on the receipt and carry a READ tag with "from line N"; required gaps are underlined in stamp red on the receipt and sit in a red-ruled card marked Required; the optional receipt number is a dashed, quieter card marked Optional. Status is always a rubber stamp with words: Needs you, Missing, Matched automatically, Matched by you, Ready, Not ready, Sent. Home is the month as a stack of slips with one next action, and Bank is a printed statement with stamps in its right margin and a tally of stamps at the foot.

## What each screen answers

- `home.html` (F1, F20). Opens on September with the line "September is the oldest month you haven't sent, so it opens first". August carries a Sent stamp in the switcher. One ink button, "Check 3 receipts". The three steps sit below it with stamps (Needs you, 3 missing, Not ready). Spend tally and the pile of six slips sit beside it, the three that need you on top.
- `review.html` (F10, F12). At 1440 the receipt and the fields share rows. At 390 the fields drop in under their own line inside the slip, so the phone view is the document itself and not a thumbnail. Required fields read "Required" in red with a red rule. The optional field is dashed and muted and never red. Read fields have a mint READ tag and the line they came from. One primary "Approve receipt", then a quiet Discard and a More fold. Progress reads "3 of 3 to check".
- `bank.html` (F3, F9). The missing rows come first on a red wash. DOMAINDESK shows the likely receipt with Same and Differs tags for amount, date (1 day apart) and seller name, plus one button, "Match to Sample Domain Desk". There is no exception checkbox: the line "Matching it accepts those two differences" does that job. Train Line points to its receipt. Missing Vendor offers Add receipt and Not a purchase. Matched rows are stamped Matched automatically, and the import banner says the app made those decisions. State 2 below shows the row after the click, stamped Matched by you, with Undo in the banner.
- `send.html`. A cover slip for Example Accounting Oy with All checked and All matched stamps, a dotted-leader tally (6 receipts, 1 invoice, 4 KB, EUR 250.22) and one primary "Download for Example Accounting Oy". The file list is folded. "Did you send it?" sits on its own slip with "Mark September as sent". State 2 shows the Sent stamp.

## What it trades away

- Density. Rows on Review are as tall as their field card, so the printed receipt on desktop gets uneven gaps between lines. A real receipt with 30 line items would stretch further, and the line-to-field mapping relies on the reader returning line positions, which it may not do today.
- Bank on a phone is 3.60 viewports including the State 2 demo section, and about 3.0 without it. That is at the edge of the "under 3 viewports" target, because each missing row carries its explanation open.
- No dark theme. The direction is a piece of paper, the same choice the site made.
- The phone nav is a row under the brand, not a bottom tab bar. A sticky bottom bar draws over content in full-page screenshots, so the prototype leaves it out. The production app can keep its fixed tab bar unchanged.
- The brand has no monospace face, so `--font-mono` is Instrument Sans and figures use `tabular-nums`.

## Files

`tokens.css` holds every hex, in three layers (primitives, the fixed semantic contract, components). `desk.css` holds the shared components (slips, torn feet, stamps, buttons, nav) and reads semantic tokens only. Each screen keeps its layout in a `<style>` block. There is no JavaScript. Other states are shown as labelled "State 2" sections.

## Contrast

`node site/scripts/check-contrast.mjs docs/app-v3/prototypes/c-desk/tokens.json`

```

Contrast against each surface, from docs/app-v3/prototypes/c-desk/tokens.json

  on ink (#0D3A36)
    slip          12.53:1   AAA body text
    onStamp       12.53:1   AAA body text
    stampWash     10.88:1   AAA body text
    paper         10.68:1   AAA body text
    desk           9.74:1   AAA body text
    guilloche      8.34:1   AAA body text
    mint           7.47:1   AAA body text
    stamp          1.68:1   fills and decoration only
    inkSoft        1.55:1   fills and decoration only

  on paper (#E6EFE9)
    ink           10.68:1   AAA body text
    inkSoft        6.88:1   AA body text
    stamp          6.34:1   AA body text
    mint           1.43:1   fills and decoration only
    guilloche      1.28:1   fills and decoration only
    slip           1.17:1   fills and decoration only
    onStamp        1.17:1   fills and decoration only
    desk           1.10:1   fills and decoration only
    stampWash      1.02:1   fills and decoration only

  on desk (#D9E6DE)
    ink            9.74:1   AAA body text
    inkSoft        6.28:1   AA body text
    stamp          5.78:1   AA body text
    mint           1.30:1   fills and decoration only
    slip           1.29:1   fills and decoration only
    onStamp        1.29:1   fills and decoration only
    guilloche      1.17:1   fills and decoration only
    stampWash      1.12:1   fills and decoration only
    paper          1.10:1   fills and decoration only

  on slip (#FFFFFF)
    ink           12.53:1   AAA body text
    inkSoft        8.08:1   AAA body text
    stamp          7.44:1   AAA body text
    mint           1.68:1   fills and decoration only
    guilloche      1.50:1   fills and decoration only
    desk           1.29:1   fills and decoration only
    paper          1.17:1   fills and decoration only
    stampWash      1.15:1   fills and decoration only
    onStamp        1.00:1   fills and decoration only

  on guilloche (#C2D8CB)
    ink            8.34:1   AAA body text
    inkSoft        5.38:1   AA body text
    stamp          4.95:1   AA body text
    slip           1.50:1   fills and decoration only
    onStamp        1.50:1   fills and decoration only
    stampWash      1.30:1   fills and decoration only
    paper          1.28:1   fills and decoration only
    desk           1.17:1   fills and decoration only
    mint           1.12:1   fills and decoration only

  on mint (#9FD3BC)
    ink            7.47:1   AAA body text
    inkSoft        4.82:1   AA body text
    stamp          4.43:1   large text and indicators only
    slip           1.68:1   fills and decoration only
    onStamp        1.68:1   fills and decoration only
    stampWash      1.46:1   fills and decoration only
    paper          1.43:1   fills and decoration only
    desk           1.30:1   fills and decoration only
    guilloche      1.12:1   fills and decoration only

  on stamp (#A8123F)
    slip           7.44:1   AAA body text
    onStamp        7.44:1   AAA body text
    stampWash      6.46:1   AA body text
    paper          6.34:1   AA body text
    desk           5.78:1   AA body text
    guilloche      4.95:1   AA body text
    mint           4.43:1   large text and indicators only
    ink            1.68:1   fills and decoration only
    inkSoft        1.09:1   fills and decoration only

  on stampWash (#FBEBEF)
    ink           10.88:1   AAA body text
    inkSoft        7.02:1   AAA body text
    stamp          6.46:1   AA body text
    mint           1.46:1   fills and decoration only
    guilloche      1.30:1   fills and decoration only
    slip           1.15:1   fills and decoration only
    onStamp        1.15:1   fills and decoration only
    desk           1.12:1   fills and decoration only
    paper          1.02:1   fills and decoration only

Every contrast claim in the palette holds.
```

## Screenshots and axe

`node docs/app-v3/prototypes/shoot.mjs docs/app-v3/prototypes/c-desk` (from `shots/REPORT.md`)

| Screen | Width | Height (viewports) | axe violations |
| --- | --- | --- | --- |
| [bank.html](bank-1440.png) | 1440 | 2.34 | 0 |
| [bank.html](bank-390.png) | 390 | 3.60 | 0 |
| [home.html](home-1440.png) | 1440 | 1.24 | 0 |
| [home.html](home-390.png) | 390 | 2.40 | 0 |
| [review.html](review-1440.png) | 1440 | 1.94 | 0 |
| [review.html](review-390.png) | 390 | 2.43 | 0 |
| [send.html](send-1440.png) | 1440 | 1.00 | 0 |
| [send.html](send-390.png) | 390 | 1.77 | 0 |

Long-dash check: `grep -rnP '\x{2014}|\x{2013}' docs/app-v3/prototypes/c-desk` returns nothing.
