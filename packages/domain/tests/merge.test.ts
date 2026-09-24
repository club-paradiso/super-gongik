import { beforeEach, describe, expect, it } from "vitest";

import {
  addLeaveCorrection,
  commitImport,
  confirmLeaveCredit,
  createServiceEvent,
  deleteLeaveAdjustment,
  deleteServiceEvent,
  importConsistencyIssues,
  isLive,
  mergeUserData,
  replaceUserData,
  rollbackImport,
  userDataSchema,
  type ImportDraft,
  type UserData,
} from "../src";
import { allDay, context, partial, userDataWithProfile } from "./helpers";

const CTX = { now: "2026-09-24T05:00:00.000Z", deviceId: "device-merge" };

// One id generator per test so fixture records never share ids.
let shared = context();
beforeEach(() => {
  shared = context();
});

function ok<T>(result: { ok: true; data: UserData; value: T } | { ok: false }) {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result;
}

function merge(current: UserData, incoming: UserData) {
  const result = mergeUserData(current, incoming, CTX);
  if (!result.ok) throw new Error(result.error);
  // Every merge result must be a valid, internally consistent document.
  expect(userDataSchema.safeParse(result.data).success).toBe(true);
  expect(importConsistencyIssues(result.data)).toEqual([]);
  return result;
}

function withImport(data: UserData, batchId = "batch-1") {
  const drafts: ImportDraft[] = [
    {
      draft: allDay("ANNUAL_LEAVE", "2026-06-12"),
      source: {
        kind: "IMPORT",
        batchId,
        format: "CSV",
        fileName: "a.csv",
        fingerprint: `fp-${batchId}`,
        confidence: 1,
        sourceRowIndex: 2,
      },
    },
  ];
  return ok(
    commitImport(
      data,
      {
        batch: {
          id: batchId,
          fileName: "a.csv",
          sourceFormat: "CSV",
          fileSha256: null,
          createdAt: "2026-09-01T00:00:00.000Z",
        },
        drafts,
        snapshots: [
          {
            leaveType: "ANNUAL_LEAVE",
            asOfDate: "2026-06-30",
            grantedDays: 15,
            grantedMinutes: null,
            usedDays: 1,
            usedMinutes: null,
            remainingDays: 14,
            remainingMinutes: 0,
            confidence: 1,
            sourceRowIndex: 3,
          },
        ],
      },
      shared,
    ),
  ).data;
}

