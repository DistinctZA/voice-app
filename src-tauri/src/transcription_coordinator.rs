use crate::actions::ACTION_MAP;
use crate::managers::audio::AudioRecordingManager;
use log::{debug, error, warn};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tokio_util::sync::CancellationToken;

// Minimum gap between accepted press events. Long enough to swallow
// hotkey spam (which otherwise churns the start/stop pipeline and races
// the overlay show/hide animations), short enough that deliberate
// back-to-back dictations still feel instant. Releases always pass
// through so push-to-talk can never be left recording by the debounce.
const DEBOUNCE: Duration = Duration::from_millis(250);

/// Commands processed sequentially by the coordinator thread.
enum Command {
    Input {
        binding_id: String,
        hotkey_string: String,
        is_pressed: bool,
        push_to_talk: bool,
    },
    Cancel,
    ProcessingFinished,
}

/// Pipeline lifecycle, owned exclusively by the coordinator thread.
enum Stage {
    Idle,
    Recording(String), // binding_id
    Processing,
}

/// Serialises all transcription lifecycle events through a single thread
/// to eliminate race conditions between keyboard shortcuts, signals, and
/// the async transcribe-paste pipeline.
pub struct TranscriptionCoordinator {
    tx: Sender<Command>,
    dictation: Mutex<Option<CancellationToken>>,
}

pub fn is_transcribe_binding(id: &str) -> bool {
    id == "transcribe"
}

impl TranscriptionCoordinator {
    pub fn new(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel();

        thread::spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let mut stage = Stage::Idle;
                let mut last_press: Option<Instant> = None;

                while let Ok(cmd) = rx.recv() {
                    match cmd {
                        Command::Input {
                            binding_id,
                            hotkey_string,
                            is_pressed,
                            push_to_talk,
                        } => {
                            // Debounce rapid-fire press events (key repeat / double-tap).
                            // Releases always pass through for push-to-talk.
                            if is_pressed {
                                let now = Instant::now();
                                if last_press.map_or(false, |t| now.duration_since(t) < DEBOUNCE) {
                                    debug!("Debounced press for '{binding_id}'");
                                    continue;
                                }
                                last_press = Some(now);
                            }

                            if push_to_talk {
                                if is_pressed && matches!(stage, Stage::Idle) {
                                    start(&app, &mut stage, &binding_id, &hotkey_string);
                                } else if is_pressed
                                    && matches!(&stage, Stage::Recording(id) if id == &binding_id)
                                {
                                    // A press while already recording means the
                                    // release event was missed (modifier-only
                                    // hotkeys can lose their release when other
                                    // key events interleave, e.g. the synthetic
                                    // paste of the previous dictation). Treat it
                                    // as the missing release so push-to-talk can
                                    // never get stuck recording.
                                    warn!(
                                        "Push-to-talk press for '{binding_id}' while already recording — \
                                         treating as missed release"
                                    );
                                    stop(&app, &mut stage, &binding_id, &hotkey_string);
                                } else if !is_pressed
                                    && matches!(&stage, Stage::Recording(id) if id == &binding_id)
                                {
                                    stop(&app, &mut stage, &binding_id, &hotkey_string);
                                }
                            } else if is_pressed {
                                match &stage {
                                    Stage::Idle => {
                                        start(&app, &mut stage, &binding_id, &hotkey_string);
                                    }
                                    Stage::Recording(id) if id == &binding_id => {
                                        stop(&app, &mut stage, &binding_id, &hotkey_string);
                                    }
                                    _ => {
                                        debug!("Ignoring press for '{binding_id}': pipeline busy")
                                    }
                                }
                            }
                        }
                        Command::Cancel if !matches!(stage, Stage::Idle) => {
                            let coordinator = app.state::<TranscriptionCoordinator>();
                            if let Some(token) = coordinator.dictation() {
                                token.cancel();
                            }
                            crate::utils::discard_current_recording(&app);
                            if matches!(stage, Stage::Recording(_)) {
                                coordinator.end_dictation();
                                stage = Stage::Idle;
                            }
                        }
                        Command::Cancel => {}
                        Command::ProcessingFinished => {
                            stage = Stage::Idle;
                        }
                    }
                }
                debug!("Transcription coordinator exited");
            }));
            if let Err(e) = result {
                error!("Transcription coordinator panicked: {e:?}");
            }
        });

        Self {
            tx,
            dictation: Mutex::default(),
        }
    }

    pub fn begin_dictation(&self) {
        *self.dictation.lock().unwrap() = Some(CancellationToken::new());
    }

    pub fn dictation(&self) -> Option<CancellationToken> {
        self.dictation.lock().unwrap().clone()
    }

    pub fn end_dictation(&self) {
        self.dictation.lock().unwrap().take();
    }

    /// Send a keyboard/signal input event for a transcribe binding.
    /// For signal-based toggles, use `is_pressed: true` and `push_to_talk: false`.
    pub fn send_input(
        &self,
        binding_id: &str,
        hotkey_string: &str,
        is_pressed: bool,
        push_to_talk: bool,
    ) {
        if self
            .tx
            .send(Command::Input {
                binding_id: binding_id.to_string(),
                hotkey_string: hotkey_string.to_string(),
                is_pressed,
                push_to_talk,
            })
            .is_err()
        {
            warn!("Transcription coordinator channel closed");
        }
    }

    pub fn cancel(&self) {
        // Suppress a paste already queued on the UI thread, even while the
        // coordinator is still draining microphone input.
        if let Some(token) = self.dictation() {
            token.cancel();
        }
        if self.tx.send(Command::Cancel).is_err() {
            warn!("Transcription coordinator channel closed");
        }
    }

    pub fn notify_processing_finished(&self) {
        self.end_dictation();
        if self.tx.send(Command::ProcessingFinished).is_err() {
            warn!("Transcription coordinator channel closed");
        }
    }
}

fn start(app: &AppHandle, stage: &mut Stage, binding_id: &str, hotkey_string: &str) {
    let Some(action) = ACTION_MAP.get(binding_id) else {
        warn!("No action in ACTION_MAP for '{binding_id}'");
        return;
    };
    action.start(app, binding_id, hotkey_string);
    if app
        .try_state::<Arc<AudioRecordingManager>>()
        .map_or(false, |a| a.is_recording())
    {
        *stage = Stage::Recording(binding_id.to_string());
    } else {
        debug!("Start for '{binding_id}' did not begin recording; staying idle");
    }
}

fn stop(app: &AppHandle, stage: &mut Stage, binding_id: &str, hotkey_string: &str) {
    let Some(action) = ACTION_MAP.get(binding_id) else {
        warn!("No action in ACTION_MAP for '{binding_id}'");
        return;
    };
    action.stop(app, binding_id, hotkey_string);
    *stage = Stage::Processing;
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::FutureExt;

    #[test]
    fn cancel_reaches_the_inflight_request_and_queued_delivery_before_cleanup() {
        let (tx, _receiver) = mpsc::channel();
        let coordinator = TranscriptionCoordinator {
            tx,
            dictation: Mutex::default(),
        };
        coordinator.begin_dictation();
        let request = coordinator.dictation().unwrap();
        let delivery = request.clone();
        assert!(request
            .run_until_cancelled(std::future::pending::<()>())
            .now_or_never()
            .is_none());
        coordinator.cancel();
        assert_eq!(
            request
                .run_until_cancelled(std::future::pending::<()>())
                .now_or_never(),
            Some(None)
        );
        coordinator.notify_processing_finished();
        coordinator.begin_dictation();
        assert!(delivery.is_cancelled());
        assert!(!coordinator.dictation().unwrap().is_cancelled());
    }
}
