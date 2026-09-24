import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  attendanceBasisFingerprint,
  buildServiceProfile,
  type AttendanceMonth,
  type DateOnly,
  type ServiceEvent,
  type ServiceProfile,
  type ServiceProfileInput,
  type YearMonth,
} from "@super-gongik/domain";
import { describe, expect, it } from "vitest";

import {
  COMPENSATION_RULE_BUNDLES,
  type CompensationRuleBundle,
  deriveMonthServiceDays as deriveRaw,
  evaluateMonthlyCompensation as evaluateRaw,
} from "../src";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-09-01T00:00:00.000Z";
const T2 = "2026-09-02T00:00:00.000Z";

function profile(
  callUpDate: string,
  expectedDischargeDate: string,
  extra: Partial<ServiceProfileInput> = {},
): ServiceProfile {
  return buildServiceProfile(
    {
      callUpDate,
      expectedDischargeDate,
      priorServiceCredit: "NONE",
      workPattern: "WEEKDAY_DAYTIME",
      workWeekdays: [1, 2, 3, 4, 5],
      ...extra,
    },
    { id: "p", localProfileId: "p", timestamp: T0 },
  );
}

function attendance(
  month: string,
  extra: Partial<AttendanceMonth> = {},
): AttendanceMonth {
  return {
    id: `att-${month}`,
    serviceProfileId: "p",
    createdAt: T1,
    updatedAt: T1,
    deletedAt: null,
    revision: 1,
    deviceId: "d",
    month: month as YearMonth,
    nonWorkingDates: [],
    dayOverrides: [],
    hadNonPayableAbsence: false,
    nonPayableDates: [],
    nonPayableDatesConfirmed: false,
    roundingPolicy: null,
    // Filled in by the wrappers below with the fingerprint of the data under
    // test, i.e. "the user confirmed exactly this data".
    basisFingerprint: CONFIRMED_AGAINST_INPUT,
    ...extra,
  };
}

const CONFIRMED_AGAINST_INPUT = "__confirmed-against-input__";

function confirmed(
  record: AttendanceMonth | null | undefined,
  profile: Parameters<typeof attendanceBasisFingerprint>[0],
  events: readonly ServiceEvent[],
) {
  if (!record || record.basisFingerprint !== CONFIRMED_AGAINST_INPUT) {
    return record ?? null;
  }
  return {
    ...record,
    basisFingerprint: attendanceBasisFingerprint(profile, events, record.month),
  };
}

function deriveMonthServiceDays(input: Parameters<typeof deriveRaw>[0]) {
  return deriveRaw({
    ...input,
    attendance: confirmed(input.attendance, input.profile, input.events),
  });
}

function evaluateMonthlyCompensation(
  subject: ServiceProfile,
  asOfDate: DateOnly,
  options: Parameters<typeof evaluateRaw>[2] = {},
) {
  const events = options.events ?? [];
  return evaluateRaw(subject, asOfDate, {
    ...options,
    attendance: confirmed(options.attendance, subject, events),
  });
}

let eventSeq = 0;
function event(
  eventType: ServiceEvent["eventType"],
  startDate: string,
  endDate: string,
  timing: ServiceEvent["timing"],
  updatedAt = T0,
): ServiceEvent {
  eventSeq += 1;
  return {
    id: `ev-${eventSeq}`,
    serviceProfileId: "p",
    createdAt: T0,
    updatedAt,
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
    source: { kind: "MANUAL" },
  };
}

const allDay = (dayCount: number) => ({ kind: "ALL_DAY" as const, dayCount });

