import React, { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { ProgressBar } from "../shared";
import { useSettings } from "../../hooks/useSettings";
import {
  commands,
  type LocalUpdateProgress,
  type LocalUpdateStatus,
} from "../../bindings";
import type { Update } from "@tauri-apps/plugin-updater";
import {
  checkRemoteUpdate,
  installRemoteUpdate,
} from "../../lib/remoteUpdater";

interface UpdateCheckerProps {
  className?: string;
}

const UpdateChecker: React.FC<UpdateCheckerProps> = ({ className = "" }) => {
  const { t } = useTranslation();
  const [isChecking, setIsChecking] = useState(false);
  const [status, setStatus] = useState<LocalUpdateStatus | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] =
    useState<LocalUpdateProgress | null>(null);
  const [showUpToDate, setShowUpToDate] = useState(false);
  const [remoteUpdate, setRemoteUpdate] = useState<Update | null>(null);

  const { settings, isLoading } = useSettings();
  const settingsLoaded = !isLoading && settings !== null;
  const updateChecksEnabled = settings?.update_checks_enabled ?? false;

  const upToDateTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const checkForUpdates = useCallback(async (manual: boolean) => {
    setIsChecking(true);
    try {
      const result = await commands.getLocalUpdateStatus();
      setStatus(result);

      // Customer installs (no source checkout): poll the release feed
      let remote: Update | null = null;
      if (!result.can_update) {
        remote = await checkRemoteUpdate();
        setRemoteUpdate(remote);
      }

      if (manual && !result.update_available && remote === null) {
        setShowUpToDate(true);
        if (upToDateTimeoutRef.current) {
          clearTimeout(upToDateTimeoutRef.current);
        }
        upToDateTimeoutRef.current = setTimeout(() => {
          setShowUpToDate(false);
        }, 3000);
      }
    } catch (error) {
      console.error("Failed to check for updates:", error);
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    // Wait for settings to load before doing anything
    if (!settingsLoaded) return;

    if (!updateChecksEnabled) {
      if (upToDateTimeoutRef.current) {
        clearTimeout(upToDateTimeoutRef.current);
      }
      setIsChecking(false);
      setStatus(null);
      setShowUpToDate(false);
      return;
    }

    void checkForUpdates(false);

    // Tray menu "Check for Updates" emits this event
    const updateUnlisten = listen("check-for-updates", () => {
      void checkForUpdates(true);
    });

    // Re-check periodically so customers hear about updates without
    // opening settings (every 4 hours while the app runs)
    const interval = setInterval(
      () => void checkForUpdates(false),
      4 * 60 * 60 * 1000,
    );

    return () => {
      if (upToDateTimeoutRef.current) {
        clearTimeout(upToDateTimeoutRef.current);
      }
      clearInterval(interval);
      updateUnlisten.then((fn) => fn());
    };
  }, [settingsLoaded, updateChecksEnabled, checkForUpdates]);

  useEffect(() => {
    if (!isUpdating) return;

    let cancelled = false;
    const unlistenPromise = listen<LocalUpdateProgress>(
      "local-update-progress",
      (event) => {
        if (cancelled) return;
        if (event.payload.stage === "failed") {
          console.error("Update failed:", event.payload.message);
          setIsUpdating(false);
          setUpdateProgress(null);
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

  const installUpdate = async () => {
    if (isUpdating) return;

    if (!status?.can_update) {
      if (!remoteUpdate) return;
      const ok = await ask(
        t("settings.about.update.remoteConfirm", {
          version: remoteUpdate.version,
        }),
        { title: t("settings.about.update.title"), kind: "info" },
      );
      if (!ok) return;
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
        setIsUpdating(false);
        setUpdateProgress(null);
      }
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
        throw new Error(result.error);
      }
      // The update script quits, reinstalls, and relaunches the app;
      // progress events keep arriving until it closes us.
    } catch (error) {
      console.error("Failed to start update:", error);
      setIsUpdating(false);
      setUpdateProgress(null);
    }
  };

  const getUpdateStatusText = () => {
    if (!updateChecksEnabled) {
      return t("footer.updateCheckingDisabled");
    }
    if (isUpdating) {
      return updateProgress
        ? t("footer.downloading", {
            progress: String(updateProgress.percent).padStart(3),
          })
        : t("settings.about.update.updating");
    }
    if (isChecking) return t("footer.checkingUpdates");
    if (showUpToDate) return t("footer.upToDate");
    if (status?.update_available || remoteUpdate)
      return t("footer.updateAvailableShort");
    return t("footer.checkForUpdates");
  };

  const updateAvailable =
    ((status?.update_available ?? false) || remoteUpdate !== null) &&
    !isUpdating;
  const isUpdateDisabled = !updateChecksEnabled || isChecking || isUpdating;
  const isUpdateClickable = !isUpdateDisabled && !showUpToDate;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {isUpdateClickable ? (
        <button
          onClick={() => {
            if (updateAvailable) {
              void installUpdate();
            } else {
              void checkForUpdates(true);
            }
          }}
          disabled={isUpdateDisabled}
          title={status?.message}
          className={`transition-colors disabled:opacity-50 tabular-nums ${
            updateAvailable
              ? "text-logo-primary hover:text-logo-primary/80 font-medium"
              : "text-text/60 hover:text-text/80"
          }`}
        >
          {getUpdateStatusText()}
        </button>
      ) : (
        <span className="text-text/60 tabular-nums" title={status?.message}>
          {getUpdateStatusText()}
        </span>
      )}

      {isUpdating && updateProgress && (
        <ProgressBar
          progress={[
            {
              id: "update",
              percentage: updateProgress.percent,
            },
          ]}
          size="large"
        />
      )}
    </div>
  );
};

export default UpdateChecker;
