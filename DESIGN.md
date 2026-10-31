# Design

How Nuits Receipts looks and behaves, and the rules that keep it that way. Read this before you change a screen. The code is the source: each section names the file that owns the rule, and a test or lint fails when the two drift apart.

## Principles

1. **Finish the month without fighting the lists.** A resolved row leaves the list, the next open row moves up, and the banner offers Undo. Open work is never stranded behind a page.
2. **Fewer things on screen.** Cut, merge or automate a control before polishing it. A receipt reaches To do only for a required fact.
3. **One meaning, one look.** An action has one label, one icon and one tone everywhere it appears. A state has one word, one tone and one icon.
4. **Words, always.** Colour and icons never carry meaning alone. Every button has a visible label, and every status has a word.
5. **The server is the source of truth.** Every page works without script. Script only enhances: keyboard shortcuts, bulk selection, the pending cue.
6. **Undo before confirm.** An action that can be undone runs at once and offers Undo. Only an action that loses data asks first.

## The look

The look is the Mix chosen from the mockups in `docs/app-v4/mockups/`: Warm paper's palette and type on Native's layout.

- **Palette:** warm paper surfaces, near-black ink and one petrol green accent.
- **Type:** Bricolage Grotesque for headings, Instrument Sans for everything else, and DM Mono for amounts, dates and status stamps.
- **Layout:** a floating sidebar on a computer, a floating tab bar on a phone, grouped lists, and segmented controls.

The page sits under a 5% paper grain, served as a file because the content security policy allows images from the app only.

## Tokens

`src/tokens.json` is the only source of colour, type, space, radius and shadow. Run `bun run tokens` after any change, which writes `src/tokens.ts`. `scripts/app-tokens.test.ts` fails when that file is stale, and it measures every contrast claim in the JSON.

### Colour

| Role | Token | Use |
| --- | --- | --- |
| Page | `paper50` | The page, under the grain. |
| Sheet | `paper0` | Grouped lists, cards, folds, and the glass tint. |
| Field | `paperField` | Fields, checkboxes and secondary buttons. |
| Sunken | `paper200` | The document panel and the segmented control's track. |
| Text | `ink950` | Body text. |
| Muted text | `ink700` | Meta lines, dates, counts and tab labels. |
| Accent | `petrol900` | The only accent: links, ghost buttons, the current item, the primary fill and the focus ring. |
| Selected | `petrol50` | A selected row, the current sidebar item and the current chip. |
| Done | `green800` on `green50` | Matched, ready, sent, and the Undo banner. |
| Needs you | `amber700` on `amber50` | Needs you, missing and overdue. |
| Info | `slate700` on `slate50` | Reading and a new sender. |
| Danger | `red700` on `red50` | Errors and permanent delete only. |
| Outline | `ink500` | Outlines of fields, chips and checkboxes. Never text. |
| Rule | `ink200` | Hairlines. Decoration only. |

Pages use the semantic names (`--surface-page`, `--text`, `--accent`, `--warn` and so on), never the raw palette. Every text colour reaches 4.5:1 on each surface it is allowed on.

### Type

| Size | Computer | Phone | Use |
| --- | --- | --- | --- |
| `xs` | 12px | 12px | Stamps, tab labels. |
| `sm` | 13px | 13.5px | Meta lines, small buttons. |
| `base` | 15px | 16px | Body and buttons. Fields are 16px on a phone so iOS does not zoom. |
| `lg` | 18px | 18px | Section headings. |
| `xl` | 24px | 24px | Large amounts. |
| `2xl` | 34px | 30px | Page headings. |

### Space, radius and size

- **Space:** a 4px base, in steps of 4, 8, 12, 16, 24, 32, 48 and 64.
- **Radius:** 8 for small parts, 10 for controls, 14 for sheets, 22 for glass, and a full pill for chips.
- **Controls:** buttons are 40px high on a computer and 44px on a phone. Fields are 46px, and list rows are 62px.
- **Layout:** the content is at most 1120px wide, and the sidebar is 260px. The phone layout starts below 880px.

### Glass

Navigation and floating controls use a glass material: the sidebar, the tab bar, the bulk bar and the segmented control's thumb. Content stays solid. The glass is our own CSS (`backdrop-filter`), not a library. Its tint is `paper0` at 0.85 alpha, the lowest value at which every label still reaches 4.5:1 over the darkest thing that can scroll under it.

The glass falls back to a solid sheet in three cases: the browser lacks `backdrop-filter`, the user asks for reduced transparency, or the user asks for more contrast.

## Components

### Buttons and actions

Every control renders from `ACTIONS` in `src/actions.ts`, by action key, never by class string. Each key has one label, one Lucide icon and one tone, so Approve looks the same on a row, in the bulk bar and on the receipt page.

