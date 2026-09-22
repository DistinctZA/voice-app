#[derive(Clone, Copy)]
pub enum SoundType {
    Start,
    Stop,
}

pub const START_SOUND_IDS: &[&str] =
    &["pulse", "chime", "ping", "bell", "click", "bloom", "snap", "glow"];

pub const STOP_SOUND_IDS: &[&str] =
    &["settle", "chime", "pong", "bell", "click", "fade", "snap", "glow"];

pub fn default_recording_start_sound() -> String {
    "pulse".to_string()
}

pub fn default_recording_stop_sound() -> String {
    "settle".to_string()
}

pub fn is_valid_start_sound(id: &str) -> bool {
    id == "custom" || START_SOUND_IDS.contains(&id)
}

pub fn is_valid_stop_sound(id: &str) -> bool {
    id == "custom" || STOP_SOUND_IDS.contains(&id)
}

pub fn normalize_start_sound(id: &str) -> String {
    if is_valid_start_sound(id) {
        id.to_string()
    } else {
        default_recording_start_sound()
    }
}

pub fn normalize_stop_sound(id: &str) -> String {
    if is_valid_stop_sound(id) {
        id.to_string()
    } else {
        default_recording_stop_sound()
    }
}

pub fn sound_file_path(sound_type: SoundType, sound_id: &str) -> String {
    match (sound_id, sound_type) {
        ("custom", SoundType::Start) => "custom_start.wav".to_string(),
        ("custom", SoundType::Stop) => "custom_stop.wav".to_string(),
        (_, SoundType::Start) => format!("resources/sounds/start/{sound_id}.wav"),
        (_, SoundType::Stop) => format!("resources/sounds/stop/{sound_id}.wav"),
    }
}

pub fn sound_base_dir(sound_id: &str) -> tauri::path::BaseDirectory {
    if sound_id == "custom" {
        tauri::path::BaseDirectory::AppData
    } else {
        tauri::path::BaseDirectory::Resource
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feedback_catalog_has_eight_options_each() {
        assert_eq!(START_SOUND_IDS.len(), 8);
        assert_eq!(STOP_SOUND_IDS.len(), 8);
        assert!(!START_SOUND_IDS.contains(&"marimba"));
        assert!(!STOP_SOUND_IDS.contains(&"pop"));
    }
}
