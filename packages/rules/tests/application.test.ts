import {
  buildServiceProfile,
  type DateOnly,
  type ServiceProfile,
} from "@super-gongik/domain";
import { describe, expect, it } from "vitest";

import {
  calculateAnnualLeaveAllocation,
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
  it("calculates only verified base pay and never a total", () => {
    const result = evaluateMonthlyCompensation(
      profile("2026-01-05", "2027-10-04"),
      "2026-10-15",
    );
    expect(result.status).toBe("PARTIAL_ESTIMATE");
    expect(result.serviceMonthIndex).toBe(9);
    expect(result.components[0]).toMatchObject({
      status: "CALCULATED",
      monthlyAmount: 1_200_000,
    });
    expect(result.components[1]).toMatchObject({
      status: "SUGGESTED_ONLY",
      monthlyAmount: null,
      dailyRate: 9000,
    });
    expect(result.components[2]).toMatchObject({
      status: "NEEDS_INPUT",
      monthlyAmount: null,
    });
    expect(result.total).toBeNull();
    expect(result.rule?.version).toBe("2026");
  });

  it("returns no number for the partial call-up month", () => {
    const result = evaluateMonthlyCompensation(
      profile("2026-09-14", "2028-06-13"),
      "2026-09-24",
    );
    expect(result.status).toBe("GATED");
    expect(
      result.components.every((component) => component.monthlyAmount === null),
    ).toBe(true);
  });

  it("returns no number while prior service is unanswered or present", () => {
    for (const answer of [null, "HAS_PRIOR_SERVICE"] as const) {
      const result = evaluateMonthlyCompensation(
        profile("2026-01-05", "2027-10-04", answer),
        "2026-10-15",
      );
      expect(result.status).not.toBe("PARTIAL_ESTIMATE");
      expect(
        result.components.every(
          (component) => component.monthlyAmount === null,
        ),
      ).toBe(true);
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

  it("keeps transport contextual even when a commute fare is entered", () => {
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
