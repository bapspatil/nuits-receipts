# Bakeoff B: an owned `/assets/live.js`

Throwaway prototype on `bakeoff/b`, built on a327383. Measured, not merged. Harness: `scripts/bakeoff-b.mjs` (real Chrome via playwright-core, busy month `2026-08`, fresh server and database per scenario, real CSP). Raw numbers: `/tmp/bakeoff-b/results.json`. Screenshots: `/tmp/bakeoff-b/shots/` (named `<scenario>-<elapsed ms>ms.png`).

## What I built

- `src/live.ts`: `LIVE_JS`, a TS string served at `/assets/live.js` (`src/index.ts`, same headers as `bulk.js`). `page()` in `src/ui.ts` adds the script tag after the footer, only when the body contains `data-live`.
- Forms marked `data-live`: the Bank To do "Not a purchase" form, the bulk bar on both To do lists (`BulkList.live`), and the receipt page's `form#fix` (Approve). Everything else is untouched.
- Single forms: a document `submit` listener builds a urlencoded body from `new FormData(form, submitter)`, POSTs with `fetch`, follows the 303, parses the page, and swaps `<main>` plus `nav.main` and `nav.tabs` (the header badges) inside `document.startViewTransition` (plain swap when it is missing or the user prefers reduced motion).
- Bulk: `bulk.js` already posts with `fetch`; its final `location.assign(url)` now calls `nuitsLive.go(url, {ids, first})` when the bar is `data-live`. `go` GETs the redirected URL and swaps.
- Rows carry `style="view-transition-name:row-<id>"` (`src/all.ts`, `src/views.ts`). CSS adds a 250 ms group duration and no animation under reduced motion.
- Scroll and focus: scroll is kept, then corrected inside the transition callback so the next open row sits where the acted-on row was (the banner above the list otherwise pushes it down 62 px). The next open row is computed client side: the first old row after the acted-on one that is still present, else the first row. Focus goes to `#row-<next>` (given `tabindex=-1`), or to `main h1` when the target is another page. A different page opens at the top.
- `bulk.js` and `settings.js` re-init through `window.nuitsBulk(root)` and `window.nuitsSettings(root)`; the document listeners in `settings.js` bind once.
- Errors: a 4xx HTML page is parsed and swapped the same way, URL kept. A non-HTML reply or a network failure re-enables the form and announces "That did not work".
- History: `pushState` by default, `replaceState` via `nuitsLive.history = 'replace'`. A `popstate` handler refetches the entry, because the document is the same one.
- Announce: a hidden `role=status` region exists, empty, from load. After a swap the banner text goes into it (cleared, then filled 50 ms later); the visible banner loses its `role`. The no-JS page still renders the banner with `role=status`.
- Pending: the form gets `aria-busy` and its buttons are disabled, so a double submit is impossible (bulk keeps its own `sending` guard).

## The six measurements

Chrome only (Chromium build in the Playwright cache). Scenario 1 is a single Not a purchase at row 30 of 50 on Bank To do. Scenario 2 is a bulk Not a purchase on the first 25 Bank rows. Scenario 3 is a single Approve on a Receipts To do receipt page.

| # | Measure | 1 single (JS, push) | 2 bulk (JS) | 3 Approve (JS) | No-JS (1 / 2 / 3) |
| --- | --- | --- | --- | --- | --- |
| 1 | Scroll kept: scrollY before to after | 5946 to 6008 | 585 to 647 | 0 to 0 | 5896 to 6153 / 120 to 405 / 0 to 0 |
| 1 | Drift of next open row vs acted-on row offset | 0 px | 0 px | n/a (new page) | -195 px / -223 px / n/a |
| 2 | Focus after | `li#row-<next>`, inside next row: yes | `li#row-<next>`: yes | `h1` of the next receipt | `body` in all three |
| 3 | View transition | `startViewTransition` present, called once, 49 row groups animated, 50 old and 50 new snapshots | called once, 25 groups, 50 old, 35 new | called once, root cross-fade only (no named rows) | none |
| 4 | HTML per action vs a327383 | 153,909 vs 148,454 B: +5,455 B (+3.7%) | 129,030 vs 125,195 B: +3,835 B (+3.1%) | 54,592 vs 54,537 B: +55 B | same HTML as JS |
| 4 | Script, once per 5 min cache | `live.js` 7,148 B served (about 2.6 KB gzip), `bulk.js` +333 B, `settings.js` +217 B | same | `live.js` only (no bulk script on that page) | none |
| 5 | Back | to the list URL without `done=`: 50 rows, acted row absent, no banner. Forward brings the banner back | to the list URL: 35 rows, no banner | to the previous (acted) receipt page, no banner | not run |
| 6 | No-JS parity | row gone, next row in place, banner offers Undo | picked rows gone, banner "Marked 25 payments" | landed on the next receipt, banner "Approved." | pass in all three |