describe("base-pay band by service-month ordinal (병역법 시행령 제62조①)", () => {
  // Call-up in 2025-01 → 2026-01 is month 13, 2026-02 month 14, 2026-03 month 15.
  it.each([
    ["2026-01-05", "2026-02-10", 2, 750_000],
    ["2026-01-05", "2026-03-10", 3, 900_000],
    ["2026-01-05", "2026-08-10", 8, 900_000],
    ["2026-01-05", "2026-09-10", 9, 1_200_000],
    ["2025-01-06", "2026-02-10", 14, 1_200_000],
    ["2025-01-06", "2026-03-10", 15, 1_500_000],
  ])(
    "call-up %s, month of %s is month %i → %i",
    (callUp, asOf, ordinal, amount) => {
      const result = evaluateMonthlyCompensation(
        profile(callUp, "2027-10-04"),
        asOf as DateOnly,
      );
      expect(result.serviceMonthOrdinal).toBe(ordinal);
      expect(result.components[0]).toMatchObject({
        status: "CALCULATED",
        monthlyAmount: amount,
      });
    },
  );

  it("regression: the third calendar month pays 일등병, not 이등병", () => {
    // Before this fix a 0-based month index was compared with ordinal bands,
    // so a January call-up still received 750,000 KRW in March.
    const result = evaluateMonthlyCompensation(
      profile("2026-01-05", "2027-10-04"),
      "2026-03-16",
    );
    expect(result.components[0]?.monthlyAmount).toBe(900_000);
    expect(result.equivalentRank).toBe("일병 상당");
  });
});

describe("prior-service credit (병역법 시행령 제62조②)", () => {
  const serving = (extra: Partial<ServiceProfileInput>) =>
    profile("2026-01-05", "2027-10-04", {
      priorServiceCredit: "HAS_PRIOR_SERVICE",
      ...extra,
    });

  it("adds institution-confirmed whole months to the month count", () => {
    const result = evaluateMonthlyCompensation(
      serving({
        priorServiceBasis: "ARTICLE_62_2_5_MILITARY_SCHOOL_WITHDRAWAL",
        priorServiceCreditedMonths: 6,
      }),
      "2026-03-16",
    );
    // March is month 3; + 6 credited months = month 9 → 상등병.
    expect(result.serviceMonthOrdinal).toBe(9);
    expect(result.components[0]?.monthlyAmount).toBe(1_200_000);
    expect(result.assumptions.join(" ")).toContain("6개월");
  });

  it("asks for the basis and months instead of inferring a credit", () => {
    for (const extra of [
      {},
      { priorServiceBasis: "ARTICLE_62_2_1_SHIPBOARD_RESERVE" as const },
      { priorServiceCreditedMonths: 4 },
    ]) {
      const result = evaluateMonthlyCompensation(serving(extra), "2026-03-16");
      expect(result.components[0]).toMatchObject({
        status: "NEEDS_INPUT",
        monthlyAmount: null,
      });
    }
  });

  it("gates a credited period that is not a whole number of months", () => {
    const result = evaluateMonthlyCompensation(
      serving({
        priorServiceBasis: "ARTICLE_62_2_5_MILITARY_SCHOOL_WITHDRAWAL",
        priorServiceCreditHasPartialMonth: true,
      }),
      "2026-03-16",
    );
    expect(result.components[0]).toMatchObject({
      status: "GATED",
      monthlyAmount: null,
    });
  });
});

