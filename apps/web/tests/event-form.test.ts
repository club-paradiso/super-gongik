import { buildServiceProfile } from "@super-gongik/domain";
import { describe, expect, it } from "vitest";

import { applyFormPatch, buildDraft, initialState } from "@/lib/event-form";
import { evaluateMoneyMonth, moneyAsOfDate } from "@/lib/money-model";

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
