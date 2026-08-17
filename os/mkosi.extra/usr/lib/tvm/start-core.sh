#!/bin/sh
# Starts core from a live app update if one has been applied, otherwise from
# the copy baked into the image. Updates write under /var/lib/tvm only, so
# ProtectSystem=strict can stay on.
set -eu

DATA="${TVM_DATA_DIR:-/var/lib/tvm}"
IMAGE_CORE=/usr/lib/tvm/core/index.js
IMAGE_UI=/usr/lib/tvm/ui
CURRENT_FILE="$DATA/app/current"

if [ -f "$CURRENT_FILE" ]; then
    version=$(tr -d '[:space:]' < "$CURRENT_FILE")
    app="$DATA/app/$version"
    if [ -f "$app/core/index.js" ]; then
        export TVM_UI_DIST="$app/ui"
        exec /usr/bin/node "$app/core/index.js"
    fi
fi

export TVM_UI_DIST="${TVM_UI_DIST:-$IMAGE_UI}"
exec /usr/bin/node "$IMAGE_CORE"
