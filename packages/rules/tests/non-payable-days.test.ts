import {
  attendanceBasisFingerprint,
  buildServiceProfile,
  type AttendanceMonth,
  type DateOnly,
  type ServiceEvent,
  type ServiceProfile,
  type YearMonth,
} from "@super-gongik/domain";
import { describe, expect, it } from "vitest";

import { deriveMonthNonPayableDates } from "../src";

const T0 = "2026-01-01T00:00:00.000Z";

function profile(): ServiceProfile {
  return buildServiceProfile(
    {
      callUpDate: "2026-01-05",
      expectedDischargeDate: "2027-10-04",
      priorServiceCredit: "NONE",
      workPattern: "WEEKDAY_DAYTIME",
      workWeekdays: [1, 2, 3, 4, 5],
    },
    { id: "p", localProfileId: "p", timestamp: T0 },
  );
}

let seq = 0;
function event(
  eventType: ServiceEvent["eventType"],
  startDate: string,
  endDate: string,
  dayCount: number,
  extra: Partial<ServiceEvent> = {},
): ServiceEvent {
  seq += 1;
  return {
    id: `e-${seq}`,
    serviceProfileId: "p",
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    revision: 1,
    deviceId: "d",
    eventType,
    startDate: startDate as DateOnly,
    endDate: endDate as DateOnly,
    timing: { kind: "ALL_DAY", dayCount },
    title: null,
    note: null,
    status: "CONFIRMED",
    source: { kind: "MANUAL" },
    ...extra,
  };
}

function attendance(
  subject: ServiceProfile,
  events: readonly ServiceEvent[],
  month: YearMonth,
  nonWorkingDates: DateOnly[] = [],
): AttendanceMonth {
  return {
    id: `a-${month}`,
    serviceProfileId: "p",
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    revision: 1,
    deviceId: "d",
    month,
    nonWorkingDates,
    dayOverrides: [],
    hadNonPayableAbsence: false,
    nonPayableDates: [],
    nonPayableDatesConfirmed: false,
    roundingPolicy: null,
    basisFingerprint: attendanceBasisFingerprint(subject, events, month),
  };
}

describe("deriveMonthNonPayableDates", () => {
  it("marks only ordinary sick-leave days after the cumulative 30-day threshold", () => {
    const subject = profile();
    const events = [
      event("SICK_LEAVE", "2026-06-01", "2026-06-30", 30, {
        sickLeaveCategory: "ORDINARY",
      }),
      event("SICK_LEAVE", "2026-07-10", "2026-07-10", 1, {
        sickLeaveCategory: "ORDINARY",
      }),
    ];

    const result = deriveMonthNonPayableDates({
      profile: subject,
      events,
      month: "2026-07",
    });

    expect(result.dates).toEqual(["2026-07-10"]);
    expect(result.days[0]).toMatchObject({
      date: "2026-07-10",
      reason: "SICK_LEAVE_OVER_30",
    });
    expect(result.sickLeave.ordinaryCumulativeDaysThroughMonth).toBe(31);
    expect(result.unresolved).toEqual([]);
  });

  it("never counts public-duty illness/injury toward the ordinary 30-day threshold", () => {
    const subject = profile();
    const events = [
      event("SICK_LEAVE", "2026-06-01", "2026-06-30", 30, {
        sickLeaveCategory: "ORDINARY",
      }),
      event("SICK_LEAVE", "2026-07-10", "2026-07-12", 3, {
        sickLeaveCategory: "PUBLIC_DUTY",
      }),
    ];

    const result = deriveMonthNonPayableDates({
      profile: subject,
      events,
      month: "2026-07",
    });

    expect(result.dates).toEqual([]);
    expect(result.sickLeave.ordinaryCumulativeDaysThroughMonth).toBe(0);
    expect(result.unresolved).toEqual([]);
  });

  it("does not gate sick-leave ambiguity when the 30-day threshold cannot be crossed", () => {
    const subject = profile();
    const events = [
      event("SICK_LEAVE", "2026-07-10", "2026-07-10", 1, {
        sickLeaveCategory: "UNKNOWN",
      }),
    ];

    const result = deriveMonthNonPayableDates({
      profile: subject,
      events,
      month: "2026-07",
    });

    expect(result.dates).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it("fails closed when an earlier sick leave has unknown compensation classification", () => {
    const subject = profile();
    const events = [
      event("SICK_LEAVE", "2026-06-01", "2026-06-30", 30, {
        sickLeaveCategory: "UNKNOWN",
      }),
      event("SICK_LEAVE", "2026-07-10", "2026-07-10", 1, {
        sickLeaveCategory: "ORDINARY",
      }),
    ];

    const result = deriveMonthNonPayableDates({
      profile: subject,
      events,
      month: "2026-07",
    });

    expect(result.dates).toEqual([]);
    expect(result.sickLeave.ordinaryCumulativeDaysThroughMonth).toBeNull();
    expect(result.unresolved.join(" ")).toContain("공무수행상");
  });

  it("fails closed when ordinary sick leave has no provable charged dates", () => {
    const subject = profile();
    const prior = event("SICK_LEAVE", "2026-06-01", "2026-06-30", 30, {
      sickLeaveCategory: "ORDINARY",
    });
    const partial: ServiceEvent = {
      ...event("SICK_LEAVE", "2026-07-10", "2026-07-10", 1, {
        sickLeaveCategory: "ORDINARY",
      }),
      timing: {
        kind: "PARTIAL",
        durationMinutes: 120,
        startTime: "09:00",
        endTime: "11:00",
      },
    };

    const result = deriveMonthNonPayableDates({
      profile: subject,
      events: [prior, partial],
      month: "2026-07",
    });

    expect(result.dates).toEqual([]);
    expect(result.sickLeave.ordinaryCumulativeDaysThroughMonth).toBeNull();
    expect(result.unresolved.join(" ")).toContain("실제 차감 날짜");
  });

  it("derives explicit Article 41(6) absence dates", () => {
    const subject = profile();
    const absence = event("SERVICE_ABSENCE", "2026-07-14", "2026-07-14", 1);

    const result = deriveMonthNonPayableDates({
      profile: subject,
      events: [absence],
      month: "2026-07",
    });

    expect(result.dates).toEqual(["2026-07-14"]);
    expect(result.days[0]).toMatchObject({
      reason: "SERVICE_ABSENCE",
      eventIds: [absence.id],
    });
  });

  it("does not guess dates for an ambiguous multi-day compensation absence", () => {
    const subject = profile();
    const ambiguous = event(
      "EXCESS_ANNUAL_ABSENCE",
      "2026-07-13",
      "2026-07-17",
      2,
    );

    const result = deriveMonthNonPayableDates({
      profile: subject,
      events: [ambiguous],
      month: "2026-07",
    });

    expect(result.dates).toEqual([]);
    expect(result.unresolved.join(" ")).toContain("정확히 확정");
  });

  it("can use a current attendance confirmation to prove charged weekdays", () => {
    const subject = profile();
    const absence = event(
      "EXCESS_ANNUAL_ABSENCE",
      "2026-07-13",
      "2026-07-17",
      4,
    );
    const events = [absence];
    const july = attendance(subject, events, "2026-07", ["2026-07-15"]);

    const result = deriveMonthNonPayableDates({
      profile: subject,
      events,
      attendanceMonths: [july],
      month: "2026-07",
    });

    expect(result.dates).toEqual([
      "2026-07-13",
      "2026-07-14",
      "2026-07-16",
      "2026-07-17",
    ]);
    expect(result.unresolved).toEqual([]);
  });
});
