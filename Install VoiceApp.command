#!/usr/bin/env bash
# Double-click to install or update VoiceApp on this Mac.
# Runs scripts/install.command (pull, build, install to /Applications).
#
# Terminal alternative:
#   cd VoiceApp && ./scripts/install.sh

set -u

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
exec bash "${REPO_ROOT}/scripts/install.command" "$@"
