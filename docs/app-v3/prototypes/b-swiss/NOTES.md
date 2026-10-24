# Direction B, Swiss workbench

## The idea in five sentences

The app is a workbench for one person closing one month, so every screen is a strict 12-column grid of tables, hairline rules and small-caps column heads. Surfaces are a cool near-white page with white tables and a grey sunken panel for the document; text is near-black at 15:1 or better. The brand petrol ink #0D3A36 is the only accent and appears only on primary buttons, the active nav item, links and the focus ring. Red means "needs you" or "missing", green means ready or matched, and both always come with the word and a square marker (solid for "matched by you", hollow for "matched automatically"). Instrument Sans carries everything, with tabular figures so amount columns line up; Bricolage appears only in the brand mark.

## What it trades away

- The paper, stamp and guilloche character of the site. This reads as a competent tool, not as Nuits; the brand survives only as the ink colour and the wordmark.
- Warmth. Deadpan copy plus grey tables can feel clerical; nothing on screen rewards finishing a month.
- Phone density. Tables become stacked cards on phones, so bank and review run to about 2.7 and 2.9 viewports at 390.

## How each screen answers the audit

- `home.html` (F1, F20). Opens on September with the label "Home, oldest month not sent" and the line "You haven't sent September yet, so it opens first. October is open too." One primary action, "Check 3 receipts". The three steps sit in a 3-column strip with words for each state; Send says "Not ready" and why.
- `review.html` (F12, F10). Desktop is a 6/6 split: the document as read, numbered by line, sticky beside the fields. Lines the reader used are grey and labelled (Seller, Date); lines holding the missing figures are red and labelled (VAT, Total). Every flagged field points at its line ("Line 6 says Total 30,00 EUR"). Required fields have a red rule and the word Required; the receipt number sits in its own "Optional" group with grey label and grey border. Read fields carry a "Read, line 1" tag. On phones the document comes first as an open `details` block at full width, so it can be read and then folded.
- `bank.html` (F9, F3, F13 in part). Missing rows come first. DOMAINDESK*SAMPLE opens a likely-receipt panel with a three-row comparison (name differs, 1 day apart, amount same) and one primary "Match to Sample Domain Desk"; the copy says matching accepts the difference, so there is no exception box. Train Line says its receipt still needs you and links to it. Missing Vendor has "Add receipt" and "Not a purchase". Matched rows say "Matched automatically" or "Matched by you", and an import notice says we matched 2 for you.
- `send.html`. One primary "Download for Example Accounting Oy", "Did you send it?" with "Mark September as sent", and the file list folded under "In the ZIP, 8 files".

## Choices not in the brief data

- Sample Client Oy is shown as "Matched by you" so both match states appear on one screen. The brief only says "Matched to invoice".
- The ZIP file names and the "8 files" count (6 receipts, 1 invoice, 1 CSV) are invented for the folded list.
- `app.css` holds the shared components; it reads semantic tokens only. Hex values live in `tokens.css` alone.

## Known screenshot artifact

The phone tab bar is `position: sticky; bottom: 0`. In the full-page 390 PNGs it is painted at the first viewport's bottom edge, so it appears mid-page over content. In a real browser it sits at the bottom of the screen. axe's target-size rule also measures at the first viewport, so a form field landing under the bar there counts as a violation; review.html's phone layout was adjusted so none does.

## Contrast

`node site/scripts/check-contrast.mjs docs/app-v3/prototypes/b-swiss/tokens.json`

