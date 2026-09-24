import type { EventIssue } from "../events/validation";
import {
  deleteAllData,
  type CommandContext,
  type CommandResult,
} from "./commands";
import {
  StorageWriteError,
  type LoadOutcome,
  type UserDataRepository,
} from "./repository";
import {
  executeRestore,
  type RestoreExecution,
  type RestoreMode,
} from "./restore";
import type { MergeOptions } from "./merge";
import { createEmptyUserData, type UserData } from "./schema";

export type LoadNotice = Exclude<LoadOutcome, { kind: "EMPTY" | "LOADED" }>;

export type StoreSnapshot =
  | { phase: "LOADING" }
  | {
      phase: "READY";
      data: UserData;
      notice: LoadNotice | null;
      /** True when the stored document came from a newer app version. */
      readOnly: boolean;
      lastError: string | null;
    };

type ReadySnapshot = Extract<StoreSnapshot, { phase: "READY" }>;

export type Command<T> = (
  data: UserData,
  context: CommandContext,
) => CommandResult<T>;

export type RunResult<T> =
  { ok: true; value: T; data: UserData } | { ok: false; errors: EventIssue[] };

export type StoreRestoreRequest = {
  mode: RestoreMode;
  options?: MergeOptions;
  /** `plan.baseDocumentRevision` of the preview the user confirmed. */
  expectedDocumentRevision: number;
  confirmDestructive?: boolean;
};

const QUARANTINE_IN_PLACE_MESSAGE =
  "읽지 못한 저장본을 따로 보관할 공간이 없어, 그 원본을 지키려고 수정을 막았어요. 원본은 그대로 있어요. 기기 저장 공간을 확보한 뒤 새로고침해 주세요.";

/**
 * Framework-agnostic application store: holds the loaded document in memory,
 * runs pure commands against it, and persists every accepted change through
 * the repository before publishing it. React (or SwiftUI via a JS bridge, or
 * any other UI) only subscribes to snapshots.
 */
