import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Download } from "lucide-react";
import { useModelStore } from "@/stores/modelStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { useSettings } from "@/hooks/useSettings";
import { useSettingsStore } from "@/stores/settingsStore";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { CloudIcon } from "@/components/icons";
import { getTranslatedModelName } from "@/lib/utils/modelTranslation";
import { commands, type ModelInfo, type SttProvider } from "@/bindings";

export const ActiveModelSelector: React.FC = () => {
  const { t } = useTranslation();
  const { models, currentModel, selectModel } = useModelStore();
  const openSection = useNavigationStore((state) => state.openSection);
  const { settings } = useSettings();
  const refreshSettings = useSettingsStore((state) => state.refreshSettings);
  const [switchingModelId, setSwitchingModelId] = useState<string | null>(null);
  const [providers, setProviders] = useState<SttProvider[]>([]);

  const cloudEnabled = settings?.stt_cloud_enabled ?? false;
  const providerId = settings?.stt_provider_id ?? "";
  const cloudModel = settings?.stt_models?.[providerId] ?? "";
  const cloudKeyConfigured =
    (settings?.stt_api_keys?.[providerId] ?? "").trim().length > 0;

  useEffect(() => {
    commands.getSttProviders().then(setProviders).catch(console.error);
  }, []);

  const providerLabel = useMemo(
    () => providers.find((p) => p.id === providerId)?.label ?? providerId,
    [providers, providerId],
  );

  const downloadedModels = useMemo(
    () => models.filter((model: ModelInfo) => model.is_downloaded),
    [models],
  );

  // Show the cloud entry when it's active or ready to activate (key saved)
  const showCloudEntry = cloudEnabled || cloudKeyConfigured;

  const handleSelectLocal = async (modelId: string) => {
    if (modelId === currentModel && !cloudEnabled) return;
    setSwitchingModelId(modelId);
    try {
      if (cloudEnabled) {
        await commands.changeSttCloudEnabledSetting(false);
        await refreshSettings();
      }
      if (modelId !== currentModel) {
        await selectModel(modelId);
      }
    } finally {
      setSwitchingModelId(null);
    }
  };

  const handleSelectCloud = async () => {
    if (cloudEnabled) return;
    setSwitchingModelId("cloud");
    try {
      await commands.changeSttCloudEnabledSetting(true);
      await refreshSettings();
    } finally {
      setSwitchingModelId(null);
    }
  };

  const rowClasses = (isActive: boolean) =>
    `w-full flex items-center justify-between rounded-lg border px-3 py-2.5 text-start transition-colors ${
      isActive
        ? "border-logo-primary bg-logo-primary/10"
        : "border-mid-gray/30 hover:border-mid-gray/50 hover:bg-mid-gray/5"
    }`;

  return (
    <SettingsGroup title={t("settings.activeModel.title")}>
      <div className="px-4 py-3 space-y-3">
        <p className="text-sm text-text/60">
          {t("settings.activeModel.description")}
        </p>

        {showCloudEntry && (
          <button
            type="button"
            onClick={() => void handleSelectCloud()}
            disabled={switchingModelId === "cloud"}
            className={rowClasses(cloudEnabled)}
          >
            <div className="flex items-center gap-2.5">
              <CloudIcon width={18} height={18} className="shrink-0" />
              <div>
                <div className="text-sm font-medium text-text/90">
                  {t("settings.models.cloud.activeBadge")} · {providerLabel}
                </div>
                <div className="text-[10px] uppercase text-text/40">
                  {cloudModel}
                </div>
              </div>
            </div>
            <div className="text-xs text-text/50">
              {switchingModelId === "cloud"
                ? t("modelSelector.switching")
                : cloudEnabled
                  ? t("modelSelector.active")
                  : t("settings.activeModel.useModel")}
            </div>
          </button>
        )}

        {downloadedModels.length > 0 ? (
          <div className="space-y-2">
            {downloadedModels.map((model) => {
              const isActive = !cloudEnabled && model.id === currentModel;
              const isSwitching = switchingModelId === model.id;

              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => void handleSelectLocal(model.id)}
                  disabled={isSwitching}
                  className={rowClasses(isActive)}
                >
                  <div>
                    <div className="text-sm font-medium text-text/90">
                      {getTranslatedModelName(model, t)}
                    </div>
                    {model.is_custom && (
                      <div className="text-[10px] uppercase text-text/40">
                        {t("modelSelector.custom")}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-text/50">
                    {isSwitching
                      ? t("modelSelector.switching")
                      : isActive
                        ? t("modelSelector.active")
                        : t("settings.activeModel.useModel")}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-mid-gray/40 px-3 py-4 text-sm text-text/50">
            {t("settings.activeModel.noDownloadedModels")}
          </div>
        )}

        <button
          type="button"
          onClick={() => openSection("models")}
          className="flex w-full items-center justify-between rounded-lg border border-mid-gray/30 px-3 py-2.5 text-sm text-text/80 transition-colors hover:bg-mid-gray/5"
        >
          <span className="flex items-center gap-2">
            <Download className="h-4 w-4 text-logo-primary" />
            {t("settings.activeModel.browseModels")}
          </span>
          <ChevronRight className="h-4 w-4 text-text/40" />
        </button>
      </div>
    </SettingsGroup>
  );
};
