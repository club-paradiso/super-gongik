import { describe, expect, it } from "vitest";

import {
  compareRevisioned,
  createServiceEvent,
  deleteServiceEvent,
  importConsistencyIssues,
  isLive,
  mergeUserData,
  planRestore,
  saveAttendanceMonth,
  updateServiceEvent,
  userDataSchema,
  type CommandContext,
  type MergeOptions,
  type ServiceEvent,
  type UserData,
} from "../src";
import { fullDocument } from "./fixtures";
import { allDay, partial, sequentialIds, userDataWithProfile } from "./helpers";

const MERGE_CTX = { now: "2026-09-24T09:00:00.000Z", deviceId: "device-here" };

// One id sequence per device name, so a device never reuses an id.
const generators = new Map<string, () => string>();
function device(
  name: string,
  now = "2026-09-22T00:00:00.000Z",
): CommandContext {
  if (!generators.has(name))
    generators.set(name, sequentialIds(`${name}-${generators.size}`));
  return { now, deviceId: name, createId: generators.get(name)! };
}

function must<T>(
  result: { ok: true; data: UserData; value: T } | { ok: false },
) {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result;
}

function merged(
  current: UserData,
  incoming: UserData,
  options: MergeOptions = {},
) {
  const result = mergeUserData(current, incoming, MERGE_CTX, options);
  if (!result.ok) throw new Error(result.error);
  expect(userDataSchema.safeParse(result.data).success).toBe(true);
  expect(importConsistencyIssues(result.data)).toEqual([]);
  return result;
}

/** A document with one event, and a way to edit it on another "device". */
function shared() {
  const created = must(
    createServiceEvent(
      userDataWithProfile(),
      allDay("ANNUAL_LEAVE", "2026-09-10"),
      device("origin"),
    ),
  );
  return { base: created.data, id: created.value.id };
}

function edit(data: UserData, id: string, note: string, ctx: CommandContext) {
  return must(
    updateServiceEvent(
      data,
      id,
      { ...allDay("ANNUAL_LEAVE", "2026-09-10"), note },
      ctx,
    ),
  ).data;
}

const eventOf = (data: UserData, id: string) =>
  data.events.find((event) => event.id === id)!;

const sortedRecords = (data: UserData) => ({
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
});

function conflictsOf(current: UserData, incoming: UserData) {
  const result = mergeUserData(current, incoming, MERGE_CTX);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a conflict");
  expect(result.reason).toBe("UNRESOLVED_CONFLICTS");
  return result.conflicts;
}

// "origin" is the device that created the record. Two documents that only
// ever went through "origin" are one linear history (e.g. today's data and
// last week's backup of the same phone). Any other device name is an
// independent device.