describe("call-up and discharge months stay gated (제41조⑤, rounding unresolved)", () => {
  it.each([
    ["call-up on the 1st", "2026-03-01", "2027-11-30", "2026-03-20"],
    ["call-up mid-month", "2026-03-16", "2027-12-15", "2026-03-20"],
    ["discharge on the last day", "2025-03-01", "2026-11-30", "2026-11-10"],
    ["discharge mid-month", "2025-03-16", "2026-11-15", "2026-11-10"],
    ["February call-up", "2026-02-02", "2027-11-01", "2026-02-10"],
  ])("%s", (_label, callUp, discharge, asOf) => {
    const result = evaluateMonthlyCompensation(
      profile(callUp, discharge),
      asOf as DateOnly,
    );
    expect(result.components[0]).toMatchObject({
      status: "GATED",
      monthlyAmount: null,
    });
    expect(result.total).toBeNull();
  });

  it("pins the month's divisor and holiday-inclusive calendar-day semantics", () => {
    const result = evaluateMonthlyCompensation(
      profile("2026-02-02", "2027-11-01"),
      "2026-02-10",
    );
    expect(result.components[0]?.explanation).toContain("28일");
    expect(result.components[0]?.explanation).toContain("휴일도 포함");
    expect(result.components[0]?.explanation).not.toContain("근무일수의 뜻");
    expect(result.components[0]?.explanation).toContain("끝수 처리");
  });

  it("states 29 days for leap-year February and still returns no amount", () => {
    const [verified] = COMPENSATION_RULE_BUNDLES;
    const leapYearBundle: CompensationRuleBundle = {
      ...verified!,
      version: "2028-test",
      effectiveFrom: "2028-01-01",
      effectiveUntil: "2028-12-31",
    };
    const result = evaluateMonthlyCompensation(
      profile("2028-02-07", "2029-11-06"),
      "2028-02-10",
      { bundles: [leapYearBundle] },
    );
    expect(result.components[0]?.status).toBe("GATED");
    expect(result.components[0]?.explanation).toContain("29일");
  });

  it("calculates a call-up month only when Treasury rounding is explicitly confirmed", () => {
    const result = evaluateMonthlyCompensation(
      profile("2026-03-16", "2027-12-15"),
      "2026-03-20",
      {
        attendance: attendance("2026-03", {
          nonPayableDatesConfirmed: true,
          roundingPolicy: "NATIONAL_TREASURY_ARTICLE_47",
        }),
      },
    );
    // 750,000 / 31 × 16 calendar days = 387,096.77... → drop sub-10 KRW.
    expect(result.components[0]).toMatchObject({
      status: "CALCULATED",
      monthlyAmount: 387_090,
    });
    expect(result.basePayAdjustment).toMatchObject({
      roundingPolicy: "NATIONAL_TREASURY_ARTICLE_47",
      calendarDaysInMonth: 31,
      serviceCalendarDays: 16,
      payableCalendarDays: 16,
      roundedAmount: 387_090,
    });
  });

  it("never applies Treasury truncation to a non-Treasury/unknown institution", () => {
    const result = evaluateMonthlyCompensation(
      profile("2026-03-16", "2027-12-15"),
      "2026-03-20",
      {
        attendance: attendance("2026-03", {
          nonPayableDatesConfirmed: true,
          roundingPolicy: "INSTITUTION_OTHER_OR_UNKNOWN",
        }),
      },
    );
    expect(result.components[0]).toMatchObject({
      status: "GATED",
      monthlyAmount: null,
    });
    expect(result.components[0]?.explanation).toContain("다른 회계 기준");
  });

  it("calculates the first full month after a mid-month call-up", () => {
    const result = evaluateMonthlyCompensation(
      profile("2026-03-16", "2027-12-15"),
      "2026-04-10",
    );
    expect(result.components[0]).toMatchObject({
      status: "CALCULATED",
      monthlyAmount: 750_000,
    });
  });
});

describe("rule effective-date boundary", () => {
  const serving = profile("2025-06-02", "2027-03-01");

  it.each([
    ["2025-12-31", "UNSUPPORTED"],
    ["2026-01-01", "PARTIAL"],
    ["2026-12-31", "PARTIAL"],
    ["2027-01-01", "UNSUPPORTED"],
  ])("%s → %s", (date, status) => {
    expect(evaluateMonthlyCompensation(serving, date as DateOnly).status).toBe(
      status,
    );
  });

  it("refuses a month in which the rule changes", () => {
    const [verified] = COMPENSATION_RULE_BUNDLES;
    const bundles: CompensationRuleBundle[] = [
      { ...verified!, version: "A", effectiveUntil: "2026-07-14" },
      { ...verified!, version: "B", effectiveFrom: "2026-07-15" },
    ];
    const result = evaluateMonthlyCompensation(serving, "2026-07-20", {
      bundles,
    });
    expect(result.status).toBe("UNSUPPORTED");
    expect(result.total).toBeNull();
  });
});

