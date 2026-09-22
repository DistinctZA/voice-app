import React from "react";

interface PulseIconProps {
  width?: number;
  height?: number;
  color?: string;
  className?: string;
  /** 0..1 — drives the core glow while recording */
  level?: number;
}

/** The VoiceApp "voice pulse" mark: a core dot with radiating rings.
 *  The core scales subtly with the live input level. */
const PulseIcon: React.FC<PulseIconProps> = ({
  width = 24,
  height = 24,
  color = "#bbff02",
  className = "",
  level = 0,
}) => {
  const core = 2.6 + Math.min(1, level) * 2.2;
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle
        cx="12"
        cy="12"
        r={core}
        fill={color}
        style={{ transition: "r 60ms ease-out" }}
      />
      <circle
        cx="12"
        cy="12"
        r="7"
        stroke={color}
        strokeWidth="1.8"
        strokeDasharray="7.5 3.5"
        opacity={0.55 + Math.min(1, level) * 0.45}
        style={{ transition: "opacity 80ms ease-out" }}
      />
      <circle cx="12" cy="12" r="10.4" stroke={color} strokeWidth="1.5" />
    </svg>
  );
};

export default PulseIcon;
