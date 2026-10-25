#!/usr/bin/env bash
# Creates a Release archive stamped with its real provenance, then proves the
# stamp landed in the archived app's Info.plist. Nothing is uploaded: App Store
# Connect / TestFlight distribution is a separate, authorized step.
#
#   CFBundleVersion = git rev-list --count HEAD   (SG_BUILD_NUMBER)
#   SGBuildCommit   = git rev-parse --short HEAD  (SG_BUILD_COMMIT, "-dirty" refused)
#   SGBuildChannel  = Release
#
# check-build-provenance.sh refuses the placeholders and any build number that
# is already in Config/build-ledger.tsv or not higher than the last one there.
# Pass --record after the archive has been distributed to append it to the
# ledger (commit that change).
#
# Usage: apps/ios/scripts/release-archive.sh [--record] [--bundle-id <id>]
#   (run from apps/ios; needs Config/Local.xcconfig with SG_DEVELOPMENT_TEAM and
#   the release SG_BUNDLE_ID — see docs/ios/RELEASE.md)
set -euo pipefail

record=0
bundle_override=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --record) record=1; shift ;;
    --bundle-id) bundle_override=("SG_BUNDLE_ID=$2"); shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCHIVE="${ARCHIVE_PATH:-$PWD/build/SuperGongik.xcarchive}"
DERIVED="${DERIVED_DATA:-$PWD/build/DerivedData-release}"
LEDGER="$here/../Config/build-ledger.tsv"

NUMBER="$(git rev-list --count HEAD)"
COMMIT="$(git rev-parse --short HEAD)"
if ! git diff --quiet HEAD -- . || [[ -n "$(git ls-files --others --exclude-standard -- .)" ]]; then
  COMMIT="$COMMIT-dirty"
fi

"$here/check-build-provenance.sh" --channel Release --commit "$COMMIT" --number "$NUMBER" --ledger "$LEDGER"
echo "archiving 0.2.0 ($NUMBER) Release · $COMMIT"

xcodegen generate --quiet
rm -rf "$ARCHIVE"
xcodebuild -project SuperGongik.xcodeproj -scheme SuperGongik -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath "$DERIVED" -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  SG_BUILD_NUMBER="$NUMBER" SG_BUILD_COMMIT="$COMMIT" SG_BUILD_CHANNEL=Release "${bundle_override[@]}" \
  archive -quiet

APP="$ARCHIVE/Products/Applications/SuperGongik.app"
plist() { /usr/libexec/PlistBuddy -c "Print $1" "$APP/Info.plist"; }
got_number="$(plist CFBundleVersion)"
got_commit="$(plist SGBuildCommit)"
got_channel="$(plist SGBuildChannel)"
got_bundle="$(plist CFBundleIdentifier)"
echo "archive: $got_bundle $(plist CFBundleShortVersionString) ($got_number) $got_channel · $got_commit"
if [[ "$got_number" != "$NUMBER" || "$got_commit" != "$COMMIT" || "$got_channel" != Release ]]; then
  echo "error: the archive's Info.plist does not carry the requested stamp" >&2
  exit 1
fi

line="$(printf '%s\t%s\t%s\t%s\t%s' "$NUMBER" "$COMMIT" Release "$(date +%Y-%m-%d)" "$got_bundle")"
if [[ "$record" == 1 ]]; then
  echo "$line" >> "$LEDGER"
  echo "recorded in $LEDGER — commit it"
else
  echo "after distributing, record it: echo \"$line\" >> apps/ios/Config/build-ledger.tsv"
fi
