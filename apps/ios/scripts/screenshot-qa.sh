#!/usr/bin/env bash
# Native screenshot QA on real iOS Simulators.
#
# Builds the Debug app once, then for a deliberate matrix of device width ×
# appearance × theme × Dynamic Type × Increase Contrast launches the app with
# the DEBUG-only hooks (-SGSeedDemo, -SGTheme, -SGInitialTab) and saves one
# PNG per case plus manifest.tsv. The demo document is created through the
# shared core commands on first launch (SuperGongik/Core/DebugSeed.swift).
#
# Usage: apps/ios/scripts/screenshot-qa.sh <output-dir>   (run from apps/ios)
set -euo pipefail

OUT="${1:-$PWD/build/screenshots}"
DERIVED="${DERIVED_DATA:-$PWD/build/DerivedData-qa}"
mkdir -p "$OUT"

xcodebuild -project SuperGongik.xcodeproj -scheme SuperGongik -configuration Debug \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath "$DERIVED" \
  CODE_SIGNING_ALLOWED=NO build -quiet
APP="$(find "$DERIVED/Build/Products/Debug-iphonesimulator" -maxdepth 1 -name 'SuperGongik.app' | head -1)"
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$APP/Info.plist")"
RUNTIME="$(xcrun simctl list runtimes -j | python3 -c 'import json,sys; r=[x for x in json.load(sys.stdin)["runtimes"] if x["platform"]=="iOS" and x["isAvailable"]]; print(sorted(r,key=lambda x:[int(p) for p in x["version"].split(".")])[-1]["identifier"])')"
echo "app=$APP bundle=$BUNDLE_ID runtime=$RUNTIME"

device() { # name -> udid (created fresh so the store starts empty)
  local type
  type="$(xcrun simctl list devicetypes -j | python3 -c "import json,sys; print(next(d['identifier'] for d in json.load(sys.stdin)['devicetypes'] if d['name']=='$1'))")"
  local udid
  udid="$(xcrun simctl create "QA $1" "$type" "$RUNTIME")"
  xcrun simctl boot "$udid"
  xcrun simctl bootstatus "$udid" -b >/dev/null
  xcrun simctl status_bar "$udid" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 || true
  xcrun simctl install "$udid" "$APP"
  echo "$udid"
}

printf 'file\tdevice\tappearance\ttheme\tcontent_size\tcontrast\ttab\n' > "$OUT/manifest.tsv"

# device|appearance|theme|content size|increase contrast|tabs
MATRIX=(
  "iPhone 16|light|standard|large|disabled|today records leave pay more"
  "iPhone 16|dark|standard|large|disabled|today more"
  "iPhone 16|light|warrior|large|disabled|today records leave pay more"
  "iPhone 16|dark|warrior|large|disabled|today records leave pay more"
  "iPhone 16|light|standard|accessibility-extra-extra-large|disabled|today"
  "iPhone 16|light|warrior|accessibility-extra-extra-large|disabled|leave"
  "iPhone 16|dark|warrior|accessibility-extra-extra-large|disabled|pay"
  "iPhone 16|light|standard|large|enabled|today"
  "iPhone 16|dark|warrior|large|enabled|today"
  "iPhone SE (3rd generation)|light|standard|large|disabled|today records"
  "iPhone SE (3rd generation)|dark|warrior|large|disabled|today"
  "iPhone 16 Plus|light|warrior|large|disabled|today"
  "iPhone 16 Plus|light|standard|large|disabled|records"
)

DEVICES="$OUT/.devices"  # "name|udid" lines (macOS /bin/bash 3.2 has no associative arrays)
: > "$DEVICES"
for row in "${MATRIX[@]}"; do
  IFS='|' read -r name appearance theme size contrast tabs <<<"$row"
  udid="$(grep -F "$name|" "$DEVICES" | cut -d'|' -f2 || true)"
  if [[ -z "$udid" ]]; then
    if ! udid="$(device "$name" | tail -1)" || [[ -z "$udid" ]]; then
      echo "SKIPPED: $name is not available with $RUNTIME" | tee -a "$OUT/skipped.txt"
      continue
    fi
    echo "$name|$udid" >> "$DEVICES"
    FIRST=1
  else
    FIRST=0
  fi
  xcrun simctl ui "$udid" appearance "$appearance"
  xcrun simctl ui "$udid" content_size "$size"
  xcrun simctl ui "$udid" increase_contrast "$contrast" || echo "increase_contrast not supported by this simctl"
  for tab in $tabs; do
    xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
    xcrun simctl launch "$udid" "$BUNDLE_ID" -SGSeedDemo YES -SGTheme "$theme" -SGInitialTab "$tab" >/dev/null
    if [[ "$FIRST" == 1 ]]; then sleep 14; FIRST=0; else sleep 7; fi
    slug="$(echo "$name" | tr -cd '[:alnum:]')"
    file="${slug}-${appearance}-${theme}-${size}-contrast_${contrast}-${tab}.png"
    xcrun simctl io "$udid" screenshot "$OUT/$file" >/dev/null
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$file" "$name" "$appearance" "$theme" "$size" "$contrast" "$tab" >> "$OUT/manifest.tsv"
    echo "captured $file"
  done
done

while IFS='|' read -r _ udid; do xcrun simctl shutdown "$udid" || true; xcrun simctl delete "$udid" || true; done < "$DEVICES"
rm -f "$DEVICES"
echo "$(($(wc -l < "$OUT/manifest.tsv") - 1)) screenshots in $OUT"
