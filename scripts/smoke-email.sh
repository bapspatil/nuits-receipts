#!/usr/bin/env bash
# Local email smoke test against `bun run dev`. Synthetic example.com mail only.
# Email Routing prepends an Authentication-Results header with its SPF verdict; the
# local /cdn-cgi/handler/email endpoint does not, so each fixture carries its own:
#   blocked     sender not allowlisted                      -> dropped
#   attachment  allowlisted, SPF pass, duplicate PDF        -> no new export row
#   body        allowlisted, SPF pass, HTML receipt         -> extracted, ready
#   nospf       allowlisted, no Authentication-Results      -> kept for review (sender_unverified), not extracted
#   spffail     allowlisted, SPF fail                       -> dropped (sender_auth_failed), nothing stored
set -euo pipefail
base=${SMOKE_URL:-http://localhost:8787}
password=${NUITS_PASSWORD:-local-dummy-password}
user=${SMOKE_USER:-owner}
out=.audit/smoke-email
mkdir -p "$out"
python3 - "$out" "$(date +%s%N)" <<'PYCODE'
from email.message import EmailMessage
from email import policy
from pathlib import Path
import sys
out, run = Path(sys.argv[1]), sys.argv[2]
html = Path('scripts/sample-receipts/sample.html').read_text()
# name: (envelope sender, SPF result or None for no header, vendor in the HTML)
cases = {
    'blocked': ('blocked@example.com', 'pass', 'Sample Blocked Vendor'),
    'attachment': ('owner@example.com', 'pass', None),
    'body': ('bookkeeping@example.org', 'pass', 'Sample Mail Meadow Oy'),
    'nospf': ('bookkeeping@example.org', None, 'Sample Unverified Vendor'),
    'spffail': ('bookkeeping@example.org', 'fail', 'Sample Spoofed Vendor'),
}
for name, (sender, spf, vendor) in cases.items():
    message = EmailMessage(policy=policy.SMTP)
    message['From'] = 'sample-vendor@example.com'
    message['To'] = 'receipts@example.com'
    message['Subject'] = f'Synthetic local email smoke ({name})'
    # Negative fixtures get a per-run Message-ID so reruns on the same database stay meaningful.
    message['Message-ID'] = f'<nuits-sample-{name}-{run}@example.com>' if name in ('nospf', 'spffail') else f'<nuits-sample-{name}@example.com>'
    message['Date'] = 'Sun, 6 Sep 2026 12:00:00 +0300'
    if vendor is None:
        message.set_content('Synthetic forwarded receipt context only.')
        message.add_attachment(Path('scripts/sample-receipts/sample.pdf').read_bytes(), maintype='application', subtype='pdf', filename='sample.pdf')
    else:
        message.set_content(html.replace('Sample Mail Meadow Oy', vendor), subtype='html')
    auth = f'Authentication-Results: mx.cloudflare.net; spf={spf} smtp.mailfrom={sender}; dkim=none; dmarc=none\r\n'.encode() if spf else b''
    (out / f'{name}.eml').write_bytes(auth + message.as_bytes())
PYCODE

get() { curl -fsS -u "$user:$password" "$base$1" -o "$2"; }
send() { curl -fsS --data-binary "@$out/$1.eml" "$base/cdn-cgi/handler/email?from=$2&to=receipts%40example.com" -o "$out/$1.response"; }
ids() { rg -o '/receipts/[a-f0-9]{64}' "$1" | sort -u || true; }
wait_for() { # wait_for <path> <pattern> <file>
  for _ in $(seq 1 40); do
    get "$1" "$3"
    if rg -q "$2" "$3"; then return 0; fi
    sleep 0.1
  done
  echo "FAIL: '$2' not found in $1" >&2
  return 1
}

get '/export.csv?month=2026-09' "$out/before.csv"
get '/' "$out/before.html"

send blocked 'blocked%40example.com'
get '/export.csv?month=2026-09' "$out/after-blocked.csv"
cmp "$out/before.csv" "$out/after-blocked.csv"

send attachment 'owner%40example.com'
get '/export.csv?month=2026-09' "$out/after-attachment.csv"
cmp "$out/before.csv" "$out/after-attachment.csv"

# Positive: SPF pass is extracted and is not held for review.
send body 'bookkeeping%40example.org'
wait_for '/export.csv?month=2026-09' 'Sample Mail Meadow Oy' "$out/after-body.csv"
python3 - "$out/after-body.csv" <<'PYCODE'
import csv, sys
rows = [r for r in csv.DictReader(open(sys.argv[1])) if r['vendor'] == 'Sample Mail Meadow Oy']
assert len(rows) == 1, rows
assert rows[0]['needs_review'] == 'false' and rows[0]['review_reasons'] == '[]', rows
PYCODE

# Negative: no SPF result is stored for review as sender_unverified and never extracted.
send nospf 'bookkeeping%40example.org'
get '/' "$out/after-nospf.html"
new=$(comm -13 <(ids "$out/before.html") <(ids "$out/after-nospf.html"))
test "$(printf '%s\n' "$new" | rg -c .)" = 1 || { echo "FAIL: expected one new review row, got: $new" >&2; exit 1; }
get "$new" "$out/nospf-receipt.html"
rg -q 'needs_review' "$out/nospf-receipt.html"
rg -q 'sender_unverified' "$out/nospf-receipt.html"
get '/export.csv?month=2026-09' "$out/after-nospf.csv"
if rg -q 'Sample Unverified Vendor' "$out/after-nospf.csv"; then echo 'FAIL: unverified mail was extracted' >&2; exit 1; fi

# Negative: SPF fail is dropped; nothing new in review or the export.
send spffail 'bookkeeping%40example.org'
get '/' "$out/after-spffail.html"
cmp <(ids "$out/after-nospf.html") <(ids "$out/after-spffail.html")
get '/export.csv?month=2026-09' "$out/after-spffail.csv"
if rg -q 'Sample Spoofed Vendor' "$out/after-spffail.csv"; then echo 'FAIL: SPF-fail mail was extracted' >&2; exit 1; fi

echo 'PASS local email interface, blocked sender, duplicate attachment, SPF pass extracted, missing SPF held for review, failing SPF dropped'
