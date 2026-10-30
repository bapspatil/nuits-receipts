# Bakeoff prototype A: cross-document View Transitions, no new script

Branch `bakeoff/a`, from `a327383`. Throwaway: measured, not merged. Harness: `scripts/bakeoff-a.mjs` (`node scripts/bakeoff-a.mjs --out /tmp/bakeoff-a --baseline <checkout of a327383>`), summary printer `scripts/bakeoff-a-show.mjs`. Chrome for Testing 151.0.7922.34, 1440x900, busy month 2026-08 on a fresh local D1, a fresh server per scenario so each starts on 60 open Bank rows.

## What was built

All of it is server-rendered markup and CSS. No script was added or changed.

- `src/ui.ts`: `VIEW_TRANSITION_CSS` and `rowTransition(id)`. The CSS is `@view-transition{navigation:auto}`, switched off under `prefers-reduced-motion:reduce`, a 250 ms group duration, `html{scroll-behavior:auto}` and a focus ring for rows. The rule is emitted only on the three pages that take part (Receipts To do, Bank, receipt page), because both documents of a navigation must opt in. The banner (`role="status"`) gets `view-transition-name:banner`.
- `src/all.ts`, `src/views.ts`: every list row gets `tabindex="-1" style="view-transition-name:r-<id>"`, the list header `listhead`, the receipt page's fields pane `fixes`. Inline `style` attributes are allowed by the existing CSP (`style-src 'unsafe-inline'`).
- Focus: the server cannot see the `#row-` fragment, so `autofocus` cannot name the next row. Instead every row is `tabindex="-1"`, and the browser's own fragment navigation focuses the target. The fragment from `listUrl` is untouched.
- `html{scroll-behavior:auto}` is a fix the first measurement forced (below). Today's CSS sets `scroll-behavior:smooth`, so a fragment navigation to a fresh document starts at the top of the page and sweeps down to the row.

`bun run typecheck` passes. `bun run test` fails 9 tests in 7 files, all of them exact-markup assertions (`<p class="listhead">`, `<li data-row=... id=...>`); I did not update them, since the prototype is not merged.

## The six measurements

Action 1: single Not a purchase on Bank To do, scrolled so row 30 of 50 sits 120 px below the viewport top. Action 2: bulk Not a purchase on the first 25 Bank rows, first selected row at 120 px. Action 3: Approve on a ready-to-approve Receipts To do receipt page, landing on the next receipt. "Base" is a327383 under the same harness.

| # | Measure | 1 Single, Bank | 2 Bulk 25, Bank | 3 Approve, receipt page |
| --- | --- | --- | --- | --- |
| 1 | Scroll kept | `scrollY` 6175 to 6357. Next row's top 0 px against the acted row's 120 px: drift -120 px | 273 to 455. Next row 0 px against 120 px: drift -120 px | 0 to 0. No rows; the fields pane moved +61 px because the banner is inserted above it |
| 1 | Same on base | final 6322 (drift -85, still sweeping at 900 ms) | 455, drift -120 | 0, +61 px |
| 2 | Focus | `li#row-<next>` (the right row), inside next row: yes | `li#row-<next>`, inside: yes | `body` (nothing focused; no row to target) |
| 3 | Animation | `pageswap` and `pagereveal` both carried a `viewTransition`; `navigation.activation` type push. 258 pseudo animations, 51 groups, 1 leaving, 250 ms, finished 337 ms after reveal | same events. 171 animations, 27 groups, 25 leaving, 11 entering, finished 323 ms | same events. 11 animations, 2 groups, finished 263 ms |
| 4 | HTML bytes (after against base) | 154,101 against 148,259: +5,842 (+3.9%) | 129,192 against 125,000: +4,192 (+3.4%) per list GET, and the bulk path loads the list twice (see below) | 54,681 against 54,342: +339 (+0.6%) |
| 4 | Script bytes | 9,652 and 9,652: +0 | 9,652 and 9,652: +0 | 0 and 0: +0 |
| 5 | Back | Lands on the pre-action list URL, a fresh fetch (`back_forward`, not bfcache), scroll restored to 6175. Acted row absent. No banner, so no Undo | same URL, fresh fetch, row absent, no banner | same: previous receipt URL, fresh fetch, no banner |
| 6 | No-JS parity (JS disabled) | Row gone, next row in place and focused (`li#row-<next>`), banner "is not a purchase ... Undo" present, drift -120 | n/a (bulk needs script) | Lands on the next receipt, banner "Approved." (no Undo on this action in a327383) |

Notes on the rows:

- Drift is exactly the acted row's offset. A fragment aligns the target to the top of the viewport (scroll-padding aside), and the server cannot know where on screen the acted row was. A: the next row always lands at the top. The acted row's offset is lost.
- Action 2 bytes: `bulk.js` posts with `fetch`, the 303 is followed (one full list HTML body downloaded and discarded), then `location.assign` fetches it again. Playwright sees one `GET document` because the first is inside the fetch's redirect chain. Same on base, so it is not new, and it is not caused by A. Delta per action is about 2 x 4.2 KB.
- Undo at a327383: the single Bank action's banner offers Undo; the bulk banner ("Marked 25 payments as not a purchase.") and the receipt Approve banner ("Approved.") do not yet. Back behaves identically on base for all three.
- Action 3, the +61 px: the same on base. It is the banner pushing the form down, which any server-rendered banner does.
- No-JS animation evidence: no instrumentation can run with JS off, so the proof is the screencast. With A, the single action streams 29 frames up to 510 ms; the same action on base has 90 frames, but that is the smooth-scroll sweep (below). On the receipt page, A streams 38 frames to 477 ms against 12 frames to 188 ms on base, which is the 250 ms crossfade running with scripting disabled. The rule is CSS-only, so this is expected.

