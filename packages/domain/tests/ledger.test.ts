import { describe, expect, it } from "vitest";

import {
  addLeaveCorrection,
  buildLeaveLedger,
  commitImport,
  confirmLeaveCredit,
  createServiceEvent,
  formatLeaveQuantity,
  type AnnualLeaveCreditInput,
  type LeaveSnapshot,
  type UserData,
} from "../src";
import {
  allDay,
  context,
  halfDay,
  partial,
  userDataWithProfile,
} from "./helpers";

const verifiedCredits: AnnualLeaveCreditInput[] = [
  {
    key: "YEAR_1",
    label: "1년차 연가",
    grantDate: "2026-05-04",
    status: "RULE_VERIFIED",
    days: 15,
    referenceDays: 15,
    ruleId: "leave",
    ruleVersion: "2026-04-23",
    explanation: "",
  },
  {
    key: "YEAR_2",
    label: "2년차 연가",
    grantDate: "2027-05-04",
    status: "RULE_VERIFIED",
    days: 13,
    referenceDays: 13,
    ruleId: "leave",
    ruleVersion: "2026-08-28",
    explanation: "",
  },
];

function withEvents(
  ...drafts: Parameters<typeof createServiceEvent>[1][]
): UserData {
  let data = userDataWithProfile();
  for (const draft of drafts) {
    const result = createServiceEvent(data, draft, context());
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    data = result.data;
  }
  return data;
}

function ledger(
  data: UserData,
  options: {
    credits?: AnnualLeaveCreditInput[];
    workdayMinutes?: number | null;
    today?: string;
    snapshots?: LeaveSnapshot[];
  } = {},
) {
  return buildLeaveLedger({
    credits: options.credits ?? verifiedCredits,
    events: data.events,
    adjustments: data.leaveAdjustments,
    snapshots: options.snapshots ?? data.leaveSnapshots,
    workdayMinutes: options.workdayMinutes ?? null,
    today: (options.today ?? "2026-09-24") as "2026-09-24",
  });
}

