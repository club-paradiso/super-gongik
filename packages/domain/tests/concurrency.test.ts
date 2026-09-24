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
import { allDay, sequentialIds, userDataWithProfile } from "./helpers";

const NOW = "2026-09-24T07:00:00.000Z";
const N = 4; // documentRevision every scenario starts from

/** An exclusive lock shared by several stores, like one origin's Web Locks. */
function sharedLock(): WriteLock {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>) => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
}

type Op = "read" | "commit";

/**
 * One backing store seen by several tabs. Each tab's view can be told to
 * stop right before its next read of, or commit to, the live document, so a
 * race is forced step by step with promises — no timers, no sleeps.
 */
function controlledStorage(options: { atomicCompareAndSet: boolean }) {
  const inner = createMemoryStorage({
    [STORAGE_KEYS.current]: JSON.stringify({
      ...userDataWithProfile(),
      documentRevision: N,
    }),
  });
  const log: string[] = [];
  const gates = new Map<string, { reached: () => void; wait: Promise<void> }>();

  async function checkpoint(tab: string, op: Op) {
    log.push(`${tab}:${op}`);
    const gate = gates.get(`${tab}:${op}`);
    if (!gate) return;
    gates.delete(`${tab}:${op}`);
    gate.reached();
    await gate.wait;
  }

  function view(tab: string): KeyValueStorage {
    const storage: KeyValueStorage = {
      async getItem(key) {
        if (key === STORAGE_KEYS.current) await checkpoint(tab, "read");
        return inner.getItem(key);
      },
      async setItem(key, value) {
        if (key === STORAGE_KEYS.current) await checkpoint(tab, "commit");
        return inner.setItem(key, value);
      },
      removeItem: (key) => inner.removeItem(key),
      keys: () => inner.keys!(),
    };
    if (options.atomicCompareAndSet) {
      storage.compareAndSet = async (key, expected, value) => {
        if (key === STORAGE_KEYS.current) await checkpoint(tab, "commit");
        return inner.compareAndSet!(key, expected, value);
      };
    }
    return storage;
  }

  /** Stop `tab` before its next `op`; resolves when it got there. */
  function pause(tab: string, op: Op) {
    let release: () => void = () => undefined;
    let reached: () => void = () => undefined;
    const arrived = new Promise<void>((resolve) => (reached = resolve));
    const wait = new Promise<void>((resolve) => (release = resolve));
    gates.set(`${tab}:${op}`, { reached, wait });
    return { arrived, release: () => release() };
  }

  function stored() {
    const doc = JSON.parse(inner.dump()[STORAGE_KEYS.current]!) as UserData;
    return {
      revision: doc.documentRevision,
      dates: doc.events
        .filter(isLive)
        .map((event) => event.startDate)
        .sort(),
    };
  }

  return { view, pause, log, stored, inner };
}

/** Let every runnable promise chain progress (bounded, deterministic). */
async function settle() {
  for (let i = 0; i < 200; i += 1) await Promise.resolve();
}

function openStore(storage: KeyValueStorage, name: string, lock?: WriteLock) {
  const createId = sequentialIds(name);
  return createUserDataStore({
    repository: createUserDataRepository(storage, { now: () => NOW, createId }),
    now: () => new Date(NOW),
    createId,
    writeLock: lock,
  });
}

function ready(store: UserDataStore): UserData {
  const snapshot = store.getSnapshot();
  if (snapshot.phase !== "READY") throw new Error("not ready");
  return snapshot.data;
}

const addLeave =
  (date: string) =>
  (data: UserData, ctx: Parameters<Parameters<UserDataStore["run"]>[0]>[1]) =>
    createServiceEvent(data, allDay("ANNUAL_LEAVE", date), ctx);

/** A backup to REPLACE with: the same profile plus one leave on `date`. */
function backupWith(date: string): UserData {
  const created = createServiceEvent(
    userDataWithProfile(),
    allDay("ANNUAL_LEAVE", date),
    { now: NOW, deviceId: "backup", createId: sequentialIds(`bk-${date}`) },
  );
  if (!created.ok) throw new Error("fixture");
  return created.data;
}

const replace = (store: UserDataStore, date: string) =>
  store.restore(backupWith(date), {
    mode: "REPLACE",
    expectedDocumentRevision: N,
    confirmDestructive: true,
  });

