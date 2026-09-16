#!/usr/bin/env bash
# Double-click in Finder. Fullscreen kiosk.
set -euo pipefail
cd "$(dirname "$0")"
exec ./TVM.sh
