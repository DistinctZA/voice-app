#!/usr/bin/env bash
# Fail when any tracked VoiceApp version differs from package.json.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED="$(node -p "require('${REPO_ROOT}/package.json').version")"

node - "$REPO_ROOT" "$EXPECTED" <<'NODE'
const fs = require("fs");
const path = require("path");

const [root, expected] = process.argv.slice(2);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [
  ["src-tauri/tauri.conf.json", JSON.parse(read("src-tauri/tauri.conf.json")).version],
  ["src-tauri/Cargo.toml", read("src-tauri/Cargo.toml").match(/^\[package\][\s\S]*?^version = "([^"]+)"/m)?.[1]],
  ["src-tauri/Cargo.lock", read("src-tauri/Cargo.lock").match(/\[\[package\]\]\nname = "voiceapp"\nversion = "([^"]+)"/)?.[1]],
];

const readme = read("README.md");
checks.push(["README.md version table", readme.match(/\| \*\*Version\*\* \| ([^ |]+) \|/)?.[1]]);
checks.push(["README.md development version", readme.match(/VoiceApp v([0-9]+\.[0-9]+\.[0-9]+) \(Dev\)/)?.[1]]);

const mismatches = checks.filter(([, actual]) => actual !== expected);
if (mismatches.length) {
  for (const [file, actual] of mismatches) {
    console.error(`${file}: expected ${expected}, found ${actual ?? "missing"}`);
  }
  process.exit(1);
}

console.log(`All tracked versions match ${expected}.`);
NODE
