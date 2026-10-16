#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 24 or later from https://nodejs.org, then run this file again."
  exit 1
fi
exec node scripts/start-local.mjs "$@"
