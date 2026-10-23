#!/usr/bin/env bash
# Subsets the two OFL variable faces to the characters the page uses, so the
# fonts are self-hosted and no third-party font request ever happens.
# Needs fonttools with brotli on PATH, or FONTTOOLS=... PYFTSUBSET=... bash scripts/fonts.sh
set -euo pipefail
cd "$(dirname "$0")/.."
SUBSET="${PYFTSUBSET:-pyftsubset}"
FONTTOOLS="${FONTTOOLS:-fonttools}"
TMP="$(mktemp -d)"
# Pinning the axes the design never moves is most of the size: Bricolage with
# all three axes is 82KB for Latin, pinned it is a fraction of that.
U="U+0020-007E,U+00A0,U+00A9,U+00B7,U+00D7,U+00E9,U+2019,U+201C,U+201D,U+2026,U+2248,U+20AC,U+2212"
F=node_modules/@fontsource-variable
"$FONTTOOLS" varLib.instancer "$F/bricolage-grotesque/files/bricolage-grotesque-latin-standard-normal.woff2" \
  opsz=96 wdth=82 wght=600:800 -o "$TMP/bricolage.ttf"
"$FONTTOOLS" varLib.instancer "$F/instrument-sans/files/instrument-sans-latin-standard-normal.woff2" \
  wdth=100 wght=400:600 -o "$TMP/instrument-sans.ttf"
"$SUBSET" "$TMP/bricolage.ttf" \
  --unicodes="$U" --flavor=woff2 --layout-features='kern,liga,tnum,lnum' --output-file=public/fonts/bricolage.woff2
"$SUBSET" "$TMP/instrument-sans.ttf" \
  --unicodes="$U" --flavor=woff2 --layout-features='kern,liga,tnum,lnum' --output-file=public/fonts/instrument-sans.woff2
