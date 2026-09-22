import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/**
 * Customer-install auto-updates.
 *
 * Dev installs (made by scripts/install.sh from the repo) update by
 * rebuilding from source — that path is `getLocalUpdateStatus` /
 * `runLocalUpdate`. Customer installs (DMG downloads) have no repo, so
 * they poll the public release feed and swap in signed prebuilt
 * archives via the Tauri updater plugin.
 */

export type RemoteProgress = { percent: number; message: string };

/** Returns the pending update, or null when current / offline / dev build. */
export async function checkRemoteUpdate(): Promise<Update | null> {
  try {
    return await check();
  } catch (error) {
    console.warn("Remote update check failed:", error);
    return null;
  }
}

/** Download, verify, install, and relaunch. Progress is 0–100. */
export async function installRemoteUpdate(
  update: Update,
  onProgress: (p: RemoteProgress) => void,
): Promise<void> {
  let total = 0;
  let received = 0;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        onProgress({ percent: 3, message: "Downloading update…" });
        break;
      case "Progress": {
        received += event.data.chunkLength;
        const percent =
          total > 0
            ? Math.min(97, 3 + Math.round((received / total) * 92))
            : 50;
        onProgress({ percent, message: "Downloading update…" });
        break;
      }
      case "Finished":
        onProgress({ percent: 99, message: "Installing…" });
        break;
    }
  });
  await relaunch();
}
