---
title: "The deploy script passes the config's Cloudflare account to wrangler itself, because D1 commands ignore it"
author: Bapusaheb
date: 2026-10-31
branch: fix/deploy-account
cost: { minutes: 2, tokens: 17923 }
id: l-9e155d20
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - docs-site/src/content/docs/reference/changelog.mdx
  - package.json
  - scripts/deploy-lib.mjs
  - scripts/deploy.mjs
  - scripts/setup.mjs
---

## Decided
When the Cloudflare login reaches more than one account, `wrangler d1 migrations list --remote --config <file>` fails in a non-interactive run with "More than one account available" even though the config file has account_id. The deploy and setup scripts now copy the config's account_id into CLOUDFLARE_ACCOUNT_ID before calling wrangler (unless it is already set), so `bun run deploy` works without exporting anything.

## Watch out
An earlier learning about deploying the live install says the config's account_id also sets the account. That holds for `wrangler deploy`, not for the D1 commands the script runs first.

In the code: scripts/deploy-lib.mjs useAccount, called in scripts/deploy.mjs after readConfig and in scripts/setup.mjs after the account question.
