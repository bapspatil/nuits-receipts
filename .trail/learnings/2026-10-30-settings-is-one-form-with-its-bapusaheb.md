---
title: Settings is one form with its controls spread over five sections
author: Bapusaheb
date: 2026-10-30
branch: ux4/settings
cost: { minutes: 1, tokens: 12795 }
id: l-6def2128
scope: repo
status: active
src: agent
touches:
  - src/setup.ts
  - src/views.ts
  - src/events.ts
---

## Decided
- The page has one empty form, id settings-form, and every setup control names it with form=. The lists and add forms between them (senders, accounts, rules, OneDrive) are forms of their own, because forms cannot nest. One Save sits in the sticky .sbar and names the form too. saveSetup reads every field present, so there is no group in the post any more.
- Section anchors from before (senders, accounts, rules, onedrive, setup-business and so on) are kept as ids inside the five sections. SECTION_OF in src/views.ts maps an anchor to its section so a banner or an Undo opens the right one. Banners, Undo and tests keep naming the old anchors.
- A save that touches one group says so in the banner; across groups it says Saved your settings (group=all, section=setup-<first>). Undo logs every key the save wrote, so a Save that changed two sections and removed a part comes back whole.
- The unsaved-changes script is gone with the per-group Saves. Row actions (Remove sender, Rename) do not save the one form, so edits typed but not saved are lost if one of them is used first.

## Tried and ruled out
- One <form> wrapping all five sections: the senders, accounts and rules rows hold their own forms, and nested forms are invalid HTML.
