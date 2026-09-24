import { describe, expect, it } from "vitest";

import {
  ConcurrentWriteError,
  STORAGE_KEYS,
  createMemoryStorage,
  createServiceEvent,
  createUserDataRepository,
  createUserDataStore,
  isLive,
  type KeyValueStorage,
  type UserData,
  type UserDataStore,
  type WriteLock,
} from "../src";
import { fullDocument } from "./fixtures";
import { allDay, sequentialIds, userDataWithProfile } from "./helpers";

const NOW = "2026-09-24T07:00:00.000Z";

/** An exclusive lock shared by several stores, like one origin's Web Locks. */
function sharedLock(): WriteLock {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>) => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
}

/**
 * One backing map seen through per-tab views. Every operation yields to the
 * timer queue first, so two tabs' async steps interleave in a fixed order
 * (Node runs zero-delay timers FIFO) — as far apart as a real browser can.
 */
function sharedStorage(initial: Record<string, string> = {}) {
  const inner = createMemoryStorage(initial);
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const view = (): KeyValueStorage => ({
    async getItem(key) {
      await tick();
      return inner.getItem(key);
    },
    async setItem(key, value) {
      await tick();
      return inner.setItem(key, value);
    },
    async removeItem(key) {
      await tick();
      return inner.removeItem(key);
    },
    keys: () => inner.keys!(),
  });
  return { inner, view };
}

/** A view that stops after its next read of the live document until released. */
function pausingView(base: KeyValueStorage) {
  let pauseNext = false;
  let release: () => void = () => undefined;
  let reached: () => void = () => undefined;
  const view: KeyValueStorage = {
    ...base,
    async getItem(key) {
      const value = await base.getItem(key);
      if (pauseNext && key === STORAGE_KEYS.current) {
        pauseNext = false;
        reached();
        await new Promise<void>((resolve) => (release = resolve));
      }
      return value;
    },
  };
  return {
    view,
    /** Pause after the next read; resolves once that read happened. */
    arm() {
      pauseNext = true;
      return new Promise<void>((resolve) => (reached = resolve));
    },
    release: () => release(),
  };
}

function openStore(
  storage: KeyValueStorage,
  name: string,
  writeLock?: WriteLock,
) {
  const createId = sequentialIds(name);
  return createUserDataStore({
    repository: createUserDataRepository(storage, { now: () => NOW, createId }),
    now: () => new Date(NOW),
    createId,
    writeLock,
  });
}

function ready(store: UserDataStore): UserData {
  const snapshot = store.getSnapshot();
  if (snapshot.phase !== "READY") throw new Error("not ready");
  return snapshot.data;
}

const seed = () =>
  JSON.stringify({ ...userDataWithProfile(), documentRevision: 4 });

const addLeave =
  (date: string) =>
  (data: UserData, ctx: Parameters<Parameters<UserDataStore["run"]>[0]>[1]) =>
    createServiceEvent(data, allDay("ANNUAL_LEAVE", date), ctx);

function storedEvents(inner: ReturnType<typeof createMemoryStorage>) {
  const doc = JSON.parse(inner.dump()[STORAGE_KEYS.current]!) as UserData;
  return {
    revision: doc.documentRevision,
    dates: doc.events
      .filter(isLive)
      .map((event) => event.startDate)
      .sort(),
  };
}

