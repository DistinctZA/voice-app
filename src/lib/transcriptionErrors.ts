import { toast } from "sonner";
import i18n from "@/i18n";
import { commands } from "@/bindings";
import { useNavigationStore } from "@/stores/navigationStore";
import type { TranscriptionErrorEvent } from "./types/events";

export function showTranscriptionError(event: TranscriptionErrorEvent) {
  const entryId = event.history_entry_id;
  let retrying = false;
  toast.error(i18n.t("errors.transcriptionFailedTitle"), {
    description: event.detail,
    duration: 10000,
    action:
      entryId === null
        ? undefined
        : {
            label: i18n.t("errors.retryTranscription"),
            onClick: async () => {
              if (retrying) return;
              retrying = true;
              const toastId = toast.loading(
                i18n.t("errors.transcriptionRetrying"),
              );
              try {
                const result =
                  await commands.retryHistoryEntryTranscription(entryId);
                if (result.status === "error") throw new Error(result.error);
                toast.success(i18n.t("errors.transcriptionRetried"), {
                  id: toastId,
                });
                useNavigationStore.getState().openSection("history");
              } catch (error) {
                toast.dismiss(toastId);
                showTranscriptionError({
                  detail:
                    error instanceof Error ? error.message : String(error),
                  history_entry_id: entryId,
                });
              } finally {
                retrying = false;
              }
            },
          },
  });
}
