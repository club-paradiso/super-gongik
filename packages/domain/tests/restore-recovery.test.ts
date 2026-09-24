import { describe, expect, it } from "vitest";

import {
  STORAGE_KEYS,
  createBackup,
  createMemoryStorage,
  createServiceEvent,
  createUserDataRepository,
  createUserDataStore,
  parseBackup,
  planRestore,
  serializeBackup,
  updateServiceEvent,
  type KeyValueStorage,
  type UserData,
  type UserDataStore,
} from "../src";
import { fullDocument, largeDocument } from "./fixtures";
import { allDay, partial, sequentialIds, userDataWithProfile } from "./helpers";

const NOW = "2026-09-24T06:00:00.000Z";

type Faults = {
  /** setItem throws for these keys; entries ending in ":" match a prefix. */
  failSet: string[];
  failGet: boolean;
};

/** Memory storage whose writes and reads can be made to fail like a browser. */
function faultyStorage(initial: Record<string, string> = {}) {
  const inner = createMemoryStorage(initial);
  const faults: Faults = { failSet: [], failGet: false };
  const quota = () =>
    Object.assign(new Error("The quota has been exceeded."), {
      name: "QuotaExceededError",
    });
  const storage: KeyValueStorage & { dump(): Record<string, string> } = {
    async getItem(key) {
      if (faults.failGet) {
        throw Object.assign(new Error("The operation is insecure."), {
          name: "SecurityError",
        });
      }
      return inner.getItem(key);
    },
    async setItem(key, value) {
      if (
        faults.failSet.some((target) =>
          target.endsWith(":") ? key.startsWith(target) : key === target,
        )
      ) {
        throw quota();
      }
      return inner.setItem(key, value);
    },
    removeItem: (key) => inner.removeItem(key),
    keys: () => inner.keys!(),
    dump: () => inner.dump(),
  };
  return { storage, faults };
}

function openStore(storage: KeyValueStorage, prefix = "s") {
  const createId = sequentialIds(prefix);
  return createUserDataStore({
    repository: createUserDataRepository(storage, { now: () => NOW, createId }),
    now: () => new Date(NOW),
    createId,
  });
}

function ready(store: UserDataStore) {
  const snapshot = store.getSnapshot();
  if (snapshot.phase !== "READY") throw new Error("not ready");
  return snapshot;
}

/** A store that already holds the full fixture document. */
async function storeWithData() {
  const { storage, faults } = faultyStorage();
  const seed = openStore(storage, "seed");
  await seed.load();
  const result = await seed.restore(fullDocument(), {
    mode: "REPLACE",
    expectedDocumentRevision: 0,
  });
  if (!result.ok) throw new Error(result.message);
  const store = openStore(storage, "tab");
  await store.load();
  return { storage, faults, store };
}

/** A later backup of the same device: one record edited, one added. */
function divergentBackup(): UserData {
  const data = fullDocument();
  const live = data.events.find(
    (event) => event.deletedAt === null && event.source.kind === "MANUAL",
  )!;
  const edited = updateServiceEvent(
    data,
    live.id,
    { ...live, note: "백업에서 수정" },
    { now: NOW, deviceId: "device-fixture", createId: sequentialIds("bk") },
  );
  if (!edited.ok) throw new Error("edit failed");
  const added = createServiceEvent(
    edited.data,
    partial("OUTING", "2026-08-03", 30),
    {
      now: NOW,
      deviceId: "device-fixture",
      createId: sequentialIds("bk2"),
    },
  );
  if (!added.ok) throw new Error("add failed");
  return added.data;
}

