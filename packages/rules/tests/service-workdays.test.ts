import {
  buildServiceProfile,
  type AnnualLeaveBalance,
  type AttendanceMonth,
  type DateOnly,
  type ServiceEvent,
  type ServiceProfileInput,
  type YearMonth,
} from "@super-gongik/domain";
import { describe, expect, it } from "vitest";

import {
  deriveServiceWorkdays,
  PUBLIC_HOLIDAY_YEARS,
  publicHolidayName,
} from "../src";

const T0 = "2026-01-01T00:00:00.000Z";

// Call-up Tue 2026-09-01, discharge Sat 2026-10-31, Mon–Fri.
// September: 22 weekdays − 추석 9/24·9/25 = 20. October 2–31: 21 weekdays −
// 대체공휴일 10/5 − 한글날 10/9 = 19.
function profile(extra: Partial<ServiceProfileInput> = {}) {
  return buildServiceProfile(
    {
      callUpDate: "2026-09-01",
      expectedDischargeDate: "2026-10-31",
      priorServiceCredit: "NONE",
      workPattern: "WEEKDAY_DAYTIME",
      workWeekdays: [1, 2, 3, 4, 5],
      ...extra,
    },
    { id: "p", localProfileId: "p", timestamp: T0 },
  );
}

let seq = 0;
function event(
  eventType: ServiceEvent["eventType"],
  startDate: string,
  endDate: string,
  timing: ServiceEvent["timing"],
): ServiceEvent {
  seq += 1;
  return {
    id: `ev-${seq}`,
    serviceProfileId: "p",
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    revision: 1,
    deviceId: "d",
    eventType,
    startDate: startDate as DateOnly,
    endDate: endDate as DateOnly,
    timing,
    title: null,
    note: null,
    status: "CONFIRMED",
  } as ServiceEvent;
}
const allDay = (dayCount: number) => ({ kind: "ALL_DAY" as const, dayCount });

function month(m: string, nonWorkingDates: string[]): AttendanceMonth {
  return {
    id: `att-${m}`,
    serviceProfileId: "p",
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    revision: 1,
    deviceId: "d",
    month: m as YearMonth,
    nonWorkingDates: nonWorkingDates as DateOnly[],
    dayOverrides: [],
    hadNonPayableAbsence: false,
    nonPayableDates: [],
    nonPayableDatesConfirmed: false,
    roundingPolicy: null,
    basisFingerprint: "x",
  };
}

function balance(
  remaining: { halfDays: number; minutes: number },
  status: AnnualLeaveBalance["status"] = "RESOLVED",
): AnnualLeaveBalance {
  return {
    remainingAfterScheduled: remaining,
    upcomingCredits: { halfDays: 0, minutes: 0 },
    status,
  } as AnnualLeaveBalance;
}

const today = "2026-10-01" as DateOnly;
const derive = (
  extra: Partial<Parameters<typeof deriveServiceWorkdays>[0]> = {},
) =>
  deriveServiceWorkdays({
    profile: profile(),
    events: [],
    attendanceMonths: [],
    annualLeave: null,
    today,
    ...extra,
  });

describe("public holidays", () => {
  it("reads the 특일 정보 file, merging two holidays on one date", () => {
    expect(PUBLIC_HOLIDAY_YEARS).toContain(2026);
    expect(publicHolidayName("2026-09-24" as DateOnly)).toBe("추석");
    expect(publicHolidayName("2025-05-05" as DateOnly)).toContain("·");
    expect(publicHolidayName("2026-09-23" as DateOnly)).toBeNull();
  });
});

describe("deriveServiceWorkdays", () => {
  it("counts weekdays minus public holidays on both sides of today", () => {
    expect(derive()).toMatchObject({
      status: "READY",
      elapsed: 20,
      remaining: 19,
      remainingIfAllLeaveUsed: null,
    });
  });

  it("drops full-day leave and absence, keeps partial days and education", () => {
    const result = derive({
      events: [
        event("ANNUAL_LEAVE", "2026-10-20", "2026-10-20", allDay(1)),
        event("SICK_LEAVE", "2026-10-22", "2026-10-26", allDay(3)),
        event("SERVICE_ABSENCE", "2026-09-10", "2026-09-10", allDay(1)),
        event("LATE_ARRIVAL", "2026-09-15", "2026-09-15", {
          kind: "PARTIAL",
          durationMinutes: 30,
          startTime: "09:00",
          endTime: "09:30",
        }),
        event("EDUCATION", "2026-09-16", "2026-09-16", allDay(1)),
      ],
    });
    // 10/22–10/26 spans a weekend: 3 charged days are Thu, Fri, Mon.
    expect(result).toMatchObject({ elapsed: 19, remaining: 15 });
  });

  it("drops holidays the user declared for a month", () => {
    const result = derive({
      attendanceMonths: [month("2026-09", ["2026-09-14"])],
    });
    expect(result).toMatchObject({ elapsed: 19, remaining: 19 });
  });

  it("subtracts every 연가 day left, in half-day steps", () => {
    // 5 half-days + 300 minutes (one more half-day, 60 minutes left over).
    const result = derive({
      annualLeave: balance({ halfDays: 5, minutes: 300 }),
    });
    expect(result).toMatchObject({
      remaining: 19,
      leaveDaysAssumed: 3,
      leaveIncludesUpcoming: false,
      remainingIfAllLeaveUsed: 16,
    });
    expect(
      derive({
        annualLeave: balance(
          { halfDays: 4, minutes: 0 },
          "NEEDS_CREDIT_CONFIRMATION",
        ),
      }),
    ).toMatchObject({ remainingIfAllLeaveUsed: null, leaveDaysAssumed: null });
  });

  it("counts the whole service as remaining before call-up", () => {
    expect(derive({ today: "2026-08-01" as DateOnly })).toMatchObject({
      elapsed: 0,
      remaining: 40,
    });
  });

  it("counts everything as elapsed after discharge", () => {
    expect(derive({ today: "2026-11-15" as DateOnly })).toMatchObject({
      elapsed: 40,
      remaining: 0,
    });
  });

  it("flags years whose holidays are not announced yet", () => {
    const result = deriveServiceWorkdays({
      profile: profile({
        callUpDate: "2028-12-01",
        expectedDischargeDate: "2029-03-01",
      }),
      events: [],
      attendanceMonths: [],
      annualLeave: null,
      today,
    });
    expect(result).toMatchObject({ uncoveredHolidayYears: [2029] });
  });

  it("needs confirmed weekdays and a supported work pattern", () => {
    expect(derive({ profile: profile({ workWeekdays: null }) })).toEqual({
      status: "NEEDS_WORK_WEEKDAYS",
    });
    expect(
      derive({
        profile: profile({
          workPattern: "NIGHT_SHIFT_ROTATION",
          workWeekdays: null,
        }),
      }),
    ).toEqual({ status: "UNSUPPORTED_WORK_PATTERN" });
  });
});
