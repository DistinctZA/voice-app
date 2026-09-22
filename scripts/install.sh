#!/usr/bin/env bash
# VoiceApp macOS installer — pull latest from git, build, and install to /Applications.
#
# Usage:
#   ./scripts/install.sh              # check for updates, pull, build if needed, install
#   ./scripts/install.sh --check      # only report update status (no build)
#   ./scripts/install.sh --force      # rebuild and reinstall even if version/commit match
#   ./scripts/install.sh --no-pull    # build from current local checkout (skip git pull)
#   ./scripts/install.sh -y           # pull without confirmation prompt
#   ./scripts/install.sh --relaunch   # reopen VoiceApp after install (used by in-app updater)
#   ./scripts/install.sh --progress-file PATH  # write JSON progress for in-app updater UI
#   ./scripts/install.sh --dev        # mark install as a dev install: the in-app updater
#                                     # rebuilds from this repo instead of using the
#                                     # customer release feed (default: customer mode)
#
# Update workflow (maintainers):
#   1. Make changes and bump version:  ./scripts/bump-version.sh 1.0.2
#   2. Commit and push to GitHub
#   3. On each Mac:                     ./scripts/install.sh

set -euo pipefail

# In-app updates spawn this script from the GUI with a minimal PATH
# (/usr/bin:/bin:...) that lacks the user's toolchains — extend it with
# the usual install locations so bun/cargo/cmake/node are found.
for tool_dir in "$HOME/.bun/bin" "$HOME/.cargo/bin" /opt/homebrew/bin /usr/local/bin; do
  case ":$PATH:" in
    *":${tool_dir}:"*) ;;
    *) PATH="${PATH}:${tool_dir}" ;;
  esac
done
export PATH

REPO_ROOT="${VOICEAPP_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

# Re-exec from a temp copy of this script. Bash reads scripts from disk
# incrementally, so if the original file is rewritten while running — by
# the git pull below, or by anyone editing the repo — the running
# instance dies mid-update. The temp copy is immune to that.
if [[ -z "${VOICEAPP_INSTALL_RELOCATED:-}" ]]; then
  export VOICEAPP_INSTALL_RELOCATED=1
  export VOICEAPP_REPO_ROOT="$REPO_ROOT"
  _tmp_self="$(mktemp "${TMPDIR:-/tmp}/voiceapp-install.XXXXXX")"
  cp "${BASH_SOURCE[0]}" "$_tmp_self"
  chmod +x "$_tmp_self"
  exec /bin/bash "$_tmp_self" "$@"
fi

APP_NAME="VoiceApp"
BUNDLE_ID="com.distinctza.voiceapp"
INSTALL_PATH="/Applications/${APP_NAME}.app"
BUILD_APP="${REPO_ROOT}/src-tauri/target/release/bundle/macos/${APP_NAME}.app"
META_DIR="${HOME}/Library/Application Support/${BUNDLE_ID}"
META_FILE="${META_DIR}/.install-meta"
GIT_REMOTE="${VOICEAPP_GIT_REMOTE:-origin}"
GIT_BRANCH="${VOICEAPP_GIT_BRANCH:-main}"

CHECK_ONLY=false
FORCE=false
NO_PULL=false
AUTO_YES=false
RELAUNCH=false
PROGRESS_FILE=""
DEV_INSTALL=false
PUBLISH_ONLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check | --check-only)
      CHECK_ONLY=true
      shift
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --no-pull)
      NO_PULL=true
      shift
      ;;
    --relaunch)
      RELAUNCH=true
      shift
      ;;
    --progress-file)
      PROGRESS_FILE="${2:-}"
      shift 2
      ;;
    -y | --yes)
      AUTO_YES=true
      shift
      ;;
    --dev)
      DEV_INSTALL=true
      shift
      ;;
    --publish-only)
      # Reuse the artifacts from the last build: skip pull/build and go
      # straight to notarize → install → publish. For recovering when a
      # notarization attempt hangs or the publish step failed.
      PUBLISH_ONLY=true
      shift
      ;;
    -h | --help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