describe("event-derived annual leave ledger", () => {
  it("counts full-day and multi-day leave in whole days", () => {
    const result = ledger(
      withEvents(
        allDay("ANNUAL_LEAVE", "2026-06-01"),
        allDay("ANNUAL_LEAVE", "2026-07-06", "2026-07-08", 3),
      ),
    );
    expect(result.balance.granted).toEqual({ halfDays: 30, minutes: 0 });
    expect(result.balance.used).toEqual({ halfDays: 8, minutes: 0 });
    expect(result.balance.remainingAfterScheduled).toEqual({
      halfDays: 22,
      minutes: 0,
    });
    expect(result.balance.status).toBe("RESOLVED");
    expect(
      formatLeaveQuantity(result.balance.remainingAfterScheduled, null),
    ).toBe("11일");
    // The second-year credit is not available before its grant date.
    expect(result.balance.upcomingCredits).toEqual({
      halfDays: 26,
      minutes: 0,
    });
  });

  it("charges half days as a day unit and never as assumed minutes", () => {
    const result = ledger(
      withEvents(halfDay("2026-06-01", "AM"), halfDay("2026-06-02", "PM")),
    );
    expect(result.balance.used).toEqual({ halfDays: 2, minutes: 0 });
    expect(
      formatLeaveQuantity(result.balance.remainingAfterScheduled, null),
    ).toBe("14일");
  });

  it("keeps multiple partial-minute usages separate until the workday is known", () => {
    const data = withEvents(
      partial("ANNUAL_LEAVE", "2026-06-01", 90),
      partial("ANNUAL_LEAVE", "2026-06-03", 120),
    );
    const unknown = ledger(data);
    expect(unknown.balance.used).toEqual({ halfDays: 0, minutes: 210 });
    expect(unknown.balance.status).toBe("NEEDS_WORKDAY_MINUTES");
    expect(
      formatLeaveQuantity(unknown.balance.remainingAfterScheduled, null),
    ).toBe("15일 − 3시간 30분");

    const known = ledger(data, { workdayMinutes: 480 });
    expect(known.balance.status).toBe("RESOLVED");
    expect(
      formatLeaveQuantity(known.balance.remainingAfterScheduled, 480),
    ).toBe("14일 4시간 30분");
  });

  it("separates scheduled future leave from used leave", () => {
    const result = ledger(withEvents(allDay("ANNUAL_LEAVE", "2026-10-05")));
    expect(result.balance.used).toEqual({ halfDays: 0, minutes: 0 });
    expect(result.balance.scheduled).toEqual({ halfDays: 2, minutes: 0 });
    expect(result.balance.available).toEqual({ halfDays: 30, minutes: 0 });
    expect(result.entries.at(-1)?.scheduled).toBe(true);
  });

  it("excludes unresolved imported durations and says so", () => {
    let data = userDataWithProfile();
    const result = commitImport(
      data,
      {
        batch: {
          id: "b1",
          fileName: "a.csv",
          sourceFormat: "CSV",
          fileSha256: null,
          createdAt: "2026-09-01T00:00:00.000Z",
        },
        drafts: [
          {
            draft: partial("ANNUAL_LEAVE", "2026-06-01", null),
            source: {
              kind: "IMPORT",
              batchId: "b1",
              format: "CSV",
              fileName: "a.csv",
              fingerprint: "fp",
              confidence: 0.8,
              sourceRowIndex: 2,
            },
          },
        ],
        snapshots: [],
      },
      context(),
    );
    if (!result.ok) throw new Error("commit failed");
    data = result.data;
    const summary = ledger(data);
    expect(summary.balance.unresolvedEventIds).toHaveLength(1);
    expect(summary.balance.used).toEqual({ halfDays: 0, minutes: 0 });
    expect(summary.warnings.join(" ")).toContain("확인되지 않은");
  });

  it("does not count a credit without a verified rule until the user confirms it", () => {
    const pending: AnnualLeaveCreditInput[] = [
      { ...verifiedCredits[0], status: "PENDING_CONFIRMATION", days: null },
      verifiedCredits[1],
    ];
    const before = ledger(userDataWithProfile(), { credits: pending });
    expect(before.balance.status).toBe("NEEDS_CREDIT_CONFIRMATION");
    expect(before.balance.granted).toEqual({ halfDays: 0, minutes: 0 });

    const confirmed = confirmLeaveCredit(
      userDataWithProfile(),
      {
        creditKey: "YEAR_1",
        grantDate: "2026-05-04",
        days: 15,
        reason: "기관 확인",
      },
      context(),
    );
    if (!confirmed.ok) throw new Error("confirm failed");
    const after = ledger(confirmed.data, { credits: pending });
    expect(after.balance.status).toBe("RESOLVED");
    expect(after.balance.granted).toEqual({ halfDays: 30, minutes: 0 });
    expect(after.credits[0]?.state).toBe("CONFIRMED_BY_USER");
  });

  it("applies explicit corrections and reconciles with institution snapshots", () => {
    const data = withEvents(allDay("ANNUAL_LEAVE", "2026-06-01"));
    const snapshot: LeaveSnapshot = {
      id: "s1",
      serviceProfileId: "profile-1",
      importBatchId: "b1",
      leaveType: "ANNUAL_LEAVE",
      asOfDate: "2026-09-01",
      grantedDays: 15,
      grantedMinutes: null,
      usedDays: 1.5,
      usedMinutes: null,
      remainingDays: 13.5,
      remainingMinutes: 0,
      confidence: 1,
      sourceRowIndex: 2,
      createdAt: "2026-09-02T00:00:00.000Z",
      deletedAt: null,
    };

    const different = ledger(data, { snapshots: [snapshot] });
    expect(different.reconciliation).toMatchObject({
      status: "DIFFERENT",
      comparedAt: "2026-09-01",
      difference: { halfDays: -1, minutes: 0 },
    });

    const corrected = addLeaveCorrection(
      data,
      {
        effectiveDate: "2026-09-01",
        halfDays: -1,
        minutes: 0,
        reason: "기관 기록 반영",
      },
      context(),
    );
    if (!corrected.ok) throw new Error("correction failed");
    const matched = ledger(corrected.data, { snapshots: [snapshot] });
    expect(matched.reconciliation.status).toBe("MATCH");
    expect(matched.balance.corrections).toEqual({ halfDays: -1, minutes: 0 });
    expect(matched.entries.map((entry) => entry.kind)).toEqual([
      "CREDIT",
      "USAGE",
      "CORRECTION",
    ]);
  });

  it("refuses to compare fractional institution days that are not half days", () => {
    const snapshot = {
      id: "s1",
      serviceProfileId: "profile-1",
      importBatchId: "b1",
      leaveType: "ANNUAL_LEAVE" as const,
      asOfDate: "2026-09-01" as const,
      grantedDays: null,
      grantedMinutes: null,
      usedDays: null,
      usedMinutes: null,
      remainingDays: 13.3,
      remainingMinutes: null,
      confidence: 1,
      sourceRowIndex: 2,
      createdAt: "2026-09-02T00:00:00.000Z",
      deletedAt: null,
    };
    expect(
      ledger(userDataWithProfile(), { snapshots: [snapshot] }).reconciliation
        .status,
    ).toBe("NOT_COMPARABLE");
  });

  it("warns about overlapping leave already stored before validation existed", () => {
    const data = withEvents(allDay("ANNUAL_LEAVE", "2026-06-01"));
    const legacyDuplicate = {
      ...data.events[0]!,
      id: "legacy-copy",
      timing: {
        kind: "PARTIAL" as const,
        durationMinutes: 120,
        startTime: null,
        endTime: null,
      },
    };
    const result = ledger({
      ...data,
      events: [...data.events, legacyDuplicate],
    });
    expect(result.warnings.join(" ")).toContain(
      "두 번 차감하는 휴가 기록이 1쌍",
    );
  });

  it("deducts authorized attendance from annual leave at eight hours per day", () => {
    const partialResult = ledger(
      withEvents(
        partial("LATE_ARRIVAL", "2026-06-01", 240),
        partial("OUTING", "2026-06-02", 240),
      ),
    );
    expect(partialResult.balance.used).toEqual({ halfDays: 2, minutes: 0 });
    expect(partialResult.attendanceMinutes).toEqual({
      OUTING: 240,
      LATE_ARRIVAL: 240,
      EARLY_LEAVE: 0,
    });
    expect(partialResult.entries.at(-1)?.running).toEqual({
      halfDays: 28,
      minutes: 0,
    });
    expect(
      formatLeaveQuantity(partialResult.balance.remainingAfterScheduled, 480),
    ).toBe("14일");

    const remainder = ledger(
      withEvents(partial("EARLY_LEAVE", "2026-06-03", 240)),
    );
    expect(remainder.balance.used).toEqual({ halfDays: 0, minutes: 240 });
    expect(
      formatLeaveQuantity(remainder.balance.remainingAfterScheduled, 480),
    ).toBe("14일 4시간");
  });
});
