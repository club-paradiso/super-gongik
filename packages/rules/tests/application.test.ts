import {
  buildServiceProfile,
  type DateOnly,
  type ServiceProfile,
} from "@super-gongik/domain";
import { describe, expect, it } from "vitest";

import {
  COMPENSATION_RULE_BUNDLES,
  calculateAnnualLeaveAllocation,
  type CompensationRuleBundle,
  deriveAnnualLeaveCredits,
  evaluateMonthlyCompensation,
} from "../src";

function profile(
  callUpDate: string,
  expectedDischargeDate: string,
  priorServiceCredit: ServiceProfile["priorServiceCredit"] = "NONE",
): ServiceProfile {
  return buildServiceProfile(
    {
      callUpDate,
      expectedDischargeDate,
      serviceCategory: null,
      workplaceType: null,
      defaultCommuteCost: null,
      defaultMealAllowanceOverride: null,
      timezone: "Asia/Seoul",
      priorServiceCredit,
    },
    { id: "p", localProfileId: "p", timestamp: "2026-01-01T00:00:00.000Z" },
  );
}

describe("annual-leave credits by grant date", () => {
  it("uses the bundle effective on each tranche's own grant date", () => {
    const credits = deriveAnnualLeaveCredits({
      callUpDate: "2026-05-04",
      referenceDate: "2026-09-24",
    });
    expect(credits).toMatchObject([
      {
        key: "YEAR_1",
        grantDate: "2026-05-04",
        status: "RULE_VERIFIED",
        days: 15,
        ruleVersion: "2026-04-23",
      },
      {
        key: "YEAR_2",
        grantDate: "2027-05-04",
        status: "RULE_VERIFIED",
        days: 13,
        ruleVersion: "2026-08-28",
      },
    ]);
  });

  it("never applies a newer bundle to a call-up date it does not cover", () => {
    const credits = deriveAnnualLeaveCredits({
      callUpDate: "2025-11-03",
      referenceDate: "2026-09-24",
    });
    expect(credits[0]).toMatchObject({
      key: "YEAR_1",
      status: "PENDING_CONFIRMATION",
      days: null,
      referenceDays: 15,
    });
    expect(credits[1]).toMatchObject({
      key: "YEAR_2",
      status: "RULE_VERIFIED",
      days: 13,
    });
  });

  it("does not auto-allocate non-standard service lengths", () => {
    const credits = deriveAnnualLeaveCredits({
      callUpDate: "2026-05-04",
      referenceDate: "2026-09-24",
      mandatoryServiceMonths: 18,
    });
    expect(
      credits.every((credit) => credit.status === "PENDING_CONFIRMATION"),
    ).toBe(true);
  });

  it("refuses allocation for dates before the oldest verified bundle", () => {
    expect(() =>
      calculateAnnualLeaveAllocation(21, "2026-04-22" as DateOnly),
    ).toThrow();
  });
});

