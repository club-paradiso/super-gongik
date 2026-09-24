import { describe, expect, it } from "vitest";

import {
  LEGACY_KEYS,
  STORAGE_KEYS,
  createBackup,
  createMemoryStorage,
  createServiceEvent,
  createUserDataRepository,
  createUserDataStore,
  csvCell,
  isLive,
  mergeUserData,
  parseBackup,
  serializeBackup,
  serviceEventsToCsv,
  type KeyValueStorage,
  type UserData,
} from "../src";
import {
  allDay,
  context,
  partial,
  sequentialIds,
  userDataWithProfile,
} from "./helpers";

function repository<T extends KeyValueStorage>(
  storage: T = createMemoryStorage() as unknown as T,
) {
  return {
    storage,
    repo: createUserDataRepository(storage, {
      now: () => "2026-09-24T00:00:00.000Z",
      createId: sequentialIds("gen"),
    }),
  };
}

function withEvent(
  data: UserData,
  draft = allDay("ANNUAL_LEAVE", "2026-09-10"),
) {
  const result = createServiceEvent(data, draft, context());
  if (!result.ok) throw new Error("create failed");
  return result.data;
}

const legacyProfile = {
  callUpDate: "2025-11-03",
  expectedDischargeDate: "2027-08-02",
  serviceCategory: null,
  workplaceType: null,
  defaultCommuteCost: null,
  defaultMealAllowanceOverride: null,
  timezone: "Asia/Seoul",
  id: "legacy-profile",
  ownerId: null,
  localProfileId: "legacy-profile",
  createdAt: "2025-11-03T00:00:00.000Z",
  updatedAt: "2025-11-03T00:00:00.000Z",
};

function legacyEvent(overrides: Record<string, unknown>) {
  return {
    id: "e1",
    serviceProfileId: "legacy-profile",
    eventType: "ANNUAL_LEAVE",
    startsAt: "2026-06-12T00:00:00+09:00",
    endsAt: null,
    durationMinutes: null,
    allDay: true,
    title: null,
    note: null,
    status: "CONFIRMED",
    metadata: {
      importBatchId: "batch-1",
      importSourceFormat: "CSV",
      importSourceFileName: "복무기록.csv",
      importFingerprint: "fp-1",
      importConfidence: 1,
      importSourceRowIndex: 2,
    },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    deletedAt: null,
    revision: 1,
    deviceId: "legacy-device",
    ...overrides,
  };
}

