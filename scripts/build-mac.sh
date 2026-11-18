#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [[ "$(uname -s)" != Darwin ]]; then
  echo "VoiceApp's Mac build requires macOS." >&2
  exit 1
fi

# Local bundles use an ad-hoc signature and their own output directory.
# A developer's release credentials and staged DMG are independent of this build.
unset APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID
unset APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
export APPLE_SIGNING_IDENTITY=-
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$PWD/src-tauri/target}/local"
if [[ "$CARGO_TARGET_DIR" != /* ]]; then
  CARGO_TARGET_DIR="$PWD/$CARGO_TARGET_DIR"
fi
export CMAKE_POLICY_VERSION_MINIMUM="${CMAKE_POLICY_VERSION_MINIMUM:-3.5}"

bun install --frozen-lockfile
bun run --bun tauri build --ci --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}' -- --locked
