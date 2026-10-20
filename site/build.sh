#!/usr/bin/env sh
# Assemble the landing page and the manual into $1 (GitHub Pages serves it at /home/): the page itself,
# the manual (site/docs, built into $1/docs), the README screenshots and the app icon, and the bundled
# JetBrains Mono (OFL) for the headings. Needs `pnpm install` first (the manual uses `marked`).
set -eu
out=${1:?usage: site/build.sh <out-dir>}
root=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$out/img" "$out/fonts"
cp "$root/site/index.html" "$root/site/style.css" "$root/site/main.js" "$out/"
cp "$root/assets/icon.svg" "$out/img/"
cp "$root"/assets/readme/*.png "$out/img/"
cp "$root/node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2" "$out/fonts/jetbrains-mono.woff2"
node "$root/site/docs/build.mjs" "$out/docs"