describe("eligible service days", () => {
  // 2026-10: Thu 1st … Sat 31st → 22 weekdays.
  const serving = profile("2026-01-05", "2027-10-04");

  it("needs a confirmed schedule before counting anything", () => {
    const unscheduled = profile("2026-01-05", "2027-10-04", {
      workPattern: null,
      workWeekdays: null,
    });
    const days = deriveMonthServiceDays({
      profile: unscheduled,
      month: "2026-10" as YearMonth,
      events: [],
      attendance: attendance("2026-10"),
    });
    expect(days.status).toBe("NEEDS_INPUT");
    expect(days.missing).toEqual(["WORK_PATTERN", "WORK_WEEKDAYS"]);
    expect(days.mealEligibleDays).toBeNull();
  });

  it("does not model night rotation or residential service", () => {
    for (const workPattern of [
      "NIGHT_SHIFT_ROTATION",
      "RESIDENTIAL",
    ] as const) {
      const result = evaluateMonthlyCompensation(
        { ...serving, workPattern },
        "2026-10-15",
        { attendance: attendance("2026-10") },
      );
      expect(result.components[1]?.status).toBe("UNSUPPORTED");
      expect(result.components[2]?.status).toBe("UNSUPPORTED");
      expect(result.total).toBeNull();
    }
  });

  it("requires the month's holidays to be confirmed by the user", () => {
    const days = deriveMonthServiceDays({
      profile: serving,
      month: "2026-10" as YearMonth,
      events: [],
      attendance: null,
    });
    expect(days.status).toBe("NEEDS_INPUT");
    expect(days.missing).toContain("MONTH_CONFIRMATION");
  });

  it("excludes declared holidays and counts plain working days", () => {
    const days = deriveMonthServiceDays({
      profile: serving,
      month: "2026-10" as YearMonth,
      events: [],
      attendance: attendance("2026-10", {
        nonWorkingDates: ["2026-10-05", "2026-10-09"] as DateOnly[],
      }),
    });
    expect(days.status).toBe("READY");
    expect(days.mealEligibleDays).toBe(20);
    expect(days.transportEligibleDays).toBe(20);
  });

  it("finds a leave's charged days over a weekend but still asks about allowances", () => {
    const leave = event("ANNUAL_LEAVE", "2026-10-16", "2026-10-19", allDay(2));
    const undecided = deriveMonthServiceDays({
      profile: serving,
      month: "2026-10" as YearMonth,
      // Fri 16th – Mon 19th, 2 charged days = the two scheduled weekdays.
      events: [leave],
      attendance: attendance("2026-10"),
    });
    expect(undecided.undecidedDates).toEqual(["2026-10-16", "2026-10-19"]);
    expect(undecided.days.find((d) => d.date === "2026-10-17")?.kind).toBe(
      "NOT_SCHEDULED",
    );
    const decided = deriveMonthServiceDays({
      profile: serving,
      month: "2026-10" as YearMonth,
      events: [leave],
      attendance: attendance("2026-10", {
        dayOverrides: ["2026-10-16", "2026-10-19"].map((date) => ({
          date: date as DateOnly,
          mealEligible: false,
          transportEligible: false,
        })),
      }),
    });
    expect(decided.status).toBe("READY");
    expect(decided.mealEligibleDays).toBe(20);
  });

  it("asks when an all-day leave's charged dates are not provable", () => {
    const days = deriveMonthServiceDays({
      profile: serving,
      month: "2026-10" as YearMonth,
      // Mon–Fri range but only 3 charged days: which three is unknown.
      events: [event("SICK_LEAVE", "2026-10-19", "2026-10-23", allDay(3))],
      attendance: attendance("2026-10"),
    });
    expect(days.status).toBe("NEEDS_INPUT");
    expect(days.undecidedDates).toHaveLength(5);
  });

  it("treats meal and transport separately for a half-day leave the user decided", () => {
    const halfDay = event("ANNUAL_LEAVE", "2026-10-20", "2026-10-20", {
      kind: "HALF_DAY",
      half: "AM",
    });
    const undecided = deriveMonthServiceDays({
      profile: serving,
      month: "2026-10" as YearMonth,
      events: [halfDay],
      attendance: attendance("2026-10"),
    });
    expect(undecided.status).toBe("NEEDS_INPUT");
    expect(undecided.undecidedDates).toEqual(["2026-10-20"]);

    const decided = deriveMonthServiceDays({
      profile: serving,
      month: "2026-10" as YearMonth,
      events: [halfDay],
      attendance: attendance("2026-10", {
        dayOverrides: [
          {
            date: "2026-10-20" as DateOnly,
            mealEligible: false,
            transportEligible: true,
          },
        ],
      }),
    });
    expect(decided.status).toBe("READY");
    expect(decided.mealEligibleDays).toBe(21);
    expect(decided.transportEligibleDays).toBe(22);
  });

  it("requires reconfirmation after the month's records or schedule change", () => {
    // Confirmed while the month had no records and a Mon–Fri schedule.
    const confirmedEarlier = attendance("2026-10", {
      basisFingerprint: attendanceBasisFingerprint(
        serving,
        [],
        "2026-10" as YearMonth,
      ),
    });
    const withLeave = deriveMonthServiceDays({
      profile: serving,
      month: "2026-10" as YearMonth,
      events: [
        event("ANNUAL_LEAVE", "2026-10-13", "2026-10-13", allDay(1), T2),
      ],
      attendance: confirmedEarlier,
    });
    expect(withLeave.missing).toContain("MONTH_RECONFIRMATION");
    const newSchedule = deriveMonthServiceDays({
      profile: { ...serving, workWeekdays: [1, 2, 3, 4] },
      month: "2026-10" as YearMonth,
      events: [],
      attendance: confirmedEarlier,
    });
    expect(newSchedule.missing).toContain("MONTH_RECONFIRMATION");
  });

  it("does not invalidate a confirmation when only rates or unrelated months change", () => {
    const confirmedEarlier = attendance("2026-10", {
      basisFingerprint: attendanceBasisFingerprint(
        serving,
        [],
        "2026-10" as YearMonth,
      ),
    });
    const result = evaluateRaw(
      {
        ...serving,
        defaultMealAllowanceOverride: 12_000,
        defaultCommuteCost: 3000,
      },
      "2026-10-15",
      {
        events: [
          event("ANNUAL_LEAVE", "2026-11-03", "2026-11-03", allDay(1), T2),
        ],
        attendance: confirmedEarlier,
      },
    );
    expect(result.serviceDays?.status).toBe("READY");
    expect(result.status).toBe("COMPLETE");
  });

  it("counts only in-service days in the call-up month", () => {
    const days = deriveMonthServiceDays({
      profile: profile("2026-03-16", "2027-12-15"),
      month: "2026-03" as YearMonth,
      events: [],
      attendance: attendance("2026-03"),
    });
    // 2026-03-16 (Mon) … 03-31 (Tue): 12 weekdays.
    expect(days.status).toBe("READY");
    expect(days.mealEligibleDays).toBe(12);
    expect(days.days.find((d) => d.date === "2026-03-13")?.kind).toBe(
      "OUTSIDE_SERVICE",
    );
  });

  it("handles leap-year February as 29 calendar days", () => {
    const days = deriveMonthServiceDays({
      profile: profile("2027-06-07", "2029-03-06"),
      month: "2028-02" as YearMonth,
      events: [],
      attendance: attendance("2028-02"),
    });
    expect(days.days).toHaveLength(29);
    expect(days.mealEligibleDays).toBe(21);
  });
});

