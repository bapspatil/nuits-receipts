# Nuits Receipts site: design and voice

## Identity

The page is money paper. Cheque-mint ground, petrol ink, white receipt slips with torn feet, and rubber stamps that say what happened to each payment. The memorable element is the stamp: it appears on the hero slip, on every row of the example statement and in the statement's own tally, and nowhere else.

Audience: freelancers and sole traders who already use Cloudflare and dread month end. Job of the page: say what the product is, why it exists and what to click, in that order, then show the arithmetic.

## Voice

- Deadpan, plain, sentence case. Short sentences.
- Lead with the problem. Clairic is credited, never the headline. Its preview disclaimer appears exactly twice on the home page, in How it works and in the small print; everywhere else it is plain "Clairic". `scripts/check-copy.mjs` enforces the count.
- Cost is stated one way: "AI reading costs about 15 cents a month. You may need Workers Paid ($5) for PDFs." Never "free to run".
- Describe a data tool, not a service or advice: it organises receipts, suggests matches, flags missing ones and prepares a CSV for your accountant. Wording rules come from the legal review, section 3, and `scripts/check-copy.mjs` enforces the banned list.
- Cloudflare is referred to, never part of the name: "runs on Cloudflare Workers". Banks are plain text, never logos, colours, "integration" or "partner".
- Never: compliance claims, tax advice, invented numbers, testimonials, logos, user counts, elves.
- The only figures on the page are the brief's measured ones. Anything the maintainer has not measured yet is left off the page.
- No long dashes anywhere. `scripts/check-copy.mjs` fails the build on one. Where a legal text supplied one, it became a comma.

## Colour

Source: `tokens.json`. Generated: `src/styles/theme.css`, `src/shaders/palette.wgsl`. Measured by `scripts/check-contrast.mjs`.

| Pair | Ratio | Allowed as |
| --- | --- | --- |
| ink on paper | 10.68:1 | any text |
| ink on slip | 12.53:1 | any text |
| inkSoft on paper | 6.88:1 | body text |
| stamp on slip | 7.44:1 | body text (Missing stamp) |
| white on stamp | 7.44:1 | body text (primary button) |
| ink on mint | 7.47:1 | body text (Matched stamp) |
| guilloche on paper | 1.28:1 | lines only, never text |
| mint on paper | 1.43:1 | fill only, never text |

The official Deploy to Cloudflare button is the one element outside the palette: it carries Cloudflare's own black and orange and is used unmodified, so the tokens never touch it.

Rules that fall out of it: guilloche and mint are fills. Stamp red is only ever a fill under white text or the colour of a stamp's own word. No state is shown by colour alone: every stamp carries its word.

### The field is a background

| Field | Picks (measured) | Swing | Text that survives on it |
| --- | --- | --- | --- |
| heroField | paper, guilloche | 1.28:1 | ink 8.34:1, inkSoft 5.38:1, stamp 4.95:1 |

Picks come from `scripts/measure-field.mjs`, which renders the real shader in Chrome (SwiftShader WebGPU), counts every colour, and fails if any pixel is not an exact palette colour. Measured: 89% paper, 11% guilloche, nothing else.

```
Treatment:  engraved guilloche lines, no fills. Two rosettes plus horizontal security waves.
Placement:  hero only. Rosette behind the receipt slip (wide) or the top-right corner (narrow).
            Quiet zone: no waves under the copy column.
Palette:    two picks, paper and guilloche, hard select, no blending.
Motion:     scroll position through the hero. Still when the reader is still. Off means frame 0.
Field:      two-harmonic rosettes, radial distance in device pixels.
Why:        the product is about money paper, and guilloche is how money paper proves it is real.
```

Fallback: `measure-field.mjs` saves the same frames as `public/field-fallback-{wide,narrow}.png` (1-bit palette PNGs). No WebGPU, a software adapter, a failed chunk or no JavaScript all show those pixels.

| Field | Picks (measured) | Swing | Text that survives on it |
| --- | --- | --- | --- |
| inkField | ink, inkSoft | 1.55:1 | paper 6.88:1, slip 8.08:1 |

Picks come from `scripts/measure-ink.mjs`, which renders `src/shaders/ink.glsl` in Chrome (SwiftShader WebGL) and fails on any colour that is not an exact token.

```
Treatment:  dot-matrix print, 3px square dots on a 6px grid, ordered dither. No lines, no fills.
Placement:  the two ink sections only. How it works: printed rows streaming into ledger lines,
            sparse on the left under the copy. The close: ink soaking in from the right edge.
Palette:    two picks, ink and inkSoft, hard select, no blending.
Motion:     rows step a whole cell at a time, like a print head; the bleed spreads with scroll
            through the close and its edge breathes. Off means the settled frame.
Field:      value noise and a 4x4 Bayer threshold per CSS-pixel cell.
Why:        the receipts this page is about came out of thermal and dot-matrix printers.
```