describe("versioned local repository", () => {
  it("migrates the pre-document localStorage layout without deleting it", async () => {
    const legacyRecords = {
      schemaVersion: 1,
      workdayMinutes: 480,
      events: [
        legacyEvent({}),
        legacyEvent({
          id: "e2",
          startsAt: "2026-06-13T09:00:00+09:00",
          endsAt: "2026-06-13T11:00:00+09:00",
          allDay: false,
          durationMinutes: 120,
          metadata: { importBatchId: "batch-1", importFingerprint: "fp-2" },
        }),
        legacyEvent({
          id: "e3",
          metadata: { importBatchId: "batch-1", importDayCount: 3 },
        }),
        legacyEvent({ id: "e4", allDay: false, durationMinutes: null }),
        legacyEvent({ id: "e5", eventType: "NOT_A_TYPE" }),
      ],
      snapshots: [],
      imports: [
        {
          id: "batch-1",
          serviceProfileId: "legacy-profile",
          fileName: "복무기록.csv",
          sourceFormat: "CSV",
          fileSha256: "abc",
          createdAt: "2026-09-01T00:00:00.000Z",
          eventCount: 4,
          snapshotCount: 0,
          skippedDuplicateCount: 0,
          status: "ACTIVE",
          rolledBackAt: null,
        },
      ],
    };
    const { repo, storage } = repository(
      createMemoryStorage({
        [LEGACY_KEYS.profile]: JSON.stringify(legacyProfile),
        [`${LEGACY_KEYS.recordsPrefix}legacy-profile`]:
          JSON.stringify(legacyRecords),
        [LEGACY_KEYS.deviceId]: "legacy-device",
      }),
    );

    const outcome = await repo.load();
    expect(outcome.kind).toBe("MIGRATED");
    if (outcome.kind !== "MIGRATED") return;
    expect(outcome.data.deviceId).toBe("legacy-device");
    expect(outcome.data.profile?.workdayMinutes).toBe(480);
    expect(outcome.data.profile?.priorServiceCredit).toBeNull();
    const byId = Object.fromEntries(
      outcome.data.events.map((event) => [event.id, event]),
    );
    expect(byId.e1?.timing).toEqual({ kind: "ALL_DAY", dayCount: 1 });
    expect(byId.e1?.source).toMatchObject({
      kind: "IMPORT",
      batchId: "batch-1",
    });
    expect(byId.e2?.timing).toEqual({
      kind: "PARTIAL",
      durationMinutes: 120,
      startTime: "09:00",
      endTime: "11:00",
    });
    // 2026-06-12 is a Friday: three charged days end on Tuesday.
    expect(byId.e3).toMatchObject({
      startDate: "2026-06-12",
      endDate: "2026-06-16",
      timing: { kind: "ALL_DAY", dayCount: 3 },
    });
    expect(byId.e4?.timing).toMatchObject({
      kind: "PARTIAL",
      durationMinutes: null,
    });
    expect(byId.e5).toBeUndefined();
    expect(outcome.issues).toHaveLength(2);
    // Legacy keys stay as an untouched fallback copy.
    expect(storage.dump()[LEGACY_KEYS.profile]).toBeDefined();
  });

  it("recovers the previous generation and quarantines a corrupt document", async () => {
    const { repo, storage } = repository(createMemoryStorage());
    const first = withEvent(userDataWithProfile());
    await repo.save(first);
    await repo.save({ ...first, documentRevision: 1 });
    await storage.setItem(STORAGE_KEYS.current, "{not json");

    const outcome = await repo.load();
    expect(outcome.kind).toBe("RECOVERED");
    if (outcome.kind !== "RECOVERED") return;
    expect(outcome.data.events).toHaveLength(1);
    expect(storage.dump()[outcome.quarantineKey]).toBe("{not json");
  });

  it("never silently discards unreadable data", async () => {
    const { repo, storage } = repository(
      createMemoryStorage({
        [STORAGE_KEYS.current]: '{"schemaVersion":2,"events":"x"}',
      }),
    );
    const outcome = await repo.load();
    expect(outcome.kind).toBe("CORRUPT");
    if (outcome.kind !== "CORRUPT") return;
    expect(storage.dump()[outcome.quarantineKey]).toContain('"events":"x"');
  });

  it("refuses to overwrite a document written by a newer app version", async () => {
    const storage = createMemoryStorage({
      [STORAGE_KEYS.current]: JSON.stringify({ schemaVersion: 99 }),
    });
    const store = createUserDataStore({
      repository: repository(storage).repo,
      createId: sequentialIds(),
    });
    await store.load();
    const snapshot = store.getSnapshot();
    expect(snapshot.phase === "READY" && snapshot.readOnly).toBe(true);
    const result = await store.run((data) => ({
      ok: true,
      data,
      value: undefined,
    }));
    expect(result.ok).toBe(false);
    expect(storage.dump()[STORAGE_KEYS.current]).toBe(
      JSON.stringify({ schemaVersion: 99 }),
    );
  });

  it("refuses to persist a structurally invalid document", async () => {
    const { repo } = repository();
    const data = userDataWithProfile();
    await expect(
      repo.save({
        ...data,
        events: [{ ...withEvent(data).events[0]!, serviceProfileId: "x" }],
      }),
    ).rejects.toThrow();
  });

  it("builds on writes made by another tab instead of overwriting them", async () => {
    const storage = createMemoryStorage();
    const tabA = createUserDataStore({
      repository: repository(storage).repo,
      createId: sequentialIds("a"),
    });
    const tabB = createUserDataStore({
      repository: repository(storage).repo,
      createId: sequentialIds("b"),
    });
    await tabA.load();
    await tabA.run((data) => ({
      ok: true,
      data: { ...userDataWithProfile(), deviceId: data.deviceId },
      value: undefined,
    }));
    await tabB.load();

    await tabA.run((data, ctx) =>
      createServiceEvent(data, allDay("ANNUAL_LEAVE", "2026-09-10"), ctx),
    );
    // Tab B has not refreshed but must still see tab A's event when writing.
    const result = await tabB.run((data, ctx) =>
      createServiceEvent(data, partial("OUTING", "2026-09-11", 30), ctx),
    );
    expect(result.ok).toBe(true);
    const reloaded = await repository(storage).repo.load();
    expect(
      reloaded.kind === "LOADED" && reloaded.data.events.filter(isLive),
    ).toHaveLength(2);
  });
});

