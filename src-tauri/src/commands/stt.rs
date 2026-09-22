use tauri::AppHandle;

use crate::cloud_transcription::{self, SttProvider};
use crate::settings;

fn validate_provider(provider_id: &str) -> Result<(), String> {
    if cloud_transcription::stt_providers()
        .iter()
        .any(|p| p.id == provider_id)
    {
        Ok(())
    } else {
        Err(format!(
            "Unknown cloud transcription provider '{provider_id}'"
        ))
    }
}

#[tauri::command]
#[specta::specta]
pub fn get_stt_providers() -> Vec<SttProvider> {
    cloud_transcription::stt_providers()
}

#[tauri::command]
#[specta::specta]
pub fn change_stt_cloud_enabled_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.stt_cloud_enabled = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_stt_provider_setting(app: AppHandle, provider_id: String) -> Result<(), String> {
    validate_provider(&provider_id)?;
    let mut settings = settings::get_settings(&app);
    settings.stt_provider_id = provider_id;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_stt_model_setting(
    app: AppHandle,
    provider_id: String,
    model: String,
) -> Result<(), String> {
    validate_provider(&provider_id)?;
    let mut settings = settings::get_settings(&app);
    settings.stt_models.insert(provider_id, model);
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_stt_api_key_setting(
    app: AppHandle,
    provider_id: String,
    api_key: String,
) -> Result<(), String> {
    validate_provider(&provider_id)?;
    let mut settings = settings::get_settings(&app);
    settings.stt_api_keys.insert(provider_id, api_key);
    settings::write_settings(&app, settings);
    Ok(())
}

/// Round-trip a half second of silence through the configured provider.
/// Proves the API key, endpoint, and model are valid without dictating.
#[tauri::command]
#[specta::specta]
pub async fn test_stt_connection(app: AppHandle) -> Result<String, String> {
    let samples = vec![0.0f32; 8000];
    crate::cloud_transcription::transcribe(&app, samples).await?;
    Ok("ok".to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn fetch_stt_models(app: AppHandle, provider_id: String) -> Result<Vec<String>, String> {
    validate_provider(&provider_id)?;
    let settings = settings::get_settings(&app);
    let api_key = settings
        .stt_api_keys
        .get(&provider_id)
        .cloned()
        .unwrap_or_default();
    cloud_transcription::fetch_stt_models(&provider_id, &api_key).await
}
