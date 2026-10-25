# Changelog props

Line art for the changelog comic (`/changelog/`), one per scope or label. `scripts/changelog-render.mjs` puts a prop in the tone corner of a panel whose entry has that scope; `ui` uses `ledger`. A scope with no file gets no prop, and the page builds without any of them. Splash slips in the book and ink panels show none.

## Generation (2026-10-25)

- Recraft API, model `recraftv3` with the site's brand style `12d5ea2f-5760-454b-bbc2-b265542ee0da`, vector (SVG) output, 1024x1024, two candidates per prompt.
- 20 images, 1000 units (USD 1.00). No retries.
- Every prompt ended: "centered, isolated on plain background, bold ink outlines, flat fills, no text, no logos, no people, no faces".

| File | Scope or label | Prompt | Chosen |
| --- | --- | --- | --- |
| `receipts.svg` | receipts | A single thermal receipt slip with a torn zigzag bottom edge, a few printed lines and a small total line | c1c812f4 |
| `bank.svg` | bank | A generic bank statement strip: three ruled transaction rows, a highlighted matched row with a check mark (no numbers) | 58eb95c4 |
| `settings.svg` | settings | Two round settings dials with notches and a small toggle switch | 37334ea4 (the other read as a face) |
| `setup.svg` | setup | A short setup checklist card, three ticked boxes, one empty | 49baa897 |
| `nav.svg` | nav | A horizontal navigation tab bar, four tabs, second raised and selected | df9a5ad9 |
| `review.svg` | review | A magnifying glass over a small receipt slip | bdd74eeb |
| `app.svg` | app | A simple app window, three title-bar circles, sidebar, two cards | fdb2ca25 (the other read as a face) |
| `mail.svg` | mail | A mail envelope with a receipt slip peeking out | bd661f62 |
| `docs.svg` | docs | A documentation sheet, folded corner, heading bar, small code block | b86d53c9 |
| `ledger.svg` | ui, generic | An open ruled ledger book, two columns of bars, a pencil | cc00513e |

## Cleaning

`node scripts/clean-recraft.mjs src/assets/svg/props <raw>/*.svg` does the following:

- drops the C2PA metadata, the full-canvas background and every inline colour
- classes each shape by its fill: `ik` (ink) for dark, `pp` (slip) for white, `mt` (mint) for light grey
- crops the viewBox to a square round the drawing
- runs svgo with `svgo.config.mjs`, at whole-unit precision

Colours come from `src/styles/changelog.css`. No bank logos, bank colours, people or faces.
