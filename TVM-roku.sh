#!/usr/bin/env bash
# Starts Core + the desktop UI in a 1920x1080 TV frame, and rebuilds the Roku zip.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$here/scripts/roku-dev.sh" "$@"
