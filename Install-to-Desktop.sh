#!/usr/bin/env bash
# Puts the laptop TVM launcher and the Roku zip on this user's Desktop.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$here/scripts/copy-to-desktop.sh" "$@"
