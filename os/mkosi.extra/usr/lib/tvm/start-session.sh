#!/bin/sh
# Starts the TVM kiosk: one compositor, one fullscreen window, no desktop.
#
# Core is Type=notify, so this unit only starts once the API is listening.
# A short health loop remains as a belt-and-braces against a raced READY=1.
set -eu

CORE_URL="http://127.0.0.1:${TVM_CORE_PORT:-7345}"

attempt=0
while [ "$attempt" -lt 50 ]; do
    if curl --silent --fail --max-time 1 "$CORE_URL/api/health" >/dev/null 2>&1; then
        break
    fi
    attempt=$((attempt + 1))
    sleep 0.2
done

exec cage -d -- chromium \
    --kiosk \
    --app="$CORE_URL" \
    --ozone-platform=wayland \
    --enable-features=UseOzonePlatform,VaapiVideoDecoder,VaapiVideoEncoder \
    --start-fullscreen \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-pinch \
    --overscroll-history-navigation=0 \
    --hide-scrollbars \
    --no-first-run \
    --autoplay-policy=no-user-gesture-required \
    --user-data-dir=/var/lib/tvm/chromium
