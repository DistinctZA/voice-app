import React from "react";
import { useTranslation } from "react-i18next";
import { PlayIcon } from "lucide-react";
import { Button } from "../ui/Button";
import { Dropdown } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";
import { useSettings } from "../../hooks/useSettings";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  RECORDING_START_SOUNDS,
  RECORDING_STOP_SOUNDS,
  type RecordingSoundOption,
} from "../../lib/constants/recordingSounds";

interface RecordingSoundPickerProps {
  kind: "start" | "stop";
  title: string;
  description: string;
  options: RecordingSoundOption[];
  settingKey: "recording_start_sound" | "recording_stop_sound";
  disabled?: boolean;
}

const RecordingSoundPicker: React.FC<RecordingSoundPickerProps> = ({
  kind,
  title,
  description,
  options,
  settingKey,
  disabled = false,
}) => {
  const { getSetting, updateSetting } = useSettings();
  const playFeedbackPreview = useSettingsStore(
    (state) => state.playFeedbackPreview,
  );
  const customSounds = useSettingsStore((state) => state.customSounds);

  const selectedValue =
    getSetting(settingKey) ?? (kind === "start" ? "pulse" : "settle");

  const dropdownOptions = [...options];
  if (customSounds[kind]) {
    dropdownOptions.push({ value: "custom", label: "Custom" });
  }

  return (
    <SettingContainer
      title={title}
      description={description}
      grouped
      layout="horizontal"
    >
      <div className="flex items-center gap-2">
        <Dropdown
          selectedValue={selectedValue}
          onSelect={(value) => void updateSetting(settingKey, value)}
          options={dropdownOptions}
          disabled={disabled}
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => void playFeedbackPreview(kind, selectedValue)}
          title={title}
        >
          <PlayIcon className="h-4 w-4" />
        </Button>
      </div>
    </SettingContainer>
  );
};

interface RecordingSoundPickersProps {
  disabled?: boolean;
}

export const RecordingSoundPickers: React.FC<RecordingSoundPickersProps> = ({
  disabled = false,
}) => {
  const { t } = useTranslation();

  return (
    <>
      <RecordingSoundPicker
        kind="start"
        title={t("settings.sound.recordingStartSound.label")}
        description={t("settings.sound.recordingStartSound.description")}
        options={RECORDING_START_SOUNDS}
        settingKey="recording_start_sound"
        disabled={disabled}
      />
      <RecordingSoundPicker
        kind="stop"
        title={t("settings.sound.recordingStopSound.label")}
        description={t("settings.sound.recordingStopSound.description")}
        options={RECORDING_STOP_SOUNDS}
        settingKey="recording_stop_sound"
        disabled={disabled}
      />
    </>
  );
};
