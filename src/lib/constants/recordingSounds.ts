export type RecordingSoundOption = {
  value: string;
  label: string;
};

export const RECORDING_START_SOUNDS: RecordingSoundOption[] = [
  { value: "pulse", label: "Pulse" },
  { value: "chime", label: "Chime" },
  { value: "ping", label: "Ping" },
  { value: "bell", label: "Bell" },
  { value: "click", label: "Click" },
  { value: "bloom", label: "Bloom" },
  { value: "snap", label: "Snap" },
  { value: "glow", label: "Glow" },
];

export const RECORDING_STOP_SOUNDS: RecordingSoundOption[] = [
  { value: "settle", label: "Settle" },
  { value: "chime", label: "Chime" },
  { value: "pong", label: "Pong" },
  { value: "bell", label: "Bell" },
  { value: "click", label: "Click" },
  { value: "fade", label: "Fade" },
  { value: "snap", label: "Snap" },
  { value: "glow", label: "Glow" },
];
