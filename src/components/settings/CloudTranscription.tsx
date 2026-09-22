import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { SettingsGroup } from "../ui/SettingsGroup";
import { SettingContainer } from "../ui/SettingContainer";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { Dropdown } from "../ui/Dropdown";
import { Select } from "../ui/Select";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { useSettings } from "../../hooks/useSettings";
import { useSettingsStore } from "../../stores/settingsStore";
import { commands, type SttProvider } from "@/bindings";

interface CloudTranscriptionFormProps {
  /** Reports the current (possibly unsaved) API key so parents can gate on it. */
  onApiKeyDraftChange?: (key: string) => void;
}

// Provider / API key / model / test-connection rows, without the enable
// toggle — shared between the settings page and onboarding.
export const CloudTranscriptionForm: React.FC<CloudTranscriptionFormProps> = ({
  onApiKeyDraftChange,
}) => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const refreshSettings = useSettingsStore((state) => state.refreshSettings);

  const [providers, setProviders] = useState<SttProvider[]>([]);
  const [models, setModels] = useState<string[] | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [localApiKey, setLocalApiKey] = useState("");
  const [testState, setTestState] = useState<
    | { status: "idle" }
    | { status: "testing" }
    | { status: "ok" }
    | { status: "error"; message: string }
  >({ status: "idle" });

  const providerId = settings?.stt_provider_id ?? "openai";
  const apiKey = settings?.stt_api_keys?.[providerId] ?? "";
  const selectedModel = settings?.stt_models?.[providerId] ?? "";

  useEffect(() => {
    commands.getSttProviders().then(setProviders).catch(console.error);
  }, []);

  // Reset per-provider state when switching providers
  useEffect(() => {
    setModels(null);
    setModelsError(null);
    setLocalApiKey(apiKey);
    setTestState({ status: "idle" });
  }, [providerId]);

  useEffect(() => {
    setLocalApiKey(apiKey);
  }, [apiKey]);

  useEffect(() => {
    onApiKeyDraftChange?.(localApiKey);
  }, [localApiKey, onApiKeyDraftChange]);

  const provider = useMemo(
    () => providers.find((p) => p.id === providerId),
    [providers, providerId],
  );

  const modelOptions = useMemo(() => {
    const list = models ?? provider?.default_models ?? [];
    const merged =
      selectedModel && !list.includes(selectedModel)
        ? [selectedModel, ...list]
        : list;
    return merged.map((m) => ({ value: m, label: m }));
  }, [models, provider, selectedModel]);

  const handleFetchModels = useCallback(async () => {
    setFetchingModels(true);
    setModelsError(null);
    try {
      const result = await commands.fetchSttModels(providerId);
      if (result.status === "ok") {
        setModels(result.data);
      } else {
        setModelsError(result.error);
      }
    } catch (error) {
      setModelsError(String(error));
    } finally {
      setFetchingModels(false);
    }
  }, [providerId]);

  const setProvider = async (id: string) => {
    await commands.changeSttProviderSetting(id);
    await refreshSettings();
  };

  const saveApiKey = async (value: string) => {
    await commands.changeSttApiKeySetting(providerId, value);
    await refreshSettings();
  };

  const setModel = async (model: string) => {
    await commands.changeSttModelSetting(providerId, model);
    await refreshSettings();
  };

  const handleTestConnection = async () => {
    setTestState({ status: "testing" });
    try {
      const result = await commands.testSttConnection();
      if (result.status === "ok") {
        setTestState({ status: "ok" });
      } else {
        setTestState({ status: "error", message: result.error });
      }
    } catch (error) {
      setTestState({ status: "error", message: String(error) });
    }
  };

  return (
    <>
      <SettingContainer
        title={t("settings.models.cloud.provider.label")}
        description={t("settings.models.cloud.provider.description")}
        descriptionMode="tooltip"
        grouped={true}
      >
        <Dropdown
          options={providers.map((p) => ({ value: p.id, label: p.label }))}
          selectedValue={providerId}
          onSelect={(value) => void setProvider(value)}
        />
      </SettingContainer>

      <SettingContainer
        title={t("settings.models.cloud.apiKey.label")}
        description={t("settings.models.cloud.apiKey.description")}
        descriptionMode="tooltip"
        grouped={true}
      >
        <Input
          type="password"
          value={localApiKey}
          onChange={(event) => setLocalApiKey(event.target.value)}
          onBlur={() => void saveApiKey(localApiKey)}
          placeholder={t("settings.models.cloud.apiKey.placeholder")}
          variant="compact"
          className="flex-1 min-w-[280px]"
        />
      </SettingContainer>

      <SettingContainer
        title={t("settings.models.cloud.model.label")}
        description={t("settings.models.cloud.model.description")}
        descriptionMode="tooltip"
        grouped={true}
        layout="stacked"
      >
        <div className="flex items-center gap-2 w-full">
          <div className="flex-1">
            <Select
              value={selectedModel || null}
              options={modelOptions}
              isLoading={fetchingModels}
              isCreatable
              onCreateOption={(value) => void setModel(value)}
              onChange={(value) => {
                if (value) void setModel(value);
              }}
              placeholder={t("settings.models.cloud.model.placeholder")}
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleFetchModels()}
            disabled={fetchingModels}
            title={t("settings.models.cloud.model.refresh")}
          >
            <RefreshCw
              className={`h-4 w-4 ${fetchingModels ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
        {modelsError && (
          <p className="text-xs text-red-400 mt-2">{modelsError}</p>
        )}
      </SettingContainer>

      <SettingContainer
        title={t("settings.models.cloud.test.label")}
        description={t("settings.models.cloud.test.description")}
        descriptionMode="tooltip"
        grouped={true}
      >
        <div className="flex items-center gap-3">
          {testState.status === "ok" && (
            <span className="text-sm text-logo-primary">
              {t("settings.models.cloud.test.success")}
            </span>
          )}
          {testState.status === "error" && (
            <span
              className="text-xs text-red-400 max-w-[280px] truncate"
              title={testState.message}
            >
              {testState.message}
            </span>
          )}
          <Button
            variant="secondary"
            size="md"
            onClick={() => void handleTestConnection()}
            disabled={testState.status === "testing"}
          >
            {testState.status === "testing"
              ? t("settings.models.cloud.test.testing")
              : t("settings.models.cloud.test.button")}
          </Button>
        </div>
      </SettingContainer>
    </>
  );
};

export const CloudTranscription: React.FC = () => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const refreshSettings = useSettingsStore((state) => state.refreshSettings);

  const enabled = settings?.stt_cloud_enabled ?? false;

  const setEnabled = async (value: boolean) => {
    await commands.changeSttCloudEnabledSetting(value);
    await refreshSettings();
  };

  return (
    <SettingsGroup title={t("settings.models.cloud.title")}>
      <ToggleSwitch
        checked={enabled}
        onChange={setEnabled}
        label={t("settings.models.cloud.enable.label")}
        description={t("settings.models.cloud.enable.description")}
        descriptionMode="inline"
        grouped={true}
      />

      {enabled && <CloudTranscriptionForm />}
    </SettingsGroup>
  );
};
