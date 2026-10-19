#!/bin/sh
# Build the overlay: assemble the page from the plugin, refuse anything that isn't part of it, build.
set -e
cd "$(dirname "$0")"
python3 assemble.py >/dev/null
for f in ui/game.png ui/game_clean.png; do rm -f "$f"; done
extra=$(find ui -maxdepth 1 -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.mp4' \) | head -1)
[ -z "$extra" ] || { echo "stray file in ui/: $extra"; exit 1; }
cd src-tauri && cargo build --release --target x86_64-pc-windows-gnu