### Recordings and frames

All in `/tmp/bakeoff-a/`, with `proto/` for A and `base/` for a327383. Each scenario has an `.mp4` (CDP screencast frames at their captured times, up to 1.2 s from the click) and `frames/<scenario>/t000ms.jpg`, `t100ms.jpg`, `t250ms.jpg` (the last frame at or before that time), plus every frame as `frame-NNN-<ms>ms.jpg`.

- `proto/1-bank-single.mp4`, `proto/2-bank-bulk.mp4`, `proto/3-receipt-approve.mp4`, with the no-JS pair `proto/1-nojs-bank-single.mp4` and `proto/3-nojs-receipt-approve.mp4`, and `proto/1b-bank-single-no-fragment.mp4`.
- The 0/100/250 ms stills are honest about timing: the server takes about 250 ms to answer the POST and the redirected GET, so the old page is on screen at 0 and 100 ms and the transition starts around 260 ms. Frame `frames/1-bank-single/frame-003-286ms.jpg` shows it: the resolved row (Kiosk Zed 113) fading out while the row below slides up into its place.
- Raw numbers: `/tmp/bakeoff-a/results.json`. The first run with smooth scroll on is `/tmp/bakeoff-a-smooth/results.json`.

## Questions the brief asked

- **Does the transition fire after POST, 303, GET?** Yes. `pageswap` and `pagereveal` both held a `viewTransition`, navigation type `push`, with the redirect carrying the `#row-` fragment. Cross-document view transitions run for a form POST that ends in a same-origin redirect.
- **After `bulk.js`'s `location.assign`?** Yes (action 2, same events, 25 rows leaving, 11 entering).
- **Does the fragment fight the transition?** Not once smooth scrolling is off. With today's `html{scroll-behavior:smooth}` it does, and badly: the new document renders at the top, then sweeps for about 1 s to the row (59 scroll steps, `scrollY` 0, 77, 1179, 2754 ... 5170 under the transition). This is a bug on main as well: base shows the same sweep (80 scroll steps, 0 to 6322 over about 1 s). With `scroll-behavior:auto` it is one jump before the first frame (1 step), and the page lands at the target. Without the fragment (`1b`), scroll resets to 0 (drift 6,237 px) and focus is lost, so the fragment is required.
- **4xx in-place errors.** The match form with a bad receipt answers 422 and renders the page at `/matches` with the alert and the whole list. A transition runs on it too (426 animations, 51 groups, 170 entering) because the error page lists a different set of rows. It is a full crossfade of a different page, harmless but not "in place": the URL and scroll are those of a new document.
- **Reading rows.** A Reading row is not resolved by the owner, so nothing here changes it. Today the list does not poll either (it shows "N being read" and a Refresh link on the receipt page); A neither adds nor removes that. A row that finishes reading and moves lists appears on the next navigation.
- **Firefox.** Not tested (no Firefox on this machine; `firefox-1555` is not installed). Evidence from the CSS: the whole feature is the `@view-transition` at-rule, the `view-transition-name` property and `::view-transition-*` selectors. A browser without cross-document support ignores unknown at-rules and properties and renders a normal page, and the rest of the change is a `tabindex` and the fragment, which are plain HTML. The harness probe records `CSS.supports('selector(::view-transition)')`, `startViewTransition` and `onpageswap` for the browser it runs in (all true in Chrome 151). In principle Firefox degrades to today's behavior: a plain reload with the fragment jump.
- **Safari.** Not tested: no WebKit build is installed (`webkit-2370` missing; the cache has an older `webkit-2104`). Safari supports `@view-transition` from 18.2, so it should animate, but I have no evidence, and I could not check focus-on-fragment or the sweep there.

## Honest weaknesses of A

1. **No control over where the next row lands.** The fragment aligns it to the top of the viewport; drift equals the acted row's offset (-120 px here). It is fixable only as a fixed `scroll-margin-top`, which is still not "stay where the row was". "Scroll and focus stay put" is not met; B can compute and restore the exact offset.
2. **Scroll behavior was already wrong on main.** `scroll-behavior:smooth` plus a fresh document sweeps the page from the top. A had to override it, on these three pages only. Any other page that navigates with a fragment still sweeps.
3. **Nothing is announced.** The banner is `role="status"` but it is present when the document loads, and a live region that exists on load is not reliably spoken. I did not run VoiceOver or NVDA; Chrome's tree shows the status role, nothing more. Focus lands on the next row, so a screen reader reads that row, which says nothing of "Not a purchase, Undo". B can inject the banner into a live region.
4. **Whole page is re-fetched and re-rendered per action.** 150 KB of HTML and a second 150 KB on the bulk path (existing), so the cost of each action stays high on slow links. A adds +3 to +4% to every list.
5. **Latency is the transition's floor.** The server answers in about 250 ms and the animation starts after that, so nothing visible happens for a quarter second, then a 250 ms animation. B can animate the row out before the response.
6. **Scale.** One group per named row in the viewport: 51 groups (258 animations) on a 50-row list. That is fine in Chrome, but it makes snapshots and per-row names part of every list template (about 83 bytes per row).
7. **Undo and Back.** Back refetches the pre-action list (no bfcache, so no stale row), and the Undo banner does not reappear. That is the behavior the plan wants, but it means Back after an action never offers Undo.
8. **A 4xx is a full-page transition, not in place.** See above.
9. **Focus on the receipt page** is not placed: `document.activeElement` is `body` after Approve.
10. **Not covered by the tests.** Nine existing tests assert the old row markup; they would need updating if A were adopted.
11. **No change for `prefers-reduced-motion`** beyond turning the transition off, which also removes the only cue that a row left.
