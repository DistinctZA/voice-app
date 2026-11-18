use anyhow::Result;
use hound::{WavReader, WavSpec, WavWriter};
use log::debug;
use std::fs::File;
use std::io::BufWriter;
use std::path::Path;
use tempfile::{Builder, TempPath};

/// Read a WAV file and return normalised f32 samples.
pub fn read_wav_samples<P: AsRef<Path>>(file_path: P) -> Result<Vec<f32>> {
    let reader = WavReader::open(file_path.as_ref())?;
    let samples = reader
        .into_samples::<i16>()
        .map(|s| s.map(|v| v as f32 / i16::MAX as f32))
        .collect::<Result<Vec<f32>, _>>()?;
    Ok(samples)
}

/// Verify a WAV file by reading it back and checking the sample count.
pub fn verify_wav_file<P: AsRef<Path>>(file_path: P, expected_samples: usize) -> Result<()> {
    let reader = WavReader::open(file_path.as_ref())?;
    let actual_samples = reader.len() as usize;
    if actual_samples != expected_samples {
        anyhow::bail!(
            "WAV sample count mismatch: expected {}, got {}",
            expected_samples,
            actual_samples
        );
    }
    Ok(())
}

/// Save audio samples as a WAV file
pub fn save_wav_file<P: AsRef<Path>>(file_path: P, samples: &[f32]) -> Result<()> {
    write_pcm(&mut File::create(file_path.as_ref())?, samples)?;
    debug!("Saved WAV file: {:?}", file_path.as_ref());
    Ok(())
}

/// Reserve a unique path before writing. The file is discarded unless History
/// keeps it, including when dictation is cancelled during transcription.
pub fn record_history_wav(dir: &Path, samples: &[f32]) -> Result<TempPath> {
    let mut recording = Builder::new()
        .prefix("voiceapp-")
        .suffix(".wav")
        .tempfile_in(dir)?;
    write_pcm(recording.as_file_mut(), samples)?;
    verify_wav_file(recording.path(), samples.len())?;
    Ok(recording.into_temp_path())
}

fn write_pcm(file: &mut File, samples: &[f32]) -> Result<()> {
    let spec = WavSpec {
        channels: 1,
        sample_rate: 16000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer = WavWriter::new(BufWriter::new(file), spec)?;

    // Convert f32 samples to i16 for WAV
    for sample in samples {
        let sample_i16 = (sample * i16::MAX as f32) as i16;
        writer.write_sample(sample_i16)?;
    }

    writer.finalize()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consecutive_recordings_are_independent_and_abandoned_audio_is_removed() {
        let dir = tempfile::tempdir().unwrap();
        let one = record_history_wav(dir.path(), &[0.5]).unwrap();
        let two = record_history_wav(dir.path(), &[-0.5]).unwrap();
        assert_ne!(one.to_path_buf(), two.to_path_buf());
        assert!(read_wav_samples(&one).unwrap()[0] > 0.0);
        let abandoned = two.to_path_buf();
        drop(two);
        assert!(!abandoned.exists());
        assert!(one.keep().unwrap().is_file());
    }
}
