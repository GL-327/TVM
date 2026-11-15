#!/usr/bin/env bash
# CI: launch the simulator build with a scripted tour of the main screens
# (TVMWebView.smokeTour) and photograph the screen every 3 seconds.
set -uo pipefail
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
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b
xcrun simctl ui "$UDID" appearance dark || true
xcrun simctl install "$UDID" "$APP"
xcrun simctl launch "$UDID" com.tvm.privateclient -TVMSmokeTour
for i in $(seq -w 1 40); do
  sleep 3
  xcrun simctl io "$UDID" screenshot "$OUT/tour-$i.png" >/dev/null 2>&1 || true
done
# The last screen (Settings, reached from the You popup).
xcrun simctl io "$UDID" screenshot "$OUT/tour-end.png" >/dev/null 2>&1 || true
ls -la "$OUT"
# Small copies in the log as well, for reviewers who cannot download artifacts.
for f in "$OUT"/tour-*.png; do
  name=$(basename "$f" .png)
  sips -s format jpeg -s formatOptions 55 --resampleWidth 390 "$f" --out "$OUT/$name.jpg" >/dev/null 2>&1 || continue
  echo "TOURIMG $name $(base64 < "$OUT/$name.jpg" | tr -d '\n')"
done
