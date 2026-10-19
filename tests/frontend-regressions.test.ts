import { beforeEach, describe, expect, mock, test } from "bun:test";

const changePtt = mock(
  async (_value: boolean): Promise<unknown> => ({ status: "ok", data: null }),
);
const changeFeedback = mock(
  async (_value: boolean): Promise<unknown> => ({ status: "ok", data: null }),
);
const retry = mock(
  async (_id: number): Promise<unknown> => ({ status: "ok", data: null }),
);
const errorToast = mock((_message: string, _options?: any) => 1);
const successToast = mock((_message: string, _options?: any) => 2);
const loadingToast = mock((_message: string) => 3);
const dismissToast = mock((_id: number) => {});

mock.module("@/bindings", () => ({
  commands: {
    changePttSetting: changePtt,
    changeAudioFeedbackSetting: changeFeedback,
    retryHistoryEntryTranscription: retry,
  },
}));
mock.module("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
mock.module("@/i18n", () => ({ default: { t: (key: string) => key } }));
mock.module("sonner", () => ({
  toast: {
    error: errorToast,
    success: successToast,
    loading: loadingToast,
    dismiss: dismissToast,
  },
}));

const { useSettingsStore } = await import("../src/stores/settingsStore");
const { useNavigationStore } = await import("../src/stores/navigationStore");
const { showTranscriptionError } = await import(
  "../src/lib/transcriptionErrors"
);

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  for (const fn of [changePtt, changeFeedback, retry]) {
    fn.mockReset();
    fn.mockImplementation(async () => ({ status: "ok", data: null }));
  }
  for (const fn of [errorToast, successToast, loadingToast, dismissToast])
    fn.mockClear();
  useSettingsStore.setState({
    settings: {
      bindings: {},
      push_to_talk: false,
      audio_feedback: false,
      external_script_path: null,
    },
    isUpdating: {},
  });
  useNavigationStore.setState({ requestedSection: null });
});

describe("settings persistence failures", () => {
  test("resolved backend errors restore the setting and notify the user", async () => {
    changePtt.mockResolvedValueOnce({
      status: "error",
      error: "Backend refused change",
    });
    await useSettingsStore.getState().updateSetting("push_to_talk", true);
    expect(useSettingsStore.getState().settings?.push_to_talk).toBe(false);
    expect(errorToast.mock.calls[0][1].description).toBe(
      "Backend refused change",
    );
    expect(useSettingsStore.getState().isUpdatingKey("push_to_talk")).toBe(
      false,
    );
  });

  test("a failed update does not undo a different setting saved while waiting", async () => {
    const pending = deferred();
    changePtt.mockReturnValueOnce(pending.promise);
    const update = useSettingsStore
      .getState()
      .updateSetting("push_to_talk", true);
    await useSettingsStore.getState().updateSetting("audio_feedback", true);
    pending.reject(new Error("IPC unavailable"));
    await update;
    expect(useSettingsStore.getState().settings?.push_to_talk).toBe(false);
    expect(useSettingsStore.getState().settings?.audio_feedback).toBe(true);
    expect(errorToast).toHaveBeenCalledTimes(1);
  });

  test("an older failure cannot roll back a newer update or clear its busy state", async () => {
    const older = deferred();
    const newer = deferred();
    changePtt
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const first = useSettingsStore
      .getState()
      .updateSetting("push_to_talk", true);
    const second = useSettingsStore
      .getState()
      .updateSetting("push_to_talk", false);
    older.resolve({ status: "error", error: "Old failure" });
    await first;
    expect(useSettingsStore.getState().settings?.push_to_talk).toBe(false);
    expect(useSettingsStore.getState().isUpdatingKey("push_to_talk")).toBe(
      true,
    );
    newer.resolve({ status: "ok", data: null });
    await second;
    expect(useSettingsStore.getState().isUpdatingKey("push_to_talk")).toBe(
      false,
    );
    expect(errorToast).not.toHaveBeenCalled();
  });

  test("successful settings remain selected", async () => {
    await useSettingsStore.getState().updateSetting("push_to_talk", true);
    expect(useSettingsStore.getState().settings?.push_to_talk).toBe(true);
    expect(errorToast).not.toHaveBeenCalled();
  });
});

describe("transcription recovery", () => {
  test("shows the failure reason and retries the saved recording", async () => {
    showTranscriptionError({
      detail: "Provider timed out",
      history_entry_id: 42,
    });
    const options = errorToast.mock.calls[0][1];
    expect(options.description).toBe("Provider timed out");
    await options.action.onClick();
    expect(retry).toHaveBeenCalledWith(42);
    expect(successToast).toHaveBeenCalledTimes(1);
    expect(useNavigationStore.getState().requestedSection).toBe("history");
  });

  test("does not offer retry when the recording could not be saved", () => {
    showTranscriptionError({
      detail: "Transcription failed",
      history_entry_id: null,
    });
    expect(errorToast.mock.calls[0][1].action).toBeUndefined();
    expect(retry).not.toHaveBeenCalled();
  });

  test("failed retries retain the error reason and another retry action", async () => {
    retry.mockResolvedValueOnce({ status: "error", error: "Invalid API key" });
    showTranscriptionError({
      detail: "Provider timed out",
      history_entry_id: 42,
    });
    await errorToast.mock.calls[0][1].action.onClick();
    expect(dismissToast).toHaveBeenCalledTimes(1);
    expect(errorToast.mock.calls[1][1].description).toBe("Invalid API key");
    expect(errorToast.mock.calls[1][1].action).toBeDefined();
    expect(successToast).not.toHaveBeenCalled();
  });

  test("repeated clicks cannot submit the same retry twice", async () => {
    const pending = deferred();
    retry.mockReturnValueOnce(pending.promise);
    showTranscriptionError({
      detail: "Provider timed out",
      history_entry_id: 42,
    });
    const action = errorToast.mock.calls[0][1].action;
    const first = action.onClick();
    await action.onClick();
    expect(retry).toHaveBeenCalledTimes(1);
    pending.resolve({ status: "ok", data: null });
    await first;
  });
});
