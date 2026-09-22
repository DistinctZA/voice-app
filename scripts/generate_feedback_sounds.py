#!/usr/bin/env python3
"""Generate bundled recording feedback sounds for VoiceApp."""

from __future__ import annotations

import math
import shutil
import struct
import wave
from pathlib import Path

SAMPLE_RATE = 44100
REPO_ROOT = Path(__file__).resolve().parents[1]
SOUNDS_DIR = REPO_ROOT / "src-tauri" / "resources" / "sounds"
LEGACY_DIR = REPO_ROOT / "src-tauri" / "resources"


def clamp(value: float) -> float:
    return max(-1.0, min(1.0, value))


def envelope(t: float, duration: float, attack: float = 0.01, release: float = 0.08) -> float:
    if t < 0:
        return 0.0
    if t < attack:
        return t / attack
    if t > duration - release:
        remaining = duration - t
        return max(0.0, remaining / release)
    return 1.0


def sine(freq: float, t: float) -> float:
    return math.sin(2 * math.pi * freq * t)


def write_wav(path: Path, samples: list[float]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "w") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for sample in samples:
            value = int(clamp(sample) * 32767)
            frames.extend(struct.pack("<h", value))
            frames.extend(struct.pack("<h", value))
        wav.writeframes(frames)


def render(duration: float, mixer) -> list[float]:
    total = int(SAMPLE_RATE * duration)
    return [mixer(i / SAMPLE_RATE) for i in range(total)]


def start_marimba(t: float) -> float:
    notes = [(660, 0.0), (880, 0.05), (990, 0.1)]
    value = 0.0
    for freq, start in notes:
        local = t - start
        if local >= 0:
            value += sine(freq, local) * envelope(local, 0.18, 0.005, 0.12) * 0.45
    return value


def start_pop(t: float) -> float:
    return sine(880, t) * envelope(t, 0.08, 0.001, 0.05) * 0.7


def start_chime(t: float) -> float:
    freqs = [523, 659, 784, 988]
    value = 0.0
    for index, freq in enumerate(freqs):
        local = t - index * 0.05
        if local >= 0:
            value += sine(freq, local) * envelope(local, 0.25, 0.002, 0.18) * 0.35
    return value


def start_ping(t: float) -> float:
    return sine(1200, t) * envelope(t, 0.06, 0.001, 0.04) * 0.65


def start_bell(t: float) -> float:
    value = sine(740, t) * 0.55
    value += sine(1480, t) * 0.25
    return value * envelope(t, 0.35, 0.003, 0.25)


def start_click(t: float) -> float:
    noise = math.sin(17_000 * t) * math.sin(900 * t)
    return noise * envelope(t, 0.03, 0.001, 0.02) * 0.35


def start_bloom(t: float) -> float:
    freq = 420 + 380 * min(1.0, t / 0.12)
    return sine(freq, t) * envelope(t, 0.22, 0.02, 0.12) * 0.6


def start_snap(t: float) -> float:
    value = sine(1800, t) * envelope(t, 0.04, 0.001, 0.025) * 0.55
    value += sine(950, t) * envelope(t, 0.05, 0.001, 0.03) * 0.25
    return value


def start_glow(t: float) -> float:
    return sine(520, t) * envelope(t, 0.28, 0.04, 0.18) * 0.55


def start_pulse(t: float) -> float:
    pulse = 1.0 if int(t * 16) % 2 == 0 else 0.55
    return sine(760, t) * envelope(t, 0.16, 0.005, 0.08) * 0.5 * pulse


def stop_marimba(t: float) -> float:
    notes = [(990, 0.0), (740, 0.06), (620, 0.12)]
    value = 0.0
    for freq, start in notes:
        local = t - start
        if local >= 0:
            value += sine(freq, local) * envelope(local, 0.22, 0.005, 0.16) * 0.42
    return value


def stop_pop(t: float) -> float:
    return sine(520, t) * envelope(t, 0.09, 0.001, 0.06) * 0.7


def stop_chime(t: float) -> float:
    freqs = [988, 784, 659, 523]
    value = 0.0
    for index, freq in enumerate(freqs):
        local = t - index * 0.05
        if local >= 0:
            value += sine(freq, local) * envelope(local, 0.28, 0.002, 0.2) * 0.32
    return value


def stop_pong(t: float) -> float:
    return sine(640, t) * envelope(t, 0.07, 0.001, 0.05) * 0.65


def stop_bell(t: float) -> float:
    value = sine(620, t) * 0.55
    value += sine(1240, t) * 0.2
    return value * envelope(t, 0.4, 0.003, 0.28)


def stop_click(t: float) -> float:
    noise = math.sin(13_000 * t) * math.sin(700 * t)
    return noise * envelope(t, 0.035, 0.001, 0.025) * 0.32


def stop_fade(t: float) -> float:
    freq = 680 - 260 * min(1.0, t / 0.18)
    return sine(freq, t) * envelope(t, 0.24, 0.01, 0.14) * 0.58


def stop_snap(t: float) -> float:
    value = sine(1200, t) * envelope(t, 0.045, 0.001, 0.03) * 0.5
    value += sine(600, t) * envelope(t, 0.06, 0.001, 0.04) * 0.25
    return value


def stop_glow(t: float) -> float:
    return sine(420, t) * envelope(t, 0.32, 0.02, 0.22) * 0.52


def stop_settle(t: float) -> float:
    value = sine(480, t) * envelope(t, 0.34, 0.03, 0.2) * 0.45
    value += sine(240, t) * envelope(t, 0.34, 0.03, 0.2) * 0.25
    return value


START_SOUNDS = {
    "marimba": (0.28, start_marimba),
    "pop": (0.12, start_pop),
    "chime": (0.35, start_chime),
    "ping": (0.08, start_ping),
    "bell": (0.4, start_bell),
    "click": (0.05, start_click),
    "bloom": (0.25, start_bloom),
    "snap": (0.08, start_snap),
    "glow": (0.32, start_glow),
    "pulse": (0.2, start_pulse),
}

STOP_SOUNDS = {
    "marimba": (0.32, stop_marimba),
    "pop": (0.14, stop_pop),
    "chime": (0.38, stop_chime),
    "pong": (0.1, stop_pong),
    "bell": (0.45, stop_bell),
    "click": (0.06, stop_click),
    "fade": (0.28, stop_fade),
    "snap": (0.1, stop_snap),
    "glow": (0.36, stop_glow),
    "settle": (0.38, stop_settle),
}


def copy_legacy(name: str, side: str) -> None:
    legacy = LEGACY_DIR / f"{name}_{side}.wav"
    target = SOUNDS_DIR / side / f"{name}.wav"
    if legacy.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(legacy, target)


def main() -> None:
    for sound_id, (duration, mixer) in START_SOUNDS.items():
        if sound_id in {"marimba", "pop"}:
            copy_legacy(sound_id, "start")
            continue
        write_wav(SOUNDS_DIR / "start" / f"{sound_id}.wav", render(duration, mixer))

    for sound_id, (duration, mixer) in STOP_SOUNDS.items():
        if sound_id in {"marimba", "pop"}:
            copy_legacy(sound_id, "stop")
            continue
        write_wav(SOUNDS_DIR / "stop" / f"{sound_id}.wav", render(duration, mixer))

    print(f"Generated feedback sounds in {SOUNDS_DIR}")


if __name__ == "__main__":
    main()
