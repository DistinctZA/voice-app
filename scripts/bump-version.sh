#!/usr/bin/env bash
# Bump every tracked VoiceApp version source together.
#
# Usage:
#   ./scripts/bump-version.sh 1.0.2
#   ./scripts/bump-version.sh 1.1.0
#
# Then commit, push, and on each Mac run:  ./scripts/install.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NEW_VERSION="${1:-}"

if [[ -z "$NEW_VERSION" ]]; then
  echo "Usage: $0 <version>" >&2
  echo "Example: $0 1.0.2" >&2
  exit 1
fi

if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version must be semver like 1.0.2 (got: ${NEW_VERSION})" >&2
  exit 1
fi

PACKAGE_JSON="${REPO_ROOT}/package.json"
TAURI_CONF="${REPO_ROOT}/src-tauri/tauri.conf.json"
CARGO_TOML="${REPO_ROOT}/src-tauri/Cargo.toml"
CARGO_LOCK="${REPO_ROOT}/src-tauri/Cargo.lock"
README="${REPO_ROOT}/README.md"

OLD_VERSION="$(node -p "require('${PACKAGE_JSON}').version")"

if [[ "$OLD_VERSION" == "$NEW_VERSION" ]]; then
  echo "Version is already ${NEW_VERSION}"
  exit 0
fi

node <<EOF
const fs = require('fs');
const pkgPath = '${PACKAGE_JSON}';
const tauriPath = '${TAURI_CONF}';
const cargoPath = '${CARGO_TOML}';
const lockPath = '${CARGO_LOCK}';
const readmePath = '${README}';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = '${NEW_VERSION}';
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
const tauri = JSON.parse(fs.readFileSync(tauriPath, 'utf8'));
tauri.version = '${NEW_VERSION}';
fs.writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + '\n');

const cargo = fs.readFileSync(cargoPath, 'utf8').replace(
  /(^\[package\][\s\S]*?^version = ")[^"]+("$)/m,
  (_, prefix, suffix) => prefix + '${NEW_VERSION}' + suffix,
);
fs.writeFileSync(cargoPath, cargo);

const lock = fs.readFileSync(lockPath, 'utf8').replace(
  /(\[\[package\]\]\nname = "voiceapp"\nversion = ")[^"]+("\n)/,
  (_, prefix, suffix) => prefix + '${NEW_VERSION}' + suffix,
);
fs.writeFileSync(lockPath, lock);

const readme = fs.readFileSync(readmePath, 'utf8')
  .replace('| **Version** | ${OLD_VERSION} |', '| **Version** | ${NEW_VERSION} |')
  .replace('VoiceApp v${OLD_VERSION} (Dev)', 'VoiceApp v${NEW_VERSION} (Dev)');
fs.writeFileSync(readmePath, readme);
EOF

"${REPO_ROOT}/scripts/check-version.sh"

echo "Bumped VoiceApp ${OLD_VERSION} → ${NEW_VERSION}"
echo ""
echo "Updated:"
echo "  - package.json"
echo "  - src-tauri/tauri.conf.json"
echo "  - src-tauri/Cargo.toml"
echo "  - src-tauri/Cargo.lock"
echo "  - README.md"
echo ""
echo "Next steps:"
echo "  git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock README.md"
echo "  git commit -m \"Release VoiceApp ${NEW_VERSION}\""
echo "  git push"
echo "  ./scripts/install.sh    # on each Mac"
