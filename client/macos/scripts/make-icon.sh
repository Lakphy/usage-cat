#!/usr/bin/env zsh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
master="$root/Resources/AppIcon.png"
icns="$root/Resources/AppIcon.icns"
work="$(mktemp -d /tmp/UsageCatIcon.XXXXXX)"
iconset="$work/AppIcon.iconset"
mkdir -p "$iconset"

swift "$root/scripts/render-icon.swift" "$master"

while read -r size name; do
  sips -z "$size" "$size" "$master" --out "$iconset/$name" >/dev/null
done <<'EOF'
16 icon_16x16.png
32 icon_16x16@2x.png
32 icon_32x32.png
64 icon_32x32@2x.png
128 icon_128x128.png
256 icon_128x128@2x.png
256 icon_256x256.png
512 icon_256x256@2x.png
512 icon_512x512.png
1024 icon_512x512@2x.png
EOF

iconutil -c icns "$iconset" -o "$icns"
rm -rf "$work"
echo "Wrote $icns"