| Tone | Rule |
| --- | --- |
| Primary | The one main action of a view, such as Start checking or Start matching. It sits in the list header and never in a row. |
| Secondary | A plain action. |
| Ghost | A quiet action. |
| Danger | Red, for permanent delete only, behind a confirm step. |

Every action Undo can reverse is secondary or ghost. A row never gets a tone from its position. Icon-only controls are limited to the previous and next chevrons and Close, each with an accessible name and a tooltip.

### Statuses

`STATUS` in `src/status.ts` gives each state one word, one tone and one icon. Stamps set the word in DM Mono capitals with a tinted outline.

| Tone | States |
| --- | --- |
| Needs you (amber) | Needs you, Overdue, Missing |
| Info (slate) | Reading, New sender |
| Done (green) | Ready, Matched, Sent, Paid |
| Muted | Not a purchase, Discarded, Duplicate, Unpaid |

Help's "Words you see" list is typed over the same keys, so a new state cannot ship without its explanation.

### Icons

Icons come from Lucide. `bun run sprite` builds `src/icons.ts` from `lucide-static`, and each page carries one inline sprite holding only the icons it uses. No two meanings share an icon. Icons are hidden from screen readers, since the label next to them carries the meaning.

### Rows

`row()` in `src/row.ts` is the one row component for every list: Receipts, held mail, Bank and the Settings lists. Each row has its parts in fixed places:
- the tick box, always visible;
- the title, a link stretched over the whole row;
- the meta line;
- the amount;
- the status;
- the row's actions.

A list never lays out its own columns.

### Banner

The banner at the top of the page says what just happened, in words, with the name of what it happened to. When the action can be undone, it carries the Undo button. It stays until the next action, so nothing times out.

## Behaviour

### Work lists

Receipts and Bank each have a To do view and an All view, both built from one model in `src/worklist.ts`.

- **To do** shows open rows first and fills the page as rows are resolved. It has no page offset. "Show 50 more" raises the count instead.
- **All** is for browsing and pages with a cursor, so no row is ever skipped.
- **Every action returns to the same list.** The view, month and search are kept, the page lands on the next open row, and the banner offers Undo.

### Motion

A resolved row leaves by a cross-document view transition. No script moves the page: each row is named inline, and the next row's fragment sets the scroll position. Transitions last a quarter of a second. All motion, including colour transitions on hover, is off when the user asks for reduced motion.

### Keyboard

On a computer, `src/keys.ts` adds the shortcuts. `?` opens a sheet that lists them, built from the same table as the Help page.

| Key | Does |
| --- | --- |
| `j` and `k` | Move to the next or previous row. |
| `x` | Select the row you are on. |
| `Enter` | Open the row. |
| `a` and `s` | Approve or skip, on a receipt. |
| `u` | Undo, when the banner offers it. |
| `/` | Focus search. |
| `?` | Show the shortcuts. |
| `Esc` | Close the sheet or clear the selection. |

The keys are off while typing in a field and on touch-only devices.

### Phone

- The tab bar keeps its safe-area inset at the bottom of the screen, and it hides while the keyboard is open.
- On a receipt, the Approve bar stays above the keyboard, because hiding it would put Approve out of reach right after a field is filled. Known gap: an older phone rule in `src/ui.ts` still hides the bar while a field has focus, and `test/app-shell.test.ts` asserts it. Remove both to match this rule.
- Every screen offers a way back inside the app, because the installed app has no browser back button.

### Forms and errors

Settings is one form with one Save. A refused form comes back in place, with the owner's input kept and the error next to its field. A submitted form shows a pending cue, so a second press does nothing.

## Copy

- Plain words a non-accountant understands, in sentence case.
- Name the thing: "Approved Sample Coffee", not "Done".
- One word per concept everywhere, taken from the `ACTIONS` and `STATUS` registries.
- Never an em dash or an en dash. Rewrite the sentence with a comma, a colon or a full stop.

## Accessibility

- Every text colour meets 4.5:1 on each surface it may sit on, measured in the token test.
- Focus is always visible as a petrol ring with a paper gap.
- Touch targets are at least 44px on a phone.
- The banner is announced, and after an action focus moves to the row that took the resolved row's place.
- Status is never colour alone.
- The target is 0 axe violations on every page at both widths.

## How it is checked

| Check | Command | Fails when |
| --- | --- | --- |
| Tokens and contrast | `bun run test:scripts` | `src/tokens.ts` is stale, or a text colour misses 4.5:1. |
| Controls | `bun run test` | A button lacks an icon or a word, a row holds a primary, or two meanings share an icon. |
| Rendered pages | `bun run ui-lint` | A page uses an off-scale font, font size or gap, or a control sits too close to an edge. The policy is `scripts/ui-policy.json`. |
| Journeys and axe | `node scripts/ux-journeys.mjs` | A journey misses a check, or a page has an axe violation. |

The decisions behind this design, and the options ruled out, are in `docs/app-v4/PLAN.md`, `docs/app-v4/DECISION.md` and `.trail/learnings/`.
