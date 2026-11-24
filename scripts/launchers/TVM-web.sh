#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$here/launch-web.mjs" ]; then
  entry="$here/launch-web.mjs"
elif [ -f "$here/../launch-web.mjs" ]; then
  entry="$here/../launch-web.mjs"
elif [ -f "$here/scripts/launch-web.mjs" ]; then
  entry="$here/scripts/launch-web.mjs"
else
  echo "launch-web.mjs is missing." >&2
  exit 1
fi
exec node "$entry" "$@"
