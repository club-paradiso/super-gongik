import { describe, expect, it } from "vitest";

import {
  calculateServiceProgress,
  continuousServiceCompletion,
  daysSinceDischarge,
  listServiceMilestones,
  nextServiceMilestone,
  seoulStartOfDay,
  serviceMilestoneOn,
  type DateOnly,
} from "../src/service";

// 637-day period: 2025-11-17 → 2027-08-16 (standard 21 months).
const period = {
  callUpDate: "2025-11-17" as DateOnly,
  expectedDischargeDate: "2027-08-16" as DateOnly,
};

describe("service milestones", () => {
  it("places percentage milestones on the first day that reaches them", () => {
    const fifty = listServiceMilestones(period).find(
      (item) => item.kind === "PERCENT" && item.value === 50,
    );
    expect(fifty?.date).toBe("2026-10-02");
    // The day before is still below 50 %, the milestone day is at/above it.
    expect(
      calculateServiceProgress(period, "2026-10-01").completionPercentage,
    ).toBeLessThan(50);
    expect(
      calculateServiceProgress(period, "2026-10-02").completionPercentage,
    ).toBeGreaterThanOrEqual(50);
  });

  it("counts D-N milestones back from the discharge date", () => {
    const d100 = listServiceMilestones(period).find(
      (item) => item.kind === "DAYS_REMAINING" && item.value === 100,
    );
    expect(d100?.date).toBe("2027-05-08");
    expect(calculateServiceProgress(period, d100!.date).dDay).toBe(100);
  });

  it("counts service day 100 with the call-up date as day 1", () => {
    const day100 = listServiceMilestones(period).find(
      (item) => item.kind === "SERVICE_DAY",
    );
    expect(day100?.date).toBe("2026-02-24");
  });

  it("returns milestones in date order and ends with discharge", () => {
    const list = listServiceMilestones(period);
    const dates = list.map((item) => item.date);
    expect([...dates].sort()).toEqual(dates);
    expect(list.at(0)?.kind).toBe("CALL_UP");
    expect(list.at(-1)?.kind).toBe("DISCHARGE");
  });

  it("finds the next milestone strictly after today", () => {
    expect(nextServiceMilestone(period, "2026-10-14")).toMatchObject({
      kind: "DAYS_REMAINING",
      value: 300,
      date: "2026-10-20",
    });
    expect(nextServiceMilestone(period, "2026-10-20")?.date).not.toBe(
      "2026-10-20",
    );
    expect(nextServiceMilestone(period, "2027-08-15")?.kind).toBe("DISCHARGE");
    expect(nextServiceMilestone(period, "2027-08-16")).toBeNull();
  });

  it("reports the call-up as the next milestone before service starts", () => {
    expect(
      nextServiceMilestone(
        { callUpDate: "2026-11-02", expectedDischargeDate: "2028-08-01" },
        "2026-10-14",
      ),
    ).toMatchObject({ kind: "CALL_UP", date: "2026-11-02" });
  });

  it("detects a milestone that falls on today", () => {
    expect(serviceMilestoneOn(period, "2026-10-02")).toMatchObject({
      kind: "PERCENT",
      value: 50,
    });
    expect(serviceMilestoneOn(period, "2026-10-03")).toBeNull();
    expect(serviceMilestoneOn(period, "2027-08-16")?.kind).toBe("DISCHARGE");
  });

  it("omits milestones outside a short period", () => {
    const short = {
      callUpDate: "2026-01-01" as DateOnly,
      expectedDischargeDate: "2026-03-01" as DateOnly,
    };
    const kinds = listServiceMilestones(short).map(
      (item) => `${item.kind}:${item.value}`,
    );
    expect(kinds).not.toContain("DAYS_REMAINING:100");
    expect(kinds).not.toContain("SERVICE_YEAR:1");
    expect(kinds).toContain("DAYS_REMAINING:50");
  });
});

describe("continuous completion", () => {
  it("equals the day model at every Seoul midnight", () => {
    for (const date of [
      "2025-11-17",
      "2026-03-01",
      "2026-10-14",
      "2027-08-15",
    ] as DateOnly[]) {
      const progress = calculateServiceProgress(period, date);
      expect(
        continuousServiceCompletion(period, new Date(seoulStartOfDay(date))),
      ).toBeCloseTo(progress.elapsedDays / progress.totalServiceDays, 12);
    }
  });

  it("uses Asia/Seoul midnight, not UTC midnight", () => {
    // 2026-10-14 00:00 KST is 2026-10-13 15:00 UTC.
    expect(seoulStartOfDay("2026-10-14")).toBe(
      Date.parse("2026-10-13T15:00:00.000Z"),
    );
  });

  it("clamps before call-up and after discharge", () => {
    expect(
      continuousServiceCompletion(period, new Date("2025-01-01T00:00:00Z")),
    ).toBe(0);
    expect(
      continuousServiceCompletion(period, new Date("2027-08-15T15:00:00Z")),
    ).toBe(1);
  });

  it("advances within a day", () => {
    const morning = continuousServiceCompletion(
      period,
      new Date("2026-10-14T00:00:00Z"),
    );
    const evening = continuousServiceCompletion(
      period,
      new Date("2026-10-14T10:00:00Z"),
    );
    expect(evening).toBeGreaterThan(morning);
  });
});

describe("days since discharge", () => {
  it("is null in service and counts from the discharge date after", () => {
    expect(daysSinceDischarge(period, "2027-08-15")).toBeNull();
    expect(daysSinceDischarge(period, "2027-08-16")).toBe(0);
    expect(daysSinceDischarge(period, "2027-08-26")).toBe(10);
  });
});
