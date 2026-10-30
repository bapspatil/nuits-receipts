# PR 9: live updates, measured

Chrome for Testing 151.0.7922.34, 1440x900, the busy month 2026-08 on a fresh local D1, a fresh server per scenario. Harness: `node scripts/live-measure.mjs --out /tmp/ux4-live`. Drift is the next row's viewport top minus the acted row's viewport top before the action.

| Action | Acted row at | Next row lands at | Drift | Focus | Transition |
| --- | --- | --- | --- | --- | --- |
| Single Not a purchase, Bank row 30 of 50 | 120 px | 72 px | -48 px | `li#row-<next>`, the right row | 51 groups, 1 leaving, done 340 ms after reveal |
| Bulk Not a purchase, first 25 of 50 | 120 px | 72 px | -48 px | `li#row-<next>`, inside the next row | 27 groups, 25 leaving, done 315 ms |
| Approve on a receipt page | n/a | n/a | scrollY 57 (the start of `#main`) | `main#main` (the next receipt needed nothing filled) | 2 groups, done 265 ms |

Both list drifts are -48 px because the next row sits at `scroll-margin-top`, which is `--nav-height` plus `--space-4` (72 px). The prototype landed it at 0 (-120 px). The bar is 200 px.

The title after each action names the event: "Kiosk Zed 113 is not a purchase, so it no longer needs a receipt · Bank · August 2026", "Marked 25 payments as not a purchase · Bank · August 2026", "Approved Acme Supply 116 · Receipts · Acme Supply 124". The next row carries `aria-describedby="banner"`.

## What the measurement changed

- `view-transition-name: auto` does not name the rows in Chrome 151. With it, the single action animated 2 groups (the page and the banner) and the row did not leave. Rows are named inline (`r-<id>`), which gives the 51 groups above. The names for the banner, the list header and the fields pane come from CSS (`#banner`, `.listhead`, `.fixes`).
- The bulk path downloads the list once at this base. The bulk bar asks for JSON and gets the signed location in the body, so there is no 303 to follow (one GET of `/payments` in the run). The prototype's double download was not reproduced. `bulk.js` now posts with `redirect: 'manual'`, so a redirect (a lapsed sign-in) is never followed and downloaded as a page; an opaque redirect sends the tab to its own address, which lands on the sign-in. A browser hides a manual redirect's `Location`, so assigning the `Location` from `fetch` is not possible.

## Journey f

The journey's "Scroll stays put" check compared `scrollY` before and after a bulk of all 50 visible rows. With the whole page resolved, the next row is the top of the refilled list, so `scrollY` cannot stay near 5152 while focus lands on that row. The check now compares what the contract means: where the next row stands against where the first resolved row still on screen stood. It passes at a drift under 200 px. All 13 f checks pass, and journeys a to e have 0 axe violations across 40 screens.

## Not verified

- Safari (the owner's iPhone, 18.2 and later) and Firefox. Argued from the CSS only.
- A screen reader. Whether VoiceOver reads the banner with the focused row, from `aria-describedby` and the title, needs a hand check after deploy.
- A receipt page whose next receipt has an empty required field (the fragment is `#f-<field>`). Covered by tests, not by the browser run, since the busy month's next receipt was complete.
