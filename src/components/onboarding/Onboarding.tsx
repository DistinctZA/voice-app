import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { commands, type ModelInfo } from "@/bindings";
import type { ModelCardStatus } from "./ModelCard";
import ModelCard from "./ModelCard";
import VoiceAppTextLogo from "../icons/VoiceAppTextLogo";
import { CloudIcon } from "../icons";
import { CloudTranscriptionForm } from "../settings/CloudTranscription";
import { Button } from "../ui/Button";
import {
  isCatalogModel,
  sortModelsByQuality,
} from "../../lib/constants/models";
import { useModelStore } from "../../stores/modelStore";
import { useSettings } from "../../hooks/useSettings";

interface OnboardingProps {
  onModelSelected: () => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ onModelSelected }) => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [mode, setMode] = useState<"local" | "cloud">("local");
  const [cloudApiKeyDraft, setCloudApiKeyDraft] = useState("");
  const [finishingCloudSetup, setFinishingCloudSetup] = useState(false);
  const {
    models,
    downloadModel,
    selectModel,
    downloadingModels,
    verifyingModels,
    extractingModels,
    downloadProgress,
    downloadStats,
  } = useModelStore();
  const catalogModels = models.filter(isCatalogModel);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  const isDownloading = selectedModelId !== null;

  // Watch for the selected model to finish downloading + verifying + extracting
  useEffect(() => {
    if (!selectedModelId) return;

    const model = models.find((m) => m.id === selectedModelId);
    const stillDownloading = selectedModelId in downloadingModels;
    const stillVerifying = selectedModelId in verifyingModels;
    const stillExtracting = selectedModelId in extractingModels;

    if (
      model?.is_downloaded &&
      !stillDownloading &&
      !stillVerifying &&
      !stillExtracting
    ) {
      // Model is ready — select it and transition
      selectModel(selectedModelId).then((success) => {
        if (success) {
          onModelSelected();
        } else {
          toast.error(t("onboarding.errors.selectModel"));
          setSelectedModelId(null);
        }
      });
    }
  }, [
    selectedModelId,
    models,
    downloadingModels,
    verifyingModels,
    extractingModels,
    selectModel,
    onModelSelected,
  ]);

  const handleDownloadModel = async (modelId: string) => {
    setSelectedModelId(modelId);

    // Error toast is handled centrally by the model-download-failed event listener
    // in modelStore — no toast here to avoid duplicates.
    const success = await downloadModel(modelId);
    if (!success) {
      setSelectedModelId(null);
    }
  };

  const getModelStatus = (modelId: string): ModelCardStatus => {
    if (modelId in extractingModels) return "extracting";
    if (modelId in verifyingModels) return "verifying";
    if (modelId in downloadingModels) return "downloading";
    return "downloadable";
  };

  const getModelDownloadProgress = (modelId: string): number | undefined => {
    return downloadProgress[modelId]?.percentage;
  };

  const getModelDownloadSpeed = (modelId: string): number | undefined => {
    return downloadStats[modelId]?.speed;
  };

  const handleCloudContinue = async () => {
    setFinishingCloudSetup(true);
    try {
      const providerId = settings?.stt_provider_id ?? "openai";
      const trimmedKey = cloudApiKeyDraft.trim();
      // The form saves on blur, but save explicitly so clicking Continue
      // right after typing the key can't race the blur handler.
      if (trimmedKey) {
        const saved = await commands.changeSttApiKeySetting(
          providerId,
          trimmedKey,
        );
        if (saved.status === "error") throw new Error(saved.error);
      }
      const enabled = await commands.changeSttCloudEnabledSetting(true);
      if (enabled.status === "error") throw new Error(enabled.error);
      onModelSelected();
    } catch (error) {
      console.error("Failed to enable cloud transcription:", error);
      toast.error(t("onboarding.cloud.errors.enable"));
      setFinishingCloudSetup(false);
    }
  };

  if (mode === "cloud") {
    return (
      <div className="h-screen w-screen flex flex-col p-6 gap-4 inset-0">
        <div className="flex flex-col items-center gap-2 shrink-0">
          <VoiceAppTextLogo width={200} />
          <p className="text-text/70 max-w-md font-medium mx-auto">
            {t("onboarding.cloud.subtitle")}
          </p>
        </div>

        <div className="max-w-[600px] w-full mx-auto flex-1 flex flex-col min-h-0 overflow-y-auto">
          <div className="flex flex-col gap-4 pb-6 text-left">
            <div className="rounded-xl border-2 border-mid-gray/20 divide-y divide-mid-gray/20">
              <CloudTranscriptionForm
                onApiKeyDraftChange={setCloudApiKeyDraft}
              />
            </div>
            <p className="text-xs text-text/50">
              {t("onboarding.cloud.privacyNote")}
            </p>

            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="md"
                onClick={() => setMode("local")}
                className="flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" />
                {t("onboarding.cloud.backToLocal")}
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={() => void handleCloudContinue()}
                disabled={
                  cloudApiKeyDraft.trim().length === 0 || finishingCloudSetup
                }
              >
                {finishingCloudSetup
                  ? t("onboarding.cloud.finishing")
                  : t("onboarding.cloud.continue")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col p-6 gap-4 inset-0">
      <div className="flex flex-col items-center gap-2 shrink-0">
        <VoiceAppTextLogo width={200} />
        <p className="text-text/70 max-w-md font-medium mx-auto">
          {t("onboarding.subtitle")}
        </p>
      </div>

      <div className="max-w-[600px] w-full mx-auto text-center flex-1 flex flex-col min-h-0">
        <div className="flex flex-col gap-4 pb-6">
          {catalogModels
            .filter((m: ModelInfo) => !m.is_downloaded)
            .filter((model: ModelInfo) => model.is_recommended)
            .map((model: ModelInfo) => (
              <ModelCard
                key={model.id}
                model={model}
                variant="featured"
                status={getModelStatus(model.id)}
                disabled={isDownloading}
                onSelect={handleDownloadModel}
                onDownload={handleDownloadModel}
                downloadProgress={getModelDownloadProgress(model.id)}
                downloadSpeed={getModelDownloadSpeed(model.id)}
              />
            ))}

          {sortModelsByQuality(
            catalogModels
              .filter((m: ModelInfo) => !m.is_downloaded)
              .filter((model: ModelInfo) => !model.is_recommended),
          ).map((model: ModelInfo) => (
            <ModelCard
              key={model.id}
              model={model}
              status={getModelStatus(model.id)}
              disabled={isDownloading}
              onSelect={handleDownloadModel}
              onDownload={handleDownloadModel}
              downloadProgress={getModelDownloadProgress(model.id)}
              downloadSpeed={getModelDownloadSpeed(model.id)}
            />
          ))}

          <div className="flex items-center gap-3 text-xs text-text/40 uppercase tracking-wide">
            <hr className="flex-1 border-mid-gray/20" />
            {t("onboarding.cloud.divider")}
            <hr className="flex-1 border-mid-gray/20" />
          </div>

          <button
            type="button"
            onClick={() => setMode("cloud")}
            disabled={isDownloading}
            className={`flex items-center gap-3 rounded-xl border-2 border-mid-gray/20 px-4 py-3 text-left transition-all duration-200 ${
              isDownloading
                ? "opacity-50 cursor-not-allowed"
                : "cursor-pointer hover:border-logo-primary/50 hover:bg-logo-primary/5 hover:shadow-lg hover:scale-[1.01] active:scale-[0.99] group"
            }`}
          >
            <CloudIcon width={28} height={28} className="shrink-0" />
            <div className="flex flex-col flex-1 min-w-0">
              <h3 className="text-base font-semibold text-text group-hover:text-logo-primary transition-colors">
                {t("onboarding.cloud.cardTitle")}
              </h3>
              <p className="text-text/60 text-sm leading-relaxed">
                {t("onboarding.cloud.cardDescription")}
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-text/40 shrink-0" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
