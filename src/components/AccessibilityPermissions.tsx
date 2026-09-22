import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { platform } from "@tauri-apps/plugin-os";
import {
  checkAccessibilityPermission,
  requestAccessibilityPermission,
  checkMicrophonePermission,
  requestMicrophonePermission,
} from "tauri-plugin-macos-permissions-api";
import { Check, Keyboard, Loader2, Mic } from "lucide-react";
import { commands } from "@/bindings";

type PermissionStatus = "checking" | "needed" | "granted";

interface PermissionsState {
  accessibility: PermissionStatus;
  microphone: PermissionStatus;
}

const AccessibilityPermissions: React.FC = () => {
  const { t } = useTranslation();
  const [permissionPlatform, setPermissionPlatform] = useState<
    "macos" | "windows" | "other" | null
  >(null);
  const [permissions, setPermissions] = useState<PermissionsState>({
    accessibility: "checking",
    microphone: "checking",
  });
  const [isRequestingAccessibility, setIsRequestingAccessibility] =
    useState(false);
  const [needsAccessibilityRetoggle, setNeedsAccessibilityRetoggle] =
    useState(false);
  const servicesReadyRef = useRef(false);

  const isMacOS = permissionPlatform === "macos";
  const isWindows = permissionPlatform === "windows";

  const setupAccessibilityServices = useCallback(async () => {
    const [enigoResult, shortcutsResult] = await Promise.all([
      commands.initializeEnigo(),
      commands.initializeShortcuts(),
    ]);

    const ready =
      enigoResult.status === "ok" && shortcutsResult.status === "ok";

    if (ready) {
      servicesReadyRef.current = true;
      setNeedsAccessibilityRetoggle(false);
    } else {
      setNeedsAccessibilityRetoggle(true);
    }

    return ready;
  }, []);

  const recheckPermissions = useCallback(
    async (setupServices = false) => {
      if (permissionPlatform === "windows") {
        try {
          const microphoneStatus =
            await commands.getWindowsMicrophonePermissionStatus();
          const microphoneGranted =
            !microphoneStatus.supported ||
            microphoneStatus.overall_access !== "denied";
          setPermissions({
            accessibility: "granted",
            microphone: microphoneGranted ? "granted" : "needed",
          });
        } catch {
          setPermissions({ accessibility: "granted", microphone: "needed" });
        }
        return;
      }

      if (permissionPlatform !== "macos") {
        return;
      }

      const [accessibilityGranted, microphoneGranted] = await Promise.all([
        checkAccessibilityPermission(),
        checkMicrophonePermission(),
      ]);

      if (accessibilityGranted) {
        if (setupServices || !servicesReadyRef.current) {
          await setupAccessibilityServices();
        }
      } else {
        servicesReadyRef.current = false;
        setNeedsAccessibilityRetoggle(false);
      }

      setPermissions({
        accessibility: accessibilityGranted ? "granted" : "needed",
        microphone: microphoneGranted ? "granted" : "needed",
      });
    },
    [permissionPlatform, setupAccessibilityServices],
  );

  useEffect(() => {
    const currentPlatform = platform();
    const nextPlatform =
      currentPlatform === "macos"
        ? "macos"
        : currentPlatform === "windows"
          ? "windows"
          : "other";

    setPermissionPlatform(nextPlatform);

    if (nextPlatform === "other") {
      return;
    }

    void recheckPermissions(true);
  }, [recheckPermissions]);

  useEffect(() => {
    if (permissionPlatform !== "macos") {
      return;
    }

    const handleFocus = () => {
      void recheckPermissions(false);
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [permissionPlatform, recheckPermissions]);

  const handleGrantMicrophone = async () => {
    if (isMacOS) {
      try {
        await requestMicrophonePermission();
      } catch (error) {
        console.error("Failed to request microphone permission:", error);
      }
    } else if (isWindows) {
      try {
        await commands.openMicrophonePrivacySettings();
      } catch (error) {
        console.error("Failed to open microphone settings:", error);
      }
    }

    await recheckPermissions(false);
  };

  const handleGrantAccessibility = async () => {
    setIsRequestingAccessibility(true);
    try {
      await requestAccessibilityPermission();
      await recheckPermissions(true);
    } catch (error) {
      console.error("Failed to request accessibility permission:", error);
    } finally {
      setIsRequestingAccessibility(false);
    }
  };

  if (!permissionPlatform || permissionPlatform === "other") {
    return null;
  }

  const renderStatus = (status: PermissionStatus, onGrant: () => void) => {
    if (status === "checking") {
      return (
        <div className="flex items-center gap-2 text-sm text-text/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      );
    }

    if (status === "granted") {
      return (
        <div className="flex items-center gap-2 text-sm text-emerald-400">
          <Check className="h-4 w-4" />
          {t("onboarding.permissions.granted")}
        </div>
      );
    }

    return (
      <button
        type="button"
        onClick={onGrant}
        className="px-3 py-1.5 rounded-lg bg-logo-primary hover:bg-logo-primary/90 text-black text-sm font-medium transition-colors"
      >
        {t("onboarding.permissions.grant")}
      </button>
    );
  };

  return (
    <div className="w-full max-w-3xl rounded-lg border border-mid-gray/30 bg-mid-gray/5 divide-y divide-mid-gray/20">
      <div className="flex items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-full bg-logo-primary/20 shrink-0">
            <Mic className="h-5 w-5 text-logo-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">
              {t("onboarding.permissions.microphone.title")}
            </p>
            <p className="text-xs text-text/60">
              {t("onboarding.permissions.microphone.description")}
            </p>
          </div>
        </div>
        {renderStatus(permissions.microphone, handleGrantMicrophone)}
      </div>

      {isMacOS && (
        <div className="flex items-center justify-between gap-4 p-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-full bg-logo-primary/20 shrink-0">
              <Keyboard className="h-5 w-5 text-logo-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-text">
                {t("onboarding.permissions.accessibility.title")}
              </p>
              <p className="text-xs text-text/60">
                {t("onboarding.permissions.accessibility.description")}
              </p>
              {needsAccessibilityRetoggle && (
                <p className="text-xs text-amber-400/90 mt-2">
                  {t("onboarding.permissions.accessibility.retoggleHint")}
                </p>
              )}
            </div>
          </div>
          {permissions.accessibility === "needed" &&
          isRequestingAccessibility ? (
            <div className="space-y-2 text-end">
              <div className="flex items-center justify-end gap-2 text-sm text-text/50">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("onboarding.permissions.waiting")}
              </div>
              <button
                type="button"
                onClick={() => void recheckPermissions(true)}
                className="px-3 py-1.5 rounded-lg border border-mid-gray/30 hover:bg-mid-gray/10 text-sm font-medium transition-colors"
              >
                {t("onboarding.permissions.checkAgain")}
              </button>
            </div>
          ) : permissions.accessibility === "granted" &&
            needsAccessibilityRetoggle ? (
            <button
              type="button"
              onClick={() => void recheckPermissions(true)}
              className="px-3 py-1.5 rounded-lg border border-mid-gray/30 hover:bg-mid-gray/10 text-sm font-medium transition-colors"
            >
              {t("onboarding.permissions.checkAgain")}
            </button>
          ) : (
            renderStatus(permissions.accessibility, handleGrantAccessibility)
          )}
        </div>
      )}
    </div>
  );
};

export default AccessibilityPermissions;
