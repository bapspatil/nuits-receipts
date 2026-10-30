---
title: "Keyboard shortcuts: one document listener, and the pending cue disables the button a tick late"
author: Bapusaheb
date: 2026-10-30
branch: ux4/keys
cost: { minutes: 19, tokens: 96504 }
id: l-e3b12355
scope: repo
status: active
src: agent
---

Decided: src/keys.ts holds one keydown listener on document and one submit listener. j and k only focus rows; x and Escape stay in bulk.js (src/bulk.ts), which already handles them when focus is on a row, so keys.js never touches them. Watch out: the pending cue must disable the submitter in a setTimeout, not in the submit handler. The browser reads the submitter's name and value after the submit event, so disabling it synchronously drops op or action from the post. It also checks defaultPrevented in that tick, so forms that other scripts submit by fetch (src/invoices.ts) are left alone. Only post forms get the cue: a GET form can end in a download (the ZIP), where the page stays and a disabled button would stick. Bulk forms (form[data-bulk]) keep their own pending state. Tried and ruled out: gating on 'a dialog other than the sheet is open' by id, since ignoring every keystroke while any dialog is open is equivalent (Escape closes the sheet natively) and simpler. The sheet CSS sits in src/ui.ts, not src/keys.ts, because ui.ts and keys.ts import each other and a const read at module load would hit the cycle.
