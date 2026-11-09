#!/usr/bin/env bash
# UI flows and Figma captures on one iOS Simulator device.
#
#   apps/ios/scripts/ui-flows.sh "<device name>" <output dir> [captures-only]
#
# Runs SuperGongikUITests (scheme SuperGongikUI) on a fresh simulator with the
# status bar pinned to 9:41, writes the Figma captures to <out>/captures and
# the result bundle to <out>/UITests.xcresult. With "captures-only" only
# FigmaCaptureTests runs (used for the extra widths). Exits non-zero when a
# test fails; a device type the runtime does not have is reported as SKIPPED
# (exit 0) so a runner image change cannot fake a pass or fail the job.
set -euo pipefail

DEVICE="$1"
OUT="$2"
MODE="${3:-all}"
mkdir -p "$OUT/captures"

RUNTIME="$(xcrun simctl list runtimes -j | python3 -c 'import json,sys; r=[x for x in json.load(sys.stdin)["runtimes"] if x["platform"]=="iOS" and x["isAvailable"]]; print(sorted(r,key=lambda x:[int(p) for p in x["version"].split(".")])[-1]["identifier"])')"
TYPE="$(xcrun simctl list devicetypes -j | python3 -c "import json,sys; print(next((d['identifier'] for d in json.load(sys.stdin)['devicetypes'] if d['name']=='$DEVICE'), ''))")"
if [[ -z "$TYPE" ]]; then
  echo "SKIPPED: device type '$DEVICE' is not available on this runner" | tee "$OUT/skipped.txt"
  exit 0
fi
UDID="$(xcrun simctl create "UI $DEVICE" "$TYPE" "$RUNTIME")"
echo "device=$DEVICE udid=$UDID runtime=$RUNTIME"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 || true

ONLY=()
if [[ "$MODE" == "captures-only" ]]; then
  ONLY=(-only-testing:SuperGongikUITests/FigmaCaptureTests)
fi

status=0
TEST_RUNNER_SG_SHOT_DIR="$OUT/captures" xcodebuild -project SuperGongik.xcodeproj -scheme SuperGongikUI \
  -destination "platform=iOS Simulator,id=$UDID" \
  -derivedDataPath "${DERIVED_DATA:-$PWD/build/DerivedData-ui}" \
  -resultBundlePath "$OUT/UITests.xcresult" \
  "${ONLY[@]+"${ONLY[@]}"}" \
  CODE_SIGNING_ALLOWED=NO test || status=$?

xcrun simctl shutdown "$UDID" || true
xcrun simctl delete "$UDID" || true
echo "$(find "$OUT/captures" -name '*.png' | wc -l | tr -d ' ') captures in $OUT/captures"
exit "$status"