async function tabs(options: { lock: boolean; atomicCompareAndSet?: boolean }) {
  const storage = controlledStorage({
    atomicCompareAndSet: options.atomicCompareAndSet ?? true,
  });
  const lock = options.lock ? sharedLock() : undefined;
  const a = openStore(storage.view("A"), "a", lock);
  const b = openStore(storage.view("B"), "b", lock);
  await Promise.all([a.load(), b.load()]);
  expect(ready(a).documentRevision).toBe(N);
  expect(ready(b).documentRevision).toBe(N);
  storage.log.length = 0;
  return { storage, a, b };
}

describe("with the cross-tab write lock (Web Locks browsers)", () => {
  for (const [first, second] of [
    ["A", "B"],
    ["B", "A"],
  ] as const) {
    it(`${first} reads N and stops before commit; ${second}'s write waits without even reading; both changes survive`, async () => {
      const { storage, ...stores } = await tabs({ lock: true });
      const one = stores[first === "A" ? "a" : "b"];
      const two = stores[second === "A" ? "a" : "b"];
      const gate = storage.pause(first, "commit");

      const firstWrite = one.run(addLeave("2026-09-10"));
      await gate.arrived; // first tab read revision N and is about to commit
      const secondWrite = two.run(addLeave("2026-09-11"));
      await settle();
      // The second tab is blocked on the lock: it has not read anything.
      expect(storage.log.filter((entry) => entry.startsWith(second))).toEqual(
        [],
      );

      gate.release();
      const results = await Promise.all([firstWrite, secondWrite]);
      expect(results.every((result) => result.ok)).toBe(true);
      expect(storage.stored()).toEqual({
        revision: N + 2,
        dates: ["2026-09-10", "2026-09-11"],
      });
    });
  }

  it("a restore stopped before commit holds off a normal write, which then builds on the restored document", async () => {
    const { storage, a, b } = await tabs({ lock: true });
    const gate = storage.pause("A", "commit");
    const restoring = replace(a, "2026-10-01");
    await gate.arrived;
    const writing = b.run(addLeave("2026-10-02"));
    await settle();
    expect(storage.log.filter((entry) => entry.startsWith("B"))).toEqual([]);
    gate.release();

    expect((await restoring).ok).toBe(true);
    expect((await writing).ok).toBe(true);
    expect(storage.stored()).toEqual({
      revision: N + 2,
      dates: ["2026-10-01", "2026-10-02"],
    });
  });

  it("a write stopped before commit makes a restore previewed at N wait, then report STALE_PREVIEW", async () => {
    const { storage, a, b } = await tabs({ lock: true });
    const gate = storage.pause("B", "commit");
    const writing = b.run(addLeave("2026-10-02"));
    await gate.arrived;
    const restoring = replace(a, "2026-10-01");
    await settle();
    gate.release();

    expect((await writing).ok).toBe(true);
    expect(await restoring).toMatchObject({ ok: false, code: "STALE_PREVIEW" });
    expect(storage.stored()).toEqual({
      revision: N + 1,
      dates: ["2026-10-02"],
    });
  });

  it("two restores from the same preview: exactly one applies", async () => {
    const { storage, a, b } = await tabs({ lock: true });
    const gate = storage.pause("A", "commit");
    const first = replace(a, "2026-10-01");
    await gate.arrived;
    const second = replace(b, "2026-10-05");
    await settle();
    gate.release();

    expect((await first).ok).toBe(true);
    expect(await second).toMatchObject({ ok: false, code: "STALE_PREVIEW" });
    expect(storage.stored()).toEqual({
      revision: N + 1,
      dates: ["2026-10-01"],
    });
  });
});

