---
title: Which dates hold the arrival month open
author: Bapusaheb
date: 2026-10-30
branch: ux4/settings
cost: { minutes: 1, tokens: 12795 }
id: l-82172024
scope: repo
status: active
src: agent
touches:
  - src/arrival.ts
  - src/checklist.ts
---

## Decided
- A receipt with no issue date never makes a month in arrivalMonth, because it reads issue_date IS NOT NULL. What holds Home on an old month is a receipt whose date is in question: still open, with missing_issue_date or uncertain_issue_date. So a never-sent month counts as open only when it holds a document whose date is not in question. A month that was sent and then changed stays open, since a send is real.
- Payments missing a receipt keep a month open, also when its only documents have a doubtful date.
- The plan wording was undated. Reading that as date in question is a judgement; the one place to narrow it is the doubtful test in arrivalMonth.
- The setup checklist lists open steps first and folds done ones in a details, so Home's month sits higher.
