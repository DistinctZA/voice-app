import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Loader2 } from "lucide-react";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { SettingContainer } from "../../ui/SettingContainer";
import { Button } from "../../ui/Button";
import { AppLanguageSelector } from "../AppLanguageSelector";
import {
  commands,
  type LocalUpdateProgress,
  type LocalUpdateStatus,
} from "@/bindings";
import type { Update } from "@tauri-apps/plugin-updater";
import { checkRemoteUpdate, installRemoteUpdate } from "@/lib/remoteUpdater";

export const AboutSettings: React.FC = () => {
  const { t } = useTranslation();
  const [version, setVersion] = useState("");
  const [updateStatus, setUpdateStatus] = useState<LocalUpdateStatus | null>(
    null,
  );
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] =
    useState<LocalUpdateProgress | null>(null);
  const [remoteUpdate, setRemoteUpdate] = useState<Update | null>(null);

  const loadUpdateStatus = useCallback(async () => {
    try {
      const status = await commands.getLocalUpdateStatus();
      setUpdateStatus(status);
      // Customer installs (no source checkout) use the release-feed updater
      if (!status.can_update) {
        setRemoteUpdate(await checkRemoteUpdate());
      }
    } catch (error) {
      console.error("Failed to load update status:", error);
    }
  }, []);

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const appVersion = await getVersion();
        setVersion(appVersion);
      } catch (error) {
        console.error("Failed to get app version:", error);
        setVersion("1.0.0");
      }
    };

    void fetchVersion();
    void loadUpdateStatus();
  }, [loadUpdateStatus]);

  useEffect(() => {
    if (!isUpdating) return;

    let cancelled = false;
    const unlistenPromise = listen<LocalUpdateProgress>(
      "local-update-progress",
      (event) => {
        if (cancelled) return;
        if (event.payload.stage === "failed") {
          setIsUpdating(false);
          setUpdateProgress(null);
          void message(event.payload.message, {
            title: t("settings.about.update.title"),
            kind: "error",
          });
          void loadUpdateStatus();
          return;
        }
        setUpdateProgress(event.payload);
      },
    );

    return () => {
      cancelled = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [isUpdating]);

  const handleRemoteUpdateClick = async () => {
    if (!remoteUpdate || isUpdating) return;
    const confirmed = await ask(
      t("settings.about.update.remoteConfirm", {
        version: remoteUpdate.version,
      }),
      { title: t("settings.about.update.title"), kind: "info" },
    );
    if (!confirmed) return;

    setIsUpdating(true);
    try {
      await installRemoteUpdate(remoteUpdate, (p) =>
        setUpdateProgress({
          percent: p.percent,
          stage: "downloading",
          message: p.message,
        }),
      );
    } catch (error) {
      console.error("Failed to install update:", error);
      await message(String(error), {
        title: t("settings.about.update.title"),
        kind: "error",
      });
      setIsUpdating(false);
      setUpdateProgress(null);
    }
  };

  const handleUpdateClick = async () => {
    if (isUpdating) return;
    if (!updateStatus?.can_update) {
      await handleRemoteUpdateClick();
      return;
    }

    const confirmed = await ask(t("settings.about.update.confirm"), {
      title: t("settings.about.update.title"),
      kind: "info",
    });

    if (!confirmed) return;

    setIsUpdating(true);
    setUpdateProgress({
      percent: 2,
      stage: "preparing",
      message: t("settings.about.update.stages.preparing"),
    });

    try {
      const result = await commands.runLocalUpdate();
      if (result.status === "error") {
        console.error("Failed to start update:", result.error);
        await message(result.error, {
          title: t("settings.about.update.title"),
          kind: "error",
        });
        setIsUpdating(false);
        setUpdateProgress(null);
      }
    } catch (error) {
      console.error("Failed to start update:", error);
      await message(String(error), {
        title: t("settings.about.update.title"),
        kind: "error",
      });
      setIsUpdating(false);
      setUpdateProgress(null);
    }
  };

  const progressMessage =
    updateProgress?.message ??
    (isUpdating ? t("settings.about.update.updating") : null);

  const canLocalUpdate = updateStatus?.can_update ?? false;
  const updateAvailable = canLocalUpdate
    ? (updateStatus?.update_available ?? false)
    : remoteUpdate !== null;

  const updateDescription = isUpdating
    ? (progressMessage ?? t("settings.about.update.updatingDescription"))
    : canLocalUpdate
      ? (updateStatus?.message ?? t("settings.about.update.description"))
      : remoteUpdate
        ? t("settings.about.update.remoteAvailable", {
            version: remoteUpdate.version,
          })
        : t("settings.about.update.remoteUpToDate");

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("settings.about.title")}>
        <AppLanguageSelector descriptionMode="tooltip" grouped={true} />
        <SettingContainer
          title={t("settings.about.version.title")}
          description={t("settings.about.version.description")}
          grouped={true}
        >
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <span className="text-sm font-mono">v{version}</span>
        </SettingContainer>

        <SettingContainer
          title={t("settings.about.update.title")}
          description={updateDescription}
          grouped={true}
          layout="stacked"
        >
          <div className="flex flex-col gap-3 w-full">
            <Button
              variant="primary"
              size="md"
              onClick={handleUpdateClick}
              disabled={(!canLocalUpdate && !remoteUpdate) || isUpdating}
              className="self-start"
            >
              {isUpdating ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("settings.about.update.updating")}
                </span>
              ) : updateAvailable ? (
                t("settings.about.update.buttonAvailable")
              ) : (
                t("settings.about.update.button")
              )}
            </Button>

            {isUpdating && updateProgress && (
              <div className="flex flex-col gap-2 w-full">
                <div className="flex items-center justify-between gap-3 text-xs text-text/60">
                  <span>{updateProgress.message}</span>
                  <span className="tabular-nums">
                    {updateProgress.percent}%
                  </span>
                </div>
                <progress
                  value={updateProgress.percent}
                  max={100}
                  className="w-full h-2 [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-mid-gray/20 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-logo-primary"
                />
                {updateProgress.stage === "closing" && (
                  <p className="text-xs text-text/50">
                    {t("settings.about.update.closingHint")}
                  </p>
                )}
              </div>
            )}
          </div>
        </SettingContainer>

        <SettingContainer
          title={t("settings.about.releases.title")}
          description={t("settings.about.releases.description")}
          grouped={true}
        >
          <Button
            variant="secondary"
            size="md"
            onClick={() =>
              openUrl("https://github.com/DistinctZA/voiceapp-releases/releases")
            }
          >
            {t("settings.about.releases.button")}
          </Button>
        </SettingContainer>
      </SettingsGroup>
    </div>
  );
};
