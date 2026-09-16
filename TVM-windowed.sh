#!/usr/bin/env bash
# Laptop start: a window that fits the work area, mouse cursor visible.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$here/scripts/launch-tvm.sh" ]; then
  exec "$here/scripts/launch-tvm.sh" --windowed "$@"
fi
if [ -f "$here/launch-tvm.sh" ]; then
  exec "$here/launch-tvm.sh" --windowed "$@"
fi
echo "launch-tvm.sh is missing next to this file." >&2
exit 1