One canvas and one WebGL context serve both sections: the canvas moves into whichever section is on screen. It is drawn at one device pixel per CSS pixel and shown pixelated, so the dots are the same at every DPR. It starts only when a section is within half a screen, runs at about 30 frames a second, stops off screen and in hidden tabs, and refuses software renderers outside the tooling (`?fx-force`). Fallback: `measure-ink.mjs` saves the settled frames as `public/ink-{rows,bleed}-{wide,narrow}.png` (1-bit, 1 to 2 KB each), shown unscaled. No WebGL, a software renderer, reduced motion, the switch set to off or no JavaScript all show those pixels.

Dark mode: not shipping. The page is a piece of paper.

## Type

| Use | Font | Licence |
| --- | --- | --- |
| Display, stamps, numerals | Bricolage Grotesque, pinned to opsz 96, wdth 82, wght 600 to 800 | OFL |
| Body, UI, figures | Instrument Sans, wdth 100, wght 400 to 600 | OFL |

Both are self-hosted Latin subsets (`scripts/fonts.sh`), 21 KB and 20 KB. Figures use tabular numerals so amount columns line up. There is no monospace face.

## Illustrations

Recraft line art in the ink of the page: bold filled ink outlines, white slip and mint fills, stamp red only where the drawing is a stamp. Colour comes from classes in `src/styles/motion.css`, never from the file. The set: an envelope with a slip (the problem), send, read and match icons (How it works) and an export sheet whose arrow turns into a tick (the close), all generated with one Recraft brand style and cleaned by `scripts/clean-recraft.mjs` (log in `src/assets/recraft/README.md`). The guilloche seal on the cost slip is computed by `scripts/make-seal.mjs` from the hero field's curve family, because Recraft's seals were not guilloche. They are inlined into the HTML at build time, so they paint without JavaScript.

## Surface

Two radii: 2px for slips, pills for buttons. One shadow, on slips and scraps only. Hairlines are 1px ink or a dashed perforation. No gradients as decoration, no glass, no blur, no translucency under text.

## Motion

| Motion | Duration | Curve |
| --- | --- | --- |
| Hero wipe, per line | 420 ms, 60 ms stagger | cubic-bezier(0.22, 0.61, 0.36, 1) |
| Button press | 90 ms | ease-out |
| FAQ plus sign | 180 ms | same curve |
| Menu opens: sheet prints down, then rules and lines rise | 560 ms; lines 480 ms from 220 ms, 50 ms stagger | cubic-bezier(0.7, 0, 0.2, 1), lines on the wipe curve |
| Menu closes: lines sink, then the sheet tears away up | 200 ms, then 440 ms from 140 ms | same |
| Scrubbed scenes | scroll position, 0.6 s smoothing | none |
| Heading wipe, per word | 520 ms, 45 ms stagger | the hero wipe curve |
| Hero full stop lands | 520 ms at 600 ms | cubic-bezier(0.3, 1.5, 0.5, 1) |
| Illustration ink traces, then fills | 1.1 s, 45 ms stagger per shape | the site ease |
| Export arrow to tick and back | 450 ms each way, every 3.3 s | power2.inOut |
| Ambient loops | 5.5 s bob, 9 s drift, 80 s seal, 1.1 s caret | ease-in-out, linear, steps |
| Native scroll timelines | scroll position | linear |

Storyboard (desktop, motion on; everything else gets the static end state):

| Scene | Archetype | Camera | What changes while scrolling |
| --- | --- | --- | --- |
| Hero | full-bleed type over field | hold, not pinned | field rotates with scroll; the slip lifts away |
| The problem | statement plus scattered scraps | assemble | scraps slide into one pile; the slip sinks into the envelope |
| How it works | rail | track, pinned 1.4 screens | three steps pass under a held title, a meter tracks them, rows print behind |
| The match | ledger | stamp, pinned 1.2 screens | stamps land row by row (narrow screens: native view timelines) |
| Demo | screening room, ink | none | the player sits in a film strip; nothing moves until the reader presses play |
| Cost | specimen with margin notes | none | the cost slip rises into place |
| So far | spec sheet, ruled rows | none | each row rises a little |
| Limits | a letter on a slip | none | the won't-do boxes get struck through |
| FAQ | numbered index, title held by CSS sticky | none | the plus turns to a cross |
| Close | full-bleed statement | none | the words step down onto one baseline, ink bleeds in, the caret blinks, then the footer tears off: the end |

