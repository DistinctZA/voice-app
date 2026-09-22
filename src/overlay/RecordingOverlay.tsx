import { listen } from "@tauri-apps/api/event";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CloudIcon,
  PulseIcon,
  ThinkingIcon,
  CancelIcon,
} from "../components/icons";
import "./RecordingOverlay.css";
import { commands } from "@/bindings";
import i18n, { syncLanguageFromSettings } from "@/i18n";
import { getLanguageDirection } from "@/lib/utils/rtl";

type OverlayState = "starting" | "recording" | "transcribing" | "processing";

const ACCENT = "#bbff02";

/** Draw a mirrored oscilloscope-style voice trace from the level buckets. */
function drawTrace(canvas: HTMLCanvasElement, levels: number[]) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const mid = h / 2;
  const maxAmp = h / 2 - 1.5;

  // The buckets are FFT bands ordered low→high frequency, and speech energy
  // sits almost entirely in the low bands — drawn left-to-right that bulges
  // on the left. Fold the spectrum around the center instead: lowest bands
  // in the middle, higher bands mirrored outward to both edges.
  const nb = levels.length;
  const n = nb * 2 - 1;
  const bucket = (i: number) => levels[Math.abs(i - (nb - 1))];

  // Amplitude envelope: taper the ends so the trace breathes from the center
  const amp = (i: number) => {
    const t = i / (n - 1);
    const taper = Math.sin(Math.PI * t) * 0.6 + 0.4;
    return Math.max(0.06, Math.pow(bucket(i), 0.65) * taper) * maxAmp;
  };

  const xs = (i: number) => (i / (n - 1)) * w;

  // Build a smooth top curve through the points, mirror it for the bottom
  const path = new Path2D();
  path.moveTo(0, mid - amp(0));
  for (let i = 0; i < n - 1; i++) {
    const xc = (xs(i) + xs(i + 1)) / 2;
    const yc = (mid - amp(i) + (mid - amp(i + 1))) / 2;
    path.quadraticCurveTo(xs(i), mid - amp(i), xc, yc);
  }
  path.lineTo(w, mid - amp(n - 1));
  for (let i = n - 1; i > 0; i--) {
    const xc = (xs(i) + xs(i - 1)) / 2;
    const yc = (mid + amp(i) + (mid + amp(i - 1))) / 2;
    path.quadraticCurveTo(xs(i), mid + amp(i), xc, yc);
  }
  path.closePath();

  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = 6;
  ctx.fillStyle = "rgba(187, 255, 2, 0.28)";
  ctx.fill(path);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.4;
  ctx.stroke(path);

  // Center line echoes the resting state
  ctx.strokeStyle = "rgba(187, 255, 2, 0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(w, mid);
  ctx.stroke();
}

const RecordingOverlay: React.FC = () => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [state, setState] = useState<OverlayState>("recording");
  // Mirrors `state` for the event listener, which closes over the first render.
  const stateRef = useRef<OverlayState>("recording");
  const [isCloud, setIsCloud] = useState(false);
  const [levels, setLevels] = useState<number[]>(Array(16).fill(0));
  const smoothedLevelsRef = useRef<number[]>(Array(16).fill(0));
  // Running peak for auto-gain, so quiet talkers still fill the trace.
  const peakRef = useRef(0.3);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const direction = getLanguageDirection(i18n.language);

  useEffect(() => {
    const setupEventListeners = async () => {
      // Listen for show-overlay event from Rust
      const unlistenShow = await listen("show-overlay", async (event) => {
        const overlayState = event.payload as OverlayState;
        if (overlayState === "starting" || overlayState === "recording") {
          // Start each recording with a flat trace — when the hotkey is
          // pressed again quickly, leftover smoothed levels and auto-gain
          // peak from the previous session would flash a stale waveform.
          smoothedLevelsRef.current = Array(16).fill(0);
          peakRef.current = 0.3;
          setLevels(Array(16).fill(0));
        }
        // "starting" → "recording" is the same session promoting itself once
        // the microphone is live, so the settings round trips are already
        // done — repeating them would put IPC work right where the user
        // starts speaking.
        const promoting =
          overlayState === "recording" && stateRef.current === "starting";
        stateRef.current = overlayState;
        setState(overlayState);
        setIsVisible(true);
        if (promoting) return;

        // Sync language from settings each time overlay is shown
        await syncLanguageFromSettings();
        // Reflect cloud transcription mode with a cloud icon
        try {
          const result = await commands.getAppSettings();
          setIsCloud(
            result.status === "ok" && (result.data.stt_cloud_enabled ?? false),
          );
        } catch {
          setIsCloud(false);
        }
      });

      // Listen for hide-overlay event from Rust
      const unlistenHide = await listen("hide-overlay", () => {
        setIsVisible(false);
      });

      // Listen for mic-level updates
      const unlistenLevel = await listen<number[]>("mic-level", (event) => {
        const newLevels = event.payload as number[];

        // Auto-gain: track the recent peak (with slow decay) and normalize
        // against it, so the trace uses the full height even for soft speech
        // or a quiet microphone.
        const frameMax = Math.max(...newLevels, 0);
        peakRef.current = Math.max(frameMax, peakRef.current * 0.995, 0.3);
        const gain = 1 / peakRef.current;

        // Fast attack, slow release: jump up almost immediately when speech
        // hits, decay smoothly when it stops.
        const smoothed = smoothedLevelsRef.current.map((prev, i) => {
          const target = Math.min(1, (newLevels[i] || 0) * gain);
          return target > prev
            ? prev * 0.25 + target * 0.75
            : prev * 0.7 + target * 0.3;
        });

        smoothedLevelsRef.current = smoothed;
        setLevels(smoothed);
      });

      // Cleanup function
      return () => {
        unlistenShow();
        unlistenHide();
        unlistenLevel();
      };
    };

    setupEventListeners();
  }, []);

  // Redraw the voice trace whenever levels change
  useEffect(() => {
    if ((state === "recording" || state === "starting") && canvasRef.current) {
      drawTrace(canvasRef.current, levels);
    }
  }, [levels, state]);

  const overallLevel =
    levels.reduce((acc, v) => acc + v, 0) / Math.max(1, levels.length);

  const getIcon = () => {
    if (state === "recording" || state === "starting") {
      return isCloud ? (
        <CloudIcon />
      ) : (
        <PulseIcon level={state === "starting" ? 0 : overallLevel} />
      );
    }
    return <ThinkingIcon />;
  };

  return (
    <div
      dir={direction}
      className={`recording-overlay ${isVisible ? "fade-in" : ""} ${
        state === "starting" ? "warming" : ""
      }`}
    >
      <div className="overlay-left">{getIcon()}</div>

      <div className="overlay-middle">
        {(state === "recording" || state === "starting") && (
          <canvas ref={canvasRef} className="voice-trace" />
        )}
        {state === "transcribing" && (
          <div className="transcribing-text">{t("overlay.transcribing")}</div>
        )}
        {state === "processing" && (
          <div className="transcribing-text">{t("overlay.processing")}</div>
        )}
      </div>

      <div className="overlay-right">
        {state === "recording" && (
          <div
            className="cancel-button"
            onClick={() => {
              commands.cancelOperation();
            }}
          >
            <CancelIcon />
          </div>
        )}
      </div>
    </div>
  );
};

export default RecordingOverlay;
