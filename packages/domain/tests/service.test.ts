import { describe, expect, it } from "vitest";

import {
  addCalendarMonths,
  buildServiceProfile,
  calculateExpectedDischargeDate,
  calculateServiceMonthIndex,
  calculateServiceProgress,
  dateOnlyInTimeZone,
  differenceInCalendarDays,
  isPartialServiceMonth,
  updateServiceProfile,
} from "../src/service";

const metadata = {
  id: "profile-1",
  localProfileId: "local-profile-1",
  timestamp: "2026-08-30T12:00:00.000Z",
};

function profile(callUpDate: string, expectedDischargeDate: string) {
  return buildServiceProfile(
    {
      callUpDate,
      expectedDischargeDate,
      serviceCategory: null,
      workplaceType: null,
      defaultCommuteCost: null,
      defaultMealAllowanceOverride: null,
      timezone: "Asia/Seoul",
    },
    metadata,
  );
}

describe("service profile", () => {
  it("calculates the 21-month discharge date using calendar months", () => {
    expect(calculateExpectedDischargeDate("2026-01-05")).toBe("2027-10-04");
  });

  it("clamps month-end dates before subtracting the inclusive final day", () => {
    expect(addCalendarMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(calculateExpectedDischargeDate("2024-02-29")).toBe("2025-11-28");
  });

  it("rejects a call-up date after the discharge date", () => {
    expect(() => profile("2026-02-02", "2026-02-01")).toThrow(
      "소집해제 예정일은 소집일보다 빠를 수 없어요.",
    );
  });

  it("stores workday clock anchors only as a complete ordered pair", () => {
    const current = profile("2026-01-05", "2027-10-04");
    expect(() =>
      updateServiceProfile(
        current,
        { ...current, workdayStartTime: "09:00", workdayEndTime: null },
        "2026-08-31T12:00:00.000Z",
      ),
    ).toThrow("근무 시작 시각과 종료 시각을 함께 입력해 주세요.");

    expect(() =>
      updateServiceProfile(
        current,
        {
          ...current,
          workdayStartTime: "18:00",
          workdayEndTime: "09:00",
        },
        "2026-08-31T12:00:00.000Z",
      ),
    ).toThrow("근무 종료 시각은 시작 시각보다 늦어야 해요.");

    const updated = updateServiceProfile(
      current,
      {
        ...current,
        workdayStartTime: "09:00",
        workdayEndTime: "18:00",
      },
      "2026-08-31T12:00:00.000Z",
    );
    expect(updated.workdayStartTime).toBe("09:00");
    expect(updated.workdayEndTime).toBe("18:00");
  });

  it("keeps local identity and creation time when the guest profile is updated", () => {
    const current = profile("2026-01-05", "2027-10-04");
    const updated = updateServiceProfile(
      current,
      {
        ...current,
        serviceCategory: "사회복지",
      },
      "2026-08-31T12:00:00.000Z",
    );

    expect(updated.id).toBe(current.id);
    expect(updated.localProfileId).toBe(current.localProfileId);
    expect(updated.createdAt).toBe(current.createdAt);
    expect(updated.updatedAt).toBe("2026-08-31T12:00:00.000Z");
    expect(updated.serviceCategory).toBe("사회복지");
  });
});

describe("service progress", () => {
  it("returns zero elapsed time when the call-up date is today", () => {
    const result = calculateServiceProgress(
      profile("2026-08-30", "2028-05-29"),
      "2026-08-30",
    );

    expect(result.state).toBe("IN_SERVICE");
    expect(result.elapsedDays).toBe(0);
    expect(result.completionPercentage).toBe(0);
  });

  it("returns D-0 and 100 percent on the discharge date", () => {
    const result = calculateServiceProgress(
      profile("2025-01-01", "2026-08-30"),
      "2026-08-30",
    );

    expect(result.state).toBe("COMPLETED");
    expect(result.dDay).toBe(0);
    expect(result.completionPercentage).toBe(100);
  });

  it("handles leap-day and year boundaries as civil dates", () => {
    expect(differenceInCalendarDays("2024-03-01", "2024-02-28")).toBe(2);
    expect(differenceInCalendarDays("2027-01-01", "2026-12-31")).toBe(1);
  });

  it("keeps not-started and completed states explicit", () => {
    const serviceProfile = profile("2026-09-01", "2028-05-31");

    expect(calculateServiceProgress(serviceProfile, "2026-08-30").state).toBe(
      "NOT_STARTED",
    );
    expect(calculateServiceProgress(serviceProfile, "2028-06-01").state).toBe(
      "COMPLETED",
    );
  });

  it("derives a date in Asia/Seoul without shifting date-only inputs", () => {
    expect(dateOnlyInTimeZone(new Date("2026-08-30T15:30:00.000Z"))).toBe(
      "2026-08-31",
    );
    expect(
      calculateServiceProgress(
        profile("2026-08-31", "2028-05-30"),
        "2026-08-31",
      ).elapsedDays,
    ).toBe(0);
  });

  it("calculates service-month boundaries by calendar month", () => {
    expect(calculateServiceMonthIndex("2026-01-31", "2026-02-01")).toBe(1);
    expect(calculateServiceMonthIndex("2025-12-15", "2026-03-01")).toBe(3);
  });

  it("marks the call-up and discharge calendar months as unsafe for automatic proration", () => {
    const serviceProfile = profile("2026-01-05", "2027-10-04");

    expect(isPartialServiceMonth(serviceProfile, "2026-01-31")).toBe(true);
    expect(isPartialServiceMonth(serviceProfile, "2026-02-01")).toBe(false);
    expect(isPartialServiceMonth(serviceProfile, "2027-10-01")).toBe(true);
  });
});
