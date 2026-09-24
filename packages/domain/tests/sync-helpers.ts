import {
  STORAGE_KEYS,
  createMemoryStorage,
  createSyncEngine,
  createSyncStateStore,
  createUserDataRepository,
  createUserDataStore,
  type CommandContext,
  type CommandResult,
  type MemorySyncServer,
  type SyncDiagnostic,
  type SyncEngine,
  type UserData,
  type WriteLock,
} from "../src";
import { sequentialIds } from "./helpers";

/** A promise-chain mutex standing in for Web Locks in tests. */
export function mutex(): WriteLock {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>) => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

export type Clock = { now: () => Date; tick: (ms?: number) => void };

export function clock(start = "2026-09-24T00:00:00.000Z"): Clock {
  let time = Date.parse(start);
  return {
    now: () => new Date(time),
    tick: (ms = 60_000) => {
      time += ms;
    },
  };
}

let instances = 0;

export type Installation = ReturnType<typeof installation>;

/**
 * One browser installation: local storage, the local store, and (once signed
 * in) a sync engine talking to the shared in-memory server.
 */
export function installation(
  server: MemorySyncServer,
  name: string,
  options: {
    seed?: UserData;
    storage?: ReturnType<typeof createMemoryStorage>;
    dataLock?: WriteLock;
    syncLock?: WriteLock;
    time?: Clock;
  } = {},
) {
  const storage = options.storage ?? createMemoryStorage();
  if (options.seed) {
    void storage.setItem(
      STORAGE_KEYS.current,
      JSON.stringify({ ...options.seed, deviceId: name }),
    );
  }
  const time = options.time ?? clock();
  // Every installation (and every tab) gets its own id sequence, as random
  // UUIDs would.
  const createId = sequentialIds(`${name}-${++instances}`);
  const store = createUserDataStore({
    repository: createUserDataRepository(storage, {
      now: () => time.now().toISOString(),
      createId,
    }),
    now: time.now,
    createId,
    writeLock: options.dataLock,
  });
  const diagnostics: SyncDiagnostic[] = [];
  let engine: SyncEngine | null = null;

  const self = {
    name,
    storage,
    store,
    time,
    diagnostics,
    async load() {
      await store.load();
      return self;
    },
    data(): UserData {
      const snapshot = store.getSnapshot();
      if (snapshot.phase !== "READY") throw new Error("not loaded");
      return snapshot.data;
    },
    /** Run a domain command locally; throws if it fails. */
    async act<T>(
      command: (data: UserData, context: CommandContext) => CommandResult<T>,
    ): Promise<T> {
      const result = await store.run(command);
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      engine?.notifyLocalChange();
      time.tick();
      return result.value;
    },
    signIn(userId: string) {
      engine = createSyncEngine({
        userId,
        store,
        transport: server.transport(userId),
        state: createSyncStateStore(storage, userId),
        now: time.now,
        lock: options.syncLock,
        diagnostics: (event) => diagnostics.push(event),
      });
      return engine;
    },
    /** Sign out: drop the engine. Local data and checkpoint stay. */
    signOut() {
      engine = null;
    },
    get engine(): SyncEngine {
      if (!engine) throw new Error(`${name} is not signed in`);
      return engine;
    },
    /** Sign in and turn sync on after looking at the preview. */
    async enable(userId: string) {
      const sync = self.signIn(userId);
      await sync.init();
      const preview = await sync.previewEnable();
      if (preview.kind !== "READY") {
        throw new Error(`preview not ready: ${preview.kind}`);
      }
      return { preview, status: await sync.enable(preview) };
    },
  };
  return self;
}

/** Records of a document without per-device metadata, for convergence checks. */
export function records(data: UserData) {
  return JSON.parse(
    JSON.stringify({
      profile: data.profile,
      events: [...data.events].sort((a, b) => a.id.localeCompare(b.id)),
      leaveAdjustments: [...data.leaveAdjustments].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
      leaveSnapshots: [...data.leaveSnapshots].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
      imports: [...data.imports].sort((a, b) => a.id.localeCompare(b.id)),
      attendanceMonths: [...data.attendanceMonths].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
      compensationSnapshots: [...data.compensationSnapshots].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
    }),
  ) as unknown;
}

export function recordCount(data: UserData) {
  return (
    (data.profile ? 1 : 0) +
    data.events.length +
    data.leaveAdjustments.length +
    data.leaveSnapshots.length +
    data.imports.length +
    data.attendanceMonths.length +
    data.compensationSnapshots.length
  );
}
