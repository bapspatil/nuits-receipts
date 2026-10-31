# Nuits Receipts docs: design

The docs are the same piece of paper as receipts.nuits.net. The shared language (identity, voice, colour, type, surface, chrome, don'ts) lives in [`site/DESIGN.md`](../site/DESIGN.md) and [`site/tokens.json`](../site/tokens.json). Read those first. This note lists only what the docs add or do differently.

## What differs from the site

- **A calm, fast reading page.** No WebGL, no scroll scenes, no pins, no word wipes. The only motion is the theme and drawer transitions Nimbus already had, and reduced motion turns them off.
- **Dark mode.** The site has none. The docs keep their theme toggle: in dark the page turns over, ink ground and paper text, with slips a step lighter (`#164A45`). The same rules hold: mint and guilloche never carry small text, stamp red is only a fill or a stamp word (the stamp word uses `#FF93AE` on ink).
- **Section headings are not numbered.** An h2 sits under a dashed perforation, the site's slate rule, without the index or the spaced capitals. Group labels in the sidebar, table headers, the TOC title and the pagination captions use the spaced-capital eyebrow instead.
- **Monospace.** The docs show code, so they keep JetBrains Mono for code only.

## Tokens

All colours are CSS variables in `src/styles/globals.css`, copied from `site/tokens.json` (`--nb-paper`, `--nb-slip`, `--nb-ink`, `--nb-ink-soft`, `--nb-guilloche`, `--nb-mint`, `--nb-stamp`). Nimbus's `--nb-*` roles map onto them.

| Pair | Ratio | Used for |
| --- | --- | --- |
| ink on paper | 10.68:1 | body text, light |
| ink on slip | 12.53:1 | text on cards, code, tables |
| inkSoft on paper | 6.88:1 | secondary text, sidebar rows |
| inkSoft on guilloche | 5.38:1 | text on the code tint |
| stamp on paper | 6.34:1 | the Docs and Caution stamp words |
| white on stamp | 7.44:1 | the Danger stamp |
| ink on mint | 7.47:1 | the Tip stamp, selection |
| paper on ink | 10.68:1 | body text, dark |
| guilloche on ink | 8.34:1 | secondary text, dark |
| paper on dark slip `#164A45` | 8.52:1 | text on cards, dark |
| guilloche on dark slip | 6.66:1 | secondary text on cards, dark |
| `#FF93AE` on ink | 5.99:1 | stamp words, dark |

## Type

One scale, in px: **12, 14, 17, 20, 24, 32, 40**. `ui-policy.json` enforces it.

| Use | Size / line | Face |
| --- | --- | --- |
| Eyebrow (group labels, table heads, tooltips, step numbers) | 12/16, spaced capitals | Instrument Sans 700 |
| UI (sidebar, TOC, breadcrumbs, page actions, buttons, tables, footer) | 14/20 | Instrument Sans 500 to 700 |
| Body, asides | 17/28 | Instrument Sans 400 |
| Lede (page description, wide); h3; wordmark | 20 | Instrument Sans; Bricolage |
| h2 | 24/28 | Bricolage 700 |
| h1 | 32/36 on phones, 40/44 from 64rem | Bricolage 800 |
| Footer wordmark | 40/40 | Bricolage 800 |

Bricolage is pinned to the site's display cut (`opsz` 96, `wdth` 82). Table cells use tabular figures; cells that hold only a figure are right-aligned (BaseLayout marks them).

## Surface

- Two radii: 2px for slips, cards, code, asides, tables and tooltips; a pill for every button, the search field and the sidebar filter.
- Hairlines are 1px ink where the paper is cut (the bar, the sidebar edge, pills) or a dashed perforation (sections, code titles, the footer nav). Guilloche lines separate rows inside a surface.
- One shadow, on screenshots only: a screenshot is a slip with white paper round it.
- No glass, blur, translucency under text or decorative gradients. Sticky bars are opaque.

## Chrome

- **Bar.** An opaque paper plate, sticky, with an ink rule and the cutter's teeth hanging below (`.nb-bar-teeth`, an element so contrast checks can read the bar). Wordmark, a red **Docs** stamp word from 40rem, Home (back to the site) from 48rem, then pills: Search, GitHub (from 48rem), the theme toggle, and **Menu** on phones. Icon-only pills carry a text tooltip on hover and focus; Escape hides it.
- **Sidebar.** No fills. Group labels are eyebrows under a perforation. The current page gets a 3px ink rule at its edge and bold weight; hover underlines.
- **TOC.** The current heading gets a 3px ink rule over the 2px guilloche rail and bold weight.
- **Asides.** A white slip with an ink edge; the title is a stamp word (Note and Tip in ink, Tip on mint, Caution in stamp red, Danger white on stamp).
- **Footer.** The receipt stub: a white slip whose torn top edge bites into the page, the wordmark at display size, links to the site (Home, Privacy notice) and GitHub, then the small print ruled like the back of a receipt. The trader line is checked by `scripts/check-copy.mjs`.
- **Focus.** Ink (paper in dark), 2px, 3px offset, everywhere.

## Checking it

Build, serve `dist`, then run lintapple through the repo script at 390 and 1440 wide:

```sh
AUTH=docs:docs node scripts/ui-lint.mjs --policy docs-site/ui-policy.json --base http://localhost:4400/docs / /reference/configuration/
```

The repo script opens its pages in the light scheme only. Check dark too: run the same script with `colorScheme: 'dark'` on its browser context. The policy's one exception covers `.sr-only` text, which is hidden on purpose.
