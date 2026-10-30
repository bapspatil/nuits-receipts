# UX v4 observable contract

What `test/worklists.test.ts` and journey f read from the app. Later PRs implement it; the tests never depend on copy, icons or classes. Until a PR lands, its invariants are `test.fails`.

## Pages

One work list per page. The container carries:

| Attribute | Value |
| --- | --- |
| `data-list` | `receipts-todo`, `receipts-all`, `bank-todo` or `bank-all` |
| `data-total` | Rows in the list under its filter, month-wide, not the page. In a `-todo` list that is the number open. |

Every row in the list, anywhere inside the page, carries `data-row="<id>"` and `id="row-<id>"`. `<id>` is the receipt id or bank transaction id. Rows render in the list's order, one element per row.

A To do list renders the first `min(upto, data-total)` rows. `upto` defaults to 50 and is a request parameter. There is no offset. An All list pages with a keyset cursor, never an offset.

The To do / All switch is two links, `a[data-view="todo"]` and `a[data-view="all"]`, each with `data-count="<N>"`: the open count and the whole list's count under the same filter as `data-total`. The bulk bar, `form[data-bulk]`, keeps its `data-total` and equals the container's.

The "all done" message appears only when `data-total="0"`.

Selection: a row's checkbox is `input[name=id]` inside it, the select-all-on-page checkbox is `input[data-bulk-page]` inside the list container, and a bulk bar button is `button[name=op][value=<op>]` inside `form[data-bulk]` (`exempt` on Bank, `approve` on Receipts).

## URLs

| Page | URL |
| --- | --- |
| Receipts To do (default) | `/receipts?view=todo&month=&upto=` |
| Receipts All | `/receipts?view=all&month=&q=&before=` |
| Bank | `/payments?month=M&view=todo\|all&upto=` |
| Receipt page | `/receipts/<id>?from=todo&month=` (`from=all&month=&q=` from the All list, so a search survives the way back) |

`month` filters on the booking month for Bank. In Receipts To do it keeps receipts dated in that month plus every undated one (`substr(issue_date,1,7)=M OR issue_date IS NULL`), because an undated receipt belongs to no month yet and Home counts it with every month ("3 to check, plus 2 undated"). In Receipts All it keeps today's browse rule, `substr(coalesce(issue_date,received_at),1,7)=M`. Empty parameters are omitted.

## Order

Receipts To do: undated first, then `issue_date`, `received_at`, `id`, all ascending. Bank To do and All oldest first: `booking_date`, `account_key`, `id`. The order is stable between renders and does not depend on the page.

Open in Receipts To do: not a duplicate, not discarded, and either needing a required fact or a sales invoice that is overdue (ready, not marked paid, no bank row paying it, and past its due date, else `issue_date` plus the payment terms). Held mail from unknown senders shows on the same page above the list, as its own rows that are not part of `data-total`. Open in Bank To do: money out that needs a receipt, has none, and is not a transfer leg. The tests read the open set from `Busy.todo` in `test/busy-month.ts`; the PR that keeps optional-only reasons out of To do changes that one line.

## Actions

The list state travels in the form, under the names the list URL uses. Bank rows and the bulk bars post `view`, `month` and `upto`. Receipt rows and bars on the list post `view`, `month` and `upto`. Every form on the receipt page posts `from`, `month` and (from All) `q`, copied from its own URL, and its action returns to that page or list under them.

A bulk bar posts the list's whole state, including `list` and `view`. A bulk post whose state is missing or invalid answers `400` with "This page is out of date", never a guessed list. Select-all acts on the list's filter: all of it up to 500 rows, else the first 500 in the list's order, which the bar offers as "Select the first 500". `data-total` is always the true count.

Every single-row and bulk action answers `303`. The `Location` is built by one function, `listUrl`:

- It is the list the action came from: same path, `view`, `month` and `upto`. It never carries `offset`, and it adds the signed `done=` event.
- When an open row remains it ends in `#row-<nextOpenId>`, otherwise it has no fragment.
- `nextOpenId` is computed after the save: the first open row after the place the acted-on row held before the save (a date typed while approving does not move it), else the first open row. For a bulk action the acted-on row is the first selected row in list order. An Undo or Restore lands on the first row it brought back.
- On the receipt page, Approve answers with `/receipts/<nextOpenId>?from=…&month=…` using that same rule, and the list URL when no open row remains. Skip uses the first open row after the current one only, with no wrap, and answers with the list URL when there is none.
- A base-path install prefixes the path; the query and fragment are unchanged.

## Undo

The status banner (`role="status"`) shown after a resolving action contains a form whose `action` is `/undo`, with the hidden fields it needs. Posting it answers `303` and restores every row the action changed, including `status`, `review_reasons_json`, `manual_fields_json`, `receipt_required`, `exempt_by` and `receipt_id`.

## Bulk Not a purchase

Rows that are matched are left alone, never unmatched. The banner counts only the rows changed.
