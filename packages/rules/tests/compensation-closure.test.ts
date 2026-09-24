import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
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
  deriveMonthServiceDays,
  evaluateMonthlyCompensation,
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
    ...extra,
  };
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

  it("states the month's own divisor, 28 days for February 2026", () => {
    const result = evaluateMonthlyCompensation(
      profile("2026-02-02", "2027-11-01"),
      "2026-02-10",
    );
    expect(result.components[0]?.explanation).toContain("28일");
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

  it("excludes declared holidays and full-day leave, counts the rest", () => {
    const days = deriveMonthServiceDays({
      profile: serving,
      month: "2026-10" as YearMonth,
      events: [event("ANNUAL_LEAVE", "2026-10-13", "2026-10-14", allDay(2))],
      attendance: attendance("2026-10", {
        nonWorkingDates: ["2026-10-05", "2026-10-09"] as DateOnly[],
      }),
    });
    expect(days.status).toBe("READY");
    expect(days.mealEligibleDays).toBe(22 - 2 - 2);
    expect(days.transportEligibleDays).toBe(18);
    expect(days.days.find((d) => d.date === "2026-10-13")?.kind).toBe(
      "FULL_DAY_LEAVE",
    );
  });

  it("charges a leave over a weekend only on scheduled days when the count proves it", () => {
    const days = deriveMonthServiceDays({
      profile: serving,
      month: "2026-10" as YearMonth,
      // Fri 16th – Mon 19th, 2 charged days = the two scheduled weekdays.
      events: [event("ANNUAL_LEAVE", "2026-10-16", "2026-10-19", allDay(2))],
      attendance: attendance("2026-10"),
    });
    expect(days.status).toBe("READY");
    expect(days.mealEligibleDays).toBe(20);
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

  it("requires reconfirmation after the month's records change", () => {
    const days = deriveMonthServiceDays({
      profile: serving,
      month: "2026-10" as YearMonth,
      events: [
        event("ANNUAL_LEAVE", "2026-10-13", "2026-10-13", allDay(1), T2),
      ],
      attendance: attendance("2026-10"),
    });
    expect(days.status).toBe("NEEDS_INPUT");
    expect(days.missing).toContain("MONTH_RECONFIRMATION");
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

describe("monthly total", () => {
  const complete = profile("2026-01-05", "2027-10-04", {
    defaultMealAllowanceOverride: 8000,
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
      8000 * 20,
      2800 * 20,
    ]);
    expect(result.total).toBe(1_200_000 + 160_000 + 56_000);
    expect(result.unresolved).toEqual([]);
  });

  it("never uses the unverified 9,000 KRW reference to reach a total", () => {
    const result = evaluateMonthlyCompensation(
      { ...complete, defaultMealAllowanceOverride: null },
      "2026-10-15",
      { attendance: attendance("2026-10") },
    );
    expect(result.components[1]).toMatchObject({
      status: "NEEDS_INPUT",
      monthlyAmount: null,
      unverifiedReference: 9000,
    });
    expect(result.components[2]?.status).toBe("CALCULATED");
    expect(result.total).toBeNull();
    expect(result.status).toBe("PARTIAL");
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

  it("gates base pay for a month confirmed to contain a non-payable absence", () => {
    const result = evaluateMonthlyCompensation(complete, "2026-10-15", {
      attendance: attendance("2026-10", { hadNonPayableAbsence: true }),
    });
    expect(result.components[0]?.status).toBe("GATED");
    expect(result.total).toBeNull();
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

  it("marks the unretrieved MMA attachment as unused", () => {
    const mma = bundle!.sources.find((source) =>
      source.title.includes("보수 등 지급 기준"),
    );
    expect(mma?.attachmentExtractionStatus).toBe(
      "NOT_RETRIEVED_EGRESS_BLOCKED",
    );
    expect(bundle!.meal).toMatchObject({
      rateStatus: "VERIFIED_NEEDS_USER_INPUT",
      unverifiedReferenceStatus: "SECONDARY_CORROBORATION_ONLY",
    });
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
  });
});
