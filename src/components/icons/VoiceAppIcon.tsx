const VoiceAppIcon = ({
  width,
  height,
  className,
}: {
  width?: number | string;
  height?: number | string;
  className?: string;
}) => (
  <svg
    width={width || 24}
    height={height || 24}
    viewBox="0 0 24 24"
    className={className}
    aria-hidden
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
  >
    {/* Voice pulse: concentric rings radiating from a core */}
    <circle cx="12" cy="12" r="2.4" fill="currentColor" />
    <circle
      cx="12"
      cy="12"
      r="6.5"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeDasharray="7 3.2"
    />
    <circle cx="12" cy="12" r="10.2" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);

export default VoiceAppIcon;