describe("allowance eligibility by leave and attendance category", () => {
  // No primary source (복무관리 규정 제41조④, 병무청 2026 지급 기준) states
  // per leave type whether 중식비·교통비 are paid on a full day of leave, so
  // every category waits for the user's decision instead of defaulting to 0.
  const serving = profile("2026-01-05", "2027-10-04", {
    defaultCommuteCost: 2800,
  });
  const date = "2026-10-20" as DateOnly;
  const monthOf = (
    events: ServiceEvent[],
    extra: Partial<AttendanceMonth> = {},
  ) =>
    evaluateMonthlyCompensation(serving, "2026-10-15", {
      events,
      attendance: attendance("2026-10", extra),
    });

  it.each([
    "ANNUAL_LEAVE",
    "SICK_LEAVE",
    "OFFICIAL_LEAVE",
    "SPECIAL_LEAVE",
    "COMPASSIONATE_LEAVE",
  ] as const)(
    "full-day %s is FULL_DAY_LEAVE with undecided allowances and blocks the total",
    (eventType) => {
      const events = [event(eventType, date, date, allDay(1))];
      const pending = monthOf(events);
      const day = pending.serviceDays?.days.find((d) => d.date === date);
      expect(day).toMatchObject({
        kind: "FULL_DAY_LEAVE",
        requiresDecision: true,
        mealEligible: null,
        transportEligible: null,
      });
      expect(pending.components[1]?.status).toBe("NEEDS_INPUT");
      expect(pending.components[2]?.status).toBe("NEEDS_INPUT");
      expect(pending.total).toBeNull();

      // The user's decision resolves it, including a split decision.
      const decided = monthOf(events, {
        dayOverrides: [{ date, mealEligible: false, transportEligible: true }],
      });
      expect(decided.status).toBe("COMPLETE");
      expect(decided.components[1]?.eligibleDays).toBe(21);
      expect(decided.components[2]?.eligibleDays).toBe(22);
      expect(decided.total).toBe(1_200_000 + 9000 * 21 + 2800 * 22);
    },
  );

  it.each([
    ["half-day annual leave", "ANNUAL_LEAVE", { kind: "HALF_DAY", half: "AM" }],
    [
      "minute sick leave",
      "SICK_LEAVE",
      {
        kind: "PARTIAL",
        durationMinutes: 120,
        startTime: "09:00",
        endTime: "11:00",
      },
    ],
    [
      "outing",
      "OUTING",
      {
        kind: "PARTIAL",
        durationMinutes: 60,
        startTime: "14:00",
        endTime: "15:00",
      },
    ],
    [
      "late arrival",
      "LATE_ARRIVAL",
      {
        kind: "PARTIAL",
        durationMinutes: 30,
        startTime: "09:00",
        endTime: "09:30",
      },
    ],
    [
      "early leave",
      "EARLY_LEAVE",
      {
        kind: "PARTIAL",
        durationMinutes: 60,
        startTime: "17:00",
        endTime: "18:00",
      },
    ],
    ["education", "EDUCATION", { kind: "ALL_DAY", dayCount: 1 }],
    ["training", "TRAINING", { kind: "ALL_DAY", dayCount: 1 }],
  ] as const)(
    "%s needs a decision and blocks the total",
    (_label, eventType, timing) => {
      const events = [
        event(eventType, date, date, timing as ServiceEvent["timing"]),
      ];
      const pending = monthOf(events);
      expect(
        pending.serviceDays?.days.find((d) => d.date === date),
      ).toMatchObject({
        kind: "NEEDS_DECISION",
        requiresDecision: true,
        mealEligible: null,
      });
      expect(pending.total).toBeNull();
      const decided = monthOf(events, {
        dayOverrides: [{ date, mealEligible: true, transportEligible: true }],
      });
      expect(decided.total).toBe(1_200_000 + 9000 * 22 + 2800 * 22);
    },
  );

  it("ignores a user note, which says nothing about attendance", () => {
    const result = monthOf([event("USER_NOTE", date, date, allDay(1))]);
    expect(result.status).toBe("COMPLETE");
  });
});