Every section title also wipes in word by word just before it arrives, and every illustration traces its ink outlines on, then fills them. A 3px reading-progress line runs along the top edge, driven by a native scroll timeline.

Rules: words never fade. A heading is split into words only when it is about to enter the viewport, and the wipe then runs to the end on its own clock, so a heading on screen is either whole or actively revealing. Illustrations keep their paper and mint regions painted while their ink traces, so a half-drawn icon is never an empty box. Loops pause off screen. Native scroll timelines sit behind `@supports (animation-timeline: view())` and `html[data-motion="on"]`, so a browser without them is never left at a keyframe's start. Nothing waits hidden for a trigger; scrubbed tweens only move content that is already painted (the one exception is the ledger stamps, which wipe in while their rows stay visible). Pins come from script only. Reduced motion, the on-page switch set to off, narrow screens and no JavaScript all get no pins, a still field and no wipe delays. Reduced motion, the switch set to off and no JavaScript also get no loops, no scroll timelines, no split-word wipes and no WebGL: the ink sections show their fallback print.

## Sections

Every scene after the hero opens with a slate: a two-digit index, the scene's short name in spaced capitals, and a perforation running to the right edge. The slate is `aria-hidden` decoration; the h2 is the heading. It is ink on paper and paper on ink, so the page reads as one roll filed in order, 01 The problem to 09 Deploy.

Each scene composes one paper object against its ground differently, so no two neighbours share a shape: the hero sets the title edge to edge with the slip hanging beside its short second line, clear of the first line's descenders and the sub and cost line as a two-column chit; the problem puts the scraps and the envelope on a ruled desk; How it works is printed tickets on a rail; the match is a bank statement slip with an ink header band, ruled columns and a tally of its stamps (counted from the example rows); the demo is the one ink scene that is not an ink field, a screening room with the player in a film strip; cost is the slip as a specimen with the copy hung beside it as margin notes; so far is a spec sheet of three ruled rows; limits is a letter printed on a slip; the FAQ is a numbered index; the close is the largest type on the page.

## The demo player

Media Chrome (`media-chrome`, pinned) wraps the real `<video>`, which keeps its native `controls` in the HTML. `src/player.ts` loads the components when the demo comes within a screen of view (or at once on `/#demo`) and removes `controls` only after they register, so a failed chunk leaves the native player. The controller's height is computed from its container's width, so the bar arriving shifts nothing. The big play button shows only while paused. Captions are on by default with and without JavaScript. Colours come from token variables; transitions are off inside the components because the page's motion clamp cannot reach their shadow DOM.

## Chrome

The bar is an opaque plate of paper with a torn foot, sticky at the top in CSS alone (so it holds with no script and with motion off), above the reel's pins and the ink scenes. Every `[id]` has `scroll-margin-top: calc(var(--bar-h) + 0.5rem)` so anchors land below it, and the FAQ's sticky title sits under it. It holds three things at every width: the wordmark, one primary action (Deploy, stamp red) and a Menu button that turns into Close. Everything else is in the full-screen menu: a native `<details>` whose panel is an ink sheet that prints down out of the bar with a torn foot, the four sections at display size (01 to 04), then Docs, Privacy and GitHub, and a foot with the descriptor and the motion switch. With no script it opens and closes natively; the sheet is fixed (the bar is sticky, so it would travel with it anyway), so following an in-page link lands under the sheet and Close shows the section; the footer nav also lists every link. `src/nav.ts` (home, privacy and 404) locks the page, marks the rest of the page inert and wraps Tab inside the bar, closes on Escape (focus returns to the trigger), animates the close, and on an in-page link closes first and then scrolls. It also runs a scroll spy that sets `aria-current="location"`, marked by an underline and a heavier rule, never by colour alone. The nav list lives once, in `src/partials/nav.html`, and the partials plugin expands it into the menu and the footer.

The footer is the receipt's stub: a torn top edge, the wordmark at display size with the footer nav and the Deploy badge, the small print in two columns, the trader identification and licence and trademark lines, and a centred tail ending on "No receipt needed for this page."

## The changelog

`/changelog/` reads the releases like a manga volume, one spread per release. It is built from `CHANGELOG.md` at site build time by `scripts/changelog-plugin.mjs` (parser in `scripts/changelog-parse.mjs` at the repository root, spreads in `scripts/changelog-book.mjs`), so every word is real HTML and a new release needs no hand work. The build fails if the newest release is not the version in `package.json`.

```
Idea:        every release is a spread in a manga volume about the app
Metaphor:    an open book: the art on the left page, the notes on the right
Signature:   the page turns in 3D and lands on the next release (src/book3d.ts)
Motion verb: turn
Screenshot:  a leaf mid-turn, screentone shade on it, the next release beneath
```