describe("destructive and failure paths", () => {
  it("wipes every local copy, including recovery and legacy keys", async () => {
    const storage = createMemoryStorage({
      [LEGACY_KEYS.profile]: JSON.stringify(legacyProfile),
      [`${LEGACY_KEYS.recordsPrefix}legacy-profile`]: "{}",
      [`${STORAGE_KEYS.quarantinePrefix}2026`]: "broken",
      "unrelated-site-key": "keep",
    });
    const store = createUserDataStore({
      repository: repository(storage).repo,
      createId: sequentialIds(),
    });
    await store.load();
    await store.run((data, ctx) =>
      createServiceEvent(data, allDay("ANNUAL_LEAVE", "2026-09-10"), ctx),
    );
    expect(storage.dump()[STORAGE_KEYS.previous]).toBeDefined();

    const result = await store.wipeAll();
    expect(result.ok).toBe(true);
    const keys = Object.keys(storage.dump()).sort();
    expect(keys).toEqual([STORAGE_KEYS.current, "unrelated-site-key"]);
    const current = JSON.parse(storage.dump()[STORAGE_KEYS.current]!);
    expect(current.profile).toBeNull();
    expect(current.events).toEqual([]);
  });

  it("does not hang when storage itself is unavailable", async () => {
    const failing = {
      getItem: async () => {
        throw new Error("SecurityError");
      },
      setItem: async () => undefined,
      removeItem: async () => undefined,
    };
    const store = createUserDataStore({
      repository: repository(failing).repo,
      createId: sequentialIds(),
    });
    await store.load();
    const snapshot = store.getSnapshot();
    expect(snapshot.phase).toBe("READY");
    expect(snapshot.phase === "READY" && snapshot.readOnly).toBe(true);
    expect(snapshot.phase === "READY" && snapshot.lastError).toContain(
      "SecurityError",
    );
  });
});

describe("backup, restore and export", () => {
  it("round-trips a full backup with schema version", () => {
    const data = withEvent(userDataWithProfile());
    const text = serializeBackup(
      createBackup(data, "2026-09-24T00:00:00.000Z"),
    );
    expect(JSON.parse(text)).toMatchObject({
      format: "super-gongik.backup",
      schemaVersion: 2,
    });
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data).toEqual(data);
      expect(parsed.summary.events).toBe(1);
    }
  });

  it("fails safely on malformed or foreign files", () => {
    expect(parseBackup("not json").ok).toBe(false);
    expect(parseBackup(JSON.stringify({ hello: "world" })).ok).toBe(false);
    const data = withEvent(userDataWithProfile());
    const broken = createBackup(data, "2026-09-24T00:00:00.000Z");
    (broken.data.events[0] as { timing: unknown }).timing = {
      kind: "ALL_DAY",
      dayCount: 0.5,
    };
    const result = parseBackup(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    const newer = {
      ...createBackup(data, ""),
      data: { ...data, schemaVersion: 3 },
    };
    expect(parseBackup(JSON.stringify(newer))).toMatchObject({ ok: false });
  });

  it("merges by id and revision without double-counting duplicated content", () => {
    const base = withEvent(userDataWithProfile());
    const original = base.events[0]!;
    const incoming: UserData = {
      ...base,
      events: [
        {
          ...original,
          note: "수정됨",
          revision: 2,
          updatedAt: "2026-09-25T00:00:00.000Z",
        },
        { ...original, id: "other-device-copy" },
        {
          ...original,
          id: "new-one",
          startDate: "2026-09-15",
          endDate: "2026-09-15",
        },
      ],
    };
    const merged = mergeUserData(base, incoming);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.stats).toMatchObject({
      updatedEvents: 1,
      skippedDuplicateEvents: 1,
      addedEvents: 1,
    });
    expect(
      merged.data.events.find((event) => event.id === original.id)?.note,
    ).toBe("수정됨");
  });

  it("refuses to merge a backup from a different profile", () => {
    const current = userDataWithProfile();
    const other = {
      ...current,
      profile: { ...current.profile!, id: "someone-else" },
    };
    expect(mergeUserData(current, other).ok).toBe(false);
  });

  it("exports events as spreadsheet-safe CSV", () => {
    const data = withEvent(userDataWithProfile(), {
      ...allDay("ANNUAL_LEAVE", "2026-09-10"),
      note: '=HYPERLINK("x")',
    });
    const csv = serviceEventsToCsv(data.events);
    expect(csv.startsWith("\uFEFF시작일")).toBe(true);
    expect(csv).toContain("'=HYPERLINK");
    expect(csvCell("a,b")).toBe('"a,b"');
  });
});
