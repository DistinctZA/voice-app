use base64::Engine;
use log::{debug, error};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::io::Cursor;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::AppHandle;

use crate::settings::get_settings;

const OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
const GROQ_BASE_URL: &str = "https://api.groq.com/openai/v1";
const OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";
const XAI_BASE_URL: &str = "https://api.x.ai/v1";
const ELEVENLABS_BASE_URL: &str = "https://api.elevenlabs.io/v1";

/// ElevenLabs' STT models aren't discoverable via a catalog endpoint;
/// this curated list mirrors their published Scribe model ids.
pub const ELEVENLABS_DEFAULT_MODEL: &str = "scribe_v2";

/// xAI's STT endpoint has a single built-in model; this placeholder keeps
/// the provider/model UI uniform without sending a model parameter.
pub const XAI_DEFAULT_MODEL: &str = "grok-stt";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// Idle keep-alive window for pooled connections. Long enough that a run of
/// dictations reuses one connection, so only the first pays DNS + TLS.
const POOL_IDLE_TIMEOUT: Duration = Duration::from_secs(300);

/// Shared HTTP client.
///
/// Building a `reqwest::Client` per call throws away the connection pool, so
/// every single transcription re-did DNS and the TLS handshake against the
/// provider (~100-250ms added to each dictation before any audio was sent).
/// One client, reused, keeps the connection warm between dictations.
fn http_client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .pool_idle_timeout(POOL_IDLE_TIMEOUT)
                .build()
                .map_err(|e| format!("Failed to create HTTP client: {e}"))
        })
        .as_ref()
        .map_err(|e| e.clone())
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SttProvider {
    pub id: String,
    pub label: String,
    /// Curated models shown before (or instead of) a live fetch.
    pub default_models: Vec<String>,
}

pub fn stt_providers() -> Vec<SttProvider> {
    vec![
        SttProvider {
            id: "openai".to_string(),
            label: "OpenAI".to_string(),
            default_models: vec![
                "gpt-4o-transcribe".to_string(),
                "gpt-4o-mini-transcribe".to_string(),
                "whisper-1".to_string(),
            ],
        },
        // Note: the "groq" provider was removed from this list (confusingly
        // similar to Grok), but its runtime branches below remain so any
        // persisted settings that still reference it keep working.
        SttProvider {
            id: "xai".to_string(),
            label: "Grok (xAI)".to_string(),
            default_models: vec![XAI_DEFAULT_MODEL.to_string()],
        },
        SttProvider {
            id: "elevenlabs".to_string(),
            label: "ElevenLabs".to_string(),
            default_models: vec![
                ELEVENLABS_DEFAULT_MODEL.to_string(),
                "scribe_v1".to_string(),
            ],
        },
        SttProvider {
            id: "openrouter".to_string(),
            label: "OpenRouter".to_string(),
            default_models: vec![
                "openai/gpt-4o-audio-preview".to_string(),
                "google/gemini-2.5-flash".to_string(),
            ],
        },
    ]
}

fn base_url(provider_id: &str) -> Result<&'static str, String> {
    match provider_id {
        "openai" => Ok(OPENAI_BASE_URL),
        "groq" => Ok(GROQ_BASE_URL),
        "openrouter" => Ok(OPENROUTER_BASE_URL),
        "xai" => Ok(XAI_BASE_URL),
        "elevenlabs" => Ok(ELEVENLABS_BASE_URL),
        other => Err(format!("Unknown cloud transcription provider '{other}'")),
    }
}

/// Encode 16 kHz mono f32 samples as a 16-bit PCM WAV in memory.
fn encode_wav(samples: &[f32]) -> Result<Vec<u8>, String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 16_000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec)
            .map_err(|e| format!("Failed to create WAV writer: {e}"))?;
        for &sample in samples {
            let clamped = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
            writer
                .write_sample(clamped)
                .map_err(|e| format!("Failed to encode WAV: {e}"))?;
        }
        writer
            .finalize()
            .map_err(|e| format!("Failed to finalize WAV: {e}"))?;
    }
    Ok(cursor.into_inner())
}

/// Map the app's selected language to an ISO 639-1 code the APIs accept,
/// or None for auto-detect.
fn api_language(selected: &str) -> Option<String> {
    match selected {
        "auto" | "" => None,
        "zh-Hans" | "zh-Hant" => Some("zh".to_string()),
        other => Some(other.to_string()),
    }
}

fn vocabulary_prompt(custom_words: &[String]) -> Option<String> {
    if custom_words.is_empty() {
        None
    } else {
        Some(format!("Vocabulary: {}", custom_words.join(", ")))
    }
}

