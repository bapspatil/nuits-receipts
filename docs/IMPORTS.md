# Import bank statements

XLSX and CSV statements are accepted as downloaded. A spreadsheet becomes a CSV on upload (`src/xlsx.ts`), the column names row is found past any preamble, a statement's own totals are checked, and a file no layout matches is mapped by one Workers AI call that the whole file must then pass.

This page moved to the documentation site:

- [Import a bank CSV](https://receipts.nuits.net/docs/how-to/import-a-bank-csv/)
- [Resolve duplicate warnings](https://receipts.nuits.net/docs/how-to/resolve-duplicate-warnings/)
- [Match payments and receipts](https://receipts.nuits.net/docs/how-to/match-payments-and-receipts/)
- [Pair an own-account transfer](https://receipts.nuits.net/docs/how-to/pair-an-own-account-transfer/)
- [Bank CSV import reference](https://receipts.nuits.net/docs/reference/bank-csv-import/): mapping fields, formats, built-in layouts and duplicate rules.

The source for these pages is in [`docs-site/src/content/docs/`](../docs-site/src/content/docs/).
