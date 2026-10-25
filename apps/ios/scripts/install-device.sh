#!/usr/bin/env bash
# Builds the app for a connected iPhone and installs it over the existing copy.
#
# The build is stamped with where it came from, so 내 정보 › 정보 shows which
# commit a phone is running (a stale install was once mistaken for the
# current design):
#   CFBundleVersion = git commit count, SGBuildCommit = short SHA
#   (+ "-dirty" when the tree has uncommitted changes), SGBuildChannel = Beta.
#
# Installing over the old app keeps its data (same bundle id). Never delete
# the app first: the service record lives only in its container.
#
# Usage: apps/ios/scripts/install-device.sh <devicectl-identifier> [xcode-udid]
#   (run from apps/ios; `xcrun devicectl list devices` lists the identifier,
#   `xcrun xctrace list devices` the UDID xcodebuild wants)
set -euo pipefail

DEVICE="${1:?devicectl device identifier}"
UDID="${2:-$(xcrun devicectl device info details --device "$DEVICE" --json-output /dev/stdout 2>/dev/null \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["hardwareProperties"]["udid"])')}"
DERIVED="${DERIVED_DATA:-$PWD/build/DerivedData-device}"

NUMBER="$(git rev-list --count HEAD)"
COMMIT="$(git rev-parse --short HEAD)"
if ! git diff --quiet HEAD -- . || [[ -n "$(git ls-files --others --exclude-standard -- .)" ]]; then
  COMMIT="$COMMIT-dirty"
fi
# Refuses a number already distributed or lower than the last one in
# Config/build-ledger.tsv (the Xcode build phase checks the same).
"$(dirname "$0")/check-build-provenance.sh" --channel Beta --commit "$COMMIT" --number "$NUMBER"
echo "building 0.2.0 ($NUMBER) Beta · $COMMIT for $UDID"

xcodegen generate --quiet
xcodebuild -project SuperGongik.xcodeproj -scheme SuperGongik -configuration Debug \
  -destination "id=$UDID" -derivedDataPath "$DERIVED" -allowProvisioningUpdates \
  SG_BUILD_NUMBER="$NUMBER" SG_BUILD_COMMIT="$COMMIT" SG_BUILD_CHANNEL=Beta \
  build -quiet

APP="$DERIVED/Build/Products/Debug-iphoneos/SuperGongik.app"
/usr/libexec/PlistBuddy -c 'Print CFBundleVersion' -c 'Print SGBuildCommit' "$APP/Info.plist"

# devicectl refuses while the phone is locked; retry for two minutes.
for attempt in $(seq 1 12); do
  if xcrun devicectl device install app --device "$DEVICE" "$APP"; then exit 0; fi
  echo "install failed (attempt $attempt) — unlock the phone"; sleep 10
done
exit 1