export function createUserDataStore(options: {
  repository: UserDataRepository;
  now?: () => Date;
  createId: () => string;
}) {
  const now = options.now ?? (() => new Date());
  let snapshot: StoreSnapshot = { phase: "LOADING" };
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();

  function publish(next: StoreSnapshot) {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  async function persist(data: UserData): Promise<UserData> {
    const next: UserData = {
      ...data,
      documentRevision: data.documentRevision + 1,
      savedAt: now().toISOString(),
    };
    await options.repository.save(next);
    return next;
  }

  async function load() {
    return enqueue(async () => {
      let outcome: LoadOutcome;
      try {
        outcome = await options.repository.load();
      } catch (error) {
        // Storage itself is unavailable (blocked cookies, private mode…).
        // Show an empty, read-only app with the reason instead of hanging.
        publish({
          phase: "READY",
          data: createEmptyUserData(options.createId()),
          notice: null,
          readOnly: true,
          lastError:
            error instanceof Error
              ? `기기 저장소를 열 수 없어요: ${error.message}`
              : "기기 저장소를 열 수 없어요.",
        });
        return;
      }
      let data = outcome.data;
      let lastError: string | null = null;
      if (
        (outcome.kind === "RECOVERED" || outcome.kind === "CORRUPT") &&
        outcome.quarantineInPlace
      ) {
        // Writing now would overwrite the only copy of the unreadable bytes.
        publish({
          phase: "READY",
          data,
          notice: outcome,
          readOnly: true,
          lastError: QUARANTINE_IN_PLACE_MESSAGE,
        });
        return;
      }
      if (outcome.kind === "MIGRATED" || outcome.kind === "RECOVERED") {
        try {
          data = await persist(data);
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
      publish({
        phase: "READY",
        data,
        notice:
          outcome.kind === "EMPTY" || outcome.kind === "LOADED"
            ? null
            : outcome,
        readOnly: outcome.kind === "NEWER_VERSION",
        lastError,
      });
    });
  }

  /** Re-read storage when another tab or window changed it. */
  async function refresh() {
    return enqueue(async () => {
      if (snapshot.phase !== "READY") return;
      let outcome: LoadOutcome;
      try {
        outcome = await options.repository.load();
      } catch {
        return; // Keep showing what we have; the next write reports it.
      }
      if (outcome.kind === "NEWER_VERSION") {
        // Another tab runs a newer app version: stop writing immediately.
        publish({ ...snapshot, notice: outcome, readOnly: true });
        return;
      }
      if (
        (outcome.kind === "LOADED" || outcome.kind === "MIGRATED") &&
        outcome.data.documentRevision > snapshot.data.documentRevision
      ) {
        publish({ ...snapshot, data: outcome.data });
      }
    });
  }

  /**
   * The document the next write must build on: this tab's copy, or a newer
   * one another tab saved. Fails closed when storage cannot be read, holds a
   * newer app version's data, or holds the only copy of unreadable bytes.
   */
  async function writableBase(): Promise<
    { ok: true; base: UserData } | { ok: false; message: string }
  > {
    if (snapshot.phase !== "READY") {
      return { ok: false, message: "아직 데이터를 불러오는 중이에요." };
    }
    if (snapshot.readOnly) {
      return {
        ok: false,
        message:
          snapshot.notice?.kind === "NEWER_VERSION"
            ? "더 새로운 앱 버전에서 저장한 데이터라 이 화면에서는 수정할 수 없어요."
            : (snapshot.lastError ?? "지금은 데이터를 수정할 수 없어요."),
      };
    }

    let stored: LoadOutcome;
    try {
      stored = await options.repository.load();
    } catch {
      return {
        ok: false,
        message:
          "기기 저장소를 읽지 못해 아무것도 바꾸지 않았어요. 브라우저 설정을 확인해 주세요.",
      };
    }
    if (stored.kind === "NEWER_VERSION") {
      publish({ ...snapshot, notice: stored, readOnly: true });
      return {
        ok: false,
        message:
          "다른 탭에서 더 새로운 앱 버전이 데이터를 저장했어요. 덮어쓰지 않도록 수정을 막았어요. 새로고침해 주세요.",
      };
    }
    if (
      (stored.kind === "RECOVERED" || stored.kind === "CORRUPT") &&
      stored.quarantineInPlace
    ) {
      return { ok: false, message: QUARANTINE_IN_PLACE_MESSAGE };
    }

    // Another tab may have written since we loaded; build on the newest.
    let base = snapshot.data;
    if (
      (stored.kind === "LOADED" || stored.kind === "MIGRATED") &&
      stored.data.documentRevision > base.documentRevision
    ) {
      base = stored.data;
    }
    return { ok: true, base };
  }

  function writeError(error: unknown) {
    return error instanceof StorageWriteError || error instanceof Error
      ? error.message
      : "저장하지 못했어요.";
  }

  function run<T>(command: Command<T>): Promise<RunResult<T>> {
    return enqueue(async (): Promise<RunResult<T>> => {
      const ready = await writableBase();
      if (!ready.ok) {
        return {
          ok: false,
          errors: [{ code: "INVALID_FIELD", message: ready.message }],
        };
      }
      const base = ready.base;

      const result = command(base, {
        now: now().toISOString(),
        deviceId: base.deviceId,
        createId: options.createId,
      });
      if (!result.ok) return result;

      try {
        const saved = await persist(result.data);
        publish({
          ...(snapshot as ReadySnapshot),
          data: saved,
          lastError: null,
        });
        return { ok: true, value: result.value, data: saved };
      } catch (error) {
        const message = writeError(error);
        publish({
          ...(snapshot as ReadySnapshot),
          data: base,
          lastError: message,
        });
        return { ok: false, errors: [{ code: "INVALID_FIELD", message }] };
      }
    });
  }

  /**
   * Apply a previewed restore atomically: re-plan against the newest stored
   * document, refuse if it moved since the preview, keep a pre-restore copy
   * before REPLACE, then write the whole document in one save. Any failure
   * leaves the stored document exactly as it was.
   */
  function restore(
    incoming: UserData,
    request: StoreRestoreRequest,
  ): Promise<RestoreExecution> {
    return enqueue(async (): Promise<RestoreExecution> => {
      const ready = await writableBase();
      if (!ready.ok) {
        return { ok: false, code: "READ_ONLY", message: ready.message };
      }
      const base = ready.base;
      const execution = executeRestore(base, incoming, {
        ...request,
        now: now().toISOString(),
        deviceId: base.deviceId,
      });
      if (!execution.ok) return execution;

      if (request.mode === "REPLACE") {
        try {
          await options.repository.preserveBeforeRestore();
        } catch {
          return {
            ok: false,
            code: "PRESERVE_FAILED",
            message:
              "복원 전 현재 데이터를 기기에 따로 보관하지 못해 복원을 멈췄어요. 아무것도 바뀌지 않았어요.",
          };
        }
      }
      try {
        const saved = await persist(execution.data);
        publish({
          ...(snapshot as ReadySnapshot),
          data: saved,
          lastError: null,
        });
        return { ok: true, plan: execution.plan, data: saved };
      } catch (error) {
        const message = writeError(error);
        publish({
          ...(snapshot as ReadySnapshot),
          data: base,
          lastError: message,
        });
        return { ok: false, code: "STORAGE_WRITE_FAILED", message };
      }
    });
  }

  /** Delete all records, then every auxiliary copy kept for recovery. */
  async function wipeAll(): Promise<RunResult<undefined>> {
    const result = await run(deleteAllData);
    if (!result.ok) return result;
    try {
      await options.repository.purgeAuxiliaryCopies();
    } catch {
      return {
        ok: false,
        errors: [
          {
            code: "INVALID_FIELD",
            message:
              "기록은 지웠지만 일부 복구용 사본을 지우지 못했어요. 브라우저 사이트 데이터를 삭제해 주세요.",
          },
        ],
      };
    }
    return result;
  }

  return {
    getSnapshot: () => snapshot,
    wipeAll,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load,
    refresh,
    run,
    restore,
    preserveBeforeRestore: () => options.repository.preserveBeforeRestore(),
    readRaw: (key: string) => options.repository.readRaw(key),
    dismissNotice() {
      if (snapshot.phase === "READY") publish({ ...snapshot, notice: null });
    },
  };
}

export type UserDataStore = ReturnType<typeof createUserDataStore>;