log() { printf '==> %s\n' "$*"; }
warn() { printf '!! %s\n' "$*" >&2; }

# Report failures into the progress file so the in-app updater UI can show
# an error instead of spinning forever. Keep messages free of `"` and `\`
# — they are interpolated into JSON verbatim.
fail_progress() {
  if [[ -n "$PROGRESS_FILE" ]]; then
    printf '{"percent":100,"stage":"failed","message":"%s"}\n' "$1" >"$PROGRESS_FILE"
  fi
}
die() {
  warn "$*"
  fail_progress "$*"
  exit 1
}
# errtrace so the ERR trap also fires for failures inside functions
set -o errtrace
trap 'fail_progress "Update failed — see update.log for details"' ERR

progress() {
  local percent="$1"
  local stage="$2"
  local message="$3"
  if [[ -n "$PROGRESS_FILE" ]]; then
    printf '{"percent":%s,"stage":"%s","message":"%s"}\n' \
      "$percent" "$stage" "$message" >"$PROGRESS_FILE"
  fi
  log "$message"
}

read_repo_version() {
  node -p "require('${REPO_ROOT}/package.json').version" 2>/dev/null \
    || grep -m1 '"version"' "${REPO_ROOT}/package.json" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
}

read_installed_version() {
  local plist="${INSTALL_PATH}/Contents/Info.plist"
  if [[ ! -f "$plist" ]]; then
    echo ""
    return
  fi
  /usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$plist" 2>/dev/null || true
}

read_installed_commit() {
  if [[ -f "$META_FILE" ]]; then
    grep '^commit=' "$META_FILE" 2>/dev/null | cut -d= -f2- || true
  else
    echo ""
  fi
}

ensure_prerequisites() {
  log "Checking prerequisites…"
  command -v git >/dev/null || die "git is required"
  command -v bun >/dev/null || die "bun is required — install from https://bun.sh"
  command -v cmake >/dev/null || die "cmake is required — run: brew install cmake"
  command -v cargo >/dev/null || die "Rust/cargo is required — install from https://rustup.rs"
  if [[ "$(uname -s)" != "Darwin" ]]; then
    die "This installer is for macOS only"
  fi
}

check_git_updates() {
  cd "$REPO_ROOT"
  progress 20 fetching "Checking for updates…"
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    warn "Not a git repository — skipping remote update check"
    return 0
  fi

  log "Fetching ${GIT_REMOTE}/${GIT_BRANCH}…"
  git fetch "$GIT_REMOTE" "$GIT_BRANCH" --quiet

  local local_ref remote_ref
  local_ref="$(git rev-parse HEAD)"
  remote_ref="$(git rev-parse "${GIT_REMOTE}/${GIT_BRANCH}" 2>/dev/null || true)"

  if [[ -z "$remote_ref" ]]; then
    warn "Remote branch ${GIT_REMOTE}/${GIT_BRANCH} not found — using local checkout only"
    return 0
  fi

  if [[ "$local_ref" != "$remote_ref" ]]; then
    local behind ahead
    behind="$(git rev-list --count HEAD.."${GIT_REMOTE}/${GIT_BRANCH}" 2>/dev/null || echo 0)"
    ahead="$(git rev-list --count "${GIT_REMOTE}/${GIT_BRANCH}"..HEAD 2>/dev/null || echo 0)"
    log "Repository update available (${behind} commit(s) on remote, ${ahead} local-only)"
    git --no-pager log --oneline HEAD.."${GIT_REMOTE}/${GIT_BRANCH}" | head -5 || true

    if [[ "$NO_PULL" == true ]]; then
      warn "Skipping pull (--no-pull)"
      return 0
    fi

    if [[ "$AUTO_YES" != true ]]; then
      read -r -p "Pull latest from ${GIT_REMOTE}/${GIT_BRANCH}? [Y/n] " reply
      if [[ "$reply" =~ ^[Nn] ]]; then
        warn "Continuing without pull"
        return 0
      fi
    fi

    log "Pulling latest changes…"
    progress 25 pulling "Pulling latest changes…"
    git pull "$GIT_REMOTE" "$GIT_BRANCH" --ff-only
  else
    log "Git checkout is up to date with ${GIT_REMOTE}/${GIT_BRANCH}"
  fi
}

