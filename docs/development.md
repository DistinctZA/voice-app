# Developing VoiceApp

The settings window and recording overlay use React and TypeScript in `src/`. The Tauri backend in `src-tauri/` handles microphone input, model loading, transcription, history, and paste. Vite serves the development frontend at `http://localhost:1420/`.

## macOS permissions

macOS grants Accessibility permission to a specific executable. For a development build, use **Show app in Finder** during onboarding and add `src-tauri/target/debug/voiceapp` under **System Settings → Privacy & Security → Accessibility**. Reopen VoiceApp after granting access. Microphone permission is requested separately.

## Local installation

Use `./scripts/install.sh --dev` to install a build in `/Applications` and point its in-app updater at your checkout. Run `./scripts/install.sh --check` to inspect update status. The installer also accepts `--no-pull` to use the current checkout, `--force` to rebuild, and `-y` to accept its pull prompt. Packaged Mac downloads use the [signed release feed](https://github.com/DistinctZA/voiceapp-releases/releases/latest).

The macOS data directory is `~/Library/Application Support/com.distinctza.voiceapp/`. Downloaded models live in `models/`, saved audio in `recordings/`, and transcript metadata in `history.db`. Custom Whisper models can be added as `.bin` files in `models/`.

## Checks and versions

```bash
bun run version:check
bun run test
bun run lint
bun run build
CMAKE_POLICY_VERSION_MINIMUM=3.5 cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
```

To prepare a release, pass the new semantic version to `./scripts/bump-version.sh`. The script synchronizes the frontend, Tauri config, Rust manifest and lockfile, and README. GitHub Actions validates changes to main before tagging a new source release. The signed DMG and updater archive are distributed through the [Mac releases repository](https://github.com/DistinctZA/voiceapp-releases).
