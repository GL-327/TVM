#!/bin/sh
# Produce a signed, device-installable IPA. Requires macOS + Xcode + an Apple team.
# This script cannot run on Windows and does not embed a team ID.
#
# From apps/ios:
#   ./export-ipa.sh development   # personal Apple ID, registered phone
#   ./export-ipa.sh ad-hoc        # paid team + device UDID on the profile
#
# Optional: DEVELOPMENT_TEAM=XXXXXXXXXX ./export-ipa.sh development
#
# First: open TVM.xcodeproj, select the TVM target, Signing & Capabilities,
# choose your team, and change com.tvm.privateclient if that id is taken.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
cd "$ROOT"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "export-ipa.sh: xcodebuild runs only on macOS with Xcode." >&2
  echo "This machine cannot produce an IPA." >&2
  echo "On a Mac: cd apps/ios && ./export-ipa.sh development" >&2
  echo "On Windows: run request-ipa.ps1 to fetch the unsigned CI zip, then re-sign with Sideloadly, AltStore, or Xcode." >&2
  exit 1
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "export-ipa.sh: xcodebuild not found. Install Xcode from the App Store, then:" >&2
  echo "  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" >&2
  exit 1
fi

METHOD=${1:-ad-hoc}
case "$METHOD" in
  ad-hoc) PLIST="$ROOT/ExportOptions-adhoc.plist" ;;
  development) PLIST="$ROOT/ExportOptions-development.plist" ;;
  *) echo "usage: $0 ad-hoc|development" >&2; exit 1 ;;
esac

ARCHIVE="$ROOT/build/TVM.xcarchive"
EXPORT="$ROOT/build/ipa"
rm -rf "$ARCHIVE" "$EXPORT"

TEAM_ARGS=""
if [ -n "${DEVELOPMENT_TEAM:-}" ]; then
  TEAM_ARGS="DEVELOPMENT_TEAM=$DEVELOPMENT_TEAM"
fi

# -allowProvisioningUpdates lets automatic signing create/refresh the profile
# for the team selected in Xcode or passed as DEVELOPMENT_TEAM.
# shellcheck disable=SC2086
xcodebuild -project TVM.xcodeproj -scheme TVM \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  $TEAM_ARGS \
  archive

# shellcheck disable=SC2086
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT" \
  -exportOptionsPlist "$PLIST" \
  -allowProvisioningUpdates \
  $TEAM_ARGS

IPA="$EXPORT/TVM.ipa"
if [ ! -f "$IPA" ]; then
  echo "export-ipa.sh: archive exported but $IPA was not created." >&2
  echo "Open the project in Xcode, set your team under Signing & Capabilities, then retry." >&2
  exit 1
fi
echo "IPA: $IPA"
echo "Install with Xcode (Window > Devices and Simulators), Apple Configurator, or a re-signer such as Sideloadly / AltStore."