describe("same-device history: revisions order versions", () => {
  it("A. a higher revision from the same device replaces the local record", () => {
    const { base, id } = shared();
    const later = edit(base, id, "나중 수정", device("origin"));
    const result = merged(base, later);
    expect(eventOf(result.data, id).note).toBe("나중 수정");
    expect(eventOf(result.data, id).revision).toBe(2);
    expect(result.counts.events.UPDATED).toBe(1);
  });

  it("B. a lower revision from the same device never overwrites a newer local record", () => {
    const { base, id } = shared();
    const local = edit(base, id, "로컬 수정", device("origin"));
    const result = merged(local, base);
    expect(eventOf(result.data, id)).toEqual(eventOf(local, id));
    expect(result.counts.events.RETAINED_LOCAL).toBe(1);
  });

  it("C. identical content is a no-op, whatever the revision and write metadata", () => {
    const { base, id } = shared();
    const sameContent: UserData = {
      ...base,
      events: base.events.map((event) =>
        event.id === id
          ? {
              ...event,
              revision: 9,
              updatedAt: "2030-01-01T00:00:00.000Z",
              deviceId: "elsewhere",
            }
          : event,
      ),
    };
    expect(compareRevisioned(eventOf(base, id), eventOf(sameContent, id))).toBe(
      "IDENTICAL",
    );
    const result = merged(base, sameContent);
    expect(result.data.events).toEqual(base.events);
    expect(result.changes).toEqual([]);
    expect(result.counts.events).toEqual({ UNCHANGED: 1 });
  });

  it("E. an older copy from the same device cannot resurrect a newer deletion", () => {
    const { base: backup, id } = shared();
    const deleted = must(deleteServiceEvent(backup, id, device("origin"))).data;
    for (const options of [{}, { incomingDeletions: "APPLY_NEWER" as const }]) {
      const result = merged(deleted, backup, options);
      expect(isLive(eventOf(result.data, id))).toBe(false);
      expect(result.changes).toEqual([
        { collection: "events", recordId: id, outcome: "LOCAL_DELETION_KEPT" },
      ]);
    }
  });

  it("F. restoring an older backup over a newer deletion keeps the deletion (MERGE) and says so; REPLACE shows it will come back", () => {
    const { base: backup, id } = shared();
    const now = must(deleteServiceEvent(backup, id, device("origin"))).data;

    const plan = planRestore(now, backup, { mode: "MERGE", ...MERGE_CTX });
    expect(plan.blocked).toBeNull();
    expect(plan.counts.events.LOCAL_DELETION_KEPT).toBe(1);
    expect(isLive(eventOf(plan.result!, id))).toBe(false);

    const replace = planRestore(now, backup, { mode: "REPLACE", ...MERGE_CTX });
    expect(replace.destructive).toBe(true);
    expect(replace.counts.events.RESTORED).toBe(1);
  });

  it("F. a newer same-device deletion is reported but not applied by recovery merge; the sync policy applies it", () => {
    const { base, id } = shared();
    const laterDeleted = must(
      deleteServiceEvent(base, id, device("origin")),
    ).data;

    const recovery = merged(base, laterDeleted);
    expect(isLive(eventOf(recovery.data, id))).toBe(true);
    expect(recovery.counts.events.INCOMING_DELETION_NOT_APPLIED).toBe(1);

    const sync = merged(base, laterDeleted, {
      incomingDeletions: "APPLY_NEWER",
    });
    expect(isLive(eventOf(sync.data, id))).toBe(false);
    expect(sync.counts.events.DELETED).toBe(1);
  });
});

