# Developing VoiceApp

The settings window and recording overlay use React and TypeScript in `src/`. The Tauri backend in `src-tauri/` handles microphone input, model loading, transcription, history, and paste. Vite serves the development frontend at `http://localhost:1420/`.

## Run with live reload

```bash
bun install --frozen-lockfile
CMAKE_POLICY_VERSION_MINIMUM=3.5 bun run tauri dev
```

For a standalone app, run `bun run build:mac`. The bundle is written to `local/release/bundle/macos/VoiceApp.app` under Cargo’s target directory, which defaults to `src-tauri/target`.

## macOS permissions

macOS grants Accessibility permission to a specific executable. For a development build, use **Show app in Finder** during onboarding and add `src-tauri/target/debug/voiceapp` under **System Settings → Privacy & Security → Accessibility**. Reopen VoiceApp after granting access. Microphone permission is requested separately.

## Local installation

Use `./scripts/install.sh` to build locally, install in `/Applications`, and use this checkout for in-app updates. Run the same command to fetch and install new commits, or use `./scripts/install.sh --check` for a status report. The installer also accepts `--no-pull` to use the current checkout, `--force` to rebuild, and `-y` to accept its pull prompt.

The macOS data directory is `~/Library/Application Support/com.distinctza.voiceapp/`. Downloaded models live in `models/`, saved audio in `recordings/`, and transcript metadata in `history.db`. Custom Whisper models can be added as `.bin` files in `models/`.

## Checks and versions

```bash
bun run version:check
bun run test
bun run lint
bun run build
CMAKE_POLICY_VERSION_MINIMUM=3.5 cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
```

GitHub Actions runs the checks on pushes and pull requests. To tag a new source release, pass the new semantic version to `./scripts/bump-version.sh`, then commit and push. The workflow creates the tag once validation passes.

The public source repository also serves as the Homebrew tap. After the public tag exists, update the `tag` and `revision` in `Formula/voiceapp.rb` to that tag and its public commit. The Homebrew workflow installs the formula on a fresh Mac and verifies the app signature. People who installed with Homebrew can then use `brew upgrade distinctza/voice-app/voiceapp`.

When you choose to distribute a signed DMG, run `./scripts/install.sh --publish` on the configured release Mac. This builds the release artifacts, runs notarization, installs the bundle, and uploads the DMG and signed updater archive. Use `--publish-only` to resume an existing release build. [Mac releases](https://github.com/DistinctZA/voiceapp-releases)
