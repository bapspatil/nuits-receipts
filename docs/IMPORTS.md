# Import bank statements

XLSX, CSV and PDF statements are accepted as downloaded. A spreadsheet (`src/xlsx.ts`) or PDF (`src/pdf.ts`) becomes a CSV on upload, the column names row is found past any preamble, a statement's own totals and balances are checked, and a file no layout matches is mapped by one Workers AI call that the whole file must then pass. A Holvi PDF is read by its layout with no model call; other PDFs are read payment by payment with Clairic, every value checked against the PDF's text. Holvi's "Currency and amount: USD 10.46" line becomes the payment's original amount. After every import the whole history is matched again, obvious non-purchases are marked by rule, and at most 40 unclear transfers of that file go to Clef in one call.

This page moved to the documentation site:

- [Import a bank CSV](https://receipts.nuits.net/docs/how-to/import-a-bank-csv/)
- [Resolve duplicate warnings](https://receipts.nuits.net/docs/how-to/resolve-duplicate-warnings/)
- [Match payments and receipts](https://receipts.nuits.net/docs/how-to/match-payments-and-receipts/)
- [Pair an own-account transfer](https://receipts.nuits.net/docs/how-to/pair-an-own-account-transfer/)
- [Bank CSV import reference](https://receipts.nuits.net/docs/reference/bank-csv-import/): mapping fields, formats, built-in layouts and duplicate rules.

The source for these pages is in [`docs-site/src/content/docs/`](../docs-site/src/content/docs/).
