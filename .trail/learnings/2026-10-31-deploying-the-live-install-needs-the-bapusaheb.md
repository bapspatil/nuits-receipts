---
title: "Deploying the live install needs the private config, the Cloudflare account set, and an Access bypass for the app icons"
author: Bapusaheb
date: 2026-10-31
branch: main
cost: { minutes: 81, tokens: 1297754 }
id: l-58b93165
scope: repo
status: active
src: agent
touches:
  - AGENTS.md
  - opencode.json
  - CHANGELOG.md
  - docs-site/src/content/docs/reference/changelog.mdx
  - package.json
  - docs-site/src/assets/screenshots/home.png
  - docs-site/src/assets/screenshots/month.png
  - docs-site/src/assets/screenshots/payments.png
  - docs-site/src/assets/screenshots/upload.png
  - docs-site/src/content/docs/how-to/add-receipts.mdx
---

## Decided
- The live install (worker nuits-receipts, served at receipts.nuits.net/app) deploys from a gitignored wrangler.production.jsonc at the repo root. It was rebuilt on 2026-10-31 from the live Worker's own version bindings: every var is listed explicitly, workers_dev is false because the workers.dev address was off, and no routes are listed, so the dashboard route stays as it is.

## Tried and ruled out
- keep_vars with only AI_MODE set: it would work, but listing the vars makes the file the full record of the live settings, so a lost dashboard edit cannot hide.

## Watch out
- The Cloudflare login reaches several accounts, so wrangler fails with an account error unless CLOUDFLARE_ACCOUNT_ID is set to the Bapusaheb Patil account (the config's account_id also sets it).
- Cloudflare Access guards all of /app, so the icon paths the installable app serves without sign-in still redirect to the Access login. A home-screen icon needs an Access bypass for /app/apple-touch-icon.png, /app/icons/* and /app/favicon.svg.
- Back up D1 before any deploy that applies migrations: wrangler d1 export DB --remote plus d1 time-travel info, as docs/RELEASING.md says.

In the code: scripts/deploy.mjs, scripts/deploy-lib.mjs (selectConfig), docs/RELEASING.md
