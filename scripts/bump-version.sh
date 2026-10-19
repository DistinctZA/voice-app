#!/usr/bin/env bash
# Update every release version, including Cargo.lock and README, on macOS or Linux.
# Usage: ./scripts/bump-version.sh 1.4.1
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "${REPO_ROOT}/scripts/version.mjs" "${1:?Usage: bump-version.sh <version>}"
