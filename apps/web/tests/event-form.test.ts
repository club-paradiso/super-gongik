import {
  buildServiceProfile,
  type DateOnly,
  type EventIssue,
  type ServiceEvent,
} from "@super-gongik/domain";
import { describe, expect, it } from "vitest";

import {
  applyFormPatch,
  buildDraft,
  describeDayCount,
  initialState,
  withDayCountConfirmation,
} from "@/lib/event-form";
import {
  attendanceEditorDays,
  attendanceMonthInput,
  evaluateMoneyMonth,
  moneyAsOfDate,
} from "@/lib/money-model";

// The editor and money-screen rules moved out of React components so the
// native client runs the same code. These pin the behaviour that moved.

const profile = buildServiceProfile(
  {
    callUpDate: "2026-05-04",
    expectedDischargeDate: "2028-02-03",
    serviceCategory: null,
    workplaceType: null,
    defaultCommuteCost: null,
    defaultMealAllowanceOverride: null,
    timezone: "Asia/Seoul",
    workdayMinutes: 480,
    workdayStartTime: "09:00",
    workdayEndTime: "18:00",
  },
  { id: "p", localProfileId: "p", timestamp: "2026-05-04T00:00:00.000Z" },
);

describe("event form model", () => {
  const blank = initialState(null, "2026-07-13");

  it("derives the weekday count until the user edits it", () => {
    expect(applyFormPatch(blank, { endDate: "2026-07-19" }).dayCount).toBe("5");
    expect(
      applyFormPatch(
        { ...blank, dayCount: "2", dayCountTouched: true },
        { endDate: "2026-07-19" },
      ).dayCount,
    ).toBe("2");
  });

  it("keeps non-payable absences all-day and counts calendar days", () => {
    const next = applyFormPatch(
      { ...blank, mode: "PARTIAL" },
      { eventType: "SERVICE_ABSENCE", endDate: "2026-07-19" },
    );
    expect(next.mode).toBe("ALL_DAY");
    expect(next.dayCount).toBe("7");
  });

  it("allows half days only for annual leave", () => {
    expect(
      applyFormPatch(
        { ...blank, mode: "HALF_DAY" },
        { eventType: "SICK_LEAVE" },
      ).mode,
    ).toBe("PARTIAL");
  });

  it("derives the duration from start and end times", () => {
    const next = applyFormPatch(
      { ...blank, mode: "PARTIAL", eventType: "OUTING" },
      { startTime: "13:00", endTime: "15:30" },
    );
    expect([next.hours, next.minutes]).toEqual(["2", "30"]);
  });

  it("turns a morning lateness through 14:00 into a morning half day", () => {
    const draft = buildDraft(
      {
        ...blank,
        eventType: "LATE_ARRIVAL",
        mode: "PARTIAL",
        startTime: "09:00",
        endTime: "14:00",
        hours: "5",
        minutes: "0",
      },
      profile,
    );
    expect(draft.eventType).toBe("ANNUAL_LEAVE");
    expect(draft.timing).toEqual({ kind: "HALF_DAY", half: "AM" });
  });
});

