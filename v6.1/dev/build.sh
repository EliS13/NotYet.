#!/bin/sh
# build.sh — zips exactly what Chrome needs into dist/, for the Web Store.
# Leaves out dev/, store/, your personal settings and anything hidden.
set -e
cd "$(dirname "$0")/.."
VERSION=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
OUT="dist/not-yet-$VERSION.zip"
mkdir -p dist
rm -f "$OUT"
zip -qr "$OUT" manifest.json background.js offscreen.html offscreen.js offscreen-noise.js lib pages content styles fonts icons -x '*.DS_Store'
echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
unzip -l "$OUT" | tail -1
