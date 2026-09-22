#[cfg(target_os = "macos")]
use std::process::Command;
#[cfg(target_os = "macos")]
use std::sync::Mutex;
#[cfg(target_os = "macos")]
use std::time::{Duration, Instant};

/// How long a clamshell reading stays good for. The `ioreg` fork costs ~10ms
/// and sits on the hotkey-to-microphone path; a lid can't open and close
/// faster than this, so re-running it per keypress buys nothing.
#[cfg(target_os = "macos")]
const CACHE_TTL: Duration = Duration::from_secs(5);

#[cfg(target_os = "macos")]
static CACHE: Mutex<Option<(Instant, bool)>> = Mutex::new(None);

/// Checks if the MacBook is in clamshell mode (lid closed with external display)
///
/// This queries the macOS IORegistry for the AppleClamshellState key.
/// Returns true if the lid is closed, false if open. Results are cached for
/// [`CACHE_TTL`] so repeated calls stay off the `ioreg` fork.
#[cfg(target_os = "macos")]
pub fn is_clamshell() -> Result<bool, String> {
    if let Ok(cache) = CACHE.lock() {
        if let Some((at, value)) = *cache {
            if at.elapsed() < CACHE_TTL {
                return Ok(value);
            }
        }
    }

    let value = query_clamshell()?;
    if let Ok(mut cache) = CACHE.lock() {
        *cache = Some((Instant::now(), value));
    }
    Ok(value)
}

#[cfg(target_os = "macos")]
fn query_clamshell() -> Result<bool, String> {
    let output = Command::new("ioreg")
        .args(["-r", "-k", "AppleClamshellState", "-d", "4"])
        .output()
        .map_err(|e| format!("Failed to execute ioreg: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "ioreg command failed with status: {}",
            output.status
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Look for "AppleClamshellState" = Yes in the output
    Ok(stdout.contains("\"AppleClamshellState\" = Yes"))
}

/// Checks if the Mac is a laptop by detecting battery presence
///
/// This uses pmset to check for battery information.
/// Returns true if a battery is detected (laptop), false otherwise (desktop)
#[cfg(target_os = "macos")]
#[tauri::command]
#[specta::specta]
pub fn is_laptop() -> Result<bool, String> {
    let output = Command::new("pmset")
        .arg("-g")
        .arg("batt")
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Check if InternalBattery is present (laptops have batteries, desktops typically don't)
    Ok(stdout.contains("InternalBattery"))
}

/// Stub implementation for non-macOS platforms
/// Always returns false since clamshell mode is macOS-specific
#[cfg(not(target_os = "macos"))]
pub fn is_clamshell() -> Result<bool, String> {
    Ok(false)
}

/// Stub implementation for non-macOS platforms
/// Always returns false since laptop detection is macOS-specific
#[cfg(not(target_os = "macos"))]
#[tauri::command]
#[specta::specta]
pub fn is_laptop() -> Result<bool, String> {
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(target_os = "macos")]
    fn test_clamshell_check() {
        // This will run on macOS and should not panic
        let result = is_clamshell();
        assert!(result.is_ok());
        let _ = result.unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn test_is_laptop() {
        let result = is_laptop();
        assert!(result.is_ok());
        if let Ok(is_laptop) = result {
            println!("Is laptop: {}", is_laptop);
        }
    }
}
