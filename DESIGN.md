# Nuits Receipts: brand and design

The reference for anything that carries the Nuits Receipts name: the app, the marketing site, the docs, the changelog, and whatever comes next (a new site, an email, a social card, a slide). Read it before you design or write for any of them.

It has three layers:
- **Brand:** who we are, what we promise, how we sound. Never varies.
- **Identity:** the logo, colour, type and motifs. The core never varies; each surface tunes the rest within the rules.
- **Product design:** how the app behaves, and the principles any new product surface inherits.

Each surface keeps its own detailed guide, which follows this one:

| Surface | Lives in | Detailed guide |
| --- | --- | --- |
| The app | `src/` | This file's product section, `docs/ARCHITECTURE.md`, `src/tokens.json` |
| Marketing site, receipts.nuits.net | `site/` | `site/DESIGN.md`, `site/tokens.json` |
| Docs, receipts.nuits.net/docs | `docs-site/` | `docs-site/WRITING.md`, `docs-site/src/styles/globals.css` |
| Changelog, receipts.nuits.net/changelog | `site/changelog/` | the changelog section of `site/DESIGN.md` |

When a surface guide and this file disagree, this file wins on brand and identity. The surface guide wins on its own mechanics.

## 1. Brand

### What it is

**Nuits Receipts** is a receipt inbox that runs on Cloudflare Workers. Freelancers and sole traders deploy their own copy into their own Cloudflare account. Receipts arrive by email or upload, AI reads them, the app suggests matches against the bank statement and flags what is missing, and at month end it prepares a ZIP and a CSV for the accountant.

- **Audience:** freelancers and sole traders who already use Cloudflare and dread month end. The second readers are their accountants, and the contributors who change the code.
- **The job it does:** gets the month closed without a fight.
- **What it is not:** bookkeeping, tax or VAT advice, an archive, or a service someone else runs for you. The owner checks every figure and the accountant decides.

### Names

| Name | Use |
| --- | --- |
| **Nuits Receipts** | The product. Two words, both capitalised. |
| **Nuits** | The maker, a sole trader in Helsinki, and the short form in running text ("Nuits never sees your data"). |
| **A receipt inbox that runs on Cloudflare Workers** | The descriptor, after the name in titles and metadata. |

- Cloudflare is something the product runs on, never part of its name. Never "Cloudflare Receipts", "Receipts for Cloudflare" or "CF-Receipts".
- An install may rename itself with `APP_NAME`, so product UI reads the name from config instead of hard-coding it.

### Promise and positioning

Open with the problem. The product is small, honest and yours: it runs in your own Cloudflare account, it is open source, and it states what it costs and what it cannot do. It never sells certainty it does not have.

### Voice

Deadpan, plain and exact. A careful bookkeeper who also writes well.

- Short sentences in sentence case. British spelling ("organise", "colour", "licence" as a noun).
- "You" for the reader. Tutorials may say "we".
- Say what it does, never what it guarantees. It *reads* receipts, *suggests* matches, *flags* missing ones and *prepares* a CSV. Figures are AI-extracted, and the user checks them.
- Name the thing. "Approved Sample Coffee", not "Done". "3 receipts need you", not "Action required".
- One word per concept, everywhere. The app's status words (Needs you, Missing, Matched, Not a purchase, Sent) are the brand's words on every surface.
- Lead with the plain fact and drop the adjective. No exclamation marks in product copy.
- No humour at the reader's expense, and no mascots or characters. The changelog's manga strip is the one sanctioned place for play.
- Never an em dash or an en dash, in any language. Rewrite with a comma, a colon, a full stop or parentheses. Ranges use a hyphen or "to".

### Wording that is fixed

These lines came out of the legal and copy reviews. Use them word for word or not at all. The site and docs builds fail on most of the banned list (`site/scripts/check-copy.mjs`, `docs-site/scripts/check-copy.mjs`). Copy those checks into any new surface.

| Topic | Say | Never say |
| --- | --- | --- |
| Cost | "AI reading costs about 15 cents a month. You may need Workers Paid ($5) for PDFs." | "free to run", invented savings |
| Privacy | "Nuits never sees your data." | "never leaves your account", "stays in your account", "bank-grade", "secure by design" |
| Banks | "Imports CSV exports from banks that provide one: presets for some layouts and a column mapper for others." Name a bank only when a preset ships for it. | "any bank" without a qualifier, "integration", "partner", "official", bank logos or bank colours |
| Accuracy and law | "Check every figure. Not tax or accounting advice. No warranty. Not affiliated with Cloudflare or any bank." | "VAT-compliant", "compliant", "tax-ready", "audit-proof", "100% accurate", "never miss", "guaranteed", "does your bookkeeping", "replaces your accountant", "calculates your VAT", "integrates with" |
| AI models | "Clairic", plus once per surface that it is a Cloudflare preview model. | Clairic as the headline |
| Proof | Measured figures only, or nothing. | testimonials, "trusted by", "thousands of", user counts, logos, placeholders |