needs_build() {
  local repo_version="$1"
  local repo_commit="$2"
  local installed_version installed_commit

  installed_version="$(read_installed_version)"
  installed_commit="$(read_installed_commit)"

  if [[ "$FORCE" == true ]]; then
    log "Rebuild forced (--force)"
    return 0
  fi

  if [[ ! -d "$BUILD_APP" ]]; then
    log "No release build found — build required"
    return 0
  fi

  if [[ ! -d "$INSTALL_PATH" ]]; then
    log "VoiceApp is not installed in /Applications — install required"
    return 0
  fi

  if [[ -z "$installed_version" ]] || [[ "$installed_version" != "$repo_version" ]]; then
    log "Installed version (${installed_version:-none}) != repo version (${repo_version}) — build required"
    return 0
  fi

  if [[ "$installed_commit" != "$repo_commit" ]]; then
    log "Installed commit differs from current HEAD — build required"
    return 0
  fi

  return 1
}

quit_running_app() {
  if pgrep -x voiceapp >/dev/null 2>&1; then
    log "Quitting running VoiceApp…"
    osascript -e "quit app \"${APP_NAME}\"" 2>/dev/null || true
    sleep 1
    if pgrep -x voiceapp >/dev/null 2>&1; then
      pkill -x voiceapp 2>/dev/null || true
      sleep 1
    fi
  fi
}

build_app() {
  cd "$REPO_ROOT"
  progress 35 dependencies "Installing dependencies…"
  log "Installing npm dependencies…"
  bun install --frozen-lockfile 2>/dev/null || bun install

  # Signing identity, best first:
  #   1. "Developer ID Application" — Apple-trusted, required for notarization,
  #      so downloads open cleanly on every Mac (Gatekeeper).
  #   2. "VoiceApp Dev" (self-signed) — keeps TCC grants across updates on
  #      this machine only; other Macs reject it outright.
  #   3. ad-hoc — permission grants won't survive updates.
  SIGNED_WITH_DEV_ID=false
  local dev_id_identity
  dev_id_identity=$(security find-identity -v -p codesigning 2>/dev/null \
    | grep -o '"Developer ID Application: [^"]*"' | head -1 | tr -d '"')
  if [[ -n "$dev_id_identity" ]]; then
    export APPLE_SIGNING_IDENTITY="$dev_id_identity"
    SIGNED_WITH_DEV_ID=true
    log "Signing with ${dev_id_identity}"
  elif security find-identity -v -p codesigning 2>/dev/null | grep -q "VoiceApp Dev"; then
    export APPLE_SIGNING_IDENTITY="VoiceApp Dev"
    log "Signing with the VoiceApp Dev certificate"
  else
    warn "No signing certificate — using ad-hoc signing (permission grants will not survive updates)"
  fi

  progress 45 building "Building VoiceApp (this may take several minutes)…"
  log "Building VoiceApp (this may take several minutes)…"
  export CMAKE_POLICY_VERSION_MINIMUM=3.5
  # Sign the auto-updater artifacts (VoiceApp.app.tar.gz.sig) so customer
  # installs can verify updates. Key generated with `tauri signer generate`.
  if [[ -f "$HOME/.tauri/voiceapp_updater.key" ]]; then
    TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.tauri/voiceapp_updater.key")"
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat "$HOME/.tauri/voiceapp_updater.key.password")"
    export TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  else
    warn "No updater signing key at ~/.tauri/voiceapp_updater.key — updater artifacts will be unsigned"
  fi
  # CI mode makes the DMG bundler skip its Finder/AppleScript styling pass,
  # which otherwise pops a "drag to Applications" window mid-build.
  export CI=true

  # Stream the build with live progress: run it in the background and, every
  # couple of seconds, advance the percent asymptotically from 45 toward 79
  # and surface the compiler's latest line so the bar never looks stuck.
  local build_log="${TMPDIR:-/tmp}/voiceapp-build-output.log"
  : >"$build_log"
  bun run tauri build >"$build_log" 2>&1 &
  local build_pid=$!
  local build_start elapsed pct activity
  build_start=$(date +%s)
  while kill -0 "$build_pid" 2>/dev/null; do
    sleep 2
    elapsed=$(($(date +%s) - build_start))
    # 45 + 34*t/(t+150): ~56% after 1 min, ~68% after 3 min, caps below 79
    pct=$((45 + (elapsed * 34) / (elapsed + 150)))
    activity=$( (grep -E "Compiling|Building |Bundling|Finished|Downloading" "$build_log" || true) \
      | tail -1 | tr -d '"\\' | sed 's/^[[:space:]]*//' | cut -c1-60)
    progress "$pct" building "Building… ${activity:-preparing} (${elapsed}s)"
  done
  if ! wait "$build_pid"; then
    tail -20 "$build_log" >&2
    die "Build failed — see update.log for compiler output"
  fi
  cat "$build_log"

  progress 80 building "Build complete"
  [[ -d "$BUILD_APP" ]] || die "Build failed — expected app at ${BUILD_APP}"
}

