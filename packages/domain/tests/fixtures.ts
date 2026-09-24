import {
  addLeaveCorrection,
  commitImport,
  confirmLeaveCredit,
  createServiceEvent,
  deleteServiceEvent,
  rollbackImport,
  saveAttendanceMonth,
  saveCompensationSnapshot,
  userDataSchema,
  type CommandContext,
  type ImportDraft,
  type ServiceEvent,
  type UserData,
} from "../src";
import {
  allDay,
  halfDay,
  partial,
  sequentialIds,
  userDataWithProfile,
} from "./helpers";

type Result<T> = { ok: true; data: UserData; value: T } | { ok: false };

function ok<T>(result: Result<T>): { data: UserData; value: T } {
  if (!result.ok)
    throw new Error(`fixture command failed: ${JSON.stringify(result)}`);
  return result;
}

function importInto(
  data: UserData,
  batchId: string,
  date: string,
  ctx: CommandContext,
): UserData {
  const drafts: ImportDraft[] = [
    {
      draft: allDay("ANNUAL_LEAVE", date),
      source: {
        kind: "IMPORT",
        batchId,
        format: "CSV",
        fileName: `${batchId}.csv`,
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
          fileName: `${batchId}.csv`,
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
      ctx,
    ),
  ).data;
}

/**
 * A document with at least one representative record in every persisted
 * collection: live and tombstoned events, a credit confirmation and a
 * correction, institution snapshots, an active and a rolled-back import, an
 * attendance month and a compensation snapshot — all with revisions, device
 * ids and import provenance.
 */
export function fullDocument(): UserData {
  const ctx: CommandContext = {
    now: "2026-09-20T01:00:00.000Z",
    deviceId: "device-fixture",
    createId: sequentialIds("fx"),
  };
  let data: UserData = {
    ...userDataWithProfile({ defaultCommuteCost: 2800 }),
    deviceId: "device-fixture",
    documentRevision: 41,
    savedAt: "2026-09-20T00:59:00.000Z",
  };
  data = ok(
    createServiceEvent(
      data,
      {
        ...allDay("ANNUAL_LEAVE", "2026-07-01"),
        note: "여름 휴가",
        title: "연가",
      },
      ctx,
    ),
  ).data;
  data = ok(createServiceEvent(data, halfDay("2026-07-08", "AM"), ctx)).data;
  data = ok(
    createServiceEvent(
      data,
      {
        ...partial("SICK_LEAVE", "2026-07-15", 120),
        sickLeaveCategory: "ORDINARY",
      },
      ctx,
    ),
  ).data;
  const doomed = ok(
    createServiceEvent(data, allDay("ANNUAL_LEAVE", "2026-07-20"), ctx),
  );
  data = ok(deleteServiceEvent(doomed.data, doomed.value.id, ctx)).data;
  data = ok(
    confirmLeaveCredit(
      data,
      {
        creditKey: "YEAR_1",
        grantDate: "2026-05-04",
        days: 15,
        reason: "기관 확인",
      },
      ctx,
    ),
  ).data;
  data = ok(
    addLeaveCorrection(
      data,
      {
        effectiveDate: "2026-09-01",
        halfDays: -1,
        minutes: 0,
        reason: "기관 기록 반영",
      },
      ctx,
    ),
  ).data;
  data = importInto(data, "batch-active", "2026-06-12", ctx);
  data = importInto(data, "batch-rolled-back", "2026-06-19", ctx);
  data = ok(rollbackImport(data, "batch-rolled-back", ctx)).data;
  data = ok(
    saveAttendanceMonth(
      data,
      {
        month: "2026-07",
        nonWorkingDates: ["2026-07-17"],
        dayOverrides: [],
        hadNonPayableAbsence: false,
      },
      ctx,
    ),
  ).data;
  data = ok(
    saveCompensationSnapshot(
      data,
      {
        month: "2026-07",
        ruleId: "compensation-2026",
        ruleVersion: "2026.1",
        total: 812345,
        evaluation: { lines: [{ code: "MEAL", amount: 1.5 }], note: null },
      },
      ctx,
    ),
  ).data;
  return userDataSchema.parse(data);
}

/**
 * Large but plausible document: about two years of daily records. Built
 * directly (not through commands) so building it stays fast.
 */
export function largeDocument(eventCount = 1500): UserData {
  const base = userDataWithProfile({ expectedDischargeDate: "2031-12-31" });
  const profileId = base.profile!.id;
  const types = [
    "OUTING",
    "ANNUAL_LEAVE",
    "SICK_LEAVE",
    "EARLY_LEAVE",
  ] as const;
  const events: ServiceEvent[] = [];
  const start = Date.UTC(2026, 4, 4);
  for (let i = 0; i < eventCount; i += 1) {
    const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    const eventType = types[i % types.length]!;
    const timing =
      eventType === "ANNUAL_LEAVE"
        ? { kind: "ALL_DAY" as const, dayCount: 1 }
        : {
            kind: "PARTIAL" as const,
            durationMinutes: 30 + (i % 5) * 30,
            startTime: null,
            endTime: null,
          };
    events.push({
      id: `large-event-${String(i).padStart(5, "0")}`,
      serviceProfileId: profileId,
      eventType,
      startDate: day as ServiceEvent["startDate"],
      endDate: day as ServiceEvent["endDate"],
      timing,
      title: null,
      note: i % 7 === 0 ? `메모 ${i}` : null,
      status: "CONFIRMED",
      source:
        i % 3 === 0
          ? {
              kind: "IMPORT",
              batchId: `large-batch-${i % 12}`,
              format: "CSV",
              fileName: "기록.csv",
              fingerprint: `fp-${i}`,
              confidence: 1,
              sourceRowIndex: i,
            }
          : { kind: "MANUAL" },
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      deletedAt: i % 50 === 0 ? "2026-09-02T00:00:00.000Z" : null,
      revision: i % 50 === 0 ? 2 : 1,
      deviceId: "device-large",
    } as ServiceEvent);
  }
  const months = Array.from({ length: 24 }, (_, index) => {
    const month = new Date(Date.UTC(2026, 4 + index, 1))
      .toISOString()
      .slice(0, 7);
    return month;
  });
  return userDataSchema.parse({
    ...base,
    deviceId: "device-large",
    events,
    imports: Array.from({ length: 12 }, (_, index) => ({
      id: `large-batch-${index}`,
      serviceProfileId: profileId,
      fileName: "기록.csv",
      sourceFormat: "CSV",
      fileSha256: null,
      createdAt: `2026-09-01T00:${String(index).padStart(2, "0")}:00.000Z`,
      eventCount: Math.ceil(eventCount / 36),
      snapshotCount: 1,
      skippedDuplicateCount: 0,
      status: "ACTIVE",
      rolledBackAt: null,
    })),
    leaveSnapshots: Array.from({ length: 12 }, (_, index) => ({
      id: `large-snapshot-${index}`,
      serviceProfileId: profileId,
      importBatchId: `large-batch-${index}`,
      leaveType: "ANNUAL_LEAVE",
      asOfDate: "2026-08-31",
      grantedDays: 15,
      grantedMinutes: null,
      usedDays: index,
      usedMinutes: null,
      remainingDays: 15 - index,
      remainingMinutes: 0,
      confidence: 1,
      sourceRowIndex: 1,
      createdAt: "2026-09-01T00:00:00.000Z",
      deletedAt: null,
    })),
    attendanceMonths: months.map((month, index) => ({
      id: `large-attendance-${index}`,
      serviceProfileId: profileId,
      month,
      nonWorkingDates: [],
      dayOverrides: [],
      hadNonPayableAbsence: false,
      nonPayableDates: [],
      nonPayableDatesConfirmed: false,
      roundingPolicy: null,
      basisFingerprint: `basis-${index}`,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      deletedAt: null,
      revision: 1,
      deviceId: "device-large",
    })),
    compensationSnapshots: months.map((month, index) => ({
      id: `large-compensation-${index}`,
      serviceProfileId: profileId,
      month,
      generatedAt: "2026-09-01T00:00:00.000Z",
      ruleId: "compensation-2026",
      ruleVersion: "2026.1",
      total: 500000 + index,
      evaluation: { lines: [{ code: "MEAL", amount: index }] },
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      deletedAt: null,
      revision: 1,
      deviceId: "device-large",
    })),
  });
}
