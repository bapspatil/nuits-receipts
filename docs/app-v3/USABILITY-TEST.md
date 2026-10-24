# Think-aloud usability test script (written, not yet run)

NN/g's guidance is that five users find most of the problems in one round. This script is ready for when real people are available; until then the findings in `AUDIT.md` are expert findings only.

## Participants

Five people: three who run a small company and hand receipts to an accountant every month (the owner-operator), two developers who have deployed a Cloudflare Worker before but never used this app (the self-hoster). No one who has seen the app.

## Setup

- A local instance seeded by `node scripts/ux-journeys.mjs` up to the start of each task (or the prototype HTML for prototype rounds).
- A 1440 px laptop and a 390 px phone; alternate which device each task uses.
- Screen and voice recording with consent. One facilitator, one note-taker.
- Say at the start: "We're testing the app, not you. Please think out loud. I can't help you during a task, but I'll answer everything afterwards."

## Tasks

Read each task aloud and hand it over on a card. Never use the words on the buttons.

1. "It's the 1st of October. Your accountant wants September. Find out what's still missing." (journey a/c, finding F1)
2. "Three receipts came in by email that the app couldn't read completely. Sort them out." (journey a, F10, F12)
3. "Here's your bank's September export (statement.csv on the desktop). Bring it in and make sure every payment out has its receipt." (journey b, F3, F9)
4. "You just matched a payment to the wrong receipt. Fix it." (F2, F7)
5. "You sent an invoice to Sample Client Oy last month. Add it and check whether they paid." (journey e, F15)
6. "Send September to your accountant." (journey c)
7. Self-hosters only: "You've just deployed this. Get it ready so receipts you forward are read." (journey d, F19)

## What to record per task

- Success: completed / completed with help / failed.
- Time on task, clicks, wrong turns (page visited that isn't on the shortest path).
- Every hesitation over three seconds and what was on screen.
- Every word the participant used for something on screen that differs from the label (vocabulary for F8).
- Single Ease Question after each task: "Overall, how easy or difficult was this task?" 1 to 7.

## After all tasks

- System Usability Scale (10 items).
- "What one thing would you change?"
- "Was there a moment you weren't sure the app had done what you asked?" (F2, F3)

## Analysis

Tag each observation with a finding ID from `AUDIT.md` or a new ID. Re-rate severity with frequency from the sessions. A finding at least 2 of 5 people hit outranks one only the evaluator predicted.
