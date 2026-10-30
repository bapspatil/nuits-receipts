# Release notes: UX v4 and the installable app

The next release after v1.15.0. `bun run version:next` on the stack plans a minor bump to **v1.16.0**. The GitHub release notes and the CHANGELOG are generated from the commits when the release is cut ([docs/RELEASING.md](../../RELEASING.md)); this page is the plain summary.

## What you get

**The lists behave.** A row you resolve leaves the list, the next open one moves up, and the page refills. Nothing hides behind Earlier or Later any more.

- **Four places:** Home, Receipts, Bank and Settings. Review is gone; its work is **Receipts To do**. Old `/review` links still land there.
- **To do | All on Receipts and on Bank.** To do is what needs you, open items first: receipts missing a fact, overdue sales invoices and mail from new senders on Receipts, payments without a receipt on Bank. All is everything, to browse. Invoices sit in Receipts All.
- **Undo everywhere.** Approve, Discard, Not a purchase, Match, Unmatch, Mark paid, removing a vendor rule, a sender or a part, and every bulk action offer Undo in the banner. Discard is one click, with no reason to pick. Actions that can't be undone (Move to invoices, Ignore a sender, Disconnect OneDrive) ask first.
- **Next goes to the right place.** Approve on a receipt opens the next open one in the same list and month. Every action returns you to the list you came from, at the next open row.
- **One-step bank import.** Choose the file and press Import statement. The app finds the account and the columns, skips what you imported before (with Import anyway when you need it), and asks only when it can't tell. The whole import has an Undo.
- **Fewer controls.** Tick boxes are always there (no Select mode). Match anyway is now Match, with its reason beside it. Matched automatically and Matched by you are one status, Matched. Part stays hidden until you have a second one. Settings has five sections and one Save.
- **A new look.** Warm paper colours and type on a sidebar and tab-bar layout, with glass on the navigation. Every button has an icon and a word, each status has one word, colour and icon, and red is kept for permanent delete.
- **Keyboard on a computer.** `j` and `k` move, `x` ticks, `Enter` opens, `a` approves, `s` skips, `u` undoes, `/` searches, and `?` shows the list.
- **On a phone,** the Approve bar stays above the keyboard while you type.

**The installable app (PR #44, same release).** Add it to your iPhone or iPad home screen (Safari, Share, Add to Home Screen), your Mac's Dock (Safari, File, Add to Dock), or install it from Chrome or Edge. It opens in its own window with its own icon. It still needs a connection: offline it shows a "You're offline" page and keeps nothing on the device. On Android, share receipt PDFs and photos to it from other apps; they open on the Add page and nothing is uploaded until you press Add.

## Migration

One new table, `undo_log`, from `migrations/0011_undo_log.sql` (and `schema/0008_undo_log.sql` for new installs). `bun run deploy` lists and applies it before deploying. Back up first, as [Upgrading a deployment](../../RELEASING.md#upgrading-a-deployment) says. Existing data needs no change: receipts flagged only for optional reasons simply stop counting as To do.

## Check by hand after deploy

These could not be checked in the automated runs (Chromium only, no screen reader, no devices):

- [ ] **VoiceOver with the banner.** After an action, the focused next row should be read with the banner's message.
- [ ] **The iPhone password prompt in the installed app.** Sign-in from the home-screen app, since the service worker stays out of the sign-in path.
- [ ] **The Android share sheet.** Share a PDF and a photo to the installed app; both should wait on the Add page.
- [ ] **Safari's view transition and glass.** A resolved row should slide out; the sidebar, tab bar and bulk bar should be frosted, or solid where Safari can't.
- [ ] **The Approve bar above the phone keyboard.** On a receipt, type in a field; the bar should stay visible above the keyboard.
- [ ] **ZIP and CSV from standalone mode.** Download the month's ZIP and CSV from the installed app, on iPhone and Android.

Measured results of the UX work are in [README.md](README.md) beside this file.
