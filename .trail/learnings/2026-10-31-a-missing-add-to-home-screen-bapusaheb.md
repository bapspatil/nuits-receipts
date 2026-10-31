---
title: A missing Add to Home Screen in Safari is not a PWA bug; the install checks pass and Safari offers it for any page
author: Bapusaheb
date: 2026-10-31
branch: main
cost: { minutes: 3, tokens: 76990 }
id: l-d771f845
scope: repo
status: active
src: agent
touches:
  - scripts/pwa-check.mjs
  - src/pwa.ts
  - src/index.ts
---

## Decided
When the owner reported no Add to Home Screen option in Safari, the install was checked and found sound, so no code change shipped. Safari shows the option for any page regardless of the manifest. On iOS 26 it sits under the "..." button > Share > View More. On a Mac it is called Add to Dock (File menu or Share button) and is absent in Private windows. In-app browsers never offer it.

## Tried and ruled out
- Changing the manifest or service worker: Chrome reports no installability errors at the /app base path, so the code is not why the menu item is missing.
- Fixing the Access bypass for the icons from the CLI: the wrangler OAuth token gets "Authentication error" (code 10000) on the Access apps API. It needs a dashboard edit or an API token with Access: Apps and Policies Edit.

## Watch out
- On 2026-10-31 the live icon paths still redirected (302) to the Access login, so the bypass from the earlier deploy learning was not yet in place. Without it, iOS uses a page screenshot as the home-screen icon.
- scripts/pwa-check.mjs passes every install check but then times out waiting for an "Add files" button on the share-target step. The button was probably renamed, so that step of the script is stale.

In the code: scripts/pwa-check.mjs (run with --base /app), src/pwa.ts PUBLIC_PATHS, src/index.ts route; live probe: curl -s -o /dev/null -w "%{http_code}" https://receipts.nuits.net/app/apple-touch-icon.png