describe("independent devices: revision counters are not a clock", () => {
  it("E. a deletion on one device vs two edits on another is a conflict, not a resurrection", () => {
    // Review scenario: base rev1; A deletes (rev2 tombstone); B edits twice
    // from the same base (rev3 live). 3 > 2 proves nothing.
    const { base, id } = shared();
    const deletedOnA = must(
      deleteServiceEvent(base, id, device("device-a")),
    ).data;
    const editedOnB = edit(
      edit(base, id, "B 수정 1", device("device-b")),
      id,
      "B 수정 2",
      device("device-b"),
    );
    expect(eventOf(deletedOnA, id).revision).toBe(2);
    expect(eventOf(editedOnB, id).revision).toBe(3);

    for (const options of [
      {},
      { incomingDeletions: "APPLY_NEWER" as const },
      { restoreLocallyDeleted: true },
    ]) {
      const result = mergeUserData(deletedOnA, editedOnB, MERGE_CTX, options);
      expect(result).toMatchObject({
        ok: false,
        reason: "UNRESOLVED_CONFLICTS",
      });
    }
    expect(conflictsOf(deletedOnA, editedOnB)).toEqual([
      {
        key: `events:${id}`,
        collection: "events",
        recordId: id,
        type: "CROSS_DEVICE_DIVERGENT",
        local: {
          revision: 2,
          updatedAt: eventOf(deletedOnA, id).updatedAt,
          deleted: true,
        },
        incoming: {
          revision: 3,
          updatedAt: eventOf(editedOnB, id).updatedAt,
          deleted: false,
        },
      },
    ]);
    // And the other way round: B's live edits never silently win either.
    expect(conflictsOf(editedOnB, deletedOnA)[0]).toMatchObject({
      type: "CROSS_DEVICE_DIVERGENT",
      local: { deleted: false },
      incoming: { deleted: true },
    });
  });

  it("unequal-revision divergent edits from different devices never pick a silent winner", () => {
    const { base, id } = shared();
    const onA = edit(base, id, "A 메모", device("device-a")); // rev2
    let onB = base;
    for (let i = 0; i < 5; i += 1)
      onB = edit(onB, id, `B 메모 ${i}`, device("device-b")); // rev6
    for (const [a, b] of [
      [onA, onB],
      [onB, onA],
    ] as const) {
      const [conflict] = conflictsOf(a, b);
      expect(conflict).toMatchObject({
        type: "CROSS_DEVICE_DIVERGENT",
        recordId: id,
      });
      // Conflicts carry version metadata only, not user text.
      expect(JSON.stringify(conflict)).not.toContain("메모");
    }
    // The plan is blocked; nothing would be written.
    const plan = planRestore(onA, onB, { mode: "MERGE", ...MERGE_CTX });
    expect(plan.blocked?.reason).toBe("UNRESOLVED_CONFLICTS");
    expect(plan.result).toBeNull();
  });

  it("D. equal revision with divergent content is a structured conflict", () => {
    const { base, id } = shared();
    const here = edit(
      base,
      id,
      "여기서 쓴 비밀 메모",
      device("here", "2026-09-23T00:00:00.000Z"),
    );
    const there = edit(
      base,
      id,
      "저기서 쓴 비밀 메모",
      device("there", "2026-09-24T00:00:00.000Z"),
    );
    for (const [a, b] of [
      [here, there],
      [there, here],
    ] as const) {
      expect(conflictsOf(a, b)).toEqual([
        {
          key: `events:${id}`,
          collection: "events",
          recordId: id,
          type: "EQUAL_VERSION_DIVERGENT",
          local: {
            revision: 2,
            updatedAt: eventOf(a, id).updatedAt,
            deleted: false,
          },
          incoming: {
            revision: 2,
            updatedAt: eventOf(b, id).updatedAt,
            deleted: false,
          },
        },
      ]);
      expect(JSON.stringify(conflictsOf(a, b))).not.toContain("비밀");
    }
    // Equal revisions from the same device conflict too.
    const sameDevice = structuredClone(here);
    eventOf(sameDevice, id).note = "같은 기기, 같은 버전";
    expect(conflictsOf(here, sameDevice)[0]!.type).toBe(
      "EQUAL_VERSION_DIVERGENT",
    );
  });

  it("D. an explicit resolution applies the chosen side verbatim and is idempotent with the same choice", () => {
    const { base, id } = shared();
    const here = edit(base, id, "여기", device("here"));
    const there = edit(
      edit(base, id, "저기1", device("there")),
      id,
      "저기",
      device("there"),
    );
    const key = `events:${id}`;

    const keepLocal = merged(here, there, { resolutions: { [key]: "LOCAL" } });
    expect(eventOf(keepLocal.data, id)).toEqual(eventOf(here, id));
    expect(keepLocal.counts.events.RESOLVED_LOCAL).toBe(1);
    expect(
      merged(keepLocal.data, there, { resolutions: { [key]: "LOCAL" } }).data,
    ).toEqual(keepLocal.data);
    // Without an answer the same file asks again: nothing proves order.
    expect(conflictsOf(keepLocal.data, there)).toHaveLength(1);

    const takeIncoming = merged(here, there, {
      resolutions: { [key]: "INCOMING" },
    });
    expect(eventOf(takeIncoming.data, id)).toEqual(eventOf(there, id));
    // Now identical: re-merging needs no answer at all.
    expect(merged(takeIncoming.data, there).data).toEqual(takeIncoming.data);
  });

  it("D. divergence is detected in every collection, including records without revisions", () => {
    const data = fullDocument();
    const divergent: UserData = JSON.parse(JSON.stringify(data));
    divergent.profile!.defaultCommuteCost = 9999;
    divergent.leaveAdjustments[0]!.reason = "다른 사유";
    divergent.leaveSnapshots[0]!.remainingDays = 3;
    divergent.imports[0]!.fileName = "renamed.csv";
    divergent.attendanceMonths[0]!.nonWorkingDates = [];
    divergent.compensationSnapshots[0]!.total = 1;

    const conflicts = conflictsOf(data, divergent);
    expect(conflicts.map((conflict) => conflict.collection).sort()).toEqual([
      "attendanceMonths",
      "compensationSnapshots",
      "imports",
      "leaveAdjustments",
      "leaveSnapshots",
      "profile",
    ]);
    const typeOf = (collection: string) =>
      conflicts.find((conflict) => conflict.collection === collection)!.type;
    expect(typeOf("imports")).toBe("IMMUTABLE_RECORD_DIVERGENT");
    expect(typeOf("leaveSnapshots")).toBe("IMMUTABLE_RECORD_DIVERGENT");
    expect(typeOf("profile")).toBe("UNVERSIONED_DIVERGENT");
  });

  it("a newer profile timestamp on another device does not silently win", () => {
    const data = userDataWithProfile();
    const edited = {
      ...data,
      profile: {
        ...data.profile!,
        defaultCommuteCost: 3000,
        updatedAt: "2030-01-01T00:00:00.000Z",
      },
    };
    expect(conflictsOf(data, edited)[0]!.type).toBe("UNVERSIONED_DIVERGENT");
    const taken = merged(data, edited, {
      resolutions: { [`profile:${data.profile!.id}`]: "INCOMING" },
    });
    expect(taken.data.profile).toEqual(edited.profile);
    expect(taken.stats.profileUpdated).toBe(true);
  });
});