```

Contrast against each surface, from docs/app-v3/prototypes/b-swiss/tokens.json

  on page (#F5F6F7)
    text          17.10:1   AAA body text
    accentHover   14.97:1   AAA body text
    accent        11.58:1   AAA body text
    muted          7.01:1   AAA body text
    danger         6.04:1   AA body text
    success        6.02:1   AA body text
    borderStrong   3.41:1   large text and indicators only
    border         1.30:1   fills and decoration only
    accentQuiet    1.11:1   fills and decoration only
    raised         1.08:1   fills and decoration only
    onAccent       1.08:1   fills and decoration only
    sunken         1.07:1   fills and decoration only
    dangerSurface   1.07:1   fills and decoration only
    successSurface   1.06:1   fills and decoration only

  on raised (#FFFFFF)
    text          18.50:1   AAA body text
    accentHover   16.19:1   AAA body text
    accent        12.53:1   AAA body text
    muted          7.59:1   AAA body text
    danger         6.54:1   AA body text
    success        6.51:1   AA body text
    borderStrong   3.69:1   large text and indicators only
    border         1.40:1   fills and decoration only
    accentQuiet    1.21:1   fills and decoration only
    sunken         1.16:1   fills and decoration only
    dangerSurface   1.15:1   fills and decoration only
    successSurface   1.15:1   fills and decoration only
    page           1.08:1   fills and decoration only
    onAccent       1.00:1   fills and decoration only

  on sunken (#ECEEF0)
    text          15.90:1   AAA body text
    accentHover   13.92:1   AAA body text
    accent        10.78:1   AAA body text
    muted          6.52:1   AA body text
    danger         5.62:1   AA body text
    success        5.60:1   AA body text
    borderStrong   3.17:1   large text and indicators only
    border         1.21:1   fills and decoration only
    raised         1.16:1   fills and decoration only
    onAccent       1.16:1   fills and decoration only
    page           1.07:1   fills and decoration only
    accentQuiet    1.04:1   fills and decoration only
    successSurface   1.01:1   fills and decoration only
    dangerSurface   1.01:1   fills and decoration only

  on accentQuiet (#E2ECEA)
    text          15.34:1   AAA body text
    accentHover   13.43:1   AAA body text
    accent        10.40:1   AAA body text
    muted          6.29:1   AA body text
    danger         5.42:1   AA body text
    success        5.40:1   AA body text
    borderStrong   3.06:1   large text and indicators only
    raised         1.21:1   fills and decoration only
    onAccent       1.21:1   fills and decoration only
    border         1.16:1   fills and decoration only
    page           1.11:1   fills and decoration only
    successSurface   1.05:1   fills and decoration only
    dangerSurface   1.05:1   fills and decoration only
    sunken         1.04:1   fills and decoration only

  on dangerSurface (#FCEBEA)
    text          16.04:1   AAA body text
    accentHover   14.04:1   AAA body text
    accent        10.87:1   AAA body text
    muted          6.58:1   AA body text
    danger         5.67:1   AA body text
    success        5.65:1   AA body text
    borderStrong   3.20:1   large text and indicators only
    border         1.22:1   fills and decoration only
    raised         1.15:1   fills and decoration only
    onAccent       1.15:1   fills and decoration only
    page           1.07:1   fills and decoration only
    accentQuiet    1.05:1   fills and decoration only
    sunken         1.01:1   fills and decoration only
    successSurface   1.00:1   fills and decoration only

  on successSurface (#E6F2EA)
    text          16.08:1   AAA body text
    accentHover   14.08:1   AAA body text
    accent        10.89:1   AAA body text
    muted          6.60:1   AA body text
    danger         5.68:1   AA body text
    success        5.66:1   AA body text
    borderStrong   3.21:1   large text and indicators only
    border         1.22:1   fills and decoration only
    raised         1.15:1   fills and decoration only
    onAccent       1.15:1   fills and decoration only
    page           1.06:1   fills and decoration only
    accentQuiet    1.05:1   fills and decoration only
    sunken         1.01:1   fills and decoration only
    dangerSurface   1.00:1   fills and decoration only

  on accent (#0D3A36)
    raised        12.53:1   AAA body text
    onAccent      12.53:1   AAA body text
    page          11.58:1   AAA body text
    successSurface  10.89:1   AAA body text
    dangerSurface  10.87:1   AAA body text
    sunken        10.78:1   AAA body text
    accentQuiet   10.40:1   AAA body text
    border         8.92:1   AAA body text
    borderStrong   3.40:1   large text and indicators only
    success        1.92:1   fills and decoration only
    danger         1.92:1   fills and decoration only
    muted          1.65:1   fills and decoration only
    text           1.48:1   fills and decoration only
    accentHover    1.29:1   fills and decoration only

  on accentHover (#072522)
    raised        16.19:1   AAA body text
    onAccent      16.19:1   AAA body text
    page          14.97:1   AAA body text
    successSurface  14.08:1   AAA body text
    dangerSurface  14.04:1   AAA body text
    sunken        13.92:1   AAA body text
    accentQuiet   13.43:1   AAA body text
    border        11.53:1   AAA body text
    borderStrong   4.39:1   large text and indicators only
    success        2.49:1   fills and decoration only
    danger         2.48:1   fills and decoration only
    muted          2.13:1   fills and decoration only
    accent         1.29:1   fills and decoration only
    text           1.14:1   fills and decoration only

  on danger (#B3261E)
    raised         6.54:1   AA body text
    onAccent       6.54:1   AA body text
    page           6.04:1   AA body text
    successSurface   5.68:1   AA body text
    dangerSurface   5.67:1   AA body text
    sunken         5.62:1   AA body text
    accentQuiet    5.42:1   AA body text
    border         4.65:1   AA body text
    text           2.83:1   fills and decoration only
    accentHover    2.48:1   fills and decoration only
    accent         1.92:1   fills and decoration only
    borderStrong   1.77:1   fills and decoration only
    muted          1.16:1   fills and decoration only
    success        1.00:1   fills and decoration only

Every contrast claim in the palette holds.
```

## Shoot report

`node docs/app-v3/prototypes/shoot.mjs docs/app-v3/prototypes/b-swiss`

| Screen | Width | Height (viewports) | axe violations |
| --- | --- | --- | --- |
| [bank.html](bank-1440.png) | 1440 | 1.60 | 0 |
| [bank.html](bank-390.png) | 390 | 2.72 | 0 |
| [home.html](home-1440.png) | 1440 | 1.45 | 0 |
| [home.html](home-390.png) | 390 | 2.59 | 0 |
| [review.html](review-1440.png) | 1440 | 1.54 | 0 |
| [review.html](review-390.png) | 390 | 2.88 | 0 |
| [send.html](send-1440.png) | 1440 | 1.11 | 0 |
| [send.html](send-390.png) | 390 | 1.92 | 0 |