install_app() {
  local repo_version="$1"
  local repo_commit="$2"

  progress 88 closing "Installing update — VoiceApp will close and reopen in a moment…"
  quit_running_app

  log "Installing to ${INSTALL_PATH}…"
  rm -rf "$INSTALL_PATH"
  ditto "$BUILD_APP" "$INSTALL_PATH"

  # The .install-meta marker makes the in-app updater rebuild from this
  # repo (slow dev lane) instead of pulling signed archives from the
  # release feed like customers do. Only --dev installs opt in; a plain
  # install leaves the machine on the customer update path.
  if [[ "$DEV_INSTALL" == true ]]; then
    mkdir -p "$META_DIR"
    cat >"$META_FILE" <<EOF
version=${repo_version}
commit=${repo_commit}
installed_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
source=${REPO_ROOT}
EOF
  else
    rm -f "$META_FILE"
  fi

  log "Installed VoiceApp ${repo_version} (${repo_commit:0:7})"
}

relaunch_app() {
  progress 95 relaunching "Relaunching VoiceApp…"
  log "Relaunching ${APP_NAME}…"
  open -a "${APP_NAME}" || warn "Could not relaunch ${APP_NAME}. Open it manually from Applications."
  progress 100 done "Update complete"
}

print_status() {
  local repo_version="$1"
  local repo_commit="$2"
  local installed_version installed_commit

  installed_version="$(read_installed_version)"
  installed_commit="$(read_installed_commit)"

  echo ""
  echo "VoiceApp update status"
  echo "──────────────────────"
  printf "  Repo version:      %s (%s)\n" "$repo_version" "${repo_commit:0:7}"
  printf "  Installed version: %s\n" "${installed_version:-not installed}"
  if [[ -n "$installed_commit" ]]; then
    printf "  Installed commit:  %s\n" "${installed_commit:0:7}"
  fi
  echo ""
}

