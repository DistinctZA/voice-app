/// Accessed under one mutex, including the OS mute calls, so finishing a
/// recording cannot race with a delayed start-sound callback.
#[derive(Default)]
pub(super) struct RecordingMute {
    generation: u64,
    active: bool,
    muted: bool,
}

impl RecordingMute {
    pub fn begin(&mut self) -> u64 {
        self.generation += 1;
        self.active = true;
        self.generation
    }

    pub fn apply(&mut self, generation: u64, enabled: bool, set_mute: impl FnOnce(bool)) {
        if self.active && self.generation == generation && enabled && !self.muted {
            set_mute(true);
            self.muted = true;
        }
    }

    pub fn finish(&mut self, set_mute: impl FnOnce(bool)) {
        self.active = false;
        if self.muted {
            set_mute(false);
            self.muted = false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancellation_unmutes_without_closing_microphone() {
        let mut state = RecordingMute::default();
        let mut calls = Vec::new();
        let recording = state.begin();
        state.apply(recording, true, |mute| calls.push(mute));
        state.finish(|mute| calls.push(mute));
        state.finish(|mute| calls.push(mute));
        assert_eq!(calls, vec![true, false]);
    }

    #[test]
    fn delayed_sound_cannot_mute_after_stop_or_cancel() {
        let mut state = RecordingMute::default();
        let recording = state.begin();
        state.finish(|_| panic!("No mute was applied"));
        state.apply(recording, true, |_| panic!("Recording already finished"));
    }

    #[test]
    fn previous_recording_cannot_mute_new_recording() {
        let mut state = RecordingMute::default();
        let previous = state.begin();
        state.finish(|_| {});
        let current = state.begin();
        state.apply(previous, true, |_| panic!("Stale start-sound callback"));
        let mut calls = Vec::new();
        state.apply(current, true, |mute| calls.push(mute));
        state.finish(|mute| calls.push(mute));
        assert_eq!(calls, vec![true, false]);
    }

    #[test]
    fn disabled_muting_does_not_change_system_audio() {
        let mut state = RecordingMute::default();
        let recording = state.begin();
        state.apply(recording, false, |_| panic!("Muting disabled"));
        state.finish(|_| panic!("System audio was not muted by us"));
    }
}
