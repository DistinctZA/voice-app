import React from "react";
import { useTranslation } from "react-i18next";
import { Cog, FlaskConical, History, Info, Cpu } from "lucide-react";
import VoiceAppTextLogo from "./icons/VoiceAppTextLogo";
import VoiceAppIcon from "./icons/VoiceAppIcon";
import { useSettings } from "../hooks/useSettings";
import {
  GeneralSettings,
  AdvancedSettings,
  HistorySettings,
  DebugSettings,
  AboutSettings,
  ModelsSettings,
} from "./settings";

export type SidebarSection = keyof typeof SECTIONS_CONFIG;

interface IconProps {
  width?: number | string;
  height?: number | string;
  size?: number | string;
  className?: string;
  [key: string]: any;
}

interface SectionConfig {
  labelKey: string;
  icon: React.ComponentType<IconProps>;
  component: React.ComponentType;
  enabled: (settings: any) => boolean;
}

export const SECTIONS_CONFIG = {
  general: {
    labelKey: "sidebar.general",
    icon: VoiceAppIcon,
    component: GeneralSettings,
    enabled: () => true,
  },
  models: {
    labelKey: "sidebar.models",
    icon: Cpu,
    component: ModelsSettings,
    enabled: () => true,
  },
  advanced: {
    labelKey: "sidebar.advanced",
    icon: Cog,
    component: AdvancedSettings,
    enabled: () => true,
  },
  history: {
    labelKey: "sidebar.history",
    icon: History,
    component: HistorySettings,
    enabled: () => true,
  },
  debug: {
    labelKey: "sidebar.debug",
    icon: FlaskConical,
    component: DebugSettings,
    enabled: (settings) => settings?.debug_mode ?? false,
  },
  about: {
    labelKey: "sidebar.about",
    icon: Info,
    component: AboutSettings,
    enabled: () => true,
  },
} as const satisfies Record<string, SectionConfig>;

interface SidebarProps {
  activeSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSectionChange,
}) => {
  const { t } = useTranslation();
  const { settings } = useSettings();

  const availableSections = Object.entries(SECTIONS_CONFIG)
    .filter(([_, config]) => config.enabled(settings))
    .map(([id, config]) => ({ id: id as SidebarSection, ...config }));

  return (
    <div className="flex flex-col w-44 h-full border-e border-mid-gray/15 bg-surface/50 px-3">
      <VoiceAppTextLogo width={116} className="mx-auto my-5" />
      <nav className="flex flex-col w-full gap-1">
        {availableSections.map((section) => {
          const Icon = section.icon;
          const isActive = activeSection === section.id;

          return (
            <button
              key={section.id}
              type="button"
              className={`flex gap-2.5 items-center px-3 py-2 w-full rounded-lg cursor-pointer text-start transition-all duration-150 ${
                isActive
                  ? "bg-logo-primary text-black font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.15)]"
                  : "text-text/70 hover:text-text hover:bg-mid-gray/15"
              }`}
              onClick={() => onSectionChange(section.id)}
            >
              <Icon width={18} height={18} className="shrink-0" />
              <p className="text-sm truncate" title={t(section.labelKey)}>
                {t(section.labelKey)}
              </p>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