/// Transcribe recorded samples with the configured cloud provider.
pub async fn transcribe(app: &AppHandle, samples: Vec<f32>) -> Result<String, String> {
    let settings = get_settings(app);
    let provider_id = settings.stt_provider_id.clone();
    let api_key = settings
        .stt_api_keys
        .get(&provider_id)
        .cloned()
        .unwrap_or_default();
    if api_key.trim().is_empty() {
        return Err(format!(
            "No API key configured for {provider_id}. Add one in Settings → Models → Cloud transcription."
        ));
    }
    // Fall back to the provider's first curated model so settings written
    // before a provider was added (missing map entry) still work.
    let model = settings
        .stt_models
        .get(&provider_id)
        .cloned()
        .filter(|m| !m.trim().is_empty())
        .or_else(|| {
            stt_providers()
                .into_iter()
                .find(|p| p.id == provider_id)
                .and_then(|p| p.default_models.first().cloned())
        })
        .unwrap_or_default();
    if model.trim().is_empty() {
        return Err(format!("No model selected for {provider_id}."));
    }

    let wav = encode_wav(&samples)?;
    debug!(
        "Cloud transcription: provider={provider_id} model={model} wav_bytes={}",
        wav.len()
    );

    let client = http_client()?;

    let text = match provider_id.as_str() {
        "openai" | "groq" => {
            transcribe_openai_compatible(client, &provider_id, &api_key, &model, wav, &settings)
                .await?
        }
        "openrouter" => transcribe_openrouter(client, &api_key, &model, wav).await?,
        "xai" => transcribe_xai(client, &api_key, wav, &settings).await?,
        "elevenlabs" => transcribe_elevenlabs(client, &api_key, &model, wav, &settings).await?,
        other => return Err(format!("Unknown cloud transcription provider '{other}'")),
    };

    Ok(text.trim().to_string())
}

/// OpenAI-style `/audio/transcriptions` multipart endpoint (OpenAI, Groq).
async fn transcribe_openai_compatible(
    client: &reqwest::Client,
    provider_id: &str,
    api_key: &str,
    model: &str,
    wav: Vec<u8>,
    settings: &crate::settings::AppSettings,
) -> Result<String, String> {
    let url = format!("{}/audio/transcriptions", base_url(provider_id)?);

    let file_part = reqwest::multipart::Part::bytes(wav)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| format!("Failed to build request: {e}"))?;

    let mut form = reqwest::multipart::Form::new()
        .part("file", file_part)
        .text("model", model.to_string())
        .text("response_format", "json");

    if let Some(language) = api_language(&settings.selected_language) {
        form = form.text("language", language);
    }
    if let Some(prompt) = vocabulary_prompt(&settings.custom_words) {
        form = form.text("prompt", prompt);
    }

    let response = client
        .post(&url)
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Cloud transcription request failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        error!("Cloud transcription failed ({status}): {body}");
        return Err(format!("Cloud transcription failed ({status}): {body}"));
    }

    let parsed: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse transcription response: {e}"))?;
    parsed
        .get("text")
        .and_then(|t| t.as_str())
        .map(str::to_string)
        .ok_or_else(|| "Transcription response missing 'text' field".to_string())
}

/// xAI's dedicated STT endpoint (POST /v1/stt, multipart). There is no
/// model parameter — Grok STT is a single hosted model. `keyterm` fields
/// bias recognition toward the user's custom words, and `format` enables
/// punctuation/formatting (only valid with an explicit language).
async fn transcribe_xai(
    client: &reqwest::Client,
    api_key: &str,
    wav: Vec<u8>,
    settings: &crate::settings::AppSettings,
) -> Result<String, String> {
    let url = format!("{XAI_BASE_URL}/stt");

    let file_part = reqwest::multipart::Part::bytes(wav)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| format!("Failed to build request: {e}"))?;

    let mut form = reqwest::multipart::Form::new().part("file", file_part);

    match api_language(&settings.selected_language) {
        Some(language) => {
            form = form.text("language", language).text("format", "true");
        }
        None => {
            form = form.text("language", "auto");
        }
    }
    for word in &settings.custom_words {
        form = form.text("keyterm", word.clone());
    }

    let response = client
        .post(&url)
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Cloud transcription request failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        error!("Grok transcription failed ({status}): {body}");
        return Err(format!("Cloud transcription failed ({status}): {body}"));
    }

    let parsed: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse transcription response: {e}"))?;
    parsed
        .get("text")
        .and_then(|t| t.as_str())
        .map(str::to_string)
        .ok_or_else(|| "Transcription response missing 'text' field".to_string())
}