describe("two tabs writing at the same time", () => {
  it("with the shared write lock, simultaneous writes from the same revision both survive", async () => {
    const { inner, view } = sharedStorage({ [STORAGE_KEYS.current]: seed() });
    const lock = sharedLock();
    const tabA = openStore(view(), "a", lock);
    const tabB = openStore(view(), "b", lock);
    await Promise.all([tabA.load(), tabB.load()]);
    expect(ready(tabA).documentRevision).toBe(ready(tabB).documentRevision);

    const [a, b] = await Promise.all([
      tabA.run(addLeave("2026-09-10")),
      tabB.run(addLeave("2026-09-11")),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(storedEvents(inner)).toEqual({
      revision: 6,
      dates: ["2026-09-10", "2026-09-11"],
    });
  });

  it("the same interleaving without any lock is exactly the race the lock closes", async () => {
    // Documents the residual risk on browsers without Web Locks: both tabs
    // pass the compare-and-set before either writes, and one change is lost.
    const { inner, view } = sharedStorage({ [STORAGE_KEYS.current]: seed() });
    const tabA = openStore(view(), "a");
    const tabB = openStore(view(), "b");
    await Promise.all([tabA.load(), tabB.load()]);
    await Promise.all([
      tabA.run(addLeave("2026-09-10")),
      tabB.run(addLeave("2026-09-11")),
    ]);
    expect(storedEvents(inner).dates).toHaveLength(1);
  });

  it("without a lock, compare-and-set still catches a write that landed after the base was read, and the command is re-run on the newer base", async () => {
    const { inner, view } = sharedStorage({ [STORAGE_KEYS.current]: seed() });
    const paused = pausingView(view());
    const tabA = openStore(paused.view, "a");
    const tabB = openStore(view(), "b");
    await Promise.all([tabA.load(), tabB.load()]);

    // Tab A reads revision 4 as its base, then stalls before writing.
    const reached = paused.arm();
    const pending = tabA.run(addLeave("2026-09-10"));
    await reached;
    // Tab B writes revision 5 meanwhile.
    expect((await tabB.run(addLeave("2026-09-11"))).ok).toBe(true);
    paused.release();

    const result = await pending;
    expect(result.ok).toBe(true);
    expect(storedEvents(inner)).toEqual({
      revision: 6,
      dates: ["2026-09-10", "2026-09-11"],
    });
  });

  it("the repository refuses a stale base outright", async () => {
    const storage = createMemoryStorage({ [STORAGE_KEYS.current]: seed() });
    const repo = createUserDataRepository(storage, {
      now: () => NOW,
      createId: sequentialIds("r"),
    });
    const before = storage.dump();
    await expect(
      repo.save(
        { ...userDataWithProfile(), documentRevision: 4 },
        { expectedRevision: 3 },
      ),
    ).rejects.toBeInstanceOf(ConcurrentWriteError);
    expect(storage.dump()).toEqual(before);
  });
});

describe("restore racing another tab", () => {
  it("a write landing between re-plan and save turns the restore into STALE_PREVIEW and keeps the other tab's write", async () => {
    const { inner, view } = sharedStorage({
      [STORAGE_KEYS.current]: JSON.stringify({
        ...fullDocument(),
        documentRevision: 4,
      }),
    });
    const paused = pausingView(view());
    const tabA = openStore(paused.view, "a");
    const tabB = openStore(view(), "b");
    await Promise.all([tabA.load(), tabB.load()]);
    const previewedAt = ready(tabA).documentRevision;

    const reached = paused.arm();
    const restoring = tabA.restore(fullDocument(), {
      mode: "REPLACE",
      expectedDocumentRevision: previewedAt,
      confirmDestructive: true,
    });
    await reached; // tab A re-read revision 4 and re-planned against it
    expect((await tabB.run(addLeave("2026-10-20"))).ok).toBe(true);
    const afterB = inner.dump()[STORAGE_KEYS.current];
    paused.release();

    expect(await restoring).toMatchObject({ ok: false, code: "STALE_PREVIEW" });
    expect(inner.dump()[STORAGE_KEYS.current]).toBe(afterB);
  });

  it("with the shared lock, a restore and a write are serialized and the restore reports the stale preview", async () => {
    const { inner, view } = sharedStorage({
      [STORAGE_KEYS.current]: JSON.stringify({
        ...fullDocument(),
        documentRevision: 4,
      }),
    });
    const lock = sharedLock();
    const tabA = openStore(view(), "a", lock);
    const tabB = openStore(view(), "b", lock);
    await Promise.all([tabA.load(), tabB.load()]);

    const [write, restore] = await Promise.all([
      tabB.run(addLeave("2026-10-20")),
      tabA.restore(fullDocument(), {
        mode: "REPLACE",
        expectedDocumentRevision: 4,
        confirmDestructive: true,
      }),
    ]);
    expect(write.ok).toBe(true);
    expect(restore).toMatchObject({ ok: false, code: "STALE_PREVIEW" });
    expect(storedEvents(inner).dates).toContain("2026-10-20");
  });
});
