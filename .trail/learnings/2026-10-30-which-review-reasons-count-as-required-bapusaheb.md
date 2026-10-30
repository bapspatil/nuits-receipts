---
title: Which review reasons count as required for To do
author: Bapusaheb
date: 2026-10-30
branch: ux4/cuts
cost: { minutes: 16, tokens: 40977 }
id: l-ae826991
scope: repo
status: active
src: agent
touches:
  - "src/flags.ts#needsReview"
  - "src/flags.ts#OPTIONAL_REASONS"
---

Decided: a receipt is in To do unless every one of its reasons is in OPTIONAL_REASONS (receipt number, VAT rate, Part, Kind, rule conflict, failed classification). Everything else counts, including Check it reasons (a required field that is read but uncertain) and reasons with no field to fix: missing_eur, credit_or_sign, sender_unverified, probable_duplicate. Why: Approve refuses only the REQUIRED_FIELDS, but the export, the month package and sales matching treat status needs_review as unchecked, so a reason with no field to fix must still hold a receipt back or it would reach the export unreviewed. Rows flagged before this change are read through needsReview and readySql instead of a migration, so every consumer (Review, nav badge, Home, month readiness, package, CSV) shares one definition. Tried and ruled out: deriving optional from isRequired alone, which would have made missing_eur and probable_duplicate optional.
