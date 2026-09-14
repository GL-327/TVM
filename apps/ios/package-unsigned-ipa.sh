#!/bin/sh
# Package TVM.app from an unsigned/ad-hoc xcodebuild into an IPA zip that
# Sideloadly / AltStore can re-sign. The result is not App Store signed and
# will not launch on a phone until it is re-signed with an Apple team.
#
# Sideloadly reports "Invalid file" if MobileVLCKit is left as an unsigned
# 1-architecture fat (CAFEBABE) wrapper. This script copies the device app,
# thins every Mach-O to arm64, ad-hoc signs nested binaries, then writes a
# PKZip with Payload/ at the root via ditto (not Info-ZIP -y symlinks).
#
# Expected layout after:
#   xcodebuild -workspace TVM.xcworkspace -scheme TVM -configuration Release \
#     -destination 'generic/platform=iOS' -derivedDataPath build \
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
APPDIR="$STAGE/Payload/TVM.app"
rm -rf "$STAGE"
mkdir -p "$STAGE/Payload"
ditto "$APP" "$APPDIR"
xattr -cr "$APPDIR" 2>/dev/null || true
find "$APPDIR" -name '.DS_Store' -delete 2>/dev/null || true

thin_if_macho() {
  f=$1
  [ -f "$f" ] || return 0
  if ! lipo -info "$f" >/dev/null 2>&1; then
    return 0
  fi
  archs=$(lipo -archs "$f" 2>/dev/null || true)
  if ! echo "$archs" | grep -qw arm64; then
    echo "package-unsigned-ipa.sh: $f has no arm64 slice ($archs)" >&2
    exit 1
  fi
  if lipo -info "$f" 2>/dev/null | grep -q 'Non-fat file' && [ "$archs" = "arm64" ]; then
    return 0
  fi
  tmp="$f.$$.arm64"
  lipo -thin arm64 "$f" -output "$tmp"
  mv "$tmp" "$f"
}

LIST=$(mktemp)
find "$APPDIR" -type f > "$LIST"
while IFS= read -r f; do
  thin_if_macho "$f"
done < "$LIST"
rm -f "$LIST"

sign_list() {
  list=$1
  while IFS= read -r item; do
    [ -n "$item" ] || continue
    codesign --force --sign - --timestamp=none "$item"
  done < "$list"
  rm -f "$list"
}

if [ -d "$APPDIR/Frameworks" ]; then
  LIST=$(mktemp)
  find "$APPDIR/Frameworks" -name '*.framework' -prune > "$LIST"
  sign_list "$LIST"
  LIST=$(mktemp)
  find "$APPDIR/Frameworks" -name '*.dylib' > "$LIST"
  sign_list "$LIST"
fi
if [ -d "$APPDIR/PlugIns" ]; then
  LIST=$(mktemp)
  find "$APPDIR/PlugIns" -name '*.appex' -prune > "$LIST"
  sign_list "$LIST"
fi
codesign --force --sign - --timestamp=none "$APPDIR"

VLC="$APPDIR/Frameworks/MobileVLCKit.framework/MobileVLCKit"
if [ -f "$VLC" ]; then
  vlc_info=$(lipo -info "$VLC")
  vlc_archs=$(lipo -archs "$VLC")
  echo "$vlc_info"
  if ! echo "$vlc_info" | grep -q 'Non-fat file'; then
    echo "package-unsigned-ipa.sh: MobileVLCKit is still a fat/CAFEBABE binary; Sideloadly will reject it." >&2
    exit 1
  fi
  if [ "$vlc_archs" != "arm64" ]; then
    echo "package-unsigned-ipa.sh: MobileVLCKit archs are '$vlc_archs', expected arm64." >&2
    exit 1
  fi
  codesign -d --verbose=2 "$VLC" 2>&1 | grep -q 'Signature=' || {
    echo "package-unsigned-ipa.sh: MobileVLCKit is not signed." >&2
    exit 1
  }
fi

if [ "$(lipo -archs "$APPDIR/TVM")" != "arm64" ]; then
  echo "package-unsigned-ipa.sh: TVM executable is not thin arm64." >&2
  exit 1
fi

IPA="$ROOT/build/TVM-unsigned.ipa"
rm -f "$IPA"
# Apple IPA layout: Payload/ at zip root, no resource-fork sidecar, no symlink entries.
ditto -c -k --norsrc --keepParent "$STAGE/Payload" "$IPA"
echo "unsigned IPA: $IPA"
echo "This file cannot be installed on an iPhone until it is re-signed on a Mac or with Sideloadly / AltStore."