describe("monthly total", () => {
  const complete = profile("2026-01-05", "2027-10-04", {
    // Institution pays above the 9,000 KRW minimum (allowed by the MMA standard).
    defaultMealAllowanceOverride: 10_000,
    defaultCommuteCost: 2800,
  });

  it("totals only when base, meal and transport are all calculated", () => {
    const result = evaluateMonthlyCompensation(complete, "2026-10-15", {
      attendance: attendance("2026-10", {
        nonWorkingDates: ["2026-10-05", "2026-10-09"] as DateOnly[],
      }),
    });
    expect(result.status).toBe("COMPLETE");
    expect(result.components.map((c) => c.monthlyAmount)).toEqual([
      1_200_000,
      10_000 * 20,
      2800 * 20,
    ]);
    expect(result.components[1]?.rateSource).toBe("USER_INPUT");
    expect(result.total).toBe(1_200_000 + 200_000 + 56_000);
    expect(result.unresolved).toEqual([]);
  });

  it("uses the MMA 2026 minimum of 9,000 KRW when no institution rate is entered", () => {
    const result = evaluateMonthlyCompensation(
      { ...complete, defaultMealAllowanceOverride: null },
      "2026-10-15",
      { attendance: attendance("2026-10") },
    );
    expect(result.components[1]).toMatchObject({
      status: "CALCULATED",
      dailyRate: 9000,
      rateSource: "OFFICIAL_MINIMUM",
      eligibleDays: 22,
      monthlyAmount: 9000 * 22,
    });
    expect(result.total).toBe(1_200_000 + 9000 * 22 + 2800 * 22);
  });

  it("refuses an institution meal rate below the official minimum and shows no total", () => {
    const result = evaluateMonthlyCompensation(
      { ...complete, defaultMealAllowanceOverride: 8000 },
      "2026-10-15",
      { attendance: attendance("2026-10") },
    );
    expect(result.components[1]).toMatchObject({
      status: "NEEDS_INPUT",
      monthlyAmount: null,
      rateSource: null,
    });
    expect(result.total).toBeNull();
    expect(result.status).toBe("PARTIAL");
  });

  it("labels a user-entered transport fare as user input, never official", () => {
    const result = evaluateMonthlyCompensation(complete, "2026-10-15", {
      attendance: attendance("2026-10"),
    });
    expect(result.components[2]?.rateSource).toBe("USER_INPUT");
  });

  it("gates base pay when sick leave may exceed the cumulative 30 days", () => {
    const result = evaluateMonthlyCompensation(complete, "2026-10-15", {
      events: [event("SICK_LEAVE", "2026-09-01", "2026-10-02", allDay(31))],
      attendance: attendance("2026-10"),
    });
    expect(result.components[0]).toMatchObject({
      status: "GATED",
      monthlyAmount: null,
    });
    expect(result.total).toBeNull();
  });

  it("uses a record-derived 31st ordinary sick-leave day without manual date entry", () => {
    const subject = complete;
    const events = [
      {
        ...event("SICK_LEAVE", "2026-09-01", "2026-09-30", allDay(30)),
        sickLeaveCategory: "ORDINARY" as const,
      },
      {
        ...event("SICK_LEAVE", "2026-10-20", "2026-10-20", allDay(1)),
        sickLeaveCategory: "ORDINARY" as const,
      },
    ];
    const current = confirmed(
      attendance("2026-10", {
        roundingPolicy: "NATIONAL_TREASURY_ARTICLE_47",
      }),
      subject,
      events,
    )!;

    const result = evaluateRaw(subject, "2026-10-15", {
      events,
      attendance: current,
      attendanceMonths: [current],
    });

    expect(result.basePayAdjustment).toMatchObject({
      derivedNonPayableDates: ["2026-10-20"],
      nonPayableDates: ["2026-10-20"],
      nonPayableDatesConfirmed: false,
      payableCalendarDays: 30,
    });
    expect(result.components[0]).toMatchObject({
      status: "CALCULATED",
      monthlyAmount: 1_161_290,
    });
  });

  it("does not deduct public-duty sick leave after 30 ordinary sick-leave days", () => {
    const subject = complete;
    const events = [
      {
        ...event("SICK_LEAVE", "2026-09-01", "2026-09-30", allDay(30)),
        sickLeaveCategory: "ORDINARY" as const,
      },
      {
        ...event("SICK_LEAVE", "2026-10-20", "2026-10-20", allDay(1)),
        sickLeaveCategory: "PUBLIC_DUTY" as const,
      },
    ];
    const current = confirmed(
      attendance("2026-10", {
        roundingPolicy: "NATIONAL_TREASURY_ARTICLE_47",
      }),
      subject,
      events,
    )!;

    const result = evaluateRaw(subject, "2026-10-15", {
      events,
      attendance: current,
      attendanceMonths: [current],
    });

    expect(result.basePayAdjustment?.derivedNonPayableDates).toEqual([]);
    expect(result.components[0]).toMatchObject({
      status: "CALCULATED",
      monthlyAmount: 1_200_000,
    });
  });

  it("lets an explicit complete institution list override unresolved derivation", () => {
    const subject = complete;
    const events = [
      {
        ...event("SICK_LEAVE", "2026-09-01", "2026-09-30", allDay(30)),
        sickLeaveCategory: "UNKNOWN" as const,
      },
      {
        ...event("SICK_LEAVE", "2026-10-20", "2026-10-20", allDay(1)),
        sickLeaveCategory: "ORDINARY" as const,
      },
    ];
    const current = confirmed(
      attendance("2026-10", {
        nonPayableDates: [] as DateOnly[],
        nonPayableDatesConfirmed: true,
        roundingPolicy: "NATIONAL_TREASURY_ARTICLE_47",
      }),
      subject,
      events,
    )!;

    const result = evaluateRaw(subject, "2026-10-15", {
      events,
      attendance: current,
      attendanceMonths: [current],
    });

    expect(
      result.basePayAdjustment?.derivationUnresolved.length,
    ).toBeGreaterThan(0);
    expect(result.components[0]).toMatchObject({
      status: "CALCULATED",
      monthlyAmount: 1_200_000,
    });
  });

  it("keeps a legacy coarse non-payable flag gated until exact dates are confirmed", () => {
    const result = evaluateMonthlyCompensation(complete, "2026-10-15", {
      attendance: attendance("2026-10", { hadNonPayableAbsence: true }),
    });
    expect(result.components[0]?.status).toBe("GATED");
    expect(result.components[0]?.explanation).toContain("정확한 날짜");
    expect(result.total).toBeNull();
  });

  it("deducts exact confirmed non-payable dates under explicit Treasury rounding", () => {
    const result = evaluateMonthlyCompensation(complete, "2026-10-15", {
      attendance: attendance("2026-10", {
        nonPayableDates: ["2026-10-20"] as DateOnly[],
        nonPayableDatesConfirmed: true,
        roundingPolicy: "NATIONAL_TREASURY_ARTICLE_47",
      }),
    });
    // 1,200,000 / 31 × 30 = 1,161,290.32... → 1,161,290.
    expect(result.components[0]).toMatchObject({
      status: "CALCULATED",
      monthlyAmount: 1_161_290,
    });
    expect(result.basePayAdjustment).toMatchObject({
      nonPayableDates: ["2026-10-20"],
      payableCalendarDays: 30,
      roundedAmount: 1_161_290,
    });
    expect(result.assumptions.join(" ")).toContain("2026-10-20");
  });
});