/// ElevenLabs Scribe (POST /v1/speech-to-text, multipart, `xi-api-key`
/// header). Diarization/audio-event tagging are disabled — dictation is
/// single-speaker. Custom-word biasing (`keyterms`) is deliberately not
/// sent: it carries a 20% price surcharge and its multipart encoding is
/// not clearly documented.
async fn transcribe_elevenlabs(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    wav: Vec<u8>,
    settings: &crate::settings::AppSettings,
) -> Result<String, String> {
    let url = format!("{ELEVENLABS_BASE_URL}/speech-to-text");

    let file_part = reqwest::multipart::Part::bytes(wav)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| format!("Failed to build request: {e}"))?;

    let mut form = reqwest::multipart::Form::new()
        .part("file", file_part)
        .text("model_id", model.to_string())
        .text("diarize", "false")
        .text("tag_audio_events", "false")
        .text("timestamps_granularity", "none");

    if let Some(language) = api_language(&settings.selected_language) {
        form = form.text("language_code", language);
    }

    let response = client
        .post(&url)
        .header("xi-api-key", api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Cloud transcription request failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        error!("ElevenLabs transcription failed ({status}): {body}");
        return Err(format!("Cloud transcription failed ({status}): {body}"));
    }

    let parsed: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse transcription response: {e}"))?;
    parsed
        .get("text")
        .and_then(|t| t.as_str())
        .map(str::to_string)
        .ok_or_else(|| "Transcription response missing 'text' field".to_string())
}

/// OpenRouter has no transcription endpoint; use an audio-capable chat model.
async fn transcribe_openrouter(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    wav: Vec<u8>,
) -> Result<String, String> {
    let url = format!("{OPENROUTER_BASE_URL}/chat/completions");
    let audio_b64 = base64::engine::general_purpose::STANDARD.encode(&wav);

    let body = serde_json::json!({
        "model": model,
        "messages": [{
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "Transcribe this audio verbatim. Output only the transcription text, with proper punctuation. Do not add commentary."
                },
                {
                    "type": "input_audio",
                    "input_audio": { "data": audio_b64, "format": "wav" }
                }
            ]
        }]
    });

    let response = client
        .post(&url)
        .bearer_auth(api_key)
        .header("HTTP-Referer", "https://github.com/DistinctZA/VoiceApp")
        .header("X-Title", "VoiceApp")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Cloud transcription request failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        error!("OpenRouter transcription failed ({status}): {body}");
        return Err(format!("Cloud transcription failed ({status}): {body}"));
    }

    let parsed: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse transcription response: {e}"))?;
    parsed
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|t| t.as_str())
        .map(str::to_string)
        .ok_or_else(|| "Transcription response missing message content".to_string())
}

/// List models available for transcription from a provider, filtered to
/// speech-capable entries.
pub async fn fetch_stt_models(provider_id: &str, api_key: &str) -> Result<Vec<String>, String> {
    // xAI's STT endpoint has no model catalog — a single hosted model.
    if provider_id == "xai" {
        return Ok(vec![XAI_DEFAULT_MODEL.to_string()]);
    }
    // ElevenLabs' /models endpoint lists TTS models only; Scribe ids are fixed.
    if provider_id == "elevenlabs" {
        return Ok(vec![
            ELEVENLABS_DEFAULT_MODEL.to_string(),
            "scribe_v1".to_string(),
        ]);
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let url = format!("{}/models", base_url(provider_id)?);
    let mut request = client.get(&url);
    // OpenRouter's model catalog is public; the others need the key.
    if provider_id != "openrouter" {
        if api_key.trim().is_empty() {
            return Err("API key is required to list models.".to_string());
        }
        request = request.bearer_auth(api_key);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Failed to fetch models: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Model list request failed ({status}): {body}"));
    }

    let parsed: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse model list: {e}"))?;
    let Some(data) = parsed.get("data").and_then(|d| d.as_array()) else {
        return Err("Unexpected model list response".to_string());
    };

    let mut models: Vec<String> = Vec::new();
    for entry in data {
        let Some(id) = entry.get("id").and_then(|i| i.as_str()) else {
            continue;
        };
        let keep = match provider_id {
            // Transcription-capable OpenAI/Groq models are whisper/transcribe ids
            "openai" | "groq" => id.contains("whisper") || id.contains("transcribe"),
            // OpenRouter: keep chat models that accept audio input
            "openrouter" => entry
                .get("architecture")
                .map(|arch| {
                    arch.get("input_modalities")
                        .and_then(|m| m.as_array())
                        .map(|m| m.iter().any(|v| v.as_str() == Some("audio")))
                        .unwrap_or_else(|| {
                            arch.get("modality")
                                .and_then(|m| m.as_str())
                                .map(|m| m.contains("audio"))
                                .unwrap_or(false)
                        })
                })
                .unwrap_or(false),
            _ => false,
        };
        if keep {
            models.push(id.to_string());
        }
    }

    models.sort();
    Ok(models)
}
