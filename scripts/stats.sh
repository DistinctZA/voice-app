#!/usr/bin/env bash
# VoiceApp download stats — per-release asset download counts from the
# public releases repo, plus 14-day website traffic.
#
# Usage:  ./scripts/stats.sh
#
# What the numbers mean:
#   *.dmg download_count        → new installs (people downloading from the site)
#   *.app.tar.gz download_count → auto-updates delivered to existing users
#   latest.json download_count  → update checks (each app checks on launch + every 4h,
#                                 so this roughly tracks active installs over time)

set -euo pipefail

REPO="DistinctZA/voiceapp-releases"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required (https://cli.github.com)" >&2
  exit 1
fi

echo "── Downloads by release ─────────────────────────────"
gh api "repos/$REPO/releases" --jq '
  .[] | "\(.tag_name)  (\(.published_at[:10]))",
        (.assets[] | "    \(.download_count | tostring | (" " * (6 - length)) + .)  \(.name)")
'

echo ""
echo "── Totals ───────────────────────────────────────────"
gh api "repos/$REPO/releases" --jq '
  [.[].assets[]] |
  "  New installs (DMG):      \(map(select(.name | endswith(".dmg")) | .download_count) | add // 0)",
  "  Auto-updates delivered:  \(map(select(.name | endswith(".tar.gz")) | .download_count) | add // 0)",
  "  Update checks:           \(map(select(.name == "latest.json") | .download_count) | add // 0)"
'

echo ""
echo "── Website traffic, last 14 days (voice-app.xyz) ────"
gh api "repos/$REPO/traffic/views" --jq '"  Views: \(.count)   Unique visitors: \(.uniques)"' \
  2>/dev/null || echo "  (traffic data unavailable — needs push access to $REPO)"