describe("restore planning is a dry run", () => {
  it("summarizes MERGE and REPLACE per collection without touching storage or inputs", async () => {
    const { storage, store } = await storeWithData();
    const before = storage.dump();
    const current = ready(store).data;
    const backup = divergentBackup();
    const currentCopy = structuredClone(current);
    const backupCopy = structuredClone(backup);

    const merge = planRestore(current, backup, {
      mode: "MERGE",
      now: NOW,
      deviceId: "d",
    });
    expect(merge.blocked).toBeNull();
    expect(merge.destructive).toBe(false);
    expect(merge.profile).toBe("SAME_PROFILE");
    expect(merge.counts.events).toMatchObject({ UPDATED: 1, ADDED: 1 });
    expect(merge.counts.attendanceMonths).toEqual({ UNCHANGED: 1 });
    expect(merge.counts.compensationSnapshots).toEqual({ UNCHANGED: 1 });
    expect(merge.counts.leaveAdjustments).toEqual({ UNCHANGED: 2 });
    expect(merge.counts.profile).toEqual({ UNCHANGED: 1 });
    expect(merge.result).not.toBeNull();

    const replace = planRestore(current, backup, {
      mode: "REPLACE",
      now: NOW,
      deviceId: "d",
    });
    expect(replace.destructive).toBe(true);
    expect(replace.requiresDestructiveConfirmation).toBe(true);
    expect(replace.counts.events).toMatchObject({ REPLACED: 1, ADDED: 1 });

    // A backup of a different person can only replace.
    const stranger = {
      ...backup,
      profile: { ...backup.profile!, id: "someone-else" },
    };
    const blocked = planRestore(current, stranger, {
      mode: "MERGE",
      now: NOW,
      deviceId: "d",
    });
    expect(blocked.profile).toBe("DIFFERENT_PROFILE");
    expect(blocked.blocked?.reason).toBe("PROFILE_MISMATCH");
    expect(blocked.result).toBeNull();

    expect(storage.dump()).toEqual(before);
    expect(current).toEqual(currentCopy);
    expect(backup).toEqual(backupCopy);
  });

  it("parsing and previewing a file, then cancelling, leaves storage byte-identical", async () => {
    const { storage, store } = await storeWithData();
    const before = storage.dump();
    const parsed = parseBackup(
      serializeBackup(createBackup(divergentBackup(), NOW)),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    planRestore(ready(store).data, parsed.data, {
      mode: "REPLACE",
      now: NOW,
      deviceId: "d",
    });
    // Cancel = simply not calling restore. A reload sees the same data.
    expect(storage.dump()).toEqual(before);
    const reloaded = openStore(storage, "reload");
    await reloaded.load();
    expect(ready(reloaded).data).toEqual(ready(store).data);
  });
});

describe("restore is atomic", () => {
  it("a failed REPLACE write leaves the previous document intact and a pre-restore copy behind", async () => {
    const { storage, faults, store } = await storeWithData();
    const before = storage.dump();
    faults.failSet = [STORAGE_KEYS.current];
    const result = await store.restore(divergentBackup(), {
      mode: "REPLACE",
      expectedDocumentRevision: ready(store).data.documentRevision,
      confirmDestructive: true,
    });
    expect(result).toMatchObject({ ok: false, code: "STORAGE_WRITE_FAILED" });
    const after = storage.dump();
    expect(after[STORAGE_KEYS.current]).toBe(before[STORAGE_KEYS.current]);
    // Recovery evidence: the pre-restore copy and the previous generation
    // both hold the document the user had before.
    expect(after[STORAGE_KEYS.preRestore]).toBe(before[STORAGE_KEYS.current]);
    expect(after[STORAGE_KEYS.previous]).toBe(before[STORAGE_KEYS.current]);
    expect(ready(store).data).toEqual(
      JSON.parse(before[STORAGE_KEYS.current]!),
    );
    expect(ready(store).lastError).toContain("저장하지 않았어요");

    faults.failSet = [];
    const reloaded = openStore(storage, "reload");
    await reloaded.load();
    expect(ready(reloaded).notice).toBeNull();
    expect(ready(reloaded).data).toEqual(
      JSON.parse(before[STORAGE_KEYS.current]!),
    );
  });

  it("a REPLACE that cannot keep a pre-restore copy is not attempted", async () => {
    const { storage, faults, store } = await storeWithData();
    const before = storage.dump();
    faults.failSet = [STORAGE_KEYS.preRestore];
    const result = await store.restore(divergentBackup(), {
      mode: "REPLACE",
      expectedDocumentRevision: ready(store).data.documentRevision,
      confirmDestructive: true,
    });
    expect(result).toMatchObject({ ok: false, code: "PRESERVE_FAILED" });
    expect(storage.dump()).toEqual(before);
  });

  it("a failed MERGE write applies nothing, even when rotating the previous generation fails", async () => {
    for (const failing of [STORAGE_KEYS.current, STORAGE_KEYS.previous]) {
      const { storage, faults, store } = await storeWithData();
      const before = storage.dump();
      faults.failSet = [failing];
      const result = await store.restore(divergentBackup(), {
        mode: "MERGE",
        expectedDocumentRevision: ready(store).data.documentRevision,
      });
      expect(result).toMatchObject({ ok: false, code: "STORAGE_WRITE_FAILED" });
      expect(storage.dump()[STORAGE_KEYS.current]).toBe(
        before[STORAGE_KEYS.current],
      );
      expect(ready(store).data).toEqual(
        JSON.parse(before[STORAGE_KEYS.current]!),
      );
    }
  });

  it("REPLACE over existing data requires explicit confirmation; nothing is written without it", async () => {
    const { storage, store } = await storeWithData();
    const before = storage.dump();
    const request = {
      mode: "REPLACE" as const,
      expectedDocumentRevision: ready(store).data.documentRevision,
    };
    expect(await store.restore(divergentBackup(), request)).toMatchObject({
      ok: false,
      code: "CONFIRMATION_REQUIRED",
    });
    expect(storage.dump()).toEqual(before);

    const confirmed = await store.restore(divergentBackup(), {
      ...request,
      confirmDestructive: true,
    });
    expect(confirmed.ok).toBe(true);
    expect(storage.dump()[STORAGE_KEYS.preRestore]).toBe(
      before[STORAGE_KEYS.current],
    );
  });

  it("MERGE with an unresolved conflict writes nothing", async () => {
    const { storage, store } = await storeWithData();
    const before = storage.dump();
    const conflicting = structuredClone(ready(store).data);
    conflicting.events[0]!.note = "같은 버전, 다른 내용";
    const result = await store.restore(conflicting, {
      mode: "MERGE",
      expectedDocumentRevision: ready(store).data.documentRevision,
    });
    expect(result).toMatchObject({ ok: false, code: "BLOCKED" });
    expect(storage.dump()).toEqual(before);
  });
});

describe("other tabs and app versions", () => {
  it("refuses a restore whose preview another tab has made stale", async () => {
    const { storage, store: tabA } = await storeWithData();
    const tabB = openStore(storage, "tabB");
    await tabB.load();

    const previewed = planRestore(ready(tabA).data, divergentBackup(), {
      mode: "REPLACE",
      now: NOW,
      deviceId: "d",
    });
    // Tab B writes after tab A showed the preview.
    const written = await tabB.run((data, ctx) =>
      createServiceEvent(data, allDay("ANNUAL_LEAVE", "2026-10-15"), ctx),
    );
    expect(written.ok).toBe(true);
    const afterB = storage.dump();

    const result = await tabA.restore(divergentBackup(), {
      mode: "REPLACE",
      expectedDocumentRevision: previewed.baseDocumentRevision,
      confirmDestructive: true,
    });
    expect(result).toMatchObject({ ok: false, code: "STALE_PREVIEW" });
    expect(storage.dump()).toEqual(afterB);

    // A fresh preview against the newest document goes through.
    await tabA.refresh();
    const retry = await tabA.restore(divergentBackup(), {
      mode: "MERGE",
      expectedDocumentRevision: ready(tabA).data.documentRevision,
    });
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(
        retry.data.events.some((event) => event.startDate === "2026-10-15"),
      ).toBe(true);
    }
  });

  it("stops writing when another tab saved data from a newer app version", async () => {
    const { storage, store } = await storeWithData();
    const future = JSON.stringify({ schemaVersion: 4, events: ["future"] });
    await storage.setItem(STORAGE_KEYS.current, future);

    const result = await store.run((data, ctx) =>
      createServiceEvent(data, allDay("ANNUAL_LEAVE", "2026-10-15"), ctx),
    );
    expect(result.ok).toBe(false);
    expect(storage.dump()[STORAGE_KEYS.current]).toBe(future);
    expect(ready(store).readOnly).toBe(true);
    expect(ready(store).notice?.kind).toBe("NEWER_VERSION");

    // The repository itself also refuses to overwrite it.
    const repo = createUserDataRepository(storage, {
      now: () => NOW,
      createId: sequentialIds("r"),
    });
    await expect(repo.save(userDataWithProfile())).rejects.toThrow(
      "새로운 앱 버전",
    );
    expect(storage.dump()[STORAGE_KEYS.current]).toBe(future);
  });

  it("refresh() flips a tab to read-only when a newer version appears", async () => {
    const { storage, store } = await storeWithData();
    await storage.setItem(
      STORAGE_KEYS.current,
      JSON.stringify({ schemaVersion: 9 }),
    );
    await store.refresh();
    expect(ready(store).readOnly).toBe(true);
  });

  it("a reload immediately after a write sees the write", async () => {
    const { storage, store } = await storeWithData();
    const written = await store.run((data, ctx) =>
      createServiceEvent(data, allDay("ANNUAL_LEAVE", "2026-10-15"), ctx),
    );
    if (!written.ok) throw new Error("write failed");
    const reloaded = openStore(storage, "reload");
    await reloaded.load();
    expect(ready(reloaded).data).toEqual(written.data);
  });
});

