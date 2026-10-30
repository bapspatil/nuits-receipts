# Decision: how a resolved row leaves the page

Date: 2026-10-30. Decided by the coordinator from two measured prototypes, per the plan's bakeoff (`PLAN.md`, section 2).

## The question

When a row in a work list is resolved (Approve, Not a purchase, a bulk action), the row must visibly leave, the rest must close the gap, scroll and focus must stay put, and the Undo banner must be announced. Two candidates were built as throwaway prototypes on the same commit (a327383) and measured the same way in Chrome 151 on the busy month:

- **A: no new script.** Cross-document View Transitions (`@view-transition { navigation: auto }`) over the existing POST, 303, GET, with a `view-transition-name` per row and the `#row-<next>` fragment. Branch `bakeoff/a` (9aea9d5), write-up in [`bakeoff/a.md`](bakeoff/a.md).
- **B: an owned `live.js`.** Fetches the POST, follows the 303, parses the page and swaps `<main>` inside `document.startViewTransition`, with `pushState`, a pending state and re-init of the other scripts. Branch `bakeoff/b` (7f7d4c9), write-up in [`bakeoff/b.md`](bakeoff/b.md).

## The six measurements

| Criterion | A | B |
| --- | --- | --- |
| Scroll kept (single action at row 30 of 50) | Next row lands at the top of the viewport: drift -120 px, under the 200 px bar | Next row lands exactly where the acted row was: drift 0 px |
| Focus on the next row | Inside `#row-<next>` on lists; `body` on the receipt page after Approve | Inside `#row-<next>` on lists; the next receipt's `h1` after Approve |
| Animation | Fires after POST, 303, GET and after the bulk reload: 51 groups, done 337 ms after reveal. Nothing on screen for the 250 ms round trip | Fires once per swap: 49 groups. Can show a pending state during the round trip |
| Bytes shipped | +0 script. +5.8 KB HTML per 50-row list (inline names). The page is re-fetched per action, as today | +7.1 KB script (about 2.6 KB gzip), +5.5 KB HTML. One fetch per action; the bulk path no longer downloads the list twice |
| Back button | A fresh fetch of the list, scroll restored, acted row gone, no banner: the same as today | With `replaceState`, Back leaves the list. With `pushState`, Back needs a `popstate` refetch to work at all |
| No-JS parity | Full: the row is gone, the next one is in place and focused, Undo is offered, and the transition still runs | Full minus the animation |

Neither prototype solves polling while a row is Reading, and neither was run in Safari or Firefox (no builds on the machine).

## The decision: A

A wins on four of six and ties on one. B wins on scroll drift (0 px against 120 px, both inside the bar) and on a pending cue during the round trip. What settles it is the cost B's own write-up names: it is a second navigation system. History, scroll restoration, focus, fragments, error pages and caching are all ours to rebuild; the next-row rule is computed twice (the server's and a client copy, because `fetch` hides the fragment); every script needs an `init(root)`; and a swap throws away whatever was half done in the page. For a server-rendered app with one maintainer, that is the wrong trade. A ships no script, keeps the server as the only truth, degrades to today's behaviour anywhere the feature is missing, and already passes the journey's drift and focus checks.

## What PR 9 does on top of A

The prototype is not merged. PR 9 builds A properly and closes A's weaknesses:

1. **Where the next row lands.** `scroll-margin-top` on rows equal to the sticky header's height plus a little, so the next row sits under the header, never behind it. Drop `html { scroll-behavior: smooth }`: every fragment navigation into a fresh document sweeps from the top with it, on every page, and that was already wrong on main.
2. **Announcing the banner without script.** The focused row carries `aria-describedby` pointing at the banner, so a screen reader reads "Approved 14 receipts, Undo" with the row it lands on, and the document title carries the event ("Approved 14 · To do"). A live region present at load is not reliably spoken, so the banner's `role="status"` is kept only for the scripted case. Check by hand with VoiceOver after deploy; it cannot be automated here.
3. **Focus on the receipt page after Approve.** The redirect's fragment targets the first field that needs filling, else `#main` with `tabindex="-1"`.
4. **Double submits.** The server treats "already resolved" as a quiet redirect, so a second submit is harmless. The pending cue (disable the button, `aria-busy`) lands with `keys.js` in PR 13 as one submit listener; until then the browser's own loading indicator is the cue.
5. **Reading rows.** The receipt page of a Reading receipt refreshes itself with `<meta http-equiv="refresh">` every 10 s; it has no editable fields yet, so nothing is lost. Lists do not auto-refresh (a refresh would drop a bulk selection); a Reading row shows a visible Refresh link, which also covers the installed app on iOS, where there is no pull to refresh.
6. **The bulk path's double download.** `bulk.js` follows the redirect with `fetch` and then `location.assign`s it, so the list downloads twice. Fetch with `redirect: 'manual'` and assign the `Location` once.
7. **Per-row names.** Try `view-transition-name: auto` (Chrome 133+) so a row's `id` names it without an inline style, behind `@supports`; keep the inline name only where it is needed. Confirm the cross-document transition on the owner's iPhone (Safari 18.2+), since it could not be run here.
8. **Reduced motion.** The transition is off under `prefers-reduced-motion`; the banner and the focused row are the cue that a row left.
9. **Tests.** Nine tests pin the old row markup; update them to the contract.

## What stays open

- Safari and Firefox were argued from the CSS, not run. Firefox has no cross-document transitions and degrades to a plain reload with the fragment jump.
- A full-page 4xx (for example a bad match) transitions as a full-page crossfade, not in place. The in-place error path for every form route is PR 12's job and is unaffected by this choice.
