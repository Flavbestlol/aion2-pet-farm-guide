#!/bin/sh
# Build the overlay: assemble the page from the plugin, refuse anything that isn't part of it, build.
set -e
cd "$(dirname "$0")"
python3 assemble.py >/dev/null
for f in ui/game.png ui/game_clean.png; do rm -f "$f"; done
extra=$(find ui -maxdepth 1 -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.mp4' \) | head -1)
[ -z "$extra" ] || { echo "stray file in ui/: $extra"; exit 1; }
# MSVC: WebView2 links into the exe (no WebView2Loader.dll); it needs only the C runtime built into Windows 10 and 11
cd src-tauri && cargo xwin build --release --target x86_64-pc-windows-msvc