describe("day count basis (suggestion vs. confirmed value)", () => {
  // 2026-10-25 is a Sunday: the audit saved a 1-day leave on it unread.
  const weekdayDaytime = {
    ...profile,
    workPattern: "WEEKDAY_DAYTIME" as const,
    workWeekdays: [1, 2, 3, 4, 5],
  };
  const unknownPattern = { ...profile, workPattern: null, workWeekdays: null };
  const nightShift = {
    ...profile,
    workPattern: "NIGHT_SHIFT_ROTATION" as const,
    workWeekdays: null,
  };
  const leave = (start: DateOnly, end: DateOnly = start) =>
    applyFormPatch(initialState(null, start), { endDate: end });

  it("a weekday for a confirmed Monday–Friday schedule is a plain suggestion", () => {
    const basis = describeDayCount(leave("2026-10-26"), weekdayDaytime);
    expect(basis).toMatchObject({
      source: "WEEKDAYS",
      weekdays: 1,
      calendarDays: 1,
      confirmation: null,
    });
    expect(leave("2026-10-26").dayCount).toBe("1");
  });

  it("a weekend-only range keeps the 1-day floor but must be confirmed", () => {
    const form = leave("2026-10-25");
    expect(form.dayCount).toBe("1");
    const basis = describeDayCount(form, weekdayDaytime);
    expect(basis?.weekdays).toBe(0);
    expect(basis?.confirmation?.code).toBe("DAY_COUNT_WEEKEND_ONLY");
    expect(basis?.confirmation?.field).toBe("dayCount");
    // Saturday–Sunday likewise.
    expect(
      describeDayCount(leave("2026-10-24", "2026-10-25"), weekdayDaytime)
        ?.confirmation?.code,
    ).toBe("DAY_COUNT_WEEKEND_ONLY");
  });

  it("Friday to Monday counts two weekdays and needs no confirmation on a confirmed schedule", () => {
    const form = leave("2026-10-23", "2026-10-26");
    expect(form.dayCount).toBe("2");
    expect(describeDayCount(form, weekdayDaytime)).toMatchObject({
      source: "WEEKDAYS",
      weekdays: 2,
      calendarDays: 4,
      confirmation: null,
    });
  });

  it("a range over a public holiday still counts weekdays and says holidays are the user's to check", () => {
    // 2026-10-09 (한글날) is a Friday; the form has no holiday calendar.
    const form = leave("2026-10-05", "2026-10-09");
    expect(form.dayCount).toBe("5");
    const basis = describeDayCount(form, weekdayDaytime);
    expect(basis?.confirmation).toBeNull();
    expect(basis?.hint).toContain("공휴일은 직접 확인");
  });

  it("an unset or non-daytime work pattern asks for confirmation; a typed value never does", () => {
    const form = leave("2026-10-26", "2026-10-30");
    expect(describeDayCount(form, unknownPattern)?.confirmation?.code).toBe(
      "DAY_COUNT_WORK_PATTERN_UNCONFIRMED",
    );
    expect(describeDayCount(form, nightShift)?.confirmation?.message).toContain(
      "주간 출퇴근이 아니어서",
    );
    expect(
      describeDayCount(form, {
        ...weekdayDaytime,
        workWeekdays: [2, 3, 4, 5, 6],
      })?.confirmation?.code,
    ).toBe("DAY_COUNT_WORK_PATTERN_UNCONFIRMED");
    expect(
      describeDayCount(form, {
        ...weekdayDaytime,
        workWeekdays: null,
      })?.confirmation?.code,
    ).toBe("DAY_COUNT_WORK_PATTERN_UNCONFIRMED");
    expect(
      describeDayCount(form, {
        ...weekdayDaytime,
        workWeekdays: [],
      })?.confirmation?.code,
    ).toBe("DAY_COUNT_WORK_PATTERN_UNCONFIRMED");
    // Shift workers who type the day count themselves are not nagged, and the
    // typed value survives later date edits.
    const typed = applyFormPatch(form, {
      dayCount: "3",
      dayCountTouched: true,
    });
    expect(describeDayCount(typed, nightShift)).toMatchObject({
      source: "USER",
      confirmation: null,
    });
    expect(applyFormPatch(typed, { endDate: "2026-11-06" }).dayCount).toBe("3");
  });

  it("existing records load as a confirmed value, so old data is never flagged", () => {
    const stored = initialState(
      {
        id: "e",
        eventType: "ANNUAL_LEAVE",
        startDate: "2026-10-25",
        endDate: "2026-10-25",
        timing: { kind: "ALL_DAY", dayCount: 1 },
        title: null,
        note: null,
        deletedAt: null,
        updatedAt: "2026-10-25T00:00:00.000Z",
        source: { kind: "MANUAL" },
      } as unknown as ServiceEvent,
      "2026-10-25",
    );
    expect(describeDayCount(stored, unknownPattern)).toMatchObject({
      source: "USER",
      confirmation: null,
    });
  });

  it("non-payable absences and non-leave records are never asked to confirm", () => {
    const absence = applyFormPatch(initialState(null, "2026-10-24"), {
      eventType: "SERVICE_ABSENCE",
      endDate: "2026-10-25",
    });
    expect(describeDayCount(absence, unknownPattern)).toMatchObject({
      source: "CALENDAR_DAYS",
      calendarDays: 2,
      confirmation: null,
    });
    const education = applyFormPatch(initialState(null, "2026-10-25"), {
      eventType: "EDUCATION",
    });
    expect(
      describeDayCount(education, unknownPattern)?.confirmation,
    ).toBeNull();
  });

  it("folds the confirmation into the warnings the editors already acknowledge", () => {
    const validation: { errors: EventIssue[]; warnings: EventIssue[] } = {
      errors: [],
      warnings: [],
    };
    const basis = describeDayCount(leave("2026-10-25"), unknownPattern);
    const merged = withDayCountConfirmation(validation, basis);
    expect(merged.warnings.map((issue) => issue.code)).toEqual([
      "DAY_COUNT_WEEKEND_ONLY",
    ]);
    expect(withDayCountConfirmation(validation, null)).toBe(validation);
  });
});

