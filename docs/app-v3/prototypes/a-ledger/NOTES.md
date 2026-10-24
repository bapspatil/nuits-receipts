# Direction A: Ledger, evolved

## The idea

The app keeps the site's cheque paper: petrol ink on mint paper, white slips, a guilloche hairline under the bar and rubber stamps that carry words. Everything sits on one system: a 4 px spacing scale, six type sizes, one row height (48 px), one field height (44 px) and a 12-column grid that every slip and table snaps to. Each screen is a few slips with the same anatomy (a head row on an ink rule, rows on guilloche hairlines, a foot), so home, review, bank and send read as pages of one ledger. Red means a problem: it marks "Needs you", "Missing" and required fields, and nothing else; the primary button is ink. A "night ledger" dark theme swaps the semantic tokens under `prefers-color-scheme: dark`, with ink-dark surfaces, paper-coloured text and a paper-filled primary button.

## What it trades away

It gives up novelty. It is the v1.5 look tightened, not a new identity, so it won't feel like a redesign to someone who already knows the app. The display face appears only in titles, slip heads and stamps, so screens are calmer and also less characterful than the site. Density costs room for explanation: the bank reasons are one or two sentences, and longer help would need a fold.

## How each screen answers the audit

- `home.html` (F1, F20). Opens on September with the stamp "Not sent" and the line "You opened on September because it is the oldest month you haven't sent." Three steps as rows with a stamp each, then one Next block with the only primary button, "Check 3 receipts". Spend summary beside it with the six receipts.
- `review.html` (F10, F12). The reader's text of the receipt sits beside the fields at desktop (sticky, 5 of 12 columns) and above them on phones at full width, in a monospace slip with a torn foot. Text the reader put into fields is highlighted mint; numbers it saw but did not read are underlined red, and a legend says which is which. Fields come in three groups: "Needs you" (red bar, red border, the word "Required", a hint quoting the document), "Optional" (no bar, neutral border, the word "Optional", told it can stay empty) and "Read from the email" (mint bar and fill, "Read" with a tick). One primary "Approve receipt", progress "3 of 3 to check" in the crumbs and the action bar, quiet Discard and More. On phones the action bar is sticky above the tab bar.
- `bank.html` (F3, F9, F13). Missing rows first. DOMAINDESK shows the bank line and the receipt side by side, says "Same amount. The seller name differs and the dates are 1 day apart." and offers one button, "Match to Sample Domain Desk". There is no exception checkbox: the click on that button is the confirmation. "Pick another receipt" folds a searchable `<input list>`. Train Line says its receipt needs checking first and links to it. Missing Vendor has "Add receipt" and "Not a purchase". Matched rows carry "Matched automatically" or "Matched by you" stamps, plus a banner saying what the import did.
- `send.html`. One primary "Download for Example Accounting Oy", then "Did you send it?" with "Mark September as sent", and the file list folded.

Assumptions: the Sample Client Oy invoice match is shown as "Matched by you" so both match states are visible; the brief doesn't say who matched it. The ZIP file names are invented placeholders.

## Dark theme, checked by reasoning

Not screenshotted. Every component reads semantic tokens, and the dark block in `tokens.css` remaps only those, so each pair used in dark is one listed in `tokens-dark.json`: text and muted text on page, raised and sunken surfaces; red words on raised and sunken (stamps, required tags, section labels); mint words on the ok wash (ok stamps, read tags); paper text on the ok and needs washes (banner, read fields, highlights); ink text on the paper button and its hover; night text on the red missing fill and count badge. Input borders use `nightLineStrong`, measured as an indicator (3:1) on all three dark surfaces. Hairlines (`nightLine`) are decoration only.

## Files

`tokens.css` (the only file with hex values: primitives, semantic, component, dark), `app.css` (components, tokens only), `tokens.json`, `tokens-dark.json`, four screens, `shots/` from `shoot.mjs`.

## Contrast, light (`node site/scripts/check-contrast.mjs docs/app-v3/prototypes/a-ledger/tokens.json`)