- The page opens on the newest release, or the one in the URL (`#1.12.3`; the old `#v1-12-3` anchors still resolve). Nothing to click first.
- Wide screens (64rem by 37.5rem and up): the book, older and newer arrows either side, a version scrubber along the foot (hover shows the art, drag flips through thumbnails only). Phones: one page, version, art, then notes, with a sticky row of version chips.
- Direction is manga: older is to the left. Left arrow and Page Down go older, right arrow and Page Up newer, Home the oldest, End the newest. Swipe right goes older.
- Notes page: the version huge, a short title, the date and the kind stamp, at most five bullets, "Read full notes" (every section) and the GitHub release link, Copy link, and the SHIPPED stamp.
- Hidden spreads are `hidden="until-found"` with lazy art, so find in page still opens them and only the open release's art loads. The next and previous art is prefetched while idle. "All releases" lists every release as text. Without JavaScript every release opens through `:target`.

### Art

- The latest three releases get a full strip (`art/strip-<version>.png`), older ones a one-panel card cut from the mascot sheet (`art/mascot-sheet.png`), by kind. Crops, label paint-outs, titles and sound words live in `changelog/art.json`.
- `bun run art` writes AVIF, WebP, a 256 px thumbnail and a blurred placeholder for each into `public/changelog-art/`, and fails over 200 KB AVIF or 320 KB WebP.
- The newest release's art is the only image in the first view (`fetchpriority="high"`). First view budget 550 KB, held by `scripts/check-weight.mjs`.

| Kind | Stamp | Sound word | Card |
| --- | --- | --- | --- |
| Breaking changes | Breaking | KRAK! | shocked |
| Features | New | KA-CHUNK! | proud |
| UI enhancements | Restyled | SHFF! | neutral |
| Hotfixes | Fixed | TAK! | sweating |
| Fixes | Fixed | TAK! | smug |
| Documentation and project site | Docs | FLIP! | sleepy |

Stamps and sound words are `aria-hidden`; the section headings are the real text.

### Motion

| Motion | Duration | Curve |
| --- | --- | --- |
| 3D turn: the leaf lifts off the page on the side you are going, bends with its free edge lagging, and lands on the other side showing the arriving page | 900 ms | power2.inOut |
| Slide (phones, no WebGL, a software or slow GPU, Save-Data, low memory): the old spread slides out, the new one in | 260 ms out, 360 ms in | the turn ease |
| A turn asked for mid-turn finishes the turn first | 150 ms | linear |
| Stamp and sound word pop in on the arriving spread | 420 ms and 380 ms | an overshoot, cubic-bezier(0.3, 1.6, 0.5, 1) |

Reduced motion, the switch set to off and no JavaScript get an instant swap. three.js and GSAP are never loaded for them.

### The 3D book

`src/book3d.ts` with `src/shaders/book.*.glsl`, three.js in its own lazy chunk (budget 160 KB gzipped, held by `scripts/check-weight.mjs`). It loads on idle after the page, only on a wide screen with motion on, WebGL2, no Save-Data, at least 4 GB of device memory and a hardware GPU (`?fx-force` lets SwiftShader through for testing).

- Each spread is captured by drawing a clone of it, with the page's styles, fonts and art inlined, into an SVG `foreignObject`. The open spread and its two neighbours are captured while idle, so a turn starts at once.
- One fixed canvas, a 30 degree camera set so z = 0 is one CSS pixel per unit. A flat plane holds the page that stays; the leaf is a 48 segment strip bent in the vertex shader (closed form arc). Shade is a 4x4 Bayer dither to inkSoft, never a blend.
- Drawn on GSAP's ticker only during a turn. Under 40 frames a second, a lost context or any error hands the turn to the slide for the session. Disposed on `pagehide` and when the motion switch goes off.

## Don'ts

- No elves, mascots or characters.
- No email capture, waitlist or anything that gates the download.
- No cookies, no analytics. The motion switch's localStorage choice is the only stored value, and the privacy notice names it.
- No Cloudflare logo except inside the official Deploy badge. No bank logos or bank colours.
- No restyled, recoloured or wrapped Deploy button.
- No stats, logos, quotes or counts that the maintainer has not measured.
- No tax or VAT compliance claims.
- No colour-only states.
- No text in guilloche or mint.
- No accent-coloured focus rings; focus is ink, 2px, 3px offset.
- No opacity on text, moving or still.
- No third-party requests: fonts, scripts and images are all same-origin.
- No long dashes.
- No hex in CSS or shaders outside `tokens.json`. The favicon SVG and the theme-color meta repeat paper and ink because they cannot read a variable.