Every public web page carries the trader identification exactly as written: "Nuits, sole trader (Bapusaheb Shankaragouda Patil), Business ID 3584845-8, Helsinki, hi@brandnuits.com". The only public email address is hi@brandnuits.com. Never publish Cloudflare account or resource IDs, private repository links, or links to commit pages.

## 2. Identity

### The idea

**Money paper.** Everything the brand draws comes from the paper trail of a month's money: receipt slips with torn feet, rubber stamps that say what happened, cheque paper with guilloche security lines, dot-matrix print from thermal and till printers, and ledger rules. Use these motifs, and nothing generic (no gradients as decoration, no stock photos, no 3D blobs).

The stamp is the signature. It is how the brand says what happened to a thing: MATCHED, MISSING, SENT. A stamp always carries its word.

### Logo

The mark is a receipt: a petrol ink slip with a zigzag torn foot and three paper-coloured lines, on a rounded paper-mint square.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#E6EFE9"/><path d="M5 2h14v19l-2.33-1.5L14.33 21 12 19.5 9.67 21l-2.34-1.5L5 21z" fill="#0D3A36"/><path d="M8 7h8M8 10.5h8M8 14h5" stroke="#E6EFE9" stroke-width="1.6" stroke-linecap="round"/></svg>
```

- **Masters:** `site/public/favicon.svg`. The app renders the same drawing from `src/icon.ts`, which also produces the install icons.
- **Do:** keep the two colours, the square and the proportions. Inside a masked icon (Android, iOS), the glyph sits on full-bleed paper with the OS rounding the corners, as `src/icon.ts` does.
- **Don't:** recolour it, outline it, add a shadow or gradient, rotate it, or put it on a busy background.
- **Wordmark:** the mark followed by "Nuits Receipts" set in Bricolage Grotesque, in ink. Never draw the name in another face.

### Colour

One ink runs through everything: **petrol `#0D3A36`**. It is the text colour on the site, the app's only accent, the docs' brand colour and the body of the logo. Around it, each surface has its own paper.

**Brand core** (the same hex on every surface):

| Name | Hex | Role |
| --- | --- | --- |
| Petrol ink | `#0D3A36` | Text, the accent, the logo, the focus ring. |
| Paper mint | `#E6EFE9` | The brand paper: the logo square, the site page. |
| Stamp red | `#A8123F` | A stamp's word, the site's one primary button, danger. Always with words. |
| Mint | `#9FD3BC` | The Matched stamp's fill, and the accent on dark grounds. A fill, never text. |
| Guilloche | `#C2D8CB` | Security-print lines and strong borders. A fill or a line, never text. |
| Slip white | `#FFFFFF` | Receipt slips and cards. |

**Per surface:**
- **Marketing site.** Cheque-mint paper with white slips, plus `inkSoft #355650` for secondary text. Light only: "the page is a piece of paper".
- **Docs.** Lighter mint paper `#F3F8F5` with white cards in light mode. Dark mode runs on deep petrol `#0A2623`, with mint as the brand and a pink-red `#FF93AE` for danger.
- **App.** Warm paper (`#F3EDE2` page, `#FBF8F2` sheet), because people work in it for hours. It adds working state colours: amber `#87470A` for needs-you, green `#2E6A3C` for done, slate `#2D4E73` for info, and red `#A12820` for errors. Light only. The petrol ink is unchanged.

**Rules for every surface:**
- Each surface has one token file, and no hex lives anywhere else: `src/tokens.json`, `site/tokens.json`, or the `--nb-*` variables for the docs. The exceptions are files that cannot read a variable, such as the favicon and the theme-color meta.
- Every text pairing is measured, and the build fails under 4.5:1 for body text. Mint and guilloche never carry text.
- Petrol is the only accent. A new surface may pick its own paper, but not a second accent.
- Red means a stamp, a primary call to action on the marketing site, or danger. It is never decoration.
- No state is shown by colour alone. A state always has its word and usually its icon.

### Type

| Role | Face | Where |
| --- | --- | --- |
| Display: headings, the wordmark, big numbers | **Bricolage Grotesque**, condensed (`wdth` about 82), weights 600 to 800 | Everywhere |
| Text: body, UI, labels | **Instrument Sans**, weights 400 to 600 | Everywhere |
| Figures: amounts, dates, stamps in the app | **DM Mono** | The app. The marketing site has no monospace face. The docs set code in JetBrains Mono, an older choice; new surfaces use DM Mono for any monospace |

- All three are OFL. Self-host them as Latin subsets: never load fonts or anything else from a third party. The system font stack is only a fallback.
- Use tabular numerals wherever amounts line up.
- Headings are tight: negative tracking (-0.03em for the site's display size, -0.015em for the app's page title) and leading near 1.
- Stamps are set in capitals with wide tracking, in DM Mono in the app and Bricolage on the site.

### Shape, surface and texture

- **Radius:** slips and receipts are nearly square, at 2px on the site. Buttons and chips are pills. The app's working surfaces are softer (8 to 22px) because they are controls, not paper.
- **Shadow:** one soft shadow for a lifted slip. Never stack shadows.
- **Lines:** 1px ink hairlines, or a dashed perforation where paper tears.
- **Texture:** guilloche and dot-matrix fields on the marketing site, and a 5% paper grain in the app. Texture sits behind content and never under body text.
- **Glass:** the app only, for navigation and floating controls, with a solid fallback. The site and docs have none.

