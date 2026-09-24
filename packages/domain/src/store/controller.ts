import type { EventIssue } from "../events/validation";
import type { CommandContext, CommandResult } from "./commands";
import {
  StorageWriteError,
  type LoadOutcome,
  type UserDataRepository,
} from "./repository";
import type { UserData } from "./schema";

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

export type Command<T> = (
  data: UserData,
  context: CommandContext,
) => CommandResult<T>;

export type RunResult<T> =
  { ok: true; value: T; data: UserData } | { ok: false; errors: EventIssue[] };

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
      const outcome = await options.repository.load();
      let data = outcome.data;
      let lastError: string | null = null;
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
      const outcome = await options.repository.load();
      if (
        (outcome.kind === "LOADED" || outcome.kind === "MIGRATED") &&
        outcome.data.documentRevision > snapshot.data.documentRevision
      ) {
        publish({ ...snapshot, data: outcome.data });
      }
    });
  }

  function run<T>(command: Command<T>): Promise<RunResult<T>> {
    return enqueue(async (): Promise<RunResult<T>> => {
      if (snapshot.phase !== "READY") {
        return {
          ok: false,
          errors: [
            {
              code: "INVALID_FIELD",
              message: "아직 데이터를 불러오는 중이에요.",
            },
          ],
        };
      }
      if (snapshot.readOnly) {
        return {
          ok: false,
          errors: [
            {
              code: "INVALID_FIELD",
              message:
                "더 새로운 앱 버전에서 저장한 데이터라 이 화면에서는 수정할 수 없어요.",
            },
          ],
        };
      }

      // Another tab may have written since we loaded; build on the newest.
      let base = snapshot.data;
      const stored = await options.repository.load();
      if (
        (stored.kind === "LOADED" || stored.kind === "MIGRATED") &&
        stored.data.documentRevision > base.documentRevision
      ) {
        base = stored.data;
      }

      const result = command(base, {
        now: now().toISOString(),
        deviceId: base.deviceId,
        createId: options.createId,
      });
      if (!result.ok) return result;

      try {
        const saved = await persist(result.data);
        publish({ ...snapshot, data: saved, lastError: null });
        return { ok: true, value: result.value, data: saved };
      } catch (error) {
        const message =
          error instanceof StorageWriteError || error instanceof Error
            ? error.message
            : "저장하지 못했어요.";
        publish({ ...snapshot, data: base, lastError: message });
        return { ok: false, errors: [{ code: "INVALID_FIELD", message }] };
      }
    });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load,
    refresh,
    run,
    preserveBeforeRestore: () => options.repository.preserveBeforeRestore(),
    readRaw: (key: string) => options.repository.readRaw(key),
    dismissNotice() {
      if (snapshot.phase === "READY") publish({ ...snapshot, notice: null });
    },
  };
}

export type UserDataStore = ReturnType<typeof createUserDataStore>;