Notes on the numbers:

- Script bytes in the table are unminified; the per-action HTML delta is inline `style` (about 104 B per row on 64-hex ids) plus `data-live`, plus about 187 B of CSS that the baseline strip does not remove. Per-action request count equals a327383 (one POST, one HTML GET); the bulk path adds a 225 B JSON reply because `bulk.js` posts for JSON and `live.go` then GETs the page.
- With `replaceState`, Back leaves the list (landed on `/`, the page before it). With `pushState`, Back stays and lands on the pre-action URL, so it needs the `popstate` refetch to work at all.
- `res.url` from `fetch` drops the `#row-<nextOpenId>` fragment, so B cannot read the server's `nextOpenId` and recomputes it. It matches the contract in these runs, not proved in general. The bulk script already loses that fragment today (`location.assign(res.url)`).
- The no-JS drift is the native fragment jump: the next row is put near the top of the viewport (144 px and 0 px), not where the resolved row was.
- Banner announce: the `MutationObserver` log shows the region empty at load, then text 50 to 70 ms after the swap. No screen reader was run.
- 4xx path: approving an incomplete receipt returned 422, the page was swapped in place, URL kept, the alert showed ("Nothing was saved. Fill in ..."), and the Approve button was enabled again. A bug found on the way: a `form.action` read returns the button named `action`; the script uses `getAttribute('action')`.
- After a bulk swap, ticking a row gave "1 selected", so `bulk.js` re-init works. No console errors in any run except the expected 422 resource line.
- Existing tests: 6 fail because they pin exact markup (`<li data-row=".." id="row-..">`, `<form ... method="post">`). They would need loosening.

## Recordings

No video: Playwright's ffmpeg build (1013) is not installed here and I did not touch the shared cache. Instead, screenshots are taken back to back after the click, each named with its real elapsed ms: `/tmp/bakeoff-b/shots/s1-push-0015ms.png`, `-0051ms`, `-0086ms`, `-0136ms`, and likewise `s1-replace-*`, `s1-nojs-*`, `s2-js-*`, `s2-nojs-*`, `s3-js-*`, `s3-nojs-*`. A screenshot stalls the compositor, so these frames do not reliably catch the animation mid-flight. The stronger evidence for animation is the count of `::view-transition-group(row-*)` animations read from `document.getAnimations()` after `transition.ready` (49, 25 and 0 above).

## Could not verify

- Safari (the app targets it for owners on iPhone): `document.startViewTransition` exists from Safari 18, and the fallback path is a plain swap that I did not exercise. No WebKit run: the cached WebKit build is Playwright's, which does not match shipping Safari behaviour for transitions.
- Firefox: no Firefox build is cached; the code path without `startViewTransition` was not run in a real browser, only reasoned about.
- Real screen reader announcement, and touch devices.
- Reduced-motion path (the code skips the transition; not run).

## B's weaknesses, honestly

- It is a second navigation system. Every correctness property we got free from the browser (history, scroll restoration, focus, fragments, error pages, cache) is now ours to rebuild, and the Back button needed a `popstate` refetch to be sane. Scroll restoration on Back is not implemented.
- The next-row logic is duplicated on the client because `fetch` hides the fragment. The server's `nextOpenId` and the client's can drift apart.
- Scripts in a swapped `<main>` do not run, so every script must expose `init(root)`. Any future inline-behaviour page (`add.js`, `keys.js` in the plan) needs the same treatment, and listeners on `document` leak or double-bind on re-init.
- Swapping all of `<main>` throws away state inside it: an open `<details>`, typed text in another row's input, the bulk selection. Fine for resolve actions, hazardous for any polling swap.
- A bulk action costs two requests' worth of work (post, then a page GET), and the signed `done=` URL is fetched with a script rather than navigated to.
- Inline `view-transition-name` adds about 5 KB per 50-row page. Setting the names from JS removes it, at the price of the animation depending entirely on the script.
- Six markup-pinning tests fail, and the `data-live` opt-in is easy to forget on a new form.

## Polling a `Reading` row

Nothing polls today: the receipt page has a manual Refresh link for a Reading receipt. In B, `live.js` would arm a timer when the page has a row marked reading (say `data-reading`), `fetch` the same URL, and swap with history `none`. It must skip the tick when focus is in a text field or a `<details>` is open or rows are ticked, and ideally swap just the changed rows rather than `<main>`. Back off the interval, stop on `visibilitychange`, and stop when no reading rows remain.
