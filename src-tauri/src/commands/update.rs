use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const BUNDLE_ID: &str = "com.distinctza.voiceapp";
const INSTALL_PATH: &str = "/Applications/VoiceApp.app";

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LocalUpdateStatus {
    pub can_update: bool,
    pub update_available: bool,
    pub installed_version: Option<String>,
    pub repo_version: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, tauri_specta::Event)]
pub struct LocalUpdateProgress {
    pub percent: u8,
    pub stage: String,
    pub message: String,
}

fn install_meta_path() -> PathBuf {
    let home = std::env::var("HOME").expect("HOME environment variable");
    PathBuf::from(home)
        .join("Library/Application Support")
        .join(BUNDLE_ID)
        .join(".install-meta")
}

fn read_meta_value(meta_path: &Path, key: &str) -> Option<String> {
    let contents = std::fs::read_to_string(meta_path).ok()?;
    for line in contents.lines() {
        if let Some(value) = line.strip_prefix(&format!("{key}=")) {
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

fn read_repo_version(repo_root: &Path) -> Option<String> {
    let package_json = std::fs::read_to_string(repo_root.join("package.json")).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&package_json).ok()?;
    parsed
        .get("version")
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

fn read_installed_version() -> Option<String> {
    let plist = Path::new(INSTALL_PATH).join("Contents/Info.plist");
    if !plist.exists() {
        return None;
    }

    let output = Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Print CFBundleShortVersionString", plist.to_str()?])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let version = String::from_utf8(output.stdout).ok()?.trim().to_string();
    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}

fn read_repo_commit(repo_root: &Path) -> Option<String> {
    let output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(repo_root)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let commit = String::from_utf8(output.stdout).ok()?.trim().to_string();
    if commit.is_empty() {
        None
    } else {
        Some(commit)
    }
}

fn resolve_update_source() -> Option<PathBuf> {
    let meta_path = install_meta_path();
    if !meta_path.exists() {
        return None;
    }

    let source = read_meta_value(&meta_path, "source")?;
    let source_path = PathBuf::from(source);
    if source_path.join("scripts/install.sh").exists() {
        Some(source_path)
    } else {
        None
    }
}

fn write_progress(progress_file: &Path, progress: &LocalUpdateProgress) {
    if let Ok(json) = serde_json::to_string(progress) {
        let _ = std::fs::write(progress_file, format!("{json}\n"));
    }
}

fn shell_escape(command: &str) -> String {
    format!("'{}'", command.replace('\'', "'\\''"))
}

fn spawn_progress_watcher(app: AppHandle, progress_file: PathBuf, running: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        let mut last_stage = String::new();
        let mut last_percent = 0u8;

        while running.load(Ordering::Relaxed) {
            if let Ok(contents) = std::fs::read_to_string(&progress_file) {
                if let Ok(progress) = serde_json::from_str::<LocalUpdateProgress>(contents.trim()) {
                    if progress.percent != last_percent || progress.stage != last_stage {
                        last_percent = progress.percent;
                        last_stage = progress.stage.clone();
                        let _ = app.emit("local-update-progress", progress);
                    }
                }
            }

            std::thread::sleep(Duration::from_millis(200));
        }
    });
}

#[cfg(target_os = "macos")]
fn build_local_update_status() -> LocalUpdateStatus {
    let installed_version = read_installed_version();
    let Some(source_path) = resolve_update_source() else {
        return LocalUpdateStatus {
            can_update: false,
            update_available: false,
            installed_version,
            repo_version: None,
            message: "Updates require installing VoiceApp with scripts/install.sh first."
                .to_string(),
        };
    };

    let repo_version = read_repo_version(&source_path);
    let installed_commit = install_meta_path()
        .exists()
        .then(|| read_meta_value(&install_meta_path(), "commit"))
        .flatten();
    let repo_commit = read_repo_commit(&source_path);

    let update_available = match (
        &installed_version,
        &repo_version,
        &installed_commit,
        &repo_commit,
    ) {
        (None, Some(_), _, _) => true,
        (Some(installed), Some(repo), _, _) if installed != repo => true,
        (_, _, Some(installed), Some(repo)) if installed != repo => true,
        _ => false,
    };

    let message = if !update_available {
        format!(
            "VoiceApp {} is up to date with this checkout.",
            installed_version.as_deref().unwrap_or("is not installed")
        )
    } else {
        format!(
            "Update available: {} → {}",
            installed_version.as_deref().unwrap_or("not installed"),
            repo_version.as_deref().unwrap_or("unknown")
        )
    };

    LocalUpdateStatus {
        can_update: true,
        update_available,
        installed_version,
        repo_version,
        message,
    }
}

#[cfg(not(target_os = "macos"))]
fn build_local_update_status() -> LocalUpdateStatus {
    LocalUpdateStatus {
        can_update: false,
        update_available: false,
        installed_version: None,
        repo_version: None,
        message: "In-app updates are only supported on macOS.".to_string(),
    }
}

#[tauri::command]
#[specta::specta]
pub fn get_local_update_status() -> LocalUpdateStatus {
    build_local_update_status()
}

#[tauri::command]
#[specta::specta]
pub fn run_local_update(app: AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        return Err("In-app updates are only supported on macOS.".into());
    }

    #[cfg(target_os = "macos")]
    {
        let source_path = resolve_update_source().ok_or_else(|| {
            "Update source not found. Install VoiceApp with scripts/install.sh first.".to_string()
        })?;

        let install_script = source_path.join("scripts/install.sh");
        let log_dir = crate::portable::app_log_dir(&app)
            .map_err(|e| format!("Failed to get log directory: {e}"))?;
        std::fs::create_dir_all(&log_dir)
            .map_err(|e| format!("Failed to create log directory: {e}"))?;
        let log_file = log_dir.join("update.log");
        let progress_file = log_dir.join("update-progress.json");

        let initial_progress = LocalUpdateProgress {
            percent: 2,
            stage: "preparing".to_string(),
            message: "Preparing update…".to_string(),
        };
        write_progress(&progress_file, &initial_progress);
        let _ = app.emit("local-update-progress", initial_progress);

        let watcher_running = Arc::new(AtomicBool::new(true));
        spawn_progress_watcher(app.clone(), progress_file.clone(), watcher_running.clone());

        let inner_command = format!(
            "cd '{}' && exec /bin/bash '{}' -y --relaunch --progress-file '{}'",
            source_path.display(),
            install_script.display(),
            progress_file.display(),
        );
        let detached_command = format!(
            "nohup /bin/bash -c {} </dev/null >> '{}' 2>&1 &",
            shell_escape(&inner_command),
            log_file.display(),
        );

        Command::new("/bin/bash")
            .args(["-c", &detached_command])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to start update: {e}"))?;

        log::info!("Started VoiceApp update from {}", source_path.display());
        Ok(())
    }
}
