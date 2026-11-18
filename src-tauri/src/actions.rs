use crate::audio_feedback::{play_feedback_sound, play_feedback_sound_blocking, SoundType};
use crate::audio_toolkit::{is_microphone_access_denied, is_no_input_device_error};
use crate::managers::audio::AudioRecordingManager;
use crate::managers::history::HistoryManager;
use crate::managers::transcription::TranscriptionManager;
use crate::settings::{get_settings, AppSettings};
use crate::shortcut;
use crate::tray::{change_tray_icon, TrayIconState};
use crate::utils::{
    self, mark_overlay_recording, show_starting_overlay, show_transcribing_overlay,
};
use crate::TranscriptionCoordinator;
use ferrous_opencc::{config::BuiltinConfig, OpenCC};
use log::{debug, error};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tauri::Manager;
use tauri::{AppHandle, Emitter};

#[derive(Clone, serde::Serialize)]
struct RecordingErrorEvent {
    error_type: String,
    detail: Option<String>,
}

#[derive(Clone, serde::Serialize)]
struct TranscriptionErrorEvent {
    detail: String,
    history_entry_id: Option<i64>,
}

/// Drop guard that notifies the [`TranscriptionCoordinator`] when the
/// transcription pipeline finishes — whether it completes normally or panics.
struct FinishGuard(AppHandle);
impl Drop for FinishGuard {
    fn drop(&mut self) {
        utils::hide_recording_overlay(&self.0);
        change_tray_icon(&self.0, TrayIconState::Idle);
        shortcut::unregister_cancel_shortcut(&self.0);
        if let Some(c) = self.0.try_state::<TranscriptionCoordinator>() {
            c.notify_processing_finished();
        }
    }
}