describe("money month model", () => {
  it("evaluates the current month on today and other months on the 15th", () => {
    expect(moneyAsOfDate("2026-10", "2026-10-03")).toBe("2026-10-03");
    expect(moneyAsOfDate("2026-09", "2026-10-03")).toBe("2026-09-15");
  });

  it("returns compensation and the pay band schedule for the month", () => {
    const result = evaluateMoneyMonth(
      {
        schemaVersion: 3,
        documentRevision: 0,
        savedAt: null,
        deviceId: "d",
        profile,
        events: [],
        leaveAdjustments: [],
        leaveSnapshots: [],
        imports: [],
        attendanceMonths: [],
        compensationSnapshots: [],
      },
      profile,
      "2026-09",
      "2026-10-03",
    );
    expect(result.asOfDate).toBe("2026-09-15");
    expect(result.compensation.month).toBe("2026-09");
    expect(result.schedule.status).toBe("NEEDS_INPUT");
  });
});

describe("attendance month model", () => {
  const days = [
    { date: "2026-10-01", kind: "WORKED", requiresDecision: false },
    { date: "2026-10-02", kind: "NEEDS_DECISION", requiresDecision: true },
    { date: "2026-10-03", kind: "NOT_SCHEDULED", requiresDecision: false },
    { date: "2026-10-05", kind: "FULL_DAY_LEAVE", requiresDecision: true },
  ] as never[];

  it("offers scheduled days and hides decisions for declared holidays", () => {
    const open = attendanceEditorDays(days, new Set());
    expect(open.scheduled.map((d: { date: string }) => d.date)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-05",
    ]);
    expect(
      attendanceEditorDays(days, new Set(["2026-10-02"])).decisionDays.map(
        (d: { date: string }) => d.date,
      ),
    ).toEqual(["2026-10-05"]);
  });

  it("saves only fully answered open days and keeps derived non-payable dates", () => {
    const input = attendanceMonthInput(
      {
        month: "2026-10",
        nonWorkingDates: [],
        decisions: [
          { date: "2026-10-02", mealEligible: true, transportEligible: false },
          { date: "2026-10-05", mealEligible: true },
        ],
        hadNonPayableAbsence: false,
        nonPayableDates: ["2026-10-07"],
        nonPayableDatesConfirmed: true,
        roundingPolicy: null,
      },
      {
        serviceDays: { days },
        basePayAdjustment: { derivedNonPayableDates: ["2026-10-08"] },
      } as never,
    );
    expect(input.dayOverrides).toEqual([
      { date: "2026-10-02", mealEligible: true, transportEligible: false },
    ]);
    expect(input.nonPayableDates).toEqual(["2026-10-07", "2026-10-08"]);
  });
});
