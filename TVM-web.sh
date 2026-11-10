#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
entry="$root/launch-web.mjs"
if [ -f "$root/scripts/launch-web.mjs" ]; then entry="$root/scripts/launch-web.mjs"; fi
exec node "$entry" "$@"
