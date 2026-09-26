import {
  buildServiceProfile,
  type DateOnly,
  type ServiceProfile,
  type ServiceProfileInput,
} from "@super-gongik/domain";
import { describe, expect, it } from "vitest";

import { derivePayBandSchedule, evaluateMonthlyCompensation } from "../src";

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
      ...extra,
    },
    { id: "p", localProfileId: "p", timestamp: "2026-01-01T00:00:00.000Z" },
  );
}

describe("pay band schedule", () => {
  it("starts each band on the first day of its service-month ordinal", () => {
    const schedule = derivePayBandSchedule(
      profile("2025-11-17", "2027-08-16"),
      "2026-10-14",
    );
    expect(schedule.status).toBe("READY");
    if (schedule.status !== "READY") return;
    expect(schedule.steps.map((step) => [step.label, step.startDate])).toEqual([
      ["이병 상당", "2025-11-17"],
      ["일병 상당", "2026-01-01"],
      ["상병 상당", "2026-07-01"],
      ["병장 상당", "2027-01-01"],
    ]);
    expect(schedule.current?.label).toBe("상병 상당");
    expect(schedule.next?.label).toBe("병장 상당");
  });

  it("never assumes an unverified year's amount", () => {
    const schedule = derivePayBandSchedule(
      profile("2025-11-17", "2027-08-16"),
      "2026-10-14",
    );
    if (schedule.status !== "READY") throw new Error("not ready");
    // 2025 and 2027 have no verified bundle in this repository.
    expect(schedule.steps[0]).toMatchObject({ monthlyAmount: null });
    expect(schedule.next).toMatchObject({
      startDate: "2027-01-01",
      monthlyAmount: null,
      amountRuleVersion: null,
    });
    expect(schedule.current).toMatchObject({
      monthlyAmount: 1_200_000,
      amountRuleVersion: "2026",
    });
  });

  it("agrees with the monthly evaluation's rank for every 2026 month", () => {
    const subject = profile("2025-11-17", "2027-08-16");
    const schedule = derivePayBandSchedule(subject, "2026-06-15");
    if (schedule.status !== "READY") throw new Error("not ready");
    for (let month = 1; month <= 12; month += 1) {
      const date = `2026-${String(month).padStart(2, "0")}-15` as DateOnly;
      const evaluation = evaluateMonthlyCompensation(subject, date);
      const band = [...schedule.steps]
        .reverse()
        .find((step) => step.startDate <= date);
      expect(band?.label, date).toBe(evaluation.equivalentRank);
    }
  });

  it("shifts bands earlier by confirmed prior-service months", () => {
    const schedule = derivePayBandSchedule(
      profile("2026-03-09", "2027-12-08", {
        priorServiceCredit: "HAS_PRIOR_SERVICE",
        priorServiceBasis: "ARTICLE_62_2_4_RESEARCH_INDUSTRIAL",
        priorServiceCreditedMonths: 10,
      }),
      "2026-03-20",
    );
    if (schedule.status !== "READY") throw new Error("not ready");
    expect(schedule.steps.map((step) => [step.label, step.startDate])).toEqual([
      ["상병 상당", "2026-03-09"],
      ["병장 상당", "2026-07-01"],
    ]);
    expect(schedule.next?.monthlyAmount).toBe(1_500_000);
  });

  it("asks for input instead of guessing prior-service credit", () => {
    expect(
      derivePayBandSchedule(
        profile("2026-03-09", "2027-12-08", { priorServiceCredit: null }),
        "2026-03-20",
      ).status,
    ).toBe("NEEDS_INPUT");
    expect(
      derivePayBandSchedule(
        profile("2026-03-09", "2027-12-08", {
          priorServiceCredit: "HAS_PRIOR_SERVICE",
          priorServiceBasis: "ARTICLE_62_2_4_RESEARCH_INDUSTRIAL",
          priorServiceCreditedMonths: 3,
          priorServiceCreditHasPartialMonth: true,
        }),
        "2026-03-20",
      ).status,
    ).toBe("NEEDS_INPUT");
  });

  it("is unsupported on a date without a verified rule", () => {
    expect(
      derivePayBandSchedule(profile("2026-03-09", "2027-12-08"), "2027-02-01")
        .status,
    ).toBe("UNSUPPORTED");
  });

  it("drops bands that would start after discharge", () => {
    const schedule = derivePayBandSchedule(
      profile("2026-01-05", "2026-06-30"),
      "2026-02-01",
    );
    if (schedule.status !== "READY") throw new Error("not ready");
    expect(schedule.steps.map((step) => step.label)).toEqual([
      "이병 상당",
      "일병 상당",
    ]);
  });
});
