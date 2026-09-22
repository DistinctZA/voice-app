/* eslint-disable i18next/no-literal-string -- brand wordmark, not translatable */
import React from "react";
import appIcon from "@/assets/app-icon.png";

const VoiceAppTextLogo = ({
  width,
  height,
  className,
}: {
  width?: number;
  height?: number;
  className?: string;
}) => {
  const fontSize = width ? Math.round(width / 6) : 20;
  const iconSize = Math.round(fontSize * 1.5);
  return (
    <div
      className={`flex items-center justify-center gap-2 font-semibold tracking-tight text-text ${className ?? ""}`}
      style={{
        fontSize: `${fontSize}px`,
        lineHeight: height ? `${height}px` : undefined,
      }}
    >
      <img
        src={appIcon}
        alt=""
        width={iconSize}
        height={iconSize}
        className="shrink-0"
        draggable={false}
      />
      VoiceApp
    </div>
  );
};

export default VoiceAppTextLogo;
