import React from "react";

interface ThinkingIconProps {
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

/** Processing state: the pulse mark with its rings broken into arcs that
 *  rotate in opposite directions — "the pulse is working". */
const ThinkingIcon: React.FC<ThinkingIconProps> = ({
  width = 24,
  height = 24,
  color = "#bbff02",
  className = "",
}) => (
  <svg
    width={width}
    height={height}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <style>
      {`@keyframes va-spin { to { transform: rotate(360deg); } }
        @keyframes va-spin-rev { to { transform: rotate(-360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .va-ring-a, .va-ring-b { animation: none !important; }
        }`}
    </style>
    <circle cx="12" cy="12" r="2.4" fill={color} />
    <g
      className="va-ring-a"
      style={{
        transformOrigin: "12px 12px",
        animation: "va-spin 1.6s linear infinite",
      }}
    >
      <circle
        cx="12"
        cy="12"
        r="7"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeDasharray="16 28"
      />
    </g>
    <g
      className="va-ring-b"
      style={{
        transformOrigin: "12px 12px",
        animation: "va-spin-rev 2.4s linear infinite",
      }}
    >
      <circle
        cx="12"
        cy="12"
        r="10.4"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="24 41"
        opacity="0.7"
      />
    </g>
  </svg>
);

export default ThinkingIcon;
