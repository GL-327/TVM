#!/usr/bin/env bash
# Starts Core + the desktop UI in a 1920x1080 TV frame, and rebuilds the Roku zip.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$here/../roku-dev.sh" ]; then
  exec "$here/../roku-dev.sh" "$@"
fi
if [ -f "$here/roku-dev.sh" ]; then
  exec "$here/roku-dev.sh" "$@"
fi
if [ -f "$here/scripts/roku-dev.sh" ]; then
  exec "$here/scripts/roku-dev.sh" "$@"
fi
echo "roku-dev.sh is missing." >&2
exit 1