describe("duplicates and identity", () => {
  it("G. identical content under another id is not added twice, and the skip is reported", () => {
    const { base, id } = shared();
    const copy: UserData = {
      ...base,
      events: [{ ...eventOf(base, id), id: "copy-from-other-device" }],
    };
    const result = merged(base, copy);
    expect(result.data.events.filter(isLive)).toHaveLength(1);
    expect(result.changes).toContainEqual({
      collection: "events",
      recordId: "copy-from-other-device",
      outcome: "DUPLICATE",
    });
  });

  it("G. similar-looking but distinct records are both kept", () => {
    const base = userDataWithProfile();
    const timed = (start: string, end: string) => ({
      ...partial("OUTING", "2026-09-10", 60),
      timing: {
        kind: "PARTIAL" as const,
        durationMinutes: 60,
        startTime: start,
        endTime: end,
      },
    });
    const morning = must(
      createServiceEvent(base, timed("09:00", "10:00"), device("a")),
    ).data;
    const afternoon = must(
      createServiceEvent(base, timed("15:00", "16:00"), device("b")),
    ).data;
    const result = merged(morning, afternoon);
    expect(result.data.events.filter(isLive)).toHaveLength(2);
  });
});

describe("reconnecting stale devices", () => {
  function busyHistory() {
    const { base, id } = shared();
    let busy = base;
    for (let i = 0; i < 6; i += 1)
      busy = edit(busy, id, `수정 ${i}`, device("origin"));
    const added = must(
      createServiceEvent(
        busy,
        allDay("ANNUAL_LEAVE", "2026-10-02"),
        device("origin"),
      ),
    );
    busy = must(
      deleteServiceEvent(added.data, added.value.id, device("origin")),
    ).data;
    busy = must(
      createServiceEvent(
        busy,
        partial("OUTING", "2026-10-05", 30),
        device("origin"),
      ),
    ).data;
    return { base, busy, id };
  }

  it("H. an old copy of the same device neither overwrites nor loses newer records", () => {
    const { base, busy, id } = busyHistory();
    const staleIntoBusy = merged(busy, base);
    expect(sortedRecords(staleIntoBusy.data)).toEqual(sortedRecords(busy));

    const busyIntoStale = merged(base, busy);
    expect(eventOf(busyIntoStale.data, id)).toEqual(eventOf(busy, id));
    expect(sortedRecords(busyIntoStale.data)).toEqual(sortedRecords(busy));
  });

  it("H. a copy edited on another device while this one moved on is a conflict, never an overwrite", () => {
    const { base, busy, id } = busyHistory();
    const elsewhere = edit(base, id, "다른 기기", device("device-b")); // rev2
    const plan = planRestore(busy, elsewhere, { mode: "MERGE", ...MERGE_CTX });
    expect(plan.blocked?.reason).toBe("UNRESOLVED_CONFLICTS");
    expect(plan.conflicts.map((conflict) => conflict.recordId)).toEqual([id]);
    const kept = merged(busy, elsewhere, {
      resolutions: { [`events:${id}`]: "LOCAL" },
    });
    expect(sortedRecords(kept.data)).toEqual(sortedRecords(busy));
  });
});