describe("without a lock (Web Locks unavailable): atomic compare-and-set", () => {
  it("A reads N, B reads N, A stops before commit, B attempts its write, A commits, B continues: B retries and both survive", async () => {
    const { storage, a, b } = await tabs({ lock: false });
    const gateA = storage.pause("A", "commit");
    const gateB = storage.pause("B", "commit");

    const writeA = a.run(addLeave("2026-09-10"));
    await gateA.arrived; // A has read revision N
    const writeB = b.run(addLeave("2026-09-11"));
    await gateB.arrived; // B has read revision N too
    gateA.release();
    expect((await writeA).ok).toBe(true); // A commits N+1
    gateB.release(); // B's compare-and-set now fails; it re-runs on N+1

    expect((await writeB).ok).toBe(true);
    expect(storage.stored()).toEqual({
      revision: N + 2,
      dates: ["2026-09-10", "2026-09-11"],
    });
    // B really did get refused once and read again.
    expect(storage.log.filter((entry) => entry === "B:commit")).toHaveLength(2);
  });

  it("reverse order: B commits first while A waits before commit; A retries and both survive", async () => {
    const { storage, a, b } = await tabs({ lock: false });
    const gateA = storage.pause("A", "commit");
    const writeA = a.run(addLeave("2026-09-10"));
    await gateA.arrived;
    expect((await b.run(addLeave("2026-09-11"))).ok).toBe(true);
    gateA.release();

    expect((await writeA).ok).toBe(true);
    expect(storage.stored()).toEqual({
      revision: N + 2,
      dates: ["2026-09-10", "2026-09-11"],
    });
  });

  it("a restore whose commit is overtaken by a write reports STALE_PREVIEW and keeps the write", async () => {
    const { storage, a, b } = await tabs({ lock: false });
    const gate = storage.pause("A", "commit");
    const restoring = replace(a, "2026-10-01");
    await gate.arrived;
    expect((await b.run(addLeave("2026-10-02"))).ok).toBe(true);
    gate.release();

    expect(await restoring).toMatchObject({ ok: false, code: "STALE_PREVIEW" });
    expect(storage.stored()).toEqual({
      revision: N + 1,
      dates: ["2026-10-02"],
    });
  });

  it("a write whose commit is overtaken by a restore re-runs on the restored document", async () => {
    const { storage, a, b } = await tabs({ lock: false });
    const gate = storage.pause("B", "commit");
    const writing = b.run(addLeave("2026-10-02"));
    await gate.arrived;
    expect((await replace(a, "2026-10-01")).ok).toBe(true);
    gate.release();

    expect((await writing).ok).toBe(true);
    expect(storage.stored()).toEqual({
      revision: N + 2,
      dates: ["2026-10-01", "2026-10-02"],
    });
  });

  it("two restores from the same preview: exactly one applies", async () => {
    const { storage, a, b } = await tabs({ lock: false });
    const gateA = storage.pause("A", "commit");
    const gateB = storage.pause("B", "commit");
    const first = replace(a, "2026-10-01");
    await gateA.arrived;
    const second = replace(b, "2026-10-05");
    await gateB.arrived;
    gateA.release();
    expect((await first).ok).toBe(true);
    gateB.release();

    expect(await second).toMatchObject({ ok: false, code: "STALE_PREVIEW" });
    expect(storage.stored()).toEqual({
      revision: N + 1,
      dates: ["2026-10-01"],
    });
  });

  it("the repository refuses a stale base outright", async () => {
    const storage = createMemoryStorage({
      [STORAGE_KEYS.current]: JSON.stringify({
        ...userDataWithProfile(),
        documentRevision: N,
      }),
    });
    const repo = createUserDataRepository(storage, {
      now: () => NOW,
      createId: sequentialIds("r"),
    });
    const before = storage.dump();
    await expect(
      repo.save(
        { ...userDataWithProfile(), documentRevision: N },
        { expectedRevision: N - 1 },
      ),
    ).rejects.toBeInstanceOf(ConcurrentWriteError);
    expect(storage.dump()).toEqual(before);
  });
});

describe("degraded provider: no lock and no atomic compare-and-set", () => {
  it("documents the residual race: a check-then-write gap can lose a change", async () => {
    // Not the production path (the localStorage adapter implements
    // compareAndSet). Kept so the documented degraded guarantee is tested,
    // not assumed.
    const { storage, a, b } = await tabs({
      lock: false,
      atomicCompareAndSet: false,
    });
    const gate = storage.pause("A", "commit");
    const writeA = a.run(addLeave("2026-09-10"));
    await gate.arrived; // A passed its revision check
    expect((await b.run(addLeave("2026-09-11"))).ok).toBe(true);
    gate.release();
    expect((await writeA).ok).toBe(true);
    expect(storage.stored().dates).toEqual(["2026-09-10"]); // B's change lost
  });
});
