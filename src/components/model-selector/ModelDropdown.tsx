import React from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Download } from "lucide-react";
import type { ModelInfo } from "@/bindings";
import {
  getTranslatedModelName,
  getTranslatedModelDescription,
} from "../../lib/utils/modelTranslation";
import { useNavigationStore } from "@/stores/navigationStore";

interface ModelDropdownProps {
  models: ModelInfo[];
  currentModelId: string;
  onModelSelect: (modelId: string) => void;
}

const ModelDropdown: React.FC<ModelDropdownProps> = ({
  models,
  currentModelId,
  onModelSelect,
}) => {
  const { t } = useTranslation();
  const openSection = useNavigationStore((state) => state.openSection);
  const downloadedModels = models.filter((m) => m.is_downloaded);

  const handleModelClick = (modelId: string) => {
    onModelSelect(modelId);
  };

  return (
    <div className="absolute bottom-full start-0 mb-2 w-64 max-h-[60vh] overflow-y-auto bg-background border border-mid-gray/20 rounded-lg shadow-lg py-2 z-50">
      {downloadedModels.length > 0 ? (
        <div>
          {downloadedModels.map((model) => (
            <div
              key={model.id}
              onClick={() => handleModelClick(model.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleModelClick(model.id);
                }
              }}
              tabIndex={0}
              role="button"
              className={`w-full px-3 py-2 text-start hover:bg-mid-gray/10 transition-colors cursor-pointer focus:outline-none ${
                currentModelId === model.id
                  ? "bg-logo-primary/10 text-logo-primary"
                  : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-text/80">
                    {getTranslatedModelName(model, t)}
                    {model.is_custom && (
                      <span className="ms-1.5 text-[10px] font-medium text-text/40 uppercase">
                        {t("modelSelector.custom")}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-text/40 italic pe-4">
                    {getTranslatedModelDescription(model, t)}
                  </div>
                </div>
                {currentModelId === model.id && (
                  <div className="text-xs text-logo-primary">
                    {t("modelSelector.active")}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div className="border-t border-mid-gray/20 mt-1 pt-1 px-1">
            <button
              type="button"
              onClick={() => openSection("models")}
              className="flex w-full items-center justify-between rounded-md px-2 py-2 text-sm text-text/70 hover:bg-mid-gray/10"
            >
              <span className="flex items-center gap-2">
                <Download className="h-3.5 w-3.5 text-logo-primary" />
                {t("modelSelector.browseModels")}
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-text/40" />
            </button>
          </div>
        </div>
      ) : (
        <div className="py-1">
          <div className="px-3 py-2 text-sm text-text/60">
            {t("modelSelector.noModelsAvailable")}
          </div>
          <div className="border-t border-mid-gray/20 mt-1 pt-1 px-1">
            <button
              type="button"
              onClick={() => openSection("models")}
              className="flex w-full items-center justify-between rounded-md px-2 py-2 text-sm text-text/70 hover:bg-mid-gray/10"
            >
              <span className="flex items-center gap-2">
                <Download className="h-3.5 w-3.5 text-logo-primary" />
                {t("modelSelector.browseModels")}
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-text/40" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModelDropdown;
