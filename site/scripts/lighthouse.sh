#!/usr/bin/env bash
# Lighthouse against the local static preview (bun run preview), mobile at 390
# wide and desktop at 1440 wide. Reports go next to the screenshots.
set -euo pipefail
# PAGES is a space-separated list of paths; each gets its own pair of reports.
BASE="${SITE_URL:-http://localhost:4321/}"
PAGES="${PAGES:-/ /changelog/}"
OUT="${OUT:-$(cd "$(dirname "$0")/../../.." && pwd)/nuits-receipts-site-shots/lighthouse}"
mkdir -p "$OUT"
FLAGS="--headless=new --no-sandbox"
export CHROME_PATH="${CHROME_PATH:-/usr/bin/google-chrome}"
for P in $PAGES; do
  URL="${BASE%/}$P"
  NAME="$(echo "$P" | tr -c 'a-z0-9\n' '-' | sed 's/^-*//; s/-*$//')"
  NAME="${NAME:-home}"
  npx --yes lighthouse@12 "$URL" --quiet --chrome-flags="$FLAGS" --output=json --output=html \
    --output-path="$OUT/$NAME-mobile" --form-factor=mobile \
    --screenEmulation.mobile=true --screenEmulation.width=390 --screenEmulation.height=844 --screenEmulation.deviceScaleFactor=3
  npx --yes lighthouse@12 "$URL" --quiet --chrome-flags="$FLAGS" --output=json --output=html \
    --output-path="$OUT/$NAME-desktop" --preset=desktop \
    --screenEmulation.width=1440 --screenEmulation.height=900
  for f in mobile desktop; do
    node -e '
      const r = require(process.argv[1]);
      const s = Object.values(r.categories).map((c) => `${c.title} ${Math.round(c.score * 100)}`).join(", ");
      const a = r.audits;
      console.log(`${process.argv[2]}: ${s}; LCP ${Math.round(a["largest-contentful-paint"].numericValue)} ms, CLS ${a["cumulative-layout-shift"].numericValue.toFixed(3)}`);
    ' "$OUT/$NAME-$f.report.json" "$NAME $f"
  done
done
