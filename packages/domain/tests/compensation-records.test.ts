import { describe, expect, it } from "vitest";

import {
  createBackup,
  decodeUserData,
  deleteCompensationSnapshot,
  mergeUserData,
  parseBackup,
  saveAttendanceMonth,
  saveCompensationSnapshot,
  serializeBackup,
  serviceProfileInputSchema,
  type UserData,
  type YearMonth,
} from "../src";
import { context, userDataWithProfile } from "./helpers";

const MERGE_CTX = { now: "2026-09-24T05:00:00.000Z", deviceId: "device-b" };

function saveMonth(
  data: UserData,
  month: string,
  extra: Partial<Parameters<typeof saveAttendanceMonth>[1]> = {},
  now?: string,
) {
  const result = saveAttendanceMonth(
    data,
    {
      month: month as YearMonth,
      nonWorkingDates: [],
      dayOverrides: [],
      hadNonPayableAbsence: false,
      ...extra,
    },
    context(now),
  );
  if (!result.ok) throw new Error(result.errors[0]?.message);
  return result;
}

function snapshotInput(total: number | null = 1_416_000) {
  return {
    month: "2026-10" as YearMonth,
    ruleId: "kr.mma.social-service.compensation",
    ruleVersion: "2026",
    total,
    evaluation: { status: total === null ? "PARTIAL" : "COMPLETE", total },
  };
}

describe("attendance month confirmation", () => {
  it("keeps one live record per month and bumps its revision on re-save", () => {
    const first = saveMonth(userDataWithProfile(), "2026-10", {
      nonWorkingDates: ["2026-10-09", "2026-10-05", "2026-10-09"] as never,
    });
    expect(first.value.nonWorkingDates).toEqual(["2026-10-05", "2026-10-09"]);
    const second = saveMonth(
      first.data,
      "2026-10",
      { hadNonPayableAbsence: true },
      "2026-09-25T00:00:00.000Z",
    );
    expect(second.data.attendanceMonths).toHaveLength(1);
    expect(second.value).toMatchObject({
      id: first.value.id,
      revision: 2,
      hadNonPayableAbsence: true,
    });
  });

  it("rejects dates outside the confirmed month", () => {
    const result = saveAttendanceMonth(
      userDataWithProfile(),
      {
        month: "2026-10" as YearMonth,
        nonWorkingDates: ["2026-11-02"] as never,
        dayOverrides: [],
        hadNonPayableAbsence: false,
      },
      context(),
    );
    expect(result.ok).toBe(false);
  });
});

describe("compensation snapshots", () => {
  it("stores the rule version used and survives a later deletion as history", () => {
    const saved = saveCompensationSnapshot(
      userDataWithProfile(),
      snapshotInput(),
      context(),
    );
    if (!saved.ok) throw new Error("save failed");
    expect(saved.value).toMatchObject({
      ruleVersion: "2026",
      total: 1_416_000,
      revision: 1,
    });
    const deleted = deleteCompensationSnapshot(
      saved.data,
      saved.value.id,
      context(),
    );
    if (!deleted.ok) throw new Error("delete failed");
    expect(deleted.data.compensationSnapshots[0]?.deletedAt).not.toBeNull();
    expect(deleted.data.compensationSnapshots[0]?.ruleVersion).toBe("2026");
  });

  it("round-trips through a backup", () => {
    const saved = saveCompensationSnapshot(
      saveMonth(userDataWithProfile(), "2026-10").data,
      snapshotInput(null),
      context(),
    );
    if (!saved.ok) throw new Error("save failed");
    const parsed = parseBackup(
      serializeBackup(createBackup(saved.data, "2026-09-24T00:00:00.000Z")),
    );
    expect(parsed.ok && parsed.data).toEqual(saved.data);
    expect(parsed.ok && parsed.summary).toMatchObject({
      attendanceMonths: 1,
      compensationSnapshots: 1,
    });
  });
});