describe("recovery generations and quarantine", () => {
  async function twoGenerations() {
    const { storage, faults, store } = await storeWithData();
    await store.run((data, ctx) =>
      createServiceEvent(data, allDay("ANNUAL_LEAVE", "2026-10-15"), ctx),
    );
    return {
      storage,
      faults,
      previous: storage.dump()[STORAGE_KEYS.previous]!,
    };
  }

  it("corrupt current + valid previous: recovers, quarantines, and never rotates the corrupt copy over the good one", async () => {
    const { storage, previous } = await twoGenerations();
    const garbage = '{"schemaVersion":3,"events":[{"truncat';
    await storage.setItem(STORAGE_KEYS.current, garbage);

    const store = openStore(storage, "after-crash");
    await store.load();
    const snapshot = ready(store);
    expect(snapshot.notice?.kind).toBe("RECOVERED");
    expect(snapshot.readOnly).toBe(false);
    if (snapshot.notice?.kind !== "RECOVERED") return;
    expect(snapshot.notice.quarantineInPlace).toBe(false);
    expect(storage.dump()[snapshot.notice.quarantineKey]).toBe(garbage);
    // The recovered document was written as current; the good previous
    // generation was not replaced by the corrupt text.
    expect(storage.dump()[STORAGE_KEYS.previous]).toBe(previous);
    expect(snapshot.data.events).toEqual(JSON.parse(previous).events);
    // Exactly one quarantine copy (no duplicate from the follow-up save).
    expect(
      Object.values(storage.dump()).filter((value) => value === garbage),
    ).toHaveLength(1);
  });

  it("a second load() (e.g. a remount) cannot swallow the recovery notice", async () => {
    const { storage } = await twoGenerations();
    await storage.setItem(STORAGE_KEYS.current, "{broken");
    const store = openStore(storage, "remount");
    await Promise.all([store.load(), store.load()]);
    await store.load();
    expect(ready(store).notice?.kind).toBe("RECOVERED");
  });

  it("corrupt current + write failure during recovery keeps the valid previous generation", async () => {
    const { storage, faults, previous } = await twoGenerations();
    await storage.setItem(STORAGE_KEYS.current, "{broken");
    faults.failSet = [STORAGE_KEYS.current];
    const store = openStore(storage, "after-crash");
    await store.load();
    expect(ready(store).notice?.kind).toBe("RECOVERED");
    expect(ready(store).lastError).not.toBeNull();
    expect(storage.dump()[STORAGE_KEYS.previous]).toBe(previous);

    faults.failSet = [];
    const again = openStore(storage, "retry");
    await again.load();
    expect(ready(again).notice?.kind).toBe("RECOVERED");
    expect(ready(again).data.events).toEqual(JSON.parse(previous).events);
  });

  it("both generations corrupt: keeps both copies, never claims data is gone", async () => {
    const { storage } = await twoGenerations();
    await storage.setItem(STORAGE_KEYS.current, "{broken current");
    await storage.setItem(STORAGE_KEYS.previous, "{broken previous");
    const store = openStore(storage, "both");
    await store.load();
    const notice = ready(store).notice;
    expect(notice?.kind).toBe("CORRUPT");
    if (notice?.kind !== "CORRUPT") return;
    expect(storage.dump()[notice.quarantineKey]).toBe("{broken current");
    expect(storage.dump()[notice.previousQuarantineKey!]).toBe(
      "{broken previous",
    );

    // Starting over is allowed and does not destroy either copy.
    const written = await store.run((data, ctx) => ({
      ok: true,
      data: {
        ...userDataWithProfile(),
        deviceId: data.deviceId,
        documentRevision: data.documentRevision,
      },
      value: ctx,
    }));
    expect(written.ok).toBe(true);
    const values = Object.values(storage.dump());
    expect(values).toContain("{broken current");
    expect(values).toContain("{broken previous");
  });

  it("when no quarantine copy fits, the app turns read-only instead of overwriting the only copy", async () => {
    const { storage, faults } = await twoGenerations();
    await storage.setItem(STORAGE_KEYS.current, "{broken");
    faults.failSet = [STORAGE_KEYS.quarantinePrefix];
    const store = openStore(storage, "full-disk");
    await store.load();
    const snapshot = ready(store);
    expect(snapshot.readOnly).toBe(true);
    expect(snapshot.notice).toMatchObject({
      kind: "RECOVERED",
      quarantineInPlace: true,
      quarantineKey: STORAGE_KEYS.current,
    });
    expect(snapshot.lastError).toContain("원본은 그대로");
    const attempt = await store.run((data, ctx) =>
      createServiceEvent(data, allDay("ANNUAL_LEAVE", "2026-10-20"), ctx),
    );
    expect(attempt.ok).toBe(false);
    expect(storage.dump()[STORAGE_KEYS.current]).toBe("{broken");
  });
});

