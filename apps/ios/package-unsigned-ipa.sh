#!/bin/sh
# Package TVM.app from an unsigned/ad-hoc xcodebuild into an IPA zip.
# The result is not App Store signed and will not install on a phone until
# it is re-signed with an Apple team and a provisioning profile
# (Sideloadly, AltStore, or Xcode on a Mac).
#
# Expected layout after:
#   xcodebuild -workspace TVM.xcworkspace -scheme TVM -configuration Release \
#     -sdk iphoneos -derivedDataPath build \
#     CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO \
#     AD_HOC_CODE_SIGNING_ALLOWED=YES build
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
cd "$ROOT"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "package-unsigned-ipa.sh: needs a Mac-built TVM.app under apps/ios/build." >&2
  echo "Windows cannot run xcodebuild. Use request-ipa.ps1 or ./export-ipa.sh on a Mac." >&2
  exit 1
fi

APP=$(find "$ROOT/build" -name 'TVM.app' -path '*Release-iphoneos*' | head -n 1)
if [ -z "$APP" ] || [ ! -d "$APP" ]; then
  echo "TVM.app not found under apps/ios/build. Run xcodebuild first." >&2
  exit 1
fi
if [ ! -f "$APP/TVM" ] || [ "$(/usr/libexec/PlistBuddy -c 'Print :DTPlatformName' "$APP/Info.plist")" != "iphoneos" ]; then
  echo "Found $APP but it is not a compiled iPhone device bundle." >&2
  exit 1
fi
STAGE="$ROOT/build/ipa-unsigned"
rm -rf "$STAGE"
mkdir -p "$STAGE/Payload"
cp -R "$APP" "$STAGE/Payload/TVM.app"
rm -f "$ROOT/build/TVM-unsigned.ipa"
(cd "$STAGE" && zip -qry "$ROOT/build/TVM-unsigned.ipa" Payload)
echo "unsigned IPA: $ROOT/build/TVM-unsigned.ipa"
echo "This file cannot be installed on an iPhone until it is re-signed on a Mac or with Sideloadly / AltStore."