### Iconography and illustration

- **Icons:** Lucide line icons at a 2px stroke, in the text colour, always next to a word. Icon-only controls are limited to previous, next and close, each with an accessible name.
- **Illustration:** bold filled ink outlines in petrol, with white slip and mint fills, and stamp red only where the drawing is a stamp. Colour comes from CSS classes, not from the file. The site's set was made with one Recraft brand style; use the same style for new pieces.
- **Screenshots:** real screens of the real app with sample data, reshot when the UI changes. Alt text says what the screen shows.
- **Never:** Cloudflare's logo outside its official, unmodified Deploy button; bank logos; stock photography; mascots.

### Motion

Motion is how paper behaves: it is printed, stamped, torn, slid and turned.

- **Purpose first.** In the product, motion shows where a thing went, such as a resolved row leaving. On the marketing site, it tells the story while you scroll.
- **Words never fade.** Headings wipe in, and text never animates its opacity.
- **Respect the reader.** Reduced motion, an off switch where a surface offers one, and no JavaScript all get the settled frame. Nothing waits hidden for a trigger.
- **Budget by surface.** The app moves rows and nothing else, in about a quarter of a second. The docs stay still. The marketing site and changelog may stage scenes, within the budgets in `site/DESIGN.md`.

## 3. Product design

These principles come from the app, and they apply to any product surface built later.

1. **Finish the job without a fight.** Lists show open work first and refill as items are resolved. A resolved item leaves with Undo, and the next one moves into its place. Nothing is stranded on a later page.
2. **Subtract first.** Cut, merge or automate a control before polishing it. Ask the owner only when the app cannot decide.
3. **One meaning, one look.** An action has one label, one icon and one tone everywhere. A state has one word, one tone and one icon.
4. **Words, always.** Every button has a visible label, and every state has a word.
5. **The server is the source of truth.** Every page works without script. Script only enhances.
6. **Undo before confirm.** An action that can be undone runs at once and offers Undo. Only an action that loses data asks first.
7. **Say what happened.** After every action, a banner names what changed and offers Undo when it can.
8. **Desktop and phone are equal.** A sidebar on a computer, a tab bar on a phone, targets of at least 44px, and a way back on every screen.

### Controls and states in the app

`ACTIONS` in `src/actions.ts` holds every control's label, icon and tone, and `STATUS` in `src/status.ts` holds every state's word, tone and icon. New UI renders from these registries, never from a class string.

| Tone | Rule |
| --- | --- |
| Primary | The one main action of a view, in its header. Never in a list row. |
| Secondary | A plain action. |
| Ghost | A quiet action. Anything Undo can reverse is secondary or ghost. |
| Danger | Red, for permanent delete only, behind a confirm step. |

| State tone | Words |
| --- | --- |
| Needs you (amber) | Needs you, Overdue, Missing |
| Info (slate) | Reading, New sender |
| Done (green) | Ready, Matched, Sent, Paid |
| Muted | Not a purchase, Discarded, Duplicate, Unpaid |

The rest of the app's system is the work-list model (`src/worklist.ts`), the one row component (`src/row.ts`), keyboard shortcuts with a `?` sheet (`src/keys.ts`), and cross-document view transitions. `docs/ARCHITECTURE.md` describes each of them. The decisions and the options ruled out are in `docs/app-v4/` and `.trail/learnings/`.

**Known gap:** on a phone, an older CSS rule in `src/ui.ts` still hides the receipt's Approve bar while a field has focus, and `test/app-shell.test.ts` asserts it. The intended rule is that Approve stays above the keyboard.

## 4. Shared standards

These apply to every surface, existing or new.

- **Accessibility:** WCAG 2.2 AA. Text contrast is measured, focus is always visible as a petrol ring, the target is 0 axe violations, and nothing is conveyed by colour alone.
- **Privacy:** no cookies, no analytics, and no third-party requests. Fonts, scripts and images are served from the same origin. A strict content security policy, with scripts as files and none inline.
- **Performance:** server-rendered or static HTML first, with script loaded late and only where it earns its place. Set a weight budget and check it in the build, as `site/scripts/check-weight.mjs` does.
- **Honesty:** facts come from the code, not from older prose. Every figure is measured or left out.
- **Checks in the build:** banned copy and long dashes, contrast, and weight. A new surface copies these checks before it ships.

## 5. Starting a new surface

1. Read this file, then the guide of the existing surface closest to yours.
2. Create one token file. Reuse the brand core hexes exactly, choose a paper, and measure every text pairing.
3. Self-host Bricolage Grotesque and Instrument Sans, plus DM Mono if you show figures.
4. Use the logo master from `site/public/favicon.svg` unchanged.
5. Copy a `check-copy.mjs` and keep its banned list and the long-dash rule.
6. Write copy in the brand voice with the fixed wording above, including the trader line on public web pages.
7. Choose a motion budget for the surface and give it a reduced-motion fallback.
8. Write the surface's own guide next to its code, and add it to the table at the top of this file.
