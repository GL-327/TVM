#!/usr/bin/env bash
# Double-click in Finder. Laptop window.
set -euo pipefail
cd "$(dirname "$0")"
exec ./TVM-windowed.sh
