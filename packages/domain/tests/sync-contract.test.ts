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

describe("record version rules", () => {
  it("A. a higher incoming revision replaces the local record", () => {
    const { base, id } = shared();
    const remote = edit(base, id, "원격 수정", device("remote"));
    const result = merged(base, remote);
    expect(eventOf(result.data, id).note).toBe("원격 수정");
    expect(eventOf(result.data, id).revision).toBe(2);
    expect(result.counts.events.UPDATED).toBe(1);
  });

  it("B. a lower incoming revision never overwrites a newer local record", () => {
    const { base, id } = shared();
    const local = edit(base, id, "로컬 수정", device("here"));
    const result = merged(local, base);
    expect(eventOf(result.data, id)).toEqual(eventOf(local, id));
    expect(result.counts.events.RETAINED_LOCAL).toBe(1);
  });

  it("C. equal revision with identical content is a no-op, whatever the write metadata", () => {
    const { base, id } = shared();
    const sameContent: UserData = {
      ...base,
      events: base.events.map((event) =>
        event.id === id
          ? {
              ...event,
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

  it("D. equal revision with divergent content is a structured conflict, never a silent winner", () => {
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
      const result = mergeUserData(a, b, MERGE_CTX);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("UNRESOLVED_CONFLICTS");
      expect(result.conflicts).toEqual([
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
      // Conflicts carry version metadata only, not user text.
      expect(JSON.stringify(result.conflicts)).not.toContain("비밀");
    }

    // The later wall-clock time does not win on its own.
    const plan = planRestore(here, there, { mode: "MERGE", ...MERGE_CTX });
    expect(plan.blocked?.reason).toBe("UNRESOLVED_CONFLICTS");
    expect(plan.result).toBeNull();
  });

  it("D. an explicit resolution applies the chosen side above both revisions, and is then stable", () => {
    const { base, id } = shared();
    const here = edit(base, id, "여기", device("here"));
    const there = edit(base, id, "저기", device("there"));

    const keepLocal = merged(here, there, {
      resolutions: { [`events:${id}`]: "LOCAL" },
    });
    expect(eventOf(keepLocal.data, id)).toMatchObject({
      note: "여기",
      revision: 3,
    });
    expect(keepLocal.counts.events.RESOLVED_LOCAL).toBe(1);
    // Merging the same incoming copy again no longer conflicts.
    expect(merged(keepLocal.data, there).data.events).toEqual(
      keepLocal.data.events,
    );

    const takeIncoming = merged(here, there, {
      resolutions: { [`events:${id}`]: "INCOMING" },
    });
    expect(eventOf(takeIncoming.data, id)).toMatchObject({
      note: "저기",
      revision: 3,
      deviceId: MERGE_CTX.deviceId,
    });
    expect(merged(takeIncoming.data, there).data.events).toEqual(
      takeIncoming.data.events,
    );
  });

  it("D. divergence is detected in every collection, including records without revisions", () => {
    const data = fullDocument();
    const divergent: UserData = JSON.parse(JSON.stringify(data));
    divergent.profile!.defaultCommuteCost = 9999; // same updatedAt
    divergent.leaveAdjustments[0]!.reason = "다른 사유";
    divergent.leaveSnapshots[0]!.remainingDays = 3;
    divergent.imports[0]!.fileName = "renamed.csv";
    divergent.attendanceMonths[0]!.nonWorkingDates = [];
    divergent.compensationSnapshots[0]!.total = 1;

    const result = mergeUserData(data, divergent, MERGE_CTX);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.conflicts.map((conflict) => conflict.collection).sort(),
    ).toEqual([
      "attendanceMonths",
      "compensationSnapshots",
      "imports",
      "leaveAdjustments",
      "leaveSnapshots",
      "profile",
    ]);
    expect(
      result.conflicts
        .filter((conflict) => conflict.type === "IMMUTABLE_RECORD_DIVERGENT")
        .map((conflict) => conflict.collection)
        .sort(),
    ).toEqual(["imports", "leaveSnapshots"]);
  });
});

describe("tombstones", () => {
  it("E. a stale edit cannot resurrect a newer deletion", () => {
    const { base, id } = shared();
    const staleEdit = edit(base, id, "오래된 수정", device("stale")); // rev 2
    const deletedHere = must(
      deleteServiceEvent(
        edit(base, id, "x", device("here")),
        id,
        device("here"),
      ),
    ).data; // rev 3, deleted
    for (const options of [{}, { incomingDeletions: "APPLY_NEWER" as const }]) {
      const result = merged(deletedHere, staleEdit, options);
      expect(isLive(eventOf(result.data, id))).toBe(false);
      expect(result.changes).toEqual([
        { collection: "events", recordId: id, outcome: "LOCAL_DELETION_KEPT" },
      ]);
    }
  });

  it("E. deletion and edit made from the same revision conflict instead of racing", () => {
    const { base, id } = shared();
    const edited = edit(base, id, "수정", device("a")); // rev 2 live
    const deleted = must(deleteServiceEvent(base, id, device("b"))).data; // rev 2 deleted
    const result = mergeUserData(deleted, edited, MERGE_CTX);
    expect(result).toMatchObject({ ok: false, reason: "UNRESOLVED_CONFLICTS" });
    if (result.ok) return;
    expect(result.conflicts[0]).toMatchObject({
      local: { deleted: true },
      incoming: { deleted: false },
    });
  });

  it("F. restoring an older backup over a newer deletion keeps the deletion (MERGE) and says so; REPLACE shows it will come back", () => {
    const { base: backup, id } = shared();
    const now = must(deleteServiceEvent(backup, id, device("here"))).data;

    const plan = planRestore(now, backup, { mode: "MERGE", ...MERGE_CTX });
    expect(plan.blocked).toBeNull();
    expect(plan.counts.events.LOCAL_DELETION_KEPT).toBe(1);
    expect(isLive(eventOf(plan.result!, id))).toBe(false);

    const replace = planRestore(now, backup, { mode: "REPLACE", ...MERGE_CTX });
    expect(replace.destructive).toBe(true);
    expect(replace.counts.events.RESTORED).toBe(1);
  });

  it("F. a newer incoming deletion is reported but not applied by recovery merge; the sync policy applies it", () => {
    const { base, id } = shared();
    const remoteDeleted = must(
      deleteServiceEvent(base, id, device("remote")),
    ).data;

    const recovery = merged(base, remoteDeleted);
    expect(isLive(eventOf(recovery.data, id))).toBe(true);
    expect(recovery.counts.events.INCOMING_DELETION_NOT_APPLIED).toBe(1);

    const sync = merged(base, remoteDeleted, {
      incomingDeletions: "APPLY_NEWER",
    });
    expect(isLive(eventOf(sync.data, id))).toBe(false);
    expect(sync.counts.events.DELETED).toBe(1);
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
    const morning = must(
      createServiceEvent(
        base,
        {
          ...partial("OUTING", "2026-09-10", 60),
          timing: {
            kind: "PARTIAL",
            durationMinutes: 60,
            startTime: "09:00",
            endTime: "10:00",
          },
        },
        device("a"),
      ),
    ).data;
    const afternoon = must(
      createServiceEvent(
        base,
        {
          ...partial("OUTING", "2026-09-10", 60),
          timing: {
            kind: "PARTIAL",
            durationMinutes: 60,
            startTime: "15:00",
            endTime: "16:00",
          },
        },
        device("b"),
      ),
    ).data;
    const result = merged(morning, afternoon);
    expect(result.data.events.filter(isLive)).toHaveLength(2);
  });
});

describe("reconnecting stale devices", () => {
  it("H. a device that missed many revisions neither overwrites nor loses newer records", () => {
    const { base, id } = shared();
    // The busy device edits the event six times and adds and deletes others.
    let busy = base;
    for (let i = 0; i < 6; i += 1)
      busy = edit(busy, id, `수정 ${i}`, device("busy"));
    const added = must(
      createServiceEvent(
        busy,
        allDay("ANNUAL_LEAVE", "2026-10-02"),
        device("busy"),
      ),
    );
    busy = must(
      deleteServiceEvent(added.data, added.value.id, device("busy")),
    ).data;
    busy = must(
      createServiceEvent(
        busy,
        partial("OUTING", "2026-10-05", 30),
        device("busy"),
      ),
    ).data;

    // The stale device only has the original.
    const staleIntoBusy = merged(busy, base);
    expect(sortedRecords(staleIntoBusy.data)).toEqual(sortedRecords(busy));

    const busyIntoStale = merged(base, busy);
    expect(eventOf(busyIntoStale.data, id)).toEqual(eventOf(busy, id));
    expect(sortedRecords(busyIntoStale.data)).toEqual(sortedRecords(busy));
  });
});

describe("algebraic properties", () => {
  function divergedPair() {
    const origin = fullDocument();
    const liveId = origin.events.find(
      (event) => isLive(event) && event.source.kind === "MANUAL",
    )!.id;
    const a = must(
      createServiceEvent(
        edit(origin, liveId, "A 기기 수정", device("a")),
        allDay("ANNUAL_LEAVE", "2026-10-06"),
        device("a"),
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
        device("b"),
      ),
    ).data;
    b = must(
      createServiceEvent(b, partial("OUTING", "2026-10-07", 30), device("b")),
    ).data;
    const other = origin.events.find(
      (event) =>
        isLive(event) && event.id !== liveId && event.source.kind === "MANUAL",
    )!;
    b = must(deleteServiceEvent(b, other.id, device("b"))).data;
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
      expect(
        twice.changes.filter(
          (change) =>
            change.outcome !== "INCOMING_DELETION_NOT_APPLIED" &&
            change.outcome !== "LOCAL_DELETION_KEPT" &&
            change.outcome !== "DUPLICATE",
        ),
      ).toEqual([]);
    }
  });

  it("J. with the sync deletion policy and no conflicts, merge direction does not change the records", () => {
    const { a, b } = divergedPair();
    const ab = merged(a, b, { incomingDeletions: "APPLY_NEWER" });
    const ba = merged(b, a, { incomingDeletions: "APPLY_NEWER" });
    expect(sortedRecords(ab.data)).toEqual(sortedRecords(ba.data));
    // Document metadata is per device and always comes from the local side.
    expect(ab.data.deviceId).toBe(a.deviceId);
    expect(ba.data.deviceId).toBe(b.deviceId);
  });

  it("J. recovery merge is intentionally not commutative for deletions", () => {
    const { a, b } = divergedPair();
    const ab = merged(a, b);
    const ba = merged(b, a);
    // A keeps the record B deleted; B keeps its own deletion.
    expect(sortedRecords(ab.data)).not.toEqual(sortedRecords(ba.data));
    expect(ab.counts.events.INCOMING_DELETION_NOT_APPLIED).toBe(1);
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
