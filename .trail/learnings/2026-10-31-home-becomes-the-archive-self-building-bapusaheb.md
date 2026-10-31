---
title: "Home becomes the archive: self-building folders, stored-text search, our own PDF.js viewer, one v2.0.0 release"
author: Bapusaheb
date: 2026-10-31
branch: feat/archive-home
cost: { minutes: 14, tokens: 149977 }
id: l-fab7718d
scope: repo
status: active
src: agent
touches:
  - DESIGN.md
  - scripts/ui-lint.mjs
---

## Decided
- Home keeps its name and becomes the archive of every finance document (receipts, sales invoices, bank statements, "Other" finance papers, sent month packages). The month-close steps shrink to a panel at the top of Home.
- Folders build themselves from data (Year > Month, Vendor, Client, Kind, Tag, Starred, Recent, Saved searches). Each folder is a filter, so nothing can be misfiled.
- Search covers extracted fields plus the PDF text layer, stored once per row in a normalised search_text column and matched with one instr() per word. No image OCR, no extra AI cost.
- PDFs open in a small viewer of our own built on self-hosted pdfjs-dist (eval off), with the extracted-text view kept as the no-script fallback.
- Desktop: drawer | list | preview pane, the pane rendered by the server for ?open=<id> and reached by normal navigation with view transitions. Phone: list, then full-screen viewer.
- Full repositioning: "not an archive" leaves DESIGN.md and the site, but the retention line stays: keep originals as your local law requires.
- Ships as one v2.0.0 release, committed in verifiable units on one branch.

## Tried and ruled out
- Names Files, Archive, Cabinet: the owner kept Home.
- SQLite FTS5: D1 supports it, but wrangler d1 export refuses databases with virtual tables, and the upgrade guide tells users to back up with that command.
- LIKE '%q%': D1 refuses LIKE patterns over 50 bytes.
- Browser's built-in PDF viewer in an iframe: iOS Safari shows only page one, and it needs frames opened in the CSP.
- Server-rendered page images: Workers cannot rasterise PDFs without paid Browser Rendering.
- Real user folders: upkeep and misfiling. Thumbnail grid: needs thumbnails for every file.
- Stacked PRs by phase: the owner wants one release.

## Watch out
- Older PDF bank statement imports only kept the converted CSV, so they show as a CSV table.
- lintapple is a devDependency but was missing from node_modules: run bun install before scripts/ui-lint.mjs.

In the code:
- Search index: src/search.ts (searchTextFor, parseQuery, searchSql); column receipts.search_text and search_version.
- Archive: src/archive.ts (DOC_KINDS, Folder, parseFolder); Home URL /?in=year:2026&q=&before=&open=.
- Viewer: src/viewer.ts serves /assets/viewer.js; CSP gains worker-src 'self'; /originals/<id>?view=raw with Range.
