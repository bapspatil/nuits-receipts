#!/usr/bin/env bash
# Lighthouse against the local static preview (bun run preview), mobile at 390
# wide and desktop at 1440 wide. Reports go next to the screenshots.
set -euo pipefail
URL="${SITE_URL:-http://localhost:4321/}"
OUT="${OUT:-$(cd "$(dirname "$0")/../../.." && pwd)/nuits-receipts-site-shots/lighthouse}"
mkdir -p "$OUT"
FLAGS="--headless=new --no-sandbox"
export CHROME_PATH="${CHROME_PATH:-/usr/bin/google-chrome}"
npx --yes lighthouse@12 "$URL" --quiet --chrome-flags="$FLAGS" --output=json --output=html \
  --output-path="$OUT/mobile" --form-factor=mobile \
  --screenEmulation.mobile=true --screenEmulation.width=390 --screenEmulation.height=844 --screenEmulation.deviceScaleFactor=3
npx --yes lighthouse@12 "$URL" --quiet --chrome-flags="$FLAGS" --output=json --output=html \
  --output-path="$OUT/desktop" --preset=desktop \
  --screenEmulation.width=1440 --screenEmulation.height=900
for f in mobile desktop; do
  node -e '
    const r = require(process.argv[1]);
    const s = Object.values(r.categories).map((c) => `${c.title} ${Math.round(c.score * 100)}`).join(", ");
    console.log(`${process.argv[2]}: ${s}`);
  ' "$OUT/$f.report.json" "$f"
done
