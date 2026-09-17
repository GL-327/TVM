#!/usr/bin/env bash
# Runs the pretend IPTV panel. Add --check to prove the proxy against a running Core.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$here/../apps/core/src/Server Side Live/tester/cli.ts" "$@"