describe("merge is non-destructive recovery", () => {
  it("1. keeps a current live event when the backup has it deleted", () => {
    const current = ok(
      createServiceEvent(
        userDataWithProfile(),
        allDay("ANNUAL_LEAVE", "2026-09-10"),
        shared,
      ),
    );
    const backup = ok(
      deleteServiceEvent(current.data, current.value.id, shared),
    ).data;
    expect(backup.events[0]!.revision).toBeGreaterThan(current.value.revision);

    const result = merge(current.data, backup);
    expect(result.data.events.filter(isLive)).toHaveLength(1);
    expect(result.stats.keptLiveOverBackupDeletion).toBe(1);
  });

  it("2. restores a locally deleted event that is live in the backup", () => {
    const backup = ok(
      createServiceEvent(
        userDataWithProfile(),
        allDay("ANNUAL_LEAVE", "2026-09-10"),
        shared,
      ),
    );
    const current = ok(
      deleteServiceEvent(backup.data, backup.value.id, shared),
    ).data;

    const result = merge(current, backup.data);
    const restored = result.data.events.find(
      (event) => event.id === backup.value.id,
    )!;
    expect(isLive(restored)).toBe(true);
    expect(restored.revision).toBe(3);
    expect(result.stats.restoredEvents).toBe(1);
  });

  it("2b. does not restore a deleted event that would now double-charge leave", () => {
    const backup = ok(
      createServiceEvent(
        userDataWithProfile(),
        allDay("ANNUAL_LEAVE", "2026-09-10"),
        shared,
      ),
    );
    const deleted = ok(
      deleteServiceEvent(backup.data, backup.value.id, shared),
    ).data;
    const current = ok(
      createServiceEvent(
        deleted,
        partial("SICK_LEAVE", "2026-09-10", 60),
        shared,
      ),
    ).data;

    const result = merge(current, backup.data);
    expect(
      result.data.events.filter(isLive).map((event) => event.eventType),
    ).toEqual(["SICK_LEAVE"]);
    expect(result.stats.skippedConflictingEvents).toBe(1);
    expect(result.stats.conflicts[0]).toContain("겹쳐");
  });

  it("3. keeps an active import active when the backup has it rolled back", () => {
    const current = withImport(userDataWithProfile());
    const backup = ok(rollbackImport(current, "batch-1", shared)).data;

    const result = merge(current, backup);
    const record = result.data.imports.find((item) => item.id === "batch-1")!;
    expect(record.status).toBe("ACTIVE");
    expect(result.data.events.filter(isLive)).toHaveLength(1);
    expect(result.data.leaveSnapshots.filter(isLive)).toHaveLength(1);
  });

  it("4. reactivates a rolled-back import from an active backup, with its records", () => {
    const backup = withImport(userDataWithProfile());
    const current = ok(rollbackImport(backup, "batch-1", shared)).data;

    const result = merge(current, backup);
    const record = result.data.imports.find((item) => item.id === "batch-1")!;
    expect(record).toMatchObject({ status: "ACTIVE", rolledBackAt: null });
    expect(result.data.events.filter(isLive)).toHaveLength(1);
    expect(result.data.leaveSnapshots.filter(isLive)).toHaveLength(1);
    expect(result.stats).toMatchObject({
      restoredEvents: 1,
      restoredSnapshots: 1,
      reactivatedImports: 1,
    });
  });

  it("5. keeps snapshots with their batch when the batch's events cannot return", () => {
    const backup = withImport(userDataWithProfile());
    const rolledBack = ok(rollbackImport(backup, "batch-1", shared)).data;
    // A manual sick day now occupies the imported date.
    const current = ok(
      createServiceEvent(
        rolledBack,
        allDay("SICK_LEAVE", "2026-06-12"),
        shared,
      ),
    ).data;

    const result = merge(current, backup);
    const record = result.data.imports.find((item) => item.id === "batch-1")!;
    expect(record.status).toBe("ROLLED_BACK");
    expect(result.data.leaveSnapshots.filter(isLive)).toHaveLength(0);
    expect(result.stats.skippedConflictingEvents).toBe(1);
  });

  it("6. never duplicates credit confirmations or corrections and ignores adjustment tombstones", () => {
    const base = ok(
      confirmLeaveCredit(
        userDataWithProfile(),
        {
          creditKey: "YEAR_1",
          grantDate: "2026-05-04",
          days: 15,
          reason: "기관 확인",
        },
        shared,
      ),
    ).data;
    const withCorrection = ok(
      addLeaveCorrection(
        base,
        {
          effectiveDate: "2026-09-01",
          halfDays: -1,
          minutes: 0,
          reason: "기관 기록 반영",
        },
        shared,
      ),
    );

    // Backup deleted the correction; current keeps it.
    const backup = ok(
      deleteLeaveAdjustment(
        withCorrection.data,
        withCorrection.value.id,
        shared,
      ),
    ).data;
    let result = merge(withCorrection.data, backup);
    expect(result.data.leaveAdjustments.filter(isLive)).toHaveLength(2);

    // Another device confirmed the same credit with a different value.
    const otherDevice = ok(
      confirmLeaveCredit(
        userDataWithProfile(),
        {
          creditKey: "YEAR_1",
          grantDate: "2026-05-04",
          days: 14,
          reason: "다른 기기",
        },
        { ...shared, createId: () => "other-confirmation" },
      ),
    ).data;
    result = merge(withCorrection.data, otherDevice);
    const confirmations = result.data.leaveAdjustments.filter(
      (item) => isLive(item) && item.kind === "GRANT_CONFIRMATION",
    );
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]!.amountHalfDays).toBe(30);
    expect(result.stats.skippedAdjustments).toBe(1);

    // The same correction recreated with a new id is not counted twice.
    const recreated: UserData = {
      ...withCorrection.data,
      leaveAdjustments: withCorrection.data.leaveAdjustments.map((item) =>
        item.kind === "CORRECTION" ? { ...item, id: "copy" } : item,
      ),
    };
    result = merge(withCorrection.data, recreated);
    expect(
      result.data.leaveAdjustments.filter(
        (item) => isLive(item) && item.kind === "CORRECTION",
      ),
    ).toHaveLength(1);
  });
});

describe("replace is exact restoration", () => {
  it("takes the backup verbatim, deletions included, keeping only device identity", () => {
    const current = withImport(userDataWithProfile());
    const backup = ok(rollbackImport(current, "batch-1", shared)).data;
    const replaced = replaceUserData(
      { ...current, deviceId: "this-device" },
      backup,
    );
    expect(replaced.events).toEqual(backup.events);
    expect(replaced.imports).toEqual(backup.imports);
    expect(replaced.deviceId).toBe("this-device");
    expect(importConsistencyIssues(replaced)).toEqual([]);
  });
});
