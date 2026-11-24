#!/usr/bin/env bash
# Start TVM desktop.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$here/launch-tvm.sh" ]; then
  exec "$here/launch-tvm.sh" "$@"
fi
if [ -f "$here/../launch-tvm.sh" ]; then
  exec "$here/../launch-tvm.sh" "$@"
fi
if [ -f "$here/scripts/launch-tvm.sh" ]; then
  exec "$here/scripts/launch-tvm.sh" "$@"
fi
echo "launch-tvm.sh is missing." >&2
exit 1
