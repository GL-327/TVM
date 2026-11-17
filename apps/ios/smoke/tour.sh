#!/usr/bin/env bash
# CI: launch the simulator build with a scripted tour of the main screens
# (TVMWebView.smokeTour) and photograph the screen every 3 seconds.
set -uo pipefail
# macOS has no timeout(1); perl's alarm gives each simulator command a real limit.
command -v timeout >/dev/null 2>&1 || timeout() { local limit=$1; shift; perl -e 'alarm shift; exec @ARGV' "$limit" "$@"; }
cd "$(dirname "$0")/.."
OUT=build/tour
mkdir -p "$OUT"
APP=$(find build/sim/Build/Products -maxdepth 2 -name TVM.app -path '*iphonesimulator*' | head -1)
[ -n "$APP" ] || { echo "no simulator app"; exit 1; }
UDID=$(xcrun simctl list devices available -j | python3 -c '
import json, sys
data = json.load(sys.stdin)["devices"]
names = [(d["name"], d["udid"]) for r, v in data.items() if "iOS" in r for d in v if d.get("isAvailable") and "iPhone" in d["name"]]
for preferred in ("iPhone 17 Pro", "iPhone 16 Pro", "iPhone 16", "iPhone 15"):
    for name, udid in names:
        if name == preferred:
            print(udid); raise SystemExit
print(names[0][1] if names else "")')
[ -n "$UDID" ] || { echo "no iPhone simulator"; exit 1; }
timeout 120 xcrun simctl boot "$UDID" 2>/dev/null || true
timeout 180 xcrun simctl bootstatus "$UDID" -b || true
timeout 30 xcrun simctl ui "$UDID" appearance dark || true
timeout 120 xcrun simctl install "$UDID" "$APP"
timeout 60 xcrun simctl launch "$UDID" com.tvm.privateclient -TVMSmokeTour
# Each photo goes into the log as soon as it is taken (a small copy, for
# reviewers who cannot download artifacts), so a hang later loses nothing.
shot() {
  local name=$1
  timeout 20 xcrun simctl io "$UDID" screenshot "$OUT/$name.png" >/dev/null 2>&1 || { echo "no photo $name"; return; }
  timeout 20 sips -s format jpeg -s formatOptions 55 --resampleWidth 390 "$OUT/$name.png" --out "$OUT/$name.jpg" >/dev/null 2>&1 || return
  echo "TOURIMG $name $(base64 < "$OUT/$name.jpg" | tr -d '\n')"
}
for i in $(seq -w 1 40); do
  sleep 3
  shot "tour-$i"
done
# The last screen: the You popup, left open.
shot tour-end
ls -la "$OUT"