describe("algebraic properties", () => {
  /** Two documents that diverged along one device's history, touching different records. */
  function divergedPair() {
    const origin = fullDocument();
    const fixture = (now = "2026-09-22T00:00:00.000Z"): CommandContext => ({
      ...device("device-fixture", now),
    });
    const manual = origin.events.filter(
      (event) => isLive(event) && event.source.kind === "MANUAL",
    );
    const a = must(
      createServiceEvent(
        edit(origin, manual[0]!.id, "A 수정", fixture()),
        allDay("ANNUAL_LEAVE", "2026-10-06"),
        fixture(),
      ),
    ).data;
    let b = must(
      saveAttendanceMonth(
        origin,
        {
          month: "2026-08",
          nonWorkingDates: [],
          dayOverrides: [],
          hadNonPayableAbsence: false,
        },
        fixture(),
      ),
    ).data;
    b = must(
      createServiceEvent(b, partial("OUTING", "2026-10-07", 30), fixture()),
    ).data;
    b = must(deleteServiceEvent(b, manual[1]!.id, fixture())).data;
    return { a, b };
  }

  it("I. merging the same document twice is idempotent", () => {
    const { a, b } = divergedPair();
    for (const options of [
      {},
      { incomingDeletions: "APPLY_NEWER" as const },
      { restoreLocallyDeleted: true },
    ]) {
      const once = merged(a, b, options);
      const twice = merged(once.data, b, options);
      expect(twice.data).toEqual(once.data);
    }
  });

  it("J. with the sync deletion policy and no conflicts, merge direction does not change the records", () => {
    const { a, b } = divergedPair();
    const ab = merged(a, b, { incomingDeletions: "APPLY_NEWER" });
    const ba = merged(b, a, { incomingDeletions: "APPLY_NEWER" });
    expect(sortedRecords(ab.data)).toEqual(sortedRecords(ba.data));
    // Document metadata is per device and always comes from the local side.
    expect(ab.data.documentRevision).toBe(a.documentRevision);
    expect(ba.data.documentRevision).toBe(b.documentRevision);
  });

  it("J. recovery merge is intentionally not commutative for deletions", () => {
    const { a, b } = divergedPair();
    const ab = merged(a, b);
    const ba = merged(b, a);
    // A keeps the record B deleted; B keeps its own deletion.
    expect(sortedRecords(ab.data)).not.toEqual(sortedRecords(ba.data));
    expect(ab.counts.events.INCOMING_DELETION_NOT_APPLIED).toBe(1);
  });

  it("J. cross-device conflicts are symmetric: both directions stop and ask", () => {
    const { base, id } = shared();
    const onA = edit(base, id, "A", device("device-a"));
    const onB = edit(
      edit(base, id, "B1", device("device-b")),
      id,
      "B2",
      device("device-b"),
    );
    expect(conflictsOf(onA, onB).map((c) => c.key)).toEqual(
      conflictsOf(onB, onA).map((c) => c.key),
    );
  });

  it("J. duplicate content under two ids keeps whichever the local side already has", () => {
    const base = userDataWithProfile();
    const a = must(
      createServiceEvent(
        base,
        allDay("ANNUAL_LEAVE", "2026-09-10"),
        device("a"),
      ),
    );
    const b = must(
      createServiceEvent(
        base,
        allDay("ANNUAL_LEAVE", "2026-09-10"),
        device("b"),
      ),
    );
    expect(merged(a.data, b.data).data.events.map((event) => event.id)).toEqual(
      [a.value.id],
    );
    expect(merged(b.data, a.data).data.events.map((event) => event.id)).toEqual(
      [b.value.id],
    );
  });

  it("never mutates either input and ignores documentRevision", () => {
    const { a, b } = divergedPair();
    const snapshotA = structuredClone(a);
    const snapshotB = structuredClone(b);
    const normal = merged(a, b);
    const huge = merged(a, { ...b, documentRevision: 1_000_000 });
    expect(a).toEqual(snapshotA);
    expect(b).toEqual(snapshotB);
    expect(huge.data).toEqual(normal.data);
    expect(normal.data.documentRevision).toBe(a.documentRevision);
  });

  it("is deterministic regardless of incoming array order", () => {
    const { a, b } = divergedPair();
    const shuffled: UserData = {
      ...b,
      events: [...b.events].reverse() as ServiceEvent[],
      leaveAdjustments: [...b.leaveAdjustments].reverse(),
      attendanceMonths: [...b.attendanceMonths].reverse(),
    };
    expect(merged(a, shuffled).data).toEqual(merged(a, b).data);
  });
});