describe("schema v3 migration", () => {
  it("upgrades a v2 document with empty compensation collections", () => {
    const { attendanceMonths, compensationSnapshots, ...rest } =
      userDataWithProfile();
    void attendanceMonths;
    void compensationSnapshots;
    const decoded = decodeUserData({ ...rest, schemaVersion: 2 });
    expect(decoded).toMatchObject({ kind: "OK", migratedFrom: 2 });
    if (decoded.kind === "OK") {
      expect(decoded.data.schemaVersion).toBe(3);
      expect(decoded.data.attendanceMonths).toEqual([]);
      expect(decoded.data.compensationSnapshots).toEqual([]);
    }
  });

  it("reads a v2 profile without the new fields as unanswered", () => {
    const parsed = serviceProfileInputSchema.parse({
      callUpDate: "2026-05-04",
      expectedDischargeDate: "2028-02-03",
    });
    expect(parsed).toMatchObject({
      priorServiceBasis: null,
      priorServiceCreditedMonths: null,
      priorServiceCreditHasPartialMonth: false,
      workPattern: null,
      workWeekdays: null,
    });
  });

  it("refuses prior-service details without a prior-service answer", () => {
    expect(
      serviceProfileInputSchema.safeParse({
        callUpDate: "2026-05-04",
        expectedDischargeDate: "2028-02-03",
        priorServiceCredit: "NONE",
        priorServiceCreditedMonths: 3,
      }).success,
    ).toBe(false);
  });
});

describe("merging compensation records", () => {
  it("keeps the current month confirmation over a different backup record", () => {
    const base = userDataWithProfile();
    const current = saveMonth(base, "2026-10", {
      nonWorkingDates: ["2026-10-05"] as never,
    }).data;
    const incoming = saveMonth(base, "2026-10", {
      nonWorkingDates: ["2026-10-09"] as never,
    }).data;
    const merged = mergeUserData(current, incoming, MERGE_CTX);
    if (!merged.ok) throw new Error(merged.error);
    const live = merged.data.attendanceMonths.filter(
      (item) => item.deletedAt === null,
    );
    expect(live).toHaveLength(1);
    expect(live[0]?.nonWorkingDates).toEqual(["2026-10-05"]);
    expect(merged.stats.conflicts.join(" ")).toContain("2026-10");
  });

  it("takes a newer revision of the same month record", () => {
    const first = saveMonth(userDataWithProfile(), "2026-10");
    const newer = saveMonth(
      first.data,
      "2026-10",
      { hadNonPayableAbsence: true },
      "2026-09-26T00:00:00.000Z",
    );
    const merged = mergeUserData(first.data, newer.data, MERGE_CTX);
    if (!merged.ok) throw new Error(merged.error);
    expect(merged.data.attendanceMonths[0]?.hadNonPayableAbsence).toBe(true);
    expect(merged.stats.updatedAttendanceMonths).toBe(1);
  });

  it("adds snapshots and never deletes a live one from a backup tombstone", () => {
    const saved = saveCompensationSnapshot(
      userDataWithProfile(),
      snapshotInput(),
      context(),
    );
    if (!saved.ok) throw new Error("save failed");
    const deleted = deleteCompensationSnapshot(
      saved.data,
      saved.value.id,
      context(),
    );
    if (!deleted.ok) throw new Error("delete failed");
    const kept = mergeUserData(saved.data, deleted.data, MERGE_CTX);
    if (!kept.ok) throw new Error(kept.error);
    expect(kept.data.compensationSnapshots[0]?.deletedAt).toBeNull();

    const added = mergeUserData(userDataWithProfile(), saved.data, MERGE_CTX);
    if (!added.ok) throw new Error(added.error);
    expect(added.stats.addedCompensationSnapshots).toBe(1);
    expect(added.data.compensationSnapshots[0]?.ruleVersion).toBe("2026");
  });
});
