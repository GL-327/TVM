#!/bin/sh
# Starts the TVM kiosk: one compositor, one window, no desktop.
#
# Phase 1 uses Chromium under Cage. The Electron shell and the mpv video plane
# replace this browser in Phase 6, but the session contract stays the same:
# systemd starts this script, it never returns, and systemd restarts it if it
# does.
set -eu

CORE_URL="http://127.0.0.1:${TVM_CORE_PORT:-7345}"

# Core owns the interface as well as the API, so there is nothing to show until
# it answers. Waiting here beats a browser error page on the television.
attempt=0
while [ "$attempt" -lt 60 ]; do
    if curl --silent --fail --max-time 1 "$CORE_URL/api/health" >/dev/null 2>&1; then
        break
    fi
    attempt=$((attempt + 1))
    sleep 1
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