// Shortcut Action Trait
pub trait ShortcutAction: Send + Sync {
    fn start(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
}

// Transcribe Action
struct TranscribeAction;

async fn maybe_convert_chinese_variant(
    settings: &AppSettings,
    transcription: &str,
) -> Option<String> {
    // Check if language is set to Simplified or Traditional Chinese
    let is_simplified = settings.selected_language == "zh-Hans";
    let is_traditional = settings.selected_language == "zh-Hant";

    if !is_simplified && !is_traditional {
        debug!("selected_language is not Simplified or Traditional Chinese; skipping translation");
        return None;
    }

    debug!(
        "Starting Chinese translation using OpenCC for language: {}",
        settings.selected_language
    );

    // Use OpenCC to convert based on selected language
    let config = if is_simplified {
        // Convert Traditional Chinese to Simplified Chinese
        BuiltinConfig::Tw2sp
    } else {
        // Convert Simplified Chinese to Traditional Chinese
        BuiltinConfig::S2tw
    };

    match OpenCC::from_config(config) {
        Ok(converter) => {
            let converted = converter.convert(transcription);
            debug!(
                "OpenCC translation completed. Input length: {}, Output length: {}",
                transcription.len(),
                converted.len()
            );
            Some(converted)
        }
        Err(e) => {
            error!("Failed to initialize OpenCC converter: {}. Falling back to original transcription.", e);
            None
        }
    }
}

pub(crate) struct ProcessedTranscription {
    pub final_text: String,
    pub processed_text: Option<String>,
}

pub(crate) async fn process_transcription_output(
    app: &AppHandle,
    transcription: &str,
) -> ProcessedTranscription {
    let settings = get_settings(app);
    let mut final_text = transcription.to_string();

    if let Some(converted_text) = maybe_convert_chinese_variant(&settings, transcription).await {
        final_text = converted_text;
    }

    let processed_text = (final_text != transcription).then(|| final_text.clone());

    ProcessedTranscription {
        final_text,
        processed_text,
    }
}

impl ShortcutAction for TranscribeAction {
    fn start(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        app.state::<TranscriptionCoordinator>().begin_dictation();
        let start_time = Instant::now();
        debug!("TranscribeAction::start called for binding: {}", binding_id);

        // Load model in the background
        let tm = app.state::<Arc<TranscriptionManager>>();
        let rm = app.state::<Arc<AudioRecordingManager>>();

        // Load ASR model and VAD model in parallel (local model not needed
        // when cloud transcription is active)
        if !get_settings(app).stt_cloud_enabled {
            tm.initiate_model_load();
        }
        let rm_clone = Arc::clone(&rm);
        std::thread::spawn(move || {
            if let Err(e) = rm_clone.preload_vad() {
                debug!("VAD pre-load failed: {}", e);
            }
        });

        let binding_id = binding_id.to_string();
        change_tray_icon(app, TrayIconState::Recording);
        // Held in the "starting" state until the input stream is actually
        // running — see show_starting_overlay.
        show_starting_overlay(app);

        let mut recording_error: Option<String> = None;
        match rm.try_start_recording(&binding_id) {
            Ok(recording) => {
                mark_overlay_recording(app);
                let app_clone = app.clone();
                let rm_clone = Arc::clone(&rm);
                std::thread::spawn(move || {
                    play_feedback_sound_blocking(&app_clone, SoundType::Start);
                    rm_clone.apply_mute(recording);
                });
            }
            Err(e) => {
                debug!("Failed to start recording: {}", e);
                recording_error = Some(e);
            }
        }

        if recording_error.is_none() {
            // Dynamically register the cancel shortcut in a separate task to avoid deadlock
            shortcut::register_cancel_shortcut(app);
        } else {
            app.state::<TranscriptionCoordinator>().end_dictation();
            // Starting failed (for example due to blocked microphone permissions).
            // Revert UI state so we don't stay stuck in the recording overlay.
            utils::hide_recording_overlay(app);
            change_tray_icon(app, TrayIconState::Idle);
            if let Some(err) = recording_error {
                let error_type = if is_microphone_access_denied(&err) {
                    "microphone_permission_denied"
                } else if is_no_input_device_error(&err) {
                    "no_input_device"
                } else {
                    "unknown"
                };
                let _ = app.emit(
                    "recording-error",
                    RecordingErrorEvent {
                        error_type: error_type.to_string(),
                        detail: Some(err),
                    },
                );
            }
        }

        debug!(
            "TranscribeAction::start completed in {:?}",
            start_time.elapsed()
        );
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        let coordinator = app.state::<TranscriptionCoordinator>();
        let Some(token) = coordinator.dictation() else {
            coordinator.notify_processing_finished();
            return;
        };

        let stop_time = Instant::now();
        debug!("TranscribeAction::stop called for binding: {}", binding_id);

        let ah = app.clone();
        let rm = Arc::clone(&app.state::<Arc<AudioRecordingManager>>());
        let tm = Arc::clone(&app.state::<Arc<TranscriptionManager>>());
        let hm = Arc::clone(&app.state::<Arc<HistoryManager>>());

        change_tray_icon(app, TrayIconState::Transcribing);
        show_transcribing_overlay(app);

        // Unmute before playing audio feedback so the stop sound is audible
        rm.remove_mute();

        // Play audio feedback for recording stop
        play_feedback_sound(app, SoundType::Stop);

        let binding_id = binding_id.to_string(); // Clone binding_id for the async task

        tauri::async_runtime::spawn(async move {
            // Keep the coordinator busy until the queued main-thread paste has
            // actually run. Cancel can still win between dispatch and delivery.
            let guard = FinishGuard(ah.clone());
            let Some(samples) = rm.stop_recording(&binding_id) else {
                return;
            };
            if samples.is_empty() || token.is_cancelled() {
                return;
            }

            let dir = hm.recordings_dir().to_owned();
            let wav_samples = samples.clone();
            let wav = tauri::async_runtime::spawn_blocking(move || {
                crate::audio_toolkit::audio::record_history_wav(&dir, &wav_samples)
            });
            let result = if get_settings(&ah).stt_cloud_enabled {
                token
                    .run_until_cancelled(crate::cloud_transcription::transcribe(&ah, samples))
                    .await
                    .map(|result| result.map_err(anyhow::Error::msg))
            } else {
                // Native inference cannot be interrupted safely. Keep its model
                // reserved until it returns, then discard a cancelled result.
                Some(
                    tauri::async_runtime::spawn_blocking(move || tm.transcribe(samples))
                        .await
                        .map_err(anyhow::Error::from)
                        .and_then(|result| result),
                )
            };
            let recording = match wav.await {
                Ok(Ok(recording)) => Some(recording),
                Ok(Err(error)) => {
                    error!("Could not save recording: {error}");
                    None
                }
                Err(error) => {
                    error!("Recording writer failed: {error}");
                    None
                }
            };
            let Some(result) = result.filter(|_| !token.is_cancelled()) else {
                return;
            };

            match result {
                Ok(transcript) => {
                    let processed = process_transcription_output(&ah, &transcript).await;
                    if token.is_cancelled() {
                        return;
                    }
                    if let Some(recording) = recording {
                        if let Err(error) = hm.save_entry(
                            recording,
                            transcript,
                            false,
                            processed.processed_text,
                            None,
                        ) {
                            error!("Could not save history entry: {error}");
                        }
                    }
                    if processed.final_text.is_empty() {
                        return;
                    }
                    let app = ah.clone();
                    if let Err(error) = ah.run_on_main_thread(move || {
                        let _guard = guard;
                        if !token.is_cancelled() {
                            if let Err(error) =
                                utils::paste(processed.final_text, app.clone(), &token)
                            {
                                error!("Failed to paste transcription: {error}");
                                let _ = app.emit("paste-error", ());
                            }
                        }
                    }) {
                        error!("Failed to schedule transcription paste: {error}");
                    }
                }
                Err(error) => {
                    error!("Transcription failed: {error}");
                    let history_entry_id = recording.and_then(|recording| {
                        hm.save_entry(recording, String::new(), false, None, None)
                            .map(|entry| entry.id)
                            .map_err(|error| error!("Could not save recording for retry: {error}"))
                            .ok()
                    });
                    if !token.is_cancelled() {
                        let _ = ah.emit(
                            "transcription-error",
                            TranscriptionErrorEvent {
                                detail: error.to_string(),
                                history_entry_id,
                            },
                        );
                    }
                }
            }
        });

        debug!(
            "TranscribeAction::stop completed in {:?}",
            stop_time.elapsed()
        );
    }
}

// Cancel Action
struct CancelAction;

impl ShortcutAction for CancelAction {
    fn start(&self, app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        utils::cancel_current_operation(app);
    }

    fn stop(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        // Nothing to do on stop for cancel
    }
}

// Test Action
struct TestAction;

impl ShortcutAction for TestAction {
    fn start(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str) {
        log::info!(
            "Shortcut ID '{}': Started - {} (App: {})", // Changed "Pressed" to "Started" for consistency
            binding_id,
            shortcut_str,
            app.package_info().name
        );
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str) {
        log::info!(
            "Shortcut ID '{}': Stopped - {} (App: {})", // Changed "Released" to "Stopped" for consistency
            binding_id,
            shortcut_str,
            app.package_info().name
        );
    }
}

// Static Action Map
pub static ACTION_MAP: Lazy<HashMap<String, Arc<dyn ShortcutAction>>> = Lazy::new(|| {
    let mut map = HashMap::new();
    map.insert(
        "transcribe".to_string(),
        Arc::new(TranscribeAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "cancel".to_string(),
        Arc::new(CancelAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "test".to_string(),
        Arc::new(TestAction) as Arc<dyn ShortcutAction>,
    );
    map
});
