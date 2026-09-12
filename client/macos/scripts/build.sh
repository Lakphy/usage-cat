#!/usr/bin/env zsh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

extract_intent_metadata() {
  local dest="$1"
  local tool="" toolchain="" sdk xcode_version file_list const_val const_list out
  local candidates=(
    /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/appintentsmetadataprocessor
  )
  if [[ -n "${DEVELOPER_DIR:-}" ]]; then
    candidates+=("$DEVELOPER_DIR/Toolchains/XcodeDefault.xctoolchain/usr/bin/appintentsmetadataprocessor")
  fi
  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]]; then
      tool="$candidate"
      toolchain="${candidate%/usr/bin/appintentsmetadataprocessor}"
      break
    fi
  done
  if [[ -z "$tool" ]]; then
    echo "warning: appintentsmetadataprocessor not found; widget configuration may be incomplete" >&2
    return 0
  fi

  file_list="$(find "$root/.build" -path '*UsageCatIntents-t.build*' -name 'UsageCatIntents.SwiftFileList' | head -n 1)"
  const_val="$(find "$root/.build" -path '*UsageCatIntents-t.build*' -name 'UsageCatIntents-primary.swiftconstvalues' | head -n 1)"
  if [[ -z "$file_list" || -z "$const_val" ]]; then
    echo "warning: missing App Intents compiler outputs" >&2
    return 0
  fi

  sdk="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null || true)"
  if [[ -z "$sdk" ]]; then
    sdk="/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk"
  fi
  xcode_version="$(defaults read /Applications/Xcode.app/Contents/version.plist ProductBuildVersion 2>/dev/null || echo 17F113)"
  out="$(mktemp -d)"
  const_list="$(mktemp)"
  print -r -- "$const_val" > "$const_list"

  "$tool" \
    --output "$out" \
    --toolchain-dir "$toolchain" \
    --module-name UsageCatIntents \
    --sdk-root "$sdk" \
    --xcode-version "$xcode_version" \
    --platform-family macos \
    --deployment-target 26.0 \
    --target-triple arm64-apple-macos26.0 \
    --source-file-list "$file_list" \
    --swift-const-vals-list "$const_list" \
    --force \
    --force-metadata-output >/dev/null

  if [[ -d "$out/Metadata.appintents" ]]; then
    rm -rf "$dest/Metadata.appintents"
    cp -R "$out/Metadata.appintents" "$dest/Metadata.appintents"
  fi
  rm -rf "$out" "$const_list"
}

"$root/scripts/make-icon.sh"
swift build -c release --product UsageCatMenu
swift build -c release --product UsageCatWidget
bin_path="$(swift build -c release --show-bin-path)"
app="$root/dist/Usage Cat.app"
appex="$app/Contents/PlugIns/UsageCatWidget.appex"

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" "$appex/Contents/MacOS" "$appex/Contents/Resources"
cp "$bin_path/UsageCatMenu" "$app/Contents/MacOS/UsageCatMenu"
cp "$root/Resources/Info.plist" "$app/Contents/Info.plist"
cp "$root/Resources/AppIcon.icns" "$app/Contents/Resources/AppIcon.icns"
printf 'APPL????' > "$app/Contents/PkgInfo"

cp "$bin_path/UsageCatWidget" "$appex/Contents/MacOS/UsageCatWidget"
cp "$root/Resources/Widget/Info.plist" "$appex/Contents/Info.plist"
cp "$root/Resources/AppIcon.icns" "$appex/Contents/Resources/AppIcon.icns"
printf 'XPC!????' > "$appex/Contents/PkgInfo"
extract_intent_metadata "$appex/Contents/Resources"
extract_intent_metadata "$app/Contents/Resources"

build_no="$(date +%Y%m%d%H%M%S)"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $build_no" "$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $build_no" "$appex/Contents/Info.plist"

codesign --force --sign - --identifier me.lakphy.usage-cat.menu.widget \
  --entitlements "$root/Resources/Widget/UsageCatWidget.entitlements" \
  --generate-entitlement-der "$appex" >/dev/null
codesign --force --sign - --identifier me.lakphy.usage-cat.menu \
  --entitlements "$root/Resources/UsageCatMenu.entitlements" \
  --generate-entitlement-der "$app" >/dev/null

if command -v pluginkit >/dev/null; then
  pluginkit -a "$appex" >/dev/null 2>&1 || true
fi

echo "Built $app"
