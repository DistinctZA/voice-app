import React from "react";

interface SettingsGroupProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  title,
  description,
  children,
}) => {
  return (
    <div className="space-y-2">
      {title && (
        <div className="px-4">
          <h2 className="text-[11px] font-semibold text-mid-gray uppercase tracking-widest">
            {title}
          </h2>
          {description && (
            <p className="text-xs text-mid-gray mt-1">{description}</p>
          )}
        </div>
      )}
      <div className="bg-surface border border-mid-gray/15 rounded-xl overflow-visible shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        <div className="divide-y divide-mid-gray/10">{children}</div>
      </div>
    </div>
  );
};
