---
title: Approve above the phone keyboard needs the viewport hint and a script
author: Bapusaheb
date: 2026-10-30
branch: ux4/settings
id: l-5e8c35ed
scope: repo
status: active
src: agent
touches:
  - src/ui.ts
  - src/views.ts
---

## Decided
- The bar of fields on a receipt page is sticky to the layout viewport. Chrome on Android resizes that viewport with the keyboard when the viewport meta says interactive-widget=resizes-content, which is now in every page's meta. iOS Safari ignores the hint and leaves the layout viewport whole, so the bar sat behind the keyboard. A small script (src/ui.ts KEYBOARD_JS, served at /assets/keyboard.js, loaded on the receipt page only) writes the gap between the layout and visual viewport to --kb, and the bar's bottom adds it.
- Scripts are files because the CSP allows script-src self only, so this could not be inline.
- Not checked on a real iPhone or Android phone; the unit test only proves the pieces are wired.

## Tried and ruled out
- Hiding the bar while an input has focus: it would put Approve out of reach exactly when a field was just typed in.
- Moving Discard into More with the status group: it is one click with Undo and lives on the bar, so More holds only the slower actions.
