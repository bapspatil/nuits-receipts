#!/usr/bin/env bash
set -euo pipefail
export WRANGLER_SEND_METRICS=false
base=${SMOKE_URL:-http://localhost:8787}
password=${NUITS_PASSWORD:-local-dummy-password}
user=${SMOKE_USER:-owner}
out=.audit/smoke
mkdir -p "$out"
status=$(curl -sS -o "$out/unauthenticated" -w '%{http_code}' "$base/")
test "$status" = 401
curl -fsS -u "$user:$password" -H "Origin: $base" -F 'file=@scripts/sample-receipts/sample.pdf;type=application/pdf' -D "$out/upload.headers" -o "$out/upload.body" -w 'PDF upload %{time_total}s, HTTP %{http_code}\n' "$base/upload"
location=$(awk 'tolower($1)=="location:" {gsub("\r", "", $2); print $2}' "$out/upload.headers")
test -n "$location"
curl -fsS -u "$user:$password" "$base$location" -o "$out/receipt.html"
id=${location##*/}
curl -fsS -u "$user:$password" "$base/originals/$id" -o "$out/original.pdf"
cmp scripts/sample-receipts/sample.pdf "$out/original.pdf"
curl -fsS -u "$user:$password" "$base/?month=2026-09" -o "$out/month.html"
curl -fsS -u "$user:$password" "$base/export.csv?month=2026-09" -o "$out/export.csv"
rg -q '125.50' "$out/export.csv"
curl -fsS -u "$user:$password" -H "Origin: $base" -F 'file=@scripts/sample-receipts/bank.csv;type=text/csv' -F 'account=default-account' -F 'account_currency=EUR' "$base/imports/csv" -o "$out/preview.html"
rg -q 'Check the file' "$out/preview.html"
python3 - "$out" <<'PYCODE'
from html.parser import HTMLParser
from urllib.parse import urlencode
from pathlib import Path
import sys
class Fields(HTMLParser):
    def __init__(self):
        super().__init__()
        self.values = {}
        self.confirmation = False
    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == 'form':
            self.confirmation = attributes.get('action') == '/imports/csv/confirm'
        if self.confirmation and tag == 'input' and attributes.get('type') == 'hidden':
            self.values[attributes['name']] = attributes.get('value', '')
    def handle_endtag(self, tag):
        if tag == 'form':
            self.confirmation = False
directory = Path(sys.argv[1])
parser = Fields()
parser.feed((directory / 'preview.html').read_text())
assert parser.values.get('preview_token'), 'Signed preview missing'
(directory / 'confirm.form').write_text(urlencode(parser.values))
PYCODE
for attempt in 1 2; do
  status=$(curl -sS -u "$user:$password" -H "Origin: $base" -H 'Content-Type: application/x-www-form-urlencoded' --data-binary "@$out/confirm.form" -o "$out/import-$attempt.body" -w '%{http_code}' "$base/imports/csv/confirm")
  test "$status" = 303
done
curl -fsS -u "$user:$password" "$base/payments?month=2026-09" -o "$out/payments.html"
rg -q 'Matched' "$out/payments.html"
rg -q 'Missing receipt' "$out/payments.html"
curl -fsS -u "$user:$password" "$base/?month=2026-09" -o "$out/month.html"
curl -fsS -u "$user:$password" "$base/export.csv?month=2026-09" -o "$out/export.csv"
python3 - "$out/export.csv" <<'PYCODE'
import csv, sys
with open(sys.argv[1], encoding='utf-8-sig') as file:
    rows = list(csv.DictReader(file))
sample = [row for row in rows if row['invoice_no'] == 'SAMPLE-1001']
assert len(sample) == 1, rows
assert sample[0]['eur_total'] == '125.50', rows
assert sample[0]['eur_source'] == 'bank', rows
assert sample[0]['matched_bank_transaction'], rows
assert sample[0]['matched_account_id'] == 'default-account', rows
assert sample[0]['matched_account_name'] == 'Bank account', rows
PYCODE
echo 'PASS authentication, PDF upload, receipt view, exact original, CSV preview/import/reimport, matched and missing payments, monthly view, CSV'