describe("monthly compensation gating", () => {
  it("calculates verified base pay but no total while inputs are missing", () => {
    const result = evaluateMonthlyCompensation(
      profile("2026-01-05", "2027-10-04"),
      "2026-10-15",
    );
    expect(result.status).toBe("PARTIAL");
    // January is month 1, so October is month 10 → 상등병 band (9–14).
    expect(result.serviceMonthOrdinal).toBe(10);
    expect(result.components[0]).toMatchObject({
      status: "CALCULATED",
      monthlyAmount: 1_200_000,
    });
    expect(result.components[1]).toMatchObject({
      status: "NEEDS_INPUT",
      monthlyAmount: null,
      dailyRate: null,
      unverifiedReference: 9000,
    });
    expect(result.components[2]).toMatchObject({
      status: "NEEDS_INPUT",
      monthlyAmount: null,
    });
    expect(result.total).toBeNull();
    expect(result.rule?.version).toBe("2026");
  });

  it("returns no base-pay number for the partial call-up month", () => {
    const result = evaluateMonthlyCompensation(
      profile("2026-09-14", "2028-06-13"),
      "2026-09-24",
    );
    expect(result.components[0]).toMatchObject({
      status: "GATED",
      monthlyAmount: null,
    });
    expect(result.total).toBeNull();
  });

  it("returns no base-pay number while prior service is unanswered or unconfirmed", () => {
    for (const answer of [null, "HAS_PRIOR_SERVICE"] as const) {
      const result = evaluateMonthlyCompensation(
        profile("2026-01-05", "2027-10-04", answer),
        "2026-10-15",
      );
      expect(result.components[0]).toMatchObject({
        status: "NEEDS_INPUT",
        monthlyAmount: null,
      });
      expect(result.total).toBeNull();
    }
  });

  it("does not fall forward into an unverified pay year", () => {
    const result = evaluateMonthlyCompensation(
      profile("2026-01-05", "2027-10-04"),
      "2027-02-15",
    );
    expect(result.status).toBe("UNSUPPORTED");
    expect(result.components).toEqual([]);
  });

  it("keeps transport uncalculated until the month's days are settled", () => {
    const withFare = {
      ...profile("2026-01-05", "2027-10-04"),
      defaultCommuteCost: 3000,
    };
    const transport = evaluateMonthlyCompensation(withFare, "2026-10-15")
      .components[2];
    expect(transport).toMatchObject({
      status: "NEEDS_INPUT",
      monthlyAmount: null,
      dailyRate: 3000,
    });
  });
});

describe("compensation rule selection by the evaluated date", () => {
  // Hypothetical mid-year amendment: the verified 2026 bundle split at
  // 2026-07-01, with the second half paying 100,000 KRW more per band.
  const [verified2026] = COMPENSATION_RULE_BUNDLES;
  const firstHalf: CompensationRuleBundle = {
    ...verified2026!,
    version: "2026-H1",
    effectiveFrom: "2026-01-01",
    effectiveUntil: "2026-06-30",
  };
  const secondHalf: CompensationRuleBundle = {
    ...verified2026!,
    version: "2026-H2",
    effectiveFrom: "2026-07-01",
    effectiveUntil: "2026-12-31",
    basePay: {
      ...verified2026!.basePay,
      serviceMonthBands: verified2026!.basePay.serviceMonthBands.map(
        (band) => ({
          ...band,
          monthlyAmount: band.monthlyAmount + 100_000,
        }),
      ),
    },
  };
  const bundles = [firstHalf, secondHalf];
  const serving = profile("2026-01-05", "2027-10-04");

  it("uses the bundle in force on the last day before the boundary", () => {
    const result = evaluateMonthlyCompensation(serving, "2026-06-30", {
      bundles,
    });
    expect(result.rule?.version).toBe("2026-H1");
    // Call-up 2026-01 → June is month 6 → 일등병 band (3–8).
    expect(result.components[0]?.monthlyAmount).toBe(900_000);
  });

  it("switches bundles on the effective date instead of using January 1", () => {
    const result = evaluateMonthlyCompensation(serving, "2026-07-01", {
      bundles,
    });
    expect(result.rule?.version).toBe("2026-H2");
    expect(result.components[0]?.monthlyAmount).toBe(1_000_000);
  });

  it("keeps every safety gate under the newer bundle", () => {
    const unanswered = evaluateMonthlyCompensation(
      profile("2026-01-05", "2027-10-04", null),
      "2026-07-15",
      { bundles },
    );
    expect(unanswered.rule?.version).toBe("2026-H2");
    expect(
      unanswered.components.every((item) => item.monthlyAmount === null),
    ).toBe(true);
    const partialMonth = evaluateMonthlyCompensation(
      profile("2026-07-06", "2028-04-05"),
      "2026-07-20",
      { bundles },
    );
    expect(partialMonth.components[0]?.status).toBe("GATED");
    expect(
      partialMonth.components.every((item) => item.monthlyAmount === null),
    ).toBe(true);
  });

  it("refuses a date covered by no bundle rather than borrowing one", () => {
    const result = evaluateMonthlyCompensation(serving, "2026-07-01", {
      bundles: [firstHalf],
    });
    expect(result.status).toBe("UNSUPPORTED");
    expect(result.components).toEqual([]);
  });
});