describe("storage unavailable", () => {
  it("a store whose storage starts failing mid-session reports errors instead of throwing", async () => {
    const { faults, store } = await storeWithData();
    faults.failGet = true;
    const result = await store.run((data, ctx) =>
      createServiceEvent(data, allDay("ANNUAL_LEAVE", "2026-10-15"), ctx),
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors[0]!.message).toContain("아무것도 바꾸지 않았어요");
    await expect(store.refresh()).resolves.toBeUndefined();
    expect(
      await store.restore(fullDocument(), {
        mode: "MERGE",
        expectedDocumentRevision: 0,
      }),
    ).toMatchObject({ ok: false, code: "READ_ONLY" });
  });

  it("a store that cannot open storage at all is read-only", async () => {
    const { storage, faults } = faultyStorage();
    faults.failGet = true;
    const store = openStore(storage);
    await store.load();
    expect(ready(store).readOnly).toBe(true);
    expect(ready(store).lastError).toContain("기기 저장소를 열 수 없어요");
  });
});

describe("large backups", () => {
  it("parses, plans and restores ~1,500 records without pathological slowdowns", async () => {
    const data = largeDocument(1500);
    const timings: Record<string, number> = {};
    const time = <T>(label: string, run: () => T): T => {
      const start = performance.now();
      const value = run();
      timings[label] = Math.round(performance.now() - start);
      return value;
    };

    const text = time("serialize", () =>
      serializeBackup(createBackup(data, NOW)),
    );
    const parsed = time("parse+verify", () => parseBackup(text));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.events).toHaveLength(1500);

    const empty = { ...userDataWithProfile(), profile: null };
    const intoEmpty = time("plan merge into empty", () =>
      planRestore(empty, parsed.data, {
        mode: "MERGE",
        now: NOW,
        deviceId: "d",
      }),
    );
    expect(
      intoEmpty.counts.events.ADDED! + intoEmpty.counts.events.ADDED_HISTORY!,
    ).toBe(1500);

    // Worst ordinary case: every record already present (all duplicates checked).
    const self = time("plan merge into itself", () =>
      planRestore(parsed.data, parsed.data, {
        mode: "MERGE",
        now: NOW,
        deviceId: "d",
      }),
    );
    expect(self.counts.events).toEqual({ UNCHANGED: 1500 });
    expect(self.changes).toEqual([]);

    // Every record copied under a new id: the duplicate checks must hit.
    const copies = {
      ...parsed.data,
      events: parsed.data.events.map((event) => ({
        ...event,
        id: `copy-${event.id}`,
      })),
    };
    const dup = time("plan merge of 1,500 duplicates", () =>
      planRestore(parsed.data, copies, {
        mode: "MERGE",
        now: NOW,
        deviceId: "d",
      }),
    );
    expect(dup.counts.events.DUPLICATE).toBe(1470);

    time("plan replace", () =>
      planRestore(parsed.data, copies, {
        mode: "REPLACE",
        now: NOW,
        deviceId: "d",
      }),
    );

    const storage = createMemoryStorage();
    const store = openStore(storage, "large");
    await store.load();
    const start = performance.now();
    const restored = await store.restore(parsed.data, {
      mode: "REPLACE",
      expectedDocumentRevision: 0,
    });
    timings["restore+save"] = Math.round(performance.now() - start);
    expect(restored.ok).toBe(true);

    // Indicative only; the bound is deliberately loose (quadratic merge of
    // 1,500 events took seconds before the day index).
    for (const value of Object.values(timings))
      expect(value).toBeLessThan(5000);
  });
});
