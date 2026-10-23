All files are synthetic test data, not real bank data. Bank names describe tested header styles only. Merchants, references, IDs, and FI00 IBANs are intentionally fake. No real export compatibility is claimed.

Run `python3 test/fixtures/banks/generate.py` to regenerate the files. Binary fixtures have base64 sidecars so the workerd test runtime reads their exact bytes through Vite raw imports.

Nordea has one preamble and one footer record. OP uses Windows-1252. UTF-16 files contain LE and BE BOMs. Revolut uses booked Completed Date; Started Date and Fee are intentionally unused. US dates require an explicit MM/DD/YYYY mapping.
