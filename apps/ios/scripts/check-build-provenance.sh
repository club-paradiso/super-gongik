#!/usr/bin/env bash
# Refuses a distributable build that still carries placeholder provenance.
#
# Config/Base.xcconfig defaults SG_BUILD_NUMBER / SG_BUILD_COMMIT / SG_BUILD_CHANNEL
# to `2` / `local` / `Debug` so a plain Xcode Run works. A Beta or Release build
# must instead be stamped on the xcodebuild command line (install-device.sh,
# release-archive.sh). An unstamped archive once made a phone's build
# indistinguishable from `main` (docs/ios/BUILD-PROVENANCE-AUDIT.md), so:
#
#   Debug           anything goes (the stamp is shown as "Debug · local").
#   Beta            commit = short SHA, optionally "-dirty"; number > every
#                   number in the ledger.
#   Release         like Beta, and never "-dirty".
#
# The ledger (Config/build-ledger.tsv) lists every build number that reached a
# phone, TestFlight or App Store Connect, so a number is never reused and the
# next one is always higher than the last upload. Append a line after each
# distribution (release-archive.sh --record does it).
#
# Usage:
#   check-build-provenance.sh                      # Xcode build phase: reads
#                                                  # SG_BUILD_* from the environment
#   check-build-provenance.sh --channel Release --commit 794e489 --number 480
#   check-build-provenance.sh --self-test          # exercises the rules (CI)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LEDGER="${SG_BUILD_LEDGER:-$here/../Config/build-ledger.tsv}"

channel="${SG_BUILD_CHANNEL:-}"
commit="${SG_BUILD_COMMIT:-}"
number="${SG_BUILD_NUMBER:-}"
self_test=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --channel) channel="$2"; shift 2 ;;
    --commit) commit="$2"; shift 2 ;;
    --number) number="$2"; shift 2 ;;
    --ledger) LEDGER="$2"; shift 2 ;;
    --self-test) self_test=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

fail() {
  # Xcode shows "error:" lines in the build log and fails the phase.
  echo "error: build provenance: $*" >&2
  echo "error: stamp the build on the command line: SG_BUILD_NUMBER=<git rev-list --count HEAD> SG_BUILD_COMMIT=<git rev-parse --short HEAD> SG_BUILD_CHANNEL=$channel (apps/ios/scripts/release-archive.sh does this)" >&2
  exit 1
}

# Highest build number recorded in the ledger; 0 when there is none.
ledger_max() {
  local max=0 n
  [[ -f "$1" ]] || { echo 0; return; }
  while IFS=$'\t' read -r n _; do
    [[ "$n" =~ ^[0-9]+$ ]] || continue
    (( n > max )) && max=$n
  done < "$1"
  echo "$max"
}

ledger_has() {
  [[ -f "$2" ]] && awk -F'\t' -v n="$1" '$1 == n { found = 1 } END { exit !found }' "$2"
}

check() {
  local channel="$1" commit="$2" number="$3" ledger="$4"
  case "$channel" in
    Debug) return 0 ;;
    Beta|Release) ;;
    *) fail "SG_BUILD_CHANNEL is '$channel'; expected Debug, Beta or Release" ;;
  esac
  [[ -n "$commit" ]] || fail "SG_BUILD_COMMIT is empty"
  [[ "$commit" != "local" ]] || fail "SG_BUILD_COMMIT is the placeholder 'local'"
  [[ "$commit" =~ ^[0-9a-f]{7,40}(-dirty)?$ ]] || fail "SG_BUILD_COMMIT '$commit' is not a short Git SHA"
  if [[ "$channel" == Release && "$commit" == *-dirty ]]; then
    fail "a Release build must come from a clean checkout (commit is '$commit')"
  fi
  [[ "$number" =~ ^[1-9][0-9]*$ ]] || fail "SG_BUILD_NUMBER '$number' is not a positive integer"
  local max
  max="$(ledger_max "$ledger")"
  if ledger_has "$number" "$ledger"; then
    fail "SG_BUILD_NUMBER $number was already distributed (Config/build-ledger.tsv)"
  fi
  (( number > max )) || fail "SG_BUILD_NUMBER $number is not higher than the last distributed build ($max, Config/build-ledger.tsv)"
}

if [[ "$self_test" == 1 ]]; then
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  printf 'number\tcommit\tchannel\tdate\tnote\n1\tunknown\tDebug\t2026-10-15\tseed\n2\tlocal\tDebug\t-\tplaceholder\n57\tabc1234\tBeta\t2026-10-20\tseed\n' > "$tmp"
  expect() { # expect <pass|fail> <channel> <commit> <number>
    local want="$1"; shift
    if ( check "$@" "$tmp" ) >/dev/null 2>&1; then got=pass; else got=fail; fi
    if [[ "$got" != "$want" ]]; then
      echo "self-test: channel=$1 commit=$2 number=$3 → $got, expected $want" >&2
      exit 1
    fi
  }
  expect pass Debug local 2
  expect pass Debug "" ""
  expect fail Release local 2
  expect fail Release "" 480
  expect fail Release 794e489 2
  expect fail Release 794e489 57       # already in the ledger
  expect fail Release 794e489 30       # lower than the last upload
  expect fail Release 794e489-dirty 480
  expect pass Beta 794e489-dirty 480
  expect pass Release 794e489 480
  expect fail Release 'g94e489' 480
  expect fail Release '$(SG_BUILD_COMMIT)' 480
  expect fail Release 794e489 0
  expect fail Nightly 794e489 480
  echo "check-build-provenance self-test: ok"
  exit 0
fi

check "$channel" "$commit" "$number" "$LEDGER"
echo "build provenance ok: $channel · $commit · build $number"