# Best-effort: attach the freshly built DMG to the GitHub release for this
# version so other machines can download a ready-made installer instead of
# Notarize the built DMG with Apple so downloads pass Gatekeeper on any Mac,
# then staple tickets and refresh the updater archive from the stapled app.
# One notarytool submission of the DMG covers the nested .app (Apple issues
# tickets for every nested bundle), so the .app can be stapled afterwards too.
# Skipped (with a warning) when not signed with Developer ID or when the
# notary keychain profile is missing — the build still works, but downloads
# will be blocked by Gatekeeper on other Macs.
NOTARY_PROFILE="voiceapp-notary"

notarize_release() {
  local version="$1"
  local dmg="${REPO_ROOT}/src-tauri/target/release/bundle/dmg/VoiceApp_${version}_aarch64.dmg"
  local bundle_dir="${REPO_ROOT}/src-tauri/target/release/bundle/macos"
  local archive="${bundle_dir}/VoiceApp.app.tar.gz"

  if [[ "${SIGNED_WITH_DEV_ID:-false}" != true ]]; then
    warn "Not signed with Developer ID — skipping notarization (downloads will be blocked on other Macs)"
    return 0
  fi
  if ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
    warn "Notary profile '$NOTARY_PROFILE' not usable — skipping notarization"
    return 0
  fi
  [[ -f "$dmg" ]] || die "DMG not found for notarization: ${dmg}"

  # Notarization requires a secure timestamp in the signature. codesign adds
  # one automatically for Developer ID identities; verify rather than assume.
  # (Capture output instead of piping into grep -q: with pipefail, grep -q
  # exiting on first match SIGPIPEs codesign and fails the whole pipeline.)
  local sig_info
  sig_info=$(codesign -dvv "$BUILD_APP" 2>&1 || true)
  if [[ "$sig_info" != *"Timestamp="* ]]; then
    die "App signature has no secure timestamp — notarization would be rejected. Check codesign flags."
  fi

  # If a previous submission of this exact DMG was eventually accepted,
  # Apple already issued its ticket — stapling succeeds without a new
  # submission. Covers recovery after a hung/interrupted --wait.
  if xcrun stapler staple "$dmg" >/dev/null 2>&1; then
    log "Notarization ticket already issued for this DMG — skipping submission"
  else

  progress 81 notarizing "Submitting to Apple for notarization…"
  log "Submitting ${dmg##*/} to Apple notary service…"
  local notary_log="${TMPDIR:-/tmp}/voiceapp-notarize.log"
  : >"$notary_log"
  xcrun notarytool submit "$dmg" --keychain-profile "$NOTARY_PROFILE" --wait >"$notary_log" 2>&1 &
  local notary_pid=$!
  local notary_start elapsed pct
  notary_start=$(date +%s)
  while kill -0 "$notary_pid" 2>/dev/null; do
    sleep 3
    elapsed=$(($(date +%s) - notary_start))
    # 81 + 5*t/(t+120): creeps toward 86 while Apple scans (usually 2-5 min)
    pct=$((81 + (elapsed * 5) / (elapsed + 120)))
    progress "$pct" notarizing "Waiting for Apple notarization… (${elapsed}s)"
  done
  wait "$notary_pid" || true
  if ! grep -q "status: Accepted" "$notary_log"; then
    cat "$notary_log" >&2
    local submission_id
    submission_id=$(grep -m1 -o 'id: [0-9a-f-]*' "$notary_log" | head -1 | cut -d' ' -f2 || true)
    if [[ -n "$submission_id" ]]; then
      xcrun notarytool log "$submission_id" --keychain-profile "$NOTARY_PROFILE" >&2 || true
    fi
    die "Apple notarization failed — see update.log for the notary report"
  fi
  log "Notarization accepted"
  fi

  progress 86 notarizing "Stapling notarization tickets…"
  xcrun stapler staple "$dmg" >/dev/null || die "Failed to staple DMG"
  xcrun stapler staple "$BUILD_APP" >/dev/null || die "Failed to staple app bundle"

  # The updater archive was packed before stapling; rebuild it from the
  # stapled app and re-sign so customers receive the stapled bundle too.
  if [[ -f "$archive" && -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
    (cd "$bundle_dir" && tar -czf "VoiceApp.app.tar.gz" "VoiceApp.app")
    (cd "$REPO_ROOT" && bun run tauri signer sign "$archive" >/dev/null 2>&1) \
      || die "Failed to re-sign updater archive after stapling"
    log "Updater archive rebuilt from stapled app and re-signed"
  fi

  log "Notarized and stapled: app + DMG"
}

# building from source. Skipped silently when gh isn't installed/authed or
# the release doesn't exist yet.
publish_dmg() {
  local version="$1"
  command -v gh >/dev/null 2>&1 || return 0
  local dmg="${REPO_ROOT}/src-tauri/target/release/bundle/dmg/VoiceApp_${version}_aarch64.dmg"
  [[ -f "$dmg" ]] || return 0
  if (cd "$REPO_ROOT" && gh release upload "v${version}" "$dmg" --clobber >/dev/null 2>&1); then
    log "Uploaded installer to GitHub release v${version}"
  else
    warn "Could not upload DMG to GitHub release v${version} (gh not authed or release missing)"
  fi
  publish_customer_release "$version" "$dmg"
}

# Publish the customer-facing release: DMG + signed update archive +
# latest.json feed to the PUBLIC releases repo, which installed apps poll
# for auto-updates. Best-effort like publish_dmg.
PUBLIC_RELEASES_REPO="DistinctZA/voiceapp-releases"

publish_customer_release() {
  local version="$1"
  local dmg="$2"
  local bundle_dir="${REPO_ROOT}/src-tauri/target/release/bundle/macos"
  local archive="${bundle_dir}/VoiceApp.app.tar.gz"
  local sig_file="${archive}.sig"

  if [[ ! -f "$archive" || ! -f "$sig_file" ]]; then
    warn "Updater archive or signature missing — skipping customer release publish"
    return 0
  fi

  local staging
  staging="$(mktemp -d "${TMPDIR:-/tmp}/voiceapp-release.XXXXXX")"
  cp "$archive" "${staging}/VoiceApp_aarch64.app.tar.gz"
  local signature
  signature="$(cat "$sig_file")"
  cat >"${staging}/latest.json" <<FEED
{
  "version": "${version}",
  "notes": "VoiceApp ${version}",
  "pub_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "platforms": {
    "darwin-aarch64": {
      "signature": "${signature}",
      "url": "https://github.com/${PUBLIC_RELEASES_REPO}/releases/download/v${version}/VoiceApp_aarch64.app.tar.gz"
    }
  }
}
FEED

  cat >"${staging}/notes.md" <<NOTES
<img src="https://raw.githubusercontent.com/${PUBLIC_RELEASES_REPO}/main/assets/icon-256.png" width="80" align="right" />

**VoiceApp ${version}** — hold a key, speak, and your words type themselves into any Mac app. Free forever.

| Your dictation setup | Local models — 100% on-device |
|---|---|
| ![General settings](https://raw.githubusercontent.com/${PUBLIC_RELEASES_REPO}/main/assets/screens/general.png) | ![Local models](https://raw.githubusercontent.com/${PUBLIC_RELEASES_REPO}/main/assets/screens/models.png) |

- 🔒 **100% local** transcription (NVIDIA Parakeet, Whisper + Apple Metal) — private, offline-capable
- ⚡ **Or bring your own AI** — Grok (xAI), OpenAI, or OpenRouter with your own API key
- 🎛 Push-to-talk on any key, live voice pulse, custom vocabulary, dictation history, signed auto-updates

### Install
Download VoiceApp_${version}_aarch64.dmg below, drag it to Applications, and open it normally. Published builds are signed and notarized by Apple. The app updates itself from then on.

🌐 **[voice-app.xyz](https://voice-app.xyz/)** · ☕ **[Support development](https://ko-fi.com/voiceapp)** · Requires macOS on Apple Silicon
NOTES

  if ! gh release view "v${version}" --repo "$PUBLIC_RELEASES_REPO" >/dev/null 2>&1; then
    gh release create "v${version}" --repo "$PUBLIC_RELEASES_REPO" --title "VoiceApp ${version}" --notes-file "${staging}/notes.md" >/dev/null 2>&1 || { warn "Could not create customer release v${version}"; rm -rf "$staging"; return 0; }
  fi

  if gh release upload "v${version}" --repo "$PUBLIC_RELEASES_REPO" --clobber     "${staging}/VoiceApp_aarch64.app.tar.gz" "${staging}/latest.json" "$dmg" >/dev/null 2>&1; then
    log "Published customer release v${version} to ${PUBLIC_RELEASES_REPO}"
  else
    warn "Could not publish customer release v${version}"
  fi
  rm -rf "$staging"
}

main() {
  ensure_prerequisites
  cd "$REPO_ROOT"

  progress 5 starting "Starting update…"

  # Note: with --relaunch the app deliberately stays open through the pull
  # and build so its own progress bar can show the update. It is quit only
  # at the install step (see install_app), moments before the bundle swap.

  if [[ "$NO_PULL" != true ]]; then
    check_git_updates
  fi

  local repo_version repo_commit
  repo_version="$(read_repo_version)"
  repo_commit="$(git rev-parse HEAD 2>/dev/null || echo unknown)"

  print_status "$repo_version" "$repo_commit"

  if [[ "$CHECK_ONLY" == true ]]; then
    local installed_version
    installed_version="$(read_installed_version)"
    if [[ -z "$installed_version" ]]; then
      log "VoiceApp is not installed. Run without --check to install."
    elif [[ "$installed_version" != "$repo_version" ]] || [[ "$(read_installed_commit)" != "$repo_commit" ]]; then
      log "An update is available. Run: ./scripts/install.sh"
    else
      log "VoiceApp ${repo_version} is up to date."
    fi
    exit 0
  fi

  if [[ "$PUBLISH_ONLY" == true ]]; then
    [[ -d "$BUILD_APP" ]] || die "--publish-only: no built app at ${BUILD_APP} — run a full build first"
    [[ -f "${REPO_ROOT}/src-tauri/target/release/bundle/dmg/VoiceApp_${repo_version}_aarch64.dmg" ]] \
      || die "--publish-only: no DMG for version ${repo_version} — run a full build first"
    # The build exported these; re-derive them for the standalone path.
    SIGNED_WITH_DEV_ID=false
    security find-identity -v -p codesigning 2>/dev/null | grep -q "Developer ID Application" \
      && SIGNED_WITH_DEV_ID=true
    if [[ -f "$HOME/.tauri/voiceapp_updater.key" ]]; then
      TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.tauri/voiceapp_updater.key")"
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat "$HOME/.tauri/voiceapp_updater.key.password")"
      export TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
    fi
    notarize_release "$repo_version"
    install_app "$repo_version" "$repo_commit"
    publish_dmg "$repo_version"
  elif needs_build "$repo_version" "$repo_commit"; then
    build_app
    notarize_release "$repo_version"
    install_app "$repo_version" "$repo_commit"
    publish_dmg "$repo_version"
  else
    log "VoiceApp ${repo_version} is already installed and matches this checkout."
    log "Use --force to rebuild anyway."
    if [[ "$RELAUNCH" == true ]]; then
      relaunch_app
    fi
    exit 0
  fi

  echo ""
  log "Done. Open VoiceApp from Applications or run:"
  echo "    open -a VoiceApp"
  echo ""
  echo "If macOS blocks the app (unsigned build), right-click VoiceApp.app → Open."
  echo "Grant Microphone and Accessibility on first launch."

  if [[ "$RELAUNCH" == true ]]; then
    relaunch_app
  fi
}

main "$@"
