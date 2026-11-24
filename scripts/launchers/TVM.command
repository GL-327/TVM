#!/usr/bin/env bash
# Double-click in Finder. Fullscreen kiosk.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"
exec "$here/TVM.sh" "$@"
