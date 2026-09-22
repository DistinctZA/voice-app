#!/usr/bin/env bash
# Double-click installer for VoiceApp (macOS).
# Opens in Terminal when launched from Finder. Keeps the window open so you can read the log.
#
# For terminal use without a pause at the end, run:
#   ./scripts/install.sh

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXIT=0

clear
echo "VoiceApp Installer"
echo "=================="
echo ""

bash "${SCRIPT_DIR}/install.sh" "$@" || EXIT=$?

echo ""
if [[ $EXIT -ne 0 ]]; then
  echo "Install failed (exit code ${EXIT})."
else
  echo "Install finished successfully."
fi
echo ""
read -r -p "Press Enter to close this window…" _ || true
exit "$EXIT"