describe("compensation rule provenance", () => {
  const [bundle] = COMPENSATION_RULE_BUNDLES;
  const repoRoot = resolve(__dirname, "../../..");

  it("pins every executable source to a checksummed primary-text excerpt", () => {
    const pinned = bundle!.sources.filter(
      (source) => typeof source.excerptFile === "string",
    );
    expect(pinned.length).toBeGreaterThanOrEqual(3);
    for (const source of pinned) {
      const text = readFileSync(resolve(repoRoot, String(source.excerptFile)));
      expect(createHash("sha256").update(text).digest("hex")).toBe(
        source.excerptSha256,
      );
      expect(source.retrievedAt).toBe("2026-09-24");
    }
  });

  it("pins the MMA 2026 payment standard's original HWPX bytes", () => {
    const mma = bundle!.sources.find((source) =>
      source.title.includes("보수 등 지급 기준"),
    );
    expect(mma?.attachmentUrl).toBe(
      "https://open.mma.go.kr/caisGGGS/board/boardFileDown.do?gesipan_id=16&gsgeul_no=1517395&ilryeon_no=1",
    );
    const bytes = readFileSync(resolve(repoRoot, String(mma?.artifactFile)));
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      mma?.artifactSha256,
    );
    // The executable meal minimum must match the extracted text verbatim.
    const text = readFileSync(
      resolve(repoRoot, String(mma?.excerptFile)),
      "utf8",
    );
    expect(text).toContain("1일 중식비 : 9,000원(최소기준)");
    expect(bundle!.meal.minimumDailyAmount).toBe(9000);
    for (const amount of ["750,000", "900,000", "1,200,000", "1,500,000"]) {
      expect(text).toContain(amount);
    }
  });

  it("matches SHA256SUMS for every stored source file", () => {
    const dir = resolve(repoRoot, "docs/sources/2026");
    const sums = readFileSync(resolve(dir, "SHA256SUMS"), "utf8")
      .trim()
      .split("\n")
      .map((line) => line.split(/\s+/));
    expect(sums.length).toBe(6);
    for (const [hash, file] of sums) {
      const bytes = readFileSync(resolve(dir, String(file)));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
    }
  });

  it("exposes rule id, version, effective window and sources on every result", () => {
    const result = evaluateMonthlyCompensation(
      profile("2026-01-05", "2027-10-04"),
      "2026-10-15",
    );
    expect(result.rule).toMatchObject({
      id: "kr.mma.social-service.compensation",
      version: "2026",
      effectiveFrom: "2026-01-01",
      effectiveUntil: "2026-12-31",
    });
    expect(result.components.every((c) => c.basis.length > 0)).toBe(true);
    // Snapshots store this object, so each source must carry its file hash.
    expect(
      result.rule?.sources.every((source) =>
        /^[0-9a-f]{64}$/.test(source.sha256 ?? ""),
      ),
    ).toBe(true);
  });
});