```

Contrast against each surface, from docs/app-v3/prototypes/a-ledger/tokens.json

  on ink (#0D3A36)
    slip          12.53:1   AAA body text
    onStamp       12.53:1   AAA body text
    stampWash     11.11:1   AAA body text
    paper         10.68:1   AAA body text
    mintWash      10.45:1   AAA body text
    sunken         9.56:1   AAA body text
    guilloche      8.34:1   AAA body text
    mint           7.47:1   AAA body text
    stamp          1.68:1   fills and decoration only
    inkSoft        1.55:1   fills and decoration only
    inkHover       1.26:1   fills and decoration only

  on inkHover (#072724)
    slip          15.85:1   AAA body text
    onStamp       15.85:1   AAA body text
    stampWash     14.05:1   AAA body text
    paper         13.50:1   AAA body text
    mintWash      13.22:1   AAA body text
    sunken        12.09:1   AAA body text
    guilloche     10.55:1   AAA body text
    mint           9.45:1   AAA body text
    stamp          2.13:1   fills and decoration only
    inkSoft        1.96:1   fills and decoration only
    ink            1.26:1   fills and decoration only

  on paper (#E6EFE9)
    inkHover      13.50:1   AAA body text
    ink           10.68:1   AAA body text
    inkSoft        6.88:1   AA body text
    stamp          6.34:1   AA body text
    mint           1.43:1   fills and decoration only
    guilloche      1.28:1   fills and decoration only
    slip           1.17:1   fills and decoration only
    onStamp        1.17:1   fills and decoration only
    sunken         1.12:1   fills and decoration only
    stampWash      1.04:1   fills and decoration only
    mintWash       1.02:1   fills and decoration only

  on slip (#FFFFFF)
    inkHover      15.85:1   AAA body text
    ink           12.53:1   AAA body text
    inkSoft        8.08:1   AAA body text
    stamp          7.44:1   AAA body text
    mint           1.68:1   fills and decoration only
    guilloche      1.50:1   fills and decoration only
    sunken         1.31:1   fills and decoration only
    mintWash       1.20:1   fills and decoration only
    paper          1.17:1   fills and decoration only
    stampWash      1.13:1   fills and decoration only
    onStamp        1.00:1   fills and decoration only

  on sunken (#D7E4DC)
    inkHover      12.09:1   AAA body text
    ink            9.56:1   AAA body text
    inkSoft        6.17:1   AA body text
    stamp          5.67:1   AA body text
    slip           1.31:1   fills and decoration only
    onStamp        1.31:1   fills and decoration only
    mint           1.28:1   fills and decoration only
    stampWash      1.16:1   fills and decoration only
    guilloche      1.15:1   fills and decoration only
    paper          1.12:1   fills and decoration only
    mintWash       1.09:1   fills and decoration only

  on guilloche (#C2D8CB)
    inkHover      10.55:1   AAA body text
    ink            8.34:1   AAA body text
    inkSoft        5.38:1   AA body text
    stamp          4.95:1   AA body text
    slip           1.50:1   fills and decoration only
    onStamp        1.50:1   fills and decoration only
    stampWash      1.33:1   fills and decoration only
    paper          1.28:1   fills and decoration only
    mintWash       1.25:1   fills and decoration only
    sunken         1.15:1   fills and decoration only
    mint           1.12:1   fills and decoration only

  on mint (#9FD3BC)
    inkHover       9.45:1   AAA body text
    ink            7.47:1   AAA body text
    inkSoft        4.82:1   AA body text
    stamp          4.43:1   large text and indicators only
    slip           1.68:1   fills and decoration only
    onStamp        1.68:1   fills and decoration only
    stampWash      1.49:1   fills and decoration only
    paper          1.43:1   fills and decoration only
    mintWash       1.40:1   fills and decoration only
    sunken         1.28:1   fills and decoration only
    guilloche      1.12:1   fills and decoration only

  on mintWash (#DCEFE4)
    inkHover      13.22:1   AAA body text
    ink           10.45:1   AAA body text
    inkSoft        6.74:1   AA body text
    stamp          6.20:1   AA body text
    mint           1.40:1   fills and decoration only
    guilloche      1.25:1   fills and decoration only
    slip           1.20:1   fills and decoration only
    onStamp        1.20:1   fills and decoration only
    sunken         1.09:1   fills and decoration only
    stampWash      1.06:1   fills and decoration only
    paper          1.02:1   fills and decoration only

  on stamp (#A8123F)
    slip           7.44:1   AAA body text
    onStamp        7.44:1   AAA body text
    stampWash      6.59:1   AA body text
    paper          6.34:1   AA body text
    mintWash       6.20:1   AA body text
    sunken         5.67:1   AA body text
    guilloche      4.95:1   AA body text
    mint           4.43:1   large text and indicators only
    inkHover       2.13:1   fills and decoration only
    ink            1.68:1   fills and decoration only
    inkSoft        1.09:1   fills and decoration only

  on stampWash (#FBEEF2)
    inkHover      14.05:1   AAA body text
    ink           11.11:1   AAA body text
    inkSoft        7.16:1   AAA body text
    stamp          6.59:1   AA body text
    mint           1.49:1   fills and decoration only
    guilloche      1.33:1   fills and decoration only
    sunken         1.16:1   fills and decoration only
    slip           1.13:1   fills and decoration only
    onStamp        1.13:1   fills and decoration only
    mintWash       1.06:1   fills and decoration only
    paper          1.04:1   fills and decoration only

Every contrast claim in the palette holds.
```

