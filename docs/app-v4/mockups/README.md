# UX v4 mockups: Native app, Warm paper, and the Mix

**The owner picked the Mix on 2026-10-30: paper look, native layout, with a glass material on navigation and floating controls.** See [Mix (chosen)](#mix-chosen). The two sections after it describe the directions the Mix is built from.

Two static directions for PR 2 of [the plan](../PLAN.md). Both show the post-cut app: Review is merged into Receipts, To do is the default, and every button has an icon and a label. Both keep the petrol green as the only accent. Pick one, and it lands as a token change plus component CSS in `src/ui.ts`.

| Direction | Page | Desktop | Phone |
| --- | --- | --- | --- |
| Native app | [native.html](native.html) | [native-1440.png](screens/native-1440.png) | [native-390.png](screens/native-390.png) |
| Warm paper | [paper.html](paper.html) | [paper-1440.png](screens/paper-1440.png) | [paper-390.png](screens/paper-390.png) |
| **Mix (chosen)** | [mix.html](mix.html) | [mix-1440.png](screens/mix-1440.png), glass: [mix-1440-glass.png](screens/mix-1440-glass.png) | [mix-390.png](screens/mix-390.png), glass: [mix-390-glass.png](screens/mix-390-glass.png) |

Each page stacks four sections: Receipts To do, receipt review, Bank To do, and a specimen of the controls, statuses and icons. The layouts at 1440 and 390 are real media queries. Resize the window, or use the "Phone, 390 px" link, which loads the page in a 390 px frame. In a row, Approve, Discard, Match, Not a purchase, Allow and Mark paid play the leave animation, so you can feel the motion.

The data is a busy September 2026 for a small Helsinki studio. To do holds 132 items: 124 receipts, 5 new senders and 3 overdue sales invoices. The brief's sample numbers (badge 12, "Start checking (12)", "3 of 12") don't fit a list of 132, so the badge shows 132, "Start checking" counts the 124 receipts, and review says "3 of 124".

## What both directions share

- **One row.** Checkbox, date, title, meta line, one status badge, amount, row actions. Receipts, held mail, overdue invoices and bank payments all use it. The checkbox is always visible. No row holds a primary button.
- **One primary per view.** "Start checking (124)" on Receipts, Approve on a receipt, "Match all (8)" on Bank. The bulk bar is its own context, so its Approve is the light button on a dark bar.
- **Five control shapes.** Segmented control, filter chip, text input, and three button tones (primary, secondary, ghost). The destructive red button appears only for permanent delete, in the specimen as "Delete forever". Discard is undoable, so it is a ghost button with `x`, never red.
- **Colour roles.** Red is for errors and permanent delete only. Needs you, Missing and Overdue use the new warning role (amber). Reading and New sender use the new info role (blue). The Undo banner uses success.
- **Icons.** An inline Lucide sprite (lucide-static 1.65.0, ISC) with `<use href="#i-...">`, `aria-hidden="true"` and `focusable="false"`. The mapping follows the plan. Skip is `skip-forward`, because `chevron-right` already means "next item" in the stepper and month arrows. Allow is `user-check` and Ignore is `user-x`. I kept them, since both act on a sender and read that way. Start checking is `list-checks`. The statuses have their own icons (`circle-alert`, `circle-dashed`, `calendar-clock`, `loader-circle`, `mail`), separate from the action icons.
- **Motion.** A resolved row leaves, then the gap closes from the row's real height (`--h`, set from `offsetHeight`), then focus moves to the row that took its place. The whole exit takes about 420 ms, and the banner updates ("Approved Adobe Systems Software Ireland."). Under `prefers-reduced-motion: reduce` the row is removed at once, with no transform or collapse, and the banner and focus still update. This is the in-place half of the plan's live-update bakeoff (PR 8). Either prototype can use these keyframes.

## Mix (chosen)

**The owner's pick, 2026-10-30: "Paper look, Native layout", with a glass material added in the same round.** It is the third theme in `themes.mjs` (`mix`). It renders from the same markup, data, row component, `ACTIONS` and `STATUS` registries and Lucide sprite as the other two, so every button still has an icon and a label and no row holds a primary.

The two `-glass` shots are viewport shots, scrolled so content passes under the sticky bars. The phone shot shows rows under the bulk bar and the tab bar. The desktop shot shows the review form under the action bar. The full-page shots put every bar at the end of its screen, as the other directions do.

### What came from where

From **Warm paper**, the look:

- The whole palette. Paper `#F3EDE2` with the 5% grain, the `#FBF8F2` sheet, ink, muted, rules, petrol as the only accent, amber warning and slate-blue info, and red only for errors and Delete forever.
- Type. Bricolage 800 titles at 34 px (30 px on the phone), Instrument Sans body, and DM Mono for amounts, dates, counts, the tally, stamps, the bulk count and numeric inputs.
- Uppercase DM Mono stamps for every status.
- Inputs with the 2 px ink baseline.
- Dashed capsule filter chips.
- The petrol strike-through, then the collapse, when a row leaves.
- Buttons in paper tones. Primary is solid petrol with a pressed bottom edge. Secondary is an outlined paper button with a 1 px drop edge. Ghost is petrol text that underlines on hover.

From **Native app**, the layout:

- A source-list sidebar on desktop, now a floating glass panel inset 12 px from the window edge.
- A tab bar on the phone, now a floating glass capsule.
- Rounded, grouped inset lists. Rows sit on one rounded sheet with inset hairlines, with no column heads and no double rules.
- The segmented To do | All control: a sunken paper track with a raised thumb, which is now glass.
- Rounded corners on every control (10 px buttons and fields, 14 px cards) and the floating bulk bar and action bar.
- Stacked rows on the phone, with the actions on their own line.

### Conflicts and how they were resolved

Each call favours whichever option keeps controls most distinct from each other.

| Conflict | Native | Paper | Mix | Why |
| --- | --- | --- | --- | --- |
| Secondary button | Petrol tint fill, no outline | Outlined paper button | **Paper**, with native radius | A tint fill matches the selected-row tint and the current sidebar item, which forced Native to swap it to white on picked rows. An outline is a shape that no surface shares. |
| Checkbox | Round | Square, browser-drawn | **Square, 5 px radius**, drawn in paper colours | A round box reads as a radio button next to a single-choice segmented control. |
| Selected row | Tint only | Tint and a 3 px petrol edge | **Paper** | The edge is a second cue beyond colour. |
| Flagged review group | Full amber outline | Amber 3 px left rule | **Native outline** | A left rule on a rounded card would echo the selected-row edge. A full outline keeps "needs you" and "selected" apart. |
| Button height | 36 px desktop | 40 px desktop | **40 px**, `.sm` 34 px, 38 px in phone rows | It is the bigger target. |
| Bulk bar | Translucent dark capsule, white tint Discard | Solid petrol950, outlined Discard | **Glass capsule**, solid petrol Approve, outlined paper Discard | The owner asked for glass on floating controls. Solid primary next to an outlined secondary is the same pair used everywhere else. |
| Status shape | Pill | Square stamp | **Stamp** | Pills look like chips and capsule buttons. Square stamps can't be mistaken for something to click. |
| Column heads | Hidden | DM Mono heads over a double rule | **Hidden** | Grouped inset lists carry no heads, and each row already labels its amount and date. |

### Glass material

Glass follows Apple's rule for Liquid Glass. It is for navigation and floating controls, and content stays solid.

**Where glass is used.** The desktop sidebar, the phone tab bar, the review action bar, the floating bulk bar, the Undo banner and the segmented control's thumb. A More or menu popover would use the same tokens. None is open in the mockup.

**Where it is not.** Rows, the list sheet, fields, review groups, the document preview and the error banner stay solid warm paper. Text you read or type must not shimmer with whatever scrolls behind it. An error must never be faint.

**Tokens.** These are CSS custom properties on `:root` in the mix theme, ready to lift into `src/tokens.json`.

| Token | Value |
| --- | --- |
| `--glass` | `rgb(251 248 242 / .85)`: the sheet colour at 85% |
| `--glass-filter` | `blur(24px) saturate(170%)`, set on both `backdrop-filter` and `-webkit-backdrop-filter` |
| `--glass-edge` | `inset 0 1px 0 rgb(255 255 255 / .8), inset 0 -1px 0 rgb(33 28 22 / .08)`: a light top edge and a faint bottom edge |
| `--glass-shadow` | `0 1px 2px rgb(33 28 22 / .1), 0 12px 32px -8px rgb(33 28 22 / .24)` |
| `--glass-border` | `rgb(133 120 97 / .3)` |
| `--glass-r` | 22 px for the sidebar, the banner and the bars. The phone tab bar is a 32 px capsule. Buttons inside glass bars are 999 px capsules. |

The 85% opacity is computed, not picked. `themes.mjs` raises the tint from 50% in steps of 1% until ink, muted, petrol and success text all reach 4.5:1 over every backdrop that can sit underneath. The backdrops tested are petrol950 (the darkest), ink, petrol, the lightest field paper and the page. The Undo banner's success green over petrol950 or ink sets the floor: 84% gives 4.42:1 and fails, and 85% gives 4.51:1. Muted tab labels reach 5.16:1 at the same opacity. A primary button on glass stays solid petrol.

**Fallbacks to solid paper.** The material collapses to solid `--sheet` with no filter in three cases:

- `@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))`
- `@media (prefers-reduced-transparency: reduce)`
- `@media (prefers-contrast: more)`, which also sets a 1 px ink border and drops the edge highlight.

**No library, no refraction.** The material is plain CSS that renders the same in Safari, Chrome and Firefox. SVG displacement through `backdrop-filter: url(#...)` works only in Chromium. Safari, which every iPhone browser uses, draws nothing while `@supports` still reports success.

### Token delta for `src/tokens.json` (PR 11)

Start from the Warm paper table in [Proposed token delta](#proposed-token-delta-for-srctokensjson). Take every colour primitive and semantic role in it as written, plus `font.num`, `text-on-accent`, `texture`, the stamp and input components and `row-height` 62 px. Then change or add the following:

| Layer | Token | Today | Mix |
| --- | --- | --- | --- |
| primitive | `radius.sm`, `radius.md`, new `radius.lg`, new `radius.glass` | 2 px, 4 px | 8 px, 10 px, 14 px, 22 px (`pill` unchanged) |
| primitive | `text.2xl`, phone `text-2xl` | 32, 26 | 34, 30 |
| primitive | `text.sm`, phone `text-sm` | 13 | 13, 13.5 |
| semantic | new `glass`, `glass-filter`, `glass-edge`, `glass-shadow`, `glass-border` | | the values in the glass table above |
| semantic | `surface-accent-quiet` (petrol50 `#DCE6DF`) | active nav item, selected row | the same, plus the current sidebar item drawn solid on glass |
| component | `nav-height` | 56 px | removed. Replaced by `sidebar-width` 260 px, floating, inset 12 px, at 880 px and up |
| component | `tabbar-height` | 3.5 rem + 1 px | 64 px bar, floating 10 px above the safe area, so content pads by 76 px + safe area |
| component | `btn-height` | 44 px | 40 px desktop, 44 px phone (`.sm` 34 px, 38 px in phone rows) |
| component | `btn-secondary` | white box, 1 px | `paperField` + 1 px `ink500` + 1 px bottom edge, `radius.md` |
| component | `btn-on-glass` | | capsule (`radius.pill`). Primary stays solid `accent`. |
| component | `seg` | white boxes | `paper200` track at 11 px radius, glass thumb at 8 px |
| component | `chip` | white box | dashed `ink500` capsule |
| component | `checkbox` | browser default | 21 px, 5 px radius, 1.5 px `ink500` on `paperField`, solid `accent` with a paper tick when checked |
| component | `list` | | `paper0` sheet, 1 px `ink200`, `radius.lg`, inset hairlines from 53 px |
| component | `row-selected` | | `surface-accent-quiet` + inset 3 px `accent` edge |
| component | `colhead-rule` | | none, because the grouped list has no column heads |
| component | `bulkbar-bg`, `actionbar-bg`, `banner-undo-bg` | | `glass` |

### Mix contrast

`build.mjs` measures every pair on each build, and `shoot.mjs` runs axe on the rendered page at 1440 and 390: 0 violations, every button has an icon and a label, no primary sits in a row, and nothing scrolls sideways. Glass pairs are measured as the flat tint over each backdrop, before blur. Blur only averages the backdrop towards its mean, so the flat case bounds the real one. The sidebar does not overlap content on desktop, but it is measured against the same worst cases so that it holds if PR 11 lets content run under it.

<!-- contrast:mix -->
| Use | Foreground | Background | Needs | Ratio | Result |
| --- | --- | --- | --- | --- | --- |
| Body text on the page | `ink` #211C16 | `page` #F3EDE2 | Text 4.5 | 14.51 | Pass |
| Row titles on a grouped list | `ink` #211C16 | `sheet` #FBF8F2 | Text 4.5 | 15.95 | Pass |
| Meta, tally and lede on the page | `muted` #5E5446 | `page` #F3EDE2 | Text 4.5 | 6.36 | Pass |
| Meta line and date in a row | `muted` #5E5446 | `sheet` #FBF8F2 | Text 4.5 | 6.99 | Pass |
| Muted text on the document panel | `muted` #5E5446 | `sunken` #E6DDCC | Text 4.5 | 5.50 | Pass |
| Row title on a selected row | `ink` #211C16 | `accentTint` #DCE6DF | Text 4.5 | 13.22 | Pass |
| Meta on a selected row | `muted` #5E5446 | `accentTint` #DCE6DF | Text 4.5 | 5.80 | Pass |
| Ghost buttons and links on the page | `accent` #0D3A36 | `page` #F3EDE2 | Text 4.5 | 10.76 | Pass |
| Ghost buttons in a row, current segment label | `accent` #0D3A36 | `sheet` #FBF8F2 | Text 4.5 | 11.82 | Pass |
| Secondary button label, input text | `ink` #211C16 | `field` #FFFDF8 | Text 4.5 | 16.63 | Pass |
| Unit inside an input | `muted` #5E5446 | `field` #FFFDF8 | Text 4.5 | 7.29 | Pass |
| Primary button, nav count | `onAccent` #FBF8F2 | `accent` #0D3A36 | Text 4.5 | 11.82 | Pass |
| Primary while hovered | `onAccent` #FBF8F2 | `accentHover` #072522 | Text 4.5 | 15.28 | Pass |
| Delete forever (permanent delete only) | `onAccent` #FBF8F2 | `danger` #A12820 | Text 4.5 | 6.98 | Pass |
| Needs you, Missing, Overdue stamps | `warn` #87470A | `warnBg` #F6E3C1 | Text 4.5 | 5.68 | Pass |
| Hint under a flagged field, flagged group heading | `warn` #87470A | `sheet` #FBF8F2 | Text 4.5 | 6.75 | Pass |
| Reading, New sender stamps | `info` #2D4E73 | `infoBg` #E1E7EC | Text 4.5 | 6.88 | Pass |
| Error banner | `danger` #A12820 | `dangerBg` #F5DCD5 | Text 4.5 | 5.66 | Pass |
| Segmented control, unselected segment | `ink` #211C16 | `segTrack` #E6DDCC | Text 4.5 | 12.54 | Pass |
| Segment count, unselected | `muted` #5E5446 | `segTrack` #E6DDCC | Text 4.5 | 5.50 | Pass |
| Glass: sidebar items, bulk bar count, over petrol950, the darkest content | `ink` #211C16 | `glassOverDarkest` #D6D8D3 | Text 4.5 | 11.77 | Pass |
| Glass: tab bar labels, position in the action bar, over petrol950, the darkest content | `muted` #5E5446 | `glassOverDarkest` #D6D8D3 | Text 4.5 | 5.16 | Pass |
| Glass: current tab, ghost buttons on a bar, over petrol950, the darkest content | `accent` #0D3A36 | `glassOverDarkest` #D6D8D3 | Text 4.5 | 8.73 | Pass |
| Glass: Undo banner and its Undo button, over petrol950, the darkest content | `success` #2E6A3C | `glassOverDarkest` #D6D8D3 | Text 4.5 | 4.51 | Pass |
| Glass: sidebar items, bulk bar count, over ink text | `ink` #211C16 | `glassOverInk` #DAD7D1 | Text 4.5 | 11.77 | Pass |
| Glass: tab bar labels, position in the action bar, over ink text | `muted` #5E5446 | `glassOverInk` #DAD7D1 | Text 4.5 | 5.16 | Pass |
| Glass: current tab, ghost buttons on a bar, over ink text | `accent` #0D3A36 | `glassOverInk` #DAD7D1 | Text 4.5 | 8.73 | Pass |
| Glass: Undo banner and its Undo button, over ink text | `success` #2E6A3C | `glassOverInk` #DAD7D1 | Text 4.5 | 4.51 | Pass |
| Glass: sidebar items, bulk bar count, over the lightest paper | `ink` #211C16 | `glassOverLightest` #FCF9F3 | Text 4.5 | 16.09 | Pass |
| Glass: tab bar labels, position in the action bar, over the lightest paper | `muted` #5E5446 | `glassOverLightest` #FCF9F3 | Text 4.5 | 7.06 | Pass |
| Glass: current tab, ghost buttons on a bar, over the lightest paper | `accent` #0D3A36 | `glassOverLightest` #FCF9F3 | Text 4.5 | 11.93 | Pass |
| Glass: Undo banner and its Undo button, over the lightest paper | `success` #2E6A3C | `glassOverLightest` #FCF9F3 | Text 4.5 | 6.16 | Pass |
| Glass: tab and sidebar icons, focus ring, worst case | `accent` #0D3A36 | `glassOverDarkest` #D6D8D3 | UI 3 | 8.73 | Pass |
| Glass segment thumb: selected segment label | `accent` #0D3A36 | `thumbOverTrack` #F8F4EC | Text 4.5 | 11.42 | Pass |
| Glass segment thumb: its count | `muted` #5E5446 | `thumbOverTrack` #F8F4EC | Text 4.5 | 6.76 | Pass |
| Current sidebar item on its solid petrol tint | `accent` #0D3A36 | `current` #DCE6DF | Text 4.5 | 9.80 | Pass |
| Bulk Discard: solid paper capsule on glass | `ink` #211C16 | `field` #FFFDF8 | Text 4.5 | 16.63 | Pass |
| Input, chip, checkbox and secondary button outline | `ruleStrong` #857861 | `sheet` #FBF8F2 | UI 3 | 4.08 | Pass |
| Chip outline on the page | `ruleStrong` #857861 | `page` #F3EDE2 | UI 3 | 3.71 | Pass |
| Unchecked checkbox on a selected row | `ruleStrong` #857861 | `accentTint` #DCE6DF | UI 3 | 3.38 | Pass |
| Input baseline | `ink` #211C16 | `field` #FFFDF8 | UI 3 | 16.63 | Pass |
| Focus ring, current tab icon | `accent` #0D3A36 | `page` #F3EDE2 | UI 3 | 10.76 | Pass |
| Focus ring on the segment track | `accent` #0D3A36 | `segTrack` #E6DDCC | UI 3 | 9.30 | Pass |
| Flagged group outline | `warn` #87470A | `sheet` #FBF8F2 | UI 3 | 6.75 | Pass |
| Checked checkbox tick | `onAccent` #FBF8F2 | `accent` #0D3A36 | UI 3 | 11.82 | Pass |
<!-- /contrast:mix -->

## Native app

**The idea.** It should feel like a Mac or iPhone system app the owner already knows: a source-list sidebar on desktop, a translucent tab bar on the phone, grouped inset lists, and controls that look like the system ones. It needs nothing new to learn.

**Type.** The platform UI stack, chosen on purpose: `system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", Roboto, sans-serif`. Body is 15 px on desktop and 17 px on the phone (the iOS body size). Meta is 13 px and 15 px. Titles are 26 px and 32 px, weight 700, tracked -0.022em like SF Display. Row titles are 600. `font-feature-settings: "tnum"` is on for the whole app, so every amount, count and date lines up. There are no font files, so the app could stop serving its two woff2 files (40.8 KB) once the site no longer shares them.

**Colour roles.** iOS grouped greys: page `#F2F2F7`, white groups, separators `#D1D1D6`. Petrol `#0D3A36` fills the primary button. Its 50 tint `#E2ECEA` fills secondary buttons and selected rows. Warning, info, success and danger each pair a dark text colour with a pale capsule. Bars are 90% `#F9F9FB` with `saturate(180%) blur(20px)`. The bulk bar is a floating 94% petrol950 capsule.

**Density.** Rows are at least 60 px tall with an inset hairline. The desktop sidebar is 232 px and content is at most 1120 px. On the phone, a row stacks title, amount, badge and date, and its actions sit on their own line.

**Motion.** The row slides 48 px right and fades out (220 ms, ease-in), then collapses (200 ms, ease-out). That is the iOS swipe-to-act gesture played back.

**Controls.** Segmented control: grey track with a raised white thumb. Chip: white capsule with a 1 px `#86868B` outline. Input: white, 10 px radius, outline, petrol focus halo. Buttons: rounded rectangles with no outline, in filled, tinted or plain tones. A round checkbox fills petrol with a white tick.

## Warm paper

**The idea.** A tidy ledger on warm paper. Amounts set like a till slip, a double rule under every column head, and stamps for status. It looks like the paper the receipts came on, and nothing like a generic admin dashboard.

**Type.** Bricolage 800 for page titles and the wordmark, Instrument Sans for body (both already self-hosted). One added font: **DM Mono** (SIL OFL 1.1, Colophon for Google), weights 400 and 500, latin subset. That is 14.8 KB plus 15.0 KB, so 29.8 KB in total, within the 40 KB budget. The latin subset covers å, ä and ö. DM Mono sets amounts, dates, counts, stamps, column heads and numeric inputs. Text inputs stay in Instrument Sans. Sizes: body 15 px (16 px on the phone), meta 12.5 to 13.5 px, titles 36 px (30 px on the phone).

**Colour roles.** Paper `#F3EDE2` with a 5% grain, sheet `#FBF8F2` for the ledger, ink `#211C16`, muted `#5E5446`, rules `#D8CCB8`, and a strong rule `#857861` for outlines. Petrol is the primary fill and the current-tab rule. Its warm tint `#DCE6DF` marks selected rows, with a 3 px petrol edge. Warning, info, success and danger are muted, earthy pairs. Stamps are uppercase DM Mono with a thin border. The bulk bar is solid petrol950.

**Density.** Rows are at least 62 px tall on one sheet with hairline rules. Content is at most 1120 px under a 60 px top bar. On the phone, the ledger runs edge to edge.

**Motion.** A petrol line strikes through the row from left to right (200 ms), like ticking a ledger line. The row then collapses (200 ms, after a 60 ms hold).

**Controls.** Segmented control: ledger tabs with a 3 px petrol underline on a rule. Chip: transparent capsule with a dashed outline. Input: a field with a 2 px ink baseline, like a form line. Primary: petrol with a pressed bottom edge. Secondary: an outlined paper button. Ghost: petrol text that underlines on hover.

## Proposed token delta for `src/tokens.json`

Today's file is "direction B, Swiss workbench". Either pick replaces the colour primitives below, adds the warning and info roles, and changes radius and component values. Names follow the file's three layers.

### Native app

| Layer | Token | Today | Proposed |
| --- | --- | --- | --- |
| primitive | `grey50` (page) | `#F5F6F7` | `#F2F2F7` |
| primitive | `grey100` (sunken) | `#ECEEF0` | `#E5E5EA` |
| primitive | `grey950` (text) | `#101418` | `#1C1C1E` |
| primitive | `grey700` (muted) | `#4B5560` | `#5B5B62` |
| primitive | `grey500` (outline) | `#7D8691` | `#86868B` |
| primitive | `grey200` (rule) | `#D6DADF` | `#D1D1D6` |
| primitive | `grey150` (segment track) | | `#E3E3E8` |
| primitive | `amber800`, `amber50` | | `#8A4B00`, `#FFEFD2` |
| primitive | `blue800`, `blue50` | | `#1D4F91`, `#E5EEFA` |
| primitive | `green50` | `#E6F2EA` | `#E3F1E7` |
| primitive | `petrol900`, `petrol950`, `petrol50`, `red700`, `red50`, `green800` | | unchanged |
| semantic | `warning`, `warning-surface` | | `amber800`, `amber50` |
| semantic | `info`, `info-surface` | | `blue800`, `blue50` |
| semantic | `surface-bar` | | `rgb(249 249 251 / .9)` + `saturate(180%) blur(20px)` |
| semantic | `danger` | Needs you, Missing, errors | errors and permanent delete only |
| primitive | `radius.sm`, `radius.md`, new `radius.lg` | 2 px, 4 px | 8 px, 10 px, 12 px |
| primitive | `font.ui`, `font.display` | Instrument Sans, Bricolage | the system stack for both |
| primitive | `text.base`, phone `text-base`, `text.2xl`, phone `text-2xl` | 15, 16, 32, 26 | 15, 17, 26, 32 |
| component | `btn-height` | 44 px | 36 px desktop, 44 px phone (`.sm` 32 px, 36 px in rows) |
| component | `btn-secondary-bg`, `btn-secondary-text` | | `surface-accent-quiet`, `accent` |
| component | `stamp-needs`, `stamp-missing` | `danger` | `warning` |
| component | `stamp-reading`, `stamp-sender` | | `info` |
| component | `row-height` | 48 px | 60 px |
| component | `tabbar-height` | 3.5 rem + 1 px | 64 px + safe area |
| component | `bulkbar-bg` | | `rgb(7 37 34 / .94)` |

### Warm paper

| Layer | Token | Today | Proposed |
| --- | --- | --- | --- |
| primitive | `paper50` (page) | | `#F3EDE2` |
| primitive | `paper0` (sheet, raised) | | `#FBF8F2` |
| primitive | `paperField` (inputs, secondary) | | `#FFFDF8` |
| primitive | `paper200` (sunken) | | `#E6DDCC` |
| primitive | `ink950` (text) | `#101418` | `#211C16` |
| primitive | `ink700` (muted) | `#4B5560` | `#5E5446` |
| primitive | `ink500` (outline) | `#7D8691` | `#857861` |
| primitive | `ink200` (rule) | `#D6DADF` | `#D8CCB8` |
| primitive | `petrol50` | `#E2ECEA` | `#DCE6DF` (warmed) |
| primitive | `amber800`, `amber50` | | `#87470A`, `#F6E3C1` |
| primitive | `slate800`, `slate50` | | `#2D4E73`, `#E1E7EC` |
| primitive | `green800`, `green50` | `#1E6B3C`, `#E6F2EA` | `#2E6A3C`, `#E2ECD9` |
| primitive | `red700`, `red50` | `#B3261E`, `#FCEBEA` | `#A12820`, `#F5DCD5` |
| primitive | `petrol900`, `petrol950` | | unchanged |
| primitive | `font.num` | | `"DM Mono", ui-monospace, Menlo, monospace` |
| primitive | `radius.sm`, `radius.md` | 2 px, 4 px | 4 px, 6 px |
| primitive | `text.2xl`, phone `text-2xl` | 32, 26 | 36, 30 |
| semantic | `text-on-accent` | `grey0` | `paper0` |
| semantic | `warning`, `warning-surface`, `info`, `info-surface` | | `amber800`, `amber50`, `slate800`, `slate50` |
| semantic | `danger` | Needs you, Missing, errors | errors and permanent delete only |
| semantic | `texture` | | 5% fractal-noise grain on page and document panel |
| component | `btn-height` | 44 px | 40 px desktop, 44 px phone (`.sm` 34 px, 38 px in rows) |
| component | `btn-secondary` | white box, 1 px | `paperField` + 1 px `ink500` + 1 px bottom shadow |
| component | `seg` | white boxes | underline tabs, 3 px `accent` |
| component | `chip` | white box | dashed `ink500` capsule |
| component | `input` | 1 px box | 1 px `ink500` + 2 px `ink950` baseline |
| component | `stamp-*` | | DM Mono 11 px caps with a 33% tone border |
| component | `row-height` | 48 px | 62 px |
| component | `colhead-rule` | | `3px double ink950` |

## Contrast

`build.mjs` measures every pair below on each build with the WCAG 2.x formula, and exits non-zero if any pair is under AA. Translucent bars are measured as the colour they composite to, both over the page and over dark text scrolling underneath (the worst case). `shoot.mjs` then runs axe-core (WCAG 2.0 to 2.2, A and AA, including `color-contrast` and `target-size`) on the rendered pages at both widths: 0 violations. Body text needs 4.5:1. Large text and UI outlines need 3:1.

### Native app

<!-- contrast:native -->
| Use | Foreground | Background | Needs | Ratio | Result |
| --- | --- | --- | --- | --- | --- |
| Body text on the page | `text` #1C1C1E | `page` #F2F2F7 | Text 4.5 | 15.25 | Pass |
| Row titles on a grouped list | `text` #1C1C1E | `raised` #FFFFFF | Text 4.5 | 17.01 | Pass |
| Meta and tally on the page | `muted` #5B5B62 | `page` #F2F2F7 | Text 4.5 | 6.04 | Pass |
| Meta line in a row | `muted` #5B5B62 | `raised` #FFFFFF | Text 4.5 | 6.74 | Pass |
| Muted text on the document panel | `muted` #5B5B62 | `sunken` #E5E5EA | Text 4.5 | 5.37 | Pass |
| Row title on a selected row | `text` #1C1C1E | `accentTint` #E2ECEA | Text 4.5 | 14.11 | Pass |
| Meta on a selected row | `muted` #5B5B62 | `accentTint` #E2ECEA | Text 4.5 | 5.59 | Pass |
| Ghost buttons and links on the page | `accent` #0D3A36 | `page` #F2F2F7 | Text 4.5 | 11.23 | Pass |
| Ghost buttons in a row | `accent` #0D3A36 | `raised` #FFFFFF | Text 4.5 | 12.53 | Pass |
| Secondary button label, current sidebar item | `accent` #0D3A36 | `accentTint` #E2ECEA | Text 4.5 | 10.40 | Pass |
| Primary button, nav count | `onAccent` #FFFFFF | `accent` #0D3A36 | Text 4.5 | 12.53 | Pass |
| Primary button while hovered | `onAccent` #FFFFFF | `accentHover` #072522 | Text 4.5 | 16.19 | Pass |
| Delete forever (permanent delete only) | `onAccent` #FFFFFF | `danger` #B3261E | Text 4.5 | 6.54 | Pass |
| Needs you, Missing, Overdue badges | `warn` #8A4B00 | `warnBg` #FFEFD2 | Text 4.5 | 6.00 | Pass |
| Hint under a flagged field | `warn` #8A4B00 | `raised` #FFFFFF | Text 4.5 | 6.80 | Pass |
| Reading, New sender badges | `info` #1D4F91 | `infoBg` #E5EEFA | Text 4.5 | 6.96 | Pass |
| Undo banner and its Undo button | `success` #1E6B3C | `successBg` #E3F1E7 | Text 4.5 | 5.58 | Pass |
| Error banner | `danger` #B3261E | `dangerBg` #FCEBEA | Text 4.5 | 5.67 | Pass |
| Segmented control, unselected segment | `text` #1C1C1E | `segTrack` #E3E3E8 | Text 4.5 | 13.30 | Pass |
| Segment count, unselected | `muted` #5B5B62 | `segTrack` #E3E3E8 | Text 4.5 | 5.27 | Pass |
| Tab bar label over the page | `muted` #5B5B62 | `barOverPage` #F8F8FB | Text 4.5 | 6.35 | Pass |
| Tab bar label over dark text scrolling under it (worst case) | `muted` #5B5B62 | `barOverInk` #E3E3E5 | Text 4.5 | 5.26 | Pass |
| Current tab over dark text (worst case) | `accent` #0D3A36 | `barOverInk` #E3E3E5 | Text 4.5 | 9.78 | Pass |
| Bulk bar text | `onAccent` #FFFFFF | `bulkOverRaised` #16322F | Text 4.5 | 13.71 | Pass |
| Bulk Approve: white button, petrol label | `accent` #0D3A36 | `raised` #FFFFFF | Text 4.5 | 12.53 | Pass |
| Bulk Discard on the bar | `onAccent` #FFFFFF | `onBulkTint` #3B5350 | Text 4.5 | 8.27 | Pass |
| Input, chip and checkbox outline | `fieldBorder` #86868B | `raised` #FFFFFF | UI 3 | 3.62 | Pass |
| Focus ring, current tab icon | `accent` #0D3A36 | `page` #F2F2F7 | UI 3 | 11.23 | Pass |
| Flagged group outline | `warn` #8A4B00 | `raised` #FFFFFF | UI 3 | 6.80 | Pass |
| Checked checkbox tick | `onAccent` #FFFFFF | `accent` #0D3A36 | UI 3 | 12.53 | Pass |
<!-- /contrast:native -->

### Warm paper

<!-- contrast:paper -->
| Use | Foreground | Background | Needs | Ratio | Result |
| --- | --- | --- | --- | --- | --- |
| Body text on the page | `ink` #211C16 | `page` #F3EDE2 | Text 4.5 | 14.51 | Pass |
| Row titles on the ledger sheet | `ink` #211C16 | `sheet` #FBF8F2 | Text 4.5 | 15.95 | Pass |
| Meta, tally and column heads on the page | `muted` #5E5446 | `page` #F3EDE2 | Text 4.5 | 6.36 | Pass |
| Meta line and date in a row | `muted` #5E5446 | `sheet` #FBF8F2 | Text 4.5 | 6.99 | Pass |
| Muted text on the document panel | `muted` #5E5446 | `sunken` #E6DDCC | Text 4.5 | 5.50 | Pass |
| Row title on a selected row | `ink` #211C16 | `accentTint` #DCE6DF | Text 4.5 | 13.22 | Pass |
| Meta on a selected row | `muted` #5E5446 | `accentTint` #DCE6DF | Text 4.5 | 5.80 | Pass |
| Ghost buttons and links on the page | `accent` #0D3A36 | `page` #F3EDE2 | Text 4.5 | 10.76 | Pass |
| Ghost buttons in a row | `accent` #0D3A36 | `sheet` #FBF8F2 | Text 4.5 | 11.82 | Pass |
| Secondary button label, input text | `ink` #211C16 | `field` #FFFDF8 | Text 4.5 | 16.63 | Pass |
| Unit inside an input | `muted` #5E5446 | `field` #FFFDF8 | Text 4.5 | 7.29 | Pass |
| Primary button, nav count | `onAccent` #FBF8F2 | `accent` #0D3A36 | Text 4.5 | 11.82 | Pass |
| Primary while hovered, bulk bar text | `onAccent` #FBF8F2 | `accentHover` #072522 | Text 4.5 | 15.28 | Pass |
| Bulk Approve: paper button, petrol label | `accent` #0D3A36 | `onAccent` #FBF8F2 | Text 4.5 | 11.82 | Pass |
| Delete forever (permanent delete only) | `onAccent` #FBF8F2 | `danger` #A12820 | Text 4.5 | 6.98 | Pass |
| Needs you, Missing, Overdue stamps | `warn` #87470A | `warnBg` #F6E3C1 | Text 4.5 | 5.68 | Pass |
| Hint under a flagged field | `warn` #87470A | `sheet` #FBF8F2 | Text 4.5 | 6.75 | Pass |
| Reading, New sender stamps | `info` #2D4E73 | `infoBg` #E1E7EC | Text 4.5 | 6.88 | Pass |
| Undo banner and its Undo button | `success` #2E6A3C | `successBg` #E2ECD9 | Text 4.5 | 5.31 | Pass |
| Error banner | `danger` #A12820 | `dangerBg` #F5DCD5 | Text 4.5 | 5.66 | Pass |
| Nav label on the translucent bar | `muted` #5E5446 | `barOverPage` #FAF7F1 | Text 4.5 | 6.93 | Pass |
| Nav label over dark text scrolling under it (worst case) | `muted` #5E5446 | `barOverInk` #EAE6E0 | Text 4.5 | 5.96 | Pass |
| Current nav item over dark text (worst case) | `accent` #0D3A36 | `barOverInk` #EAE6E0 | Text 4.5 | 10.08 | Pass |
| Input, chip and secondary button outline | `ruleStrong` #857861 | `sheet` #FBF8F2 | UI 3 | 4.08 | Pass |
| Chip outline on the page | `ruleStrong` #857861 | `page` #F3EDE2 | UI 3 | 3.71 | Pass |
| Input baseline | `ink` #211C16 | `field` #FFFDF8 | UI 3 | 16.63 | Pass |
| Focus ring, current tab rule | `accent` #0D3A36 | `page` #F3EDE2 | UI 3 | 10.76 | Pass |
| Flagged group rule | `warn` #87470A | `sheet` #FBF8F2 | UI 3 | 6.75 | Pass |
| Bulk Discard outline, 55% paper on petrol950 | `onBarOutline` #8D9994 | `accentHover` #072522 | UI 3 | 5.49 | Pass |
<!-- /contrast:paper -->

## What each costs to build in `src/ui.ts`

Both land in PR 11 on top of the `row()` component, the `ACTIONS` and `STATUS` registries, and `src/icons.ts` from PR 10. Neither touches page logic. The shared work: about 60 lines of row, bulk bar, banner and specimen CSS replace `.list li`, `.held`, `.pay` and `.srow`. The tokens move through `scripts/app-tokens.mjs`, and `scripts/app-tokens.test.ts` gains the new `textOn` claims from the tables above.

- **Native app: smaller.** No font work. `src/fonts.ts` (55 KB of base64) and the `/assets/fonts/*` route can go, unless the site keeps sharing them. The app-shell test that pins them changes. Costs: `backdrop-filter` for the bars and sidebar (Firefox has it, older browsers get the opaque fallback colour), the custom round checkbox (`appearance: none` plus a data-URI tick), and the sidebar at 880 px and up, which replaces today's top nav, a layout change to the shell in `layout()`. Estimate: about 220 lines of CSS changed, a net drop in bytes shipped.
- **Warm paper: a little bigger.** DM Mono's two woff2 files join `src/fonts.ts` (+29.8 KB raw, about 40 KB as base64) and the `/assets/fonts/` route. Add a `NOTICE` line for the OFL. The test that compares app fonts with `site/public/fonts` needs the new files on the site side too, or an app-only exception. The grain is a data-URI SVG, under 1 KB. The top nav stays where it is, so the shell layout barely moves. Estimate: about 240 lines of CSS changed, plus 30 KB on first load (cached after).

## Recommendation

Warm paper. It is the one that looks like this app and nobody else's: the till-slip numerals make 132 rows of amounts easy to scan, the stamps and underline tabs finally make every control a different shape, and it keeps the current shell, so the cost is one 30 KB font. Native app is the safer, cheaper pick if the owner mostly works on an iPhone and wants the app to disappear into the system, but on desktop it reads closer to a generic settings pane.

## Rebuild

```sh
mkdir -p /tmp/lucide && (cd /tmp/lucide && npm pack lucide-static@1.65.0 && tar xzf lucide-static-1.65.0.tgz)
node docs/app-v4/mockups/build.mjs /tmp/lucide/package/icons   # writes all three pages and the tables above
node docs/app-v4/mockups/shoot.mjs                             # screenshots, axe, button and dash checks
```

DM Mono: Copyright 2020 The DM Mono Project Authors, SIL Open Font License 1.1 ([fonts/DM-Mono-OFL.txt](fonts/DM-Mono-OFL.txt)). Lucide: ISC licence.