## Contrast, dark (`tokens-dark.json`)

```

Contrast against each surface, from docs/app-v3/prototypes/a-ledger/tokens-dark.json

  on night (#0B1F1C)
    paperHover    17.12:1   AAA body text
    paperText     14.58:1   AAA body text
    okText        10.20:1   AAA body text
    mutedText      8.83:1   AAA body text
    needsText      8.56:1   AAA body text
    nightLineStrong   5.85:1   AA body text
    nightLine      1.74:1   fills and decoration only
    okWash         1.49:1   fills and decoration only
    inkOnPaper     1.37:1   fills and decoration only
    nightRaised    1.21:1   fills and decoration only
    nightSunken    1.09:1   fills and decoration only
    needsWash      1.07:1   fills and decoration only
    onNeeds        1.00:1   fills and decoration only

  on nightRaised (#133029)
    paperHover    14.17:1   AAA body text
    paperText     12.07:1   AAA body text
    okText         8.44:1   AAA body text
    mutedText      7.31:1   AAA body text
    needsText      7.08:1   AAA body text
    nightLineStrong   4.84:1   AA body text
    nightLine      1.44:1   fills and decoration only
    nightSunken    1.32:1   fills and decoration only
    okWash         1.23:1   fills and decoration only
    night          1.21:1   fills and decoration only
    onNeeds        1.21:1   fills and decoration only
    inkOnPaper     1.13:1   fills and decoration only
    needsWash      1.13:1   fills and decoration only

  on nightSunken (#071513)
    paperHover    18.65:1   AAA body text
    paperText     15.89:1   AAA body text
    okText        11.12:1   AAA body text
    mutedText      9.63:1   AAA body text
    needsText      9.33:1   AAA body text
    nightLineStrong   6.38:1   AA body text
    nightLine      1.89:1   fills and decoration only
    okWash         1.62:1   fills and decoration only
    inkOnPaper     1.49:1   fills and decoration only
    nightRaised    1.32:1   fills and decoration only
    needsWash      1.17:1   fills and decoration only
    night          1.09:1   fills and decoration only
    onNeeds        1.09:1   fills and decoration only

  on nightLine (#2A4943)
    paperHover     9.85:1   AAA body text
    paperText      8.39:1   AAA body text
    okText         5.87:1   AA body text
    mutedText      5.08:1   AA body text
    needsText      4.92:1   AA body text
    nightLineStrong   3.37:1   large text and indicators only
    nightSunken    1.89:1   fills and decoration only
    night          1.74:1   fills and decoration only
    onNeeds        1.74:1   fills and decoration only
    needsWash      1.62:1   fills and decoration only
    nightRaised    1.44:1   fills and decoration only
    inkOnPaper     1.27:1   fills and decoration only
    okWash         1.17:1   fills and decoration only

  on paperText (#E6EFE9)
    nightSunken   15.89:1   AAA body text
    night         14.58:1   AAA body text
    onNeeds       14.58:1   AAA body text
    needsWash     13.59:1   AAA body text
    nightRaised   12.07:1   AAA body text
    inkOnPaper    10.68:1   AAA body text
    okWash         9.78:1   AAA body text
    nightLine      8.39:1   AAA body text
    nightLineStrong   2.49:1   fills and decoration only
    needsText      1.70:1   fills and decoration only
    mutedText      1.65:1   fills and decoration only
    okText         1.43:1   fills and decoration only
    paperHover     1.17:1   fills and decoration only

  on paperHover (#FFFFFF)
    nightSunken   18.65:1   AAA body text
    night         17.12:1   AAA body text
    onNeeds       17.12:1   AAA body text
    needsWash     15.95:1   AAA body text
    nightRaised   14.17:1   AAA body text
    inkOnPaper    12.53:1   AAA body text
    okWash        11.48:1   AAA body text
    nightLine      9.85:1   AAA body text
    nightLineStrong   2.92:1   fills and decoration only
    needsText      2.00:1   fills and decoration only
    mutedText      1.94:1   fills and decoration only
    okText         1.68:1   fills and decoration only
    paperText      1.17:1   fills and decoration only

  on okText (#9FD3BC)
    nightSunken   11.12:1   AAA body text
    night         10.20:1   AAA body text
    onNeeds       10.20:1   AAA body text
    needsWash      9.51:1   AAA body text
    nightRaised    8.44:1   AAA body text
    inkOnPaper     7.47:1   AAA body text
    okWash         6.85:1   AA body text
    nightLine      5.87:1   AA body text
    nightLineStrong   1.74:1   fills and decoration only
    paperHover     1.68:1   fills and decoration only
    paperText      1.43:1   fills and decoration only
    needsText      1.19:1   fills and decoration only
    mutedText      1.16:1   fills and decoration only

  on okWash (#16403A)
    paperHover    11.48:1   AAA body text
    paperText      9.78:1   AAA body text
    okText         6.85:1   AA body text
    mutedText      5.93:1   AA body text
    needsText      5.74:1   AA body text
    nightLineStrong   3.93:1   large text and indicators only
    nightSunken    1.62:1   fills and decoration only
    night          1.49:1   fills and decoration only
    onNeeds        1.49:1   fills and decoration only
    needsWash      1.39:1   fills and decoration only
    nightRaised    1.23:1   fills and decoration only
    nightLine      1.17:1   fills and decoration only
    inkOnPaper     1.09:1   fills and decoration only

  on needsText (#FF9AB0)
    nightSunken    9.33:1   AAA body text
    night          8.56:1   AAA body text
    onNeeds        8.56:1   AAA body text
    needsWash      7.98:1   AAA body text
    nightRaised    7.08:1   AAA body text
    inkOnPaper     6.27:1   AA body text
    okWash         5.74:1   AA body text
    nightLine      4.92:1   AA body text
    paperHover     2.00:1   fills and decoration only
    paperText      1.70:1   fills and decoration only
    nightLineStrong   1.46:1   fills and decoration only
    okText         1.19:1   fills and decoration only
    mutedText      1.03:1   fills and decoration only

  on needsWash (#3A1621)
    paperHover    15.95:1   AAA body text
    paperText     13.59:1   AAA body text
    okText         9.51:1   AAA body text
    mutedText      8.23:1   AAA body text
    needsText      7.98:1   AAA body text
    nightLineStrong   5.45:1   AA body text
    nightLine      1.62:1   fills and decoration only
    okWash         1.39:1   fills and decoration only
    inkOnPaper     1.27:1   fills and decoration only
    nightSunken    1.17:1   fills and decoration only
    nightRaised    1.13:1   fills and decoration only
    night          1.07:1   fills and decoration only
    onNeeds        1.07:1   fills and decoration only

Every contrast claim in the palette holds.
```

## Screenshots and axe (`shots/REPORT.md`)

| Screen | Width | Height (viewports) | axe violations |
| --- | --- | --- | --- |
| [bank.html](bank-1440.png) | 1440 | 1.42 | 0 |
| [bank.html](bank-390.png) | 390 | 2.40 | 0 |
| [home.html](home-1440.png) | 1440 | 1.00 | 0 |
| [home.html](home-390.png) | 390 | 1.78 | 0 |
| [review.html](review-1440.png) | 1440 | 1.38 | 0 |
| [review.html](review-390.png) | 390 | 2.31 | 0 |
| [send.html](send-1440.png) | 1440 | 1.01 | 0 |
| [send.html](send-390.png) | 390 | 1.50 | 0 |

The phone screenshots are full-page captures, so the fixed tab bar and the sticky review action bar are painted where the first viewport ends, over the middle of the page. On a phone they sit at the bottom of the screen.

Dash check: `grep -rnP '\x{2014}|\x{2013}' docs/app-v3/prototypes/a-ledger` returns nothing.
