import { describe, expect, it } from "vitest";

import {
  calculateLiveServiceProgress,
  formatLiveCompletionPercentage,
  formatLiveCountdown,
} from "@/lib/live-service-progress";

const profile = {
  callUpDate: "2026-01-01",
  expectedDischargeDate: "2026-01-03",
} as const;

describe("live service progress", () => {
  it("counts down to Seoul midnight on the discharge date", () => {
    const result = calculateLiveServiceProgress(
      profile,
      new Date("2026-01-01T15:00:00.000Z"),
    );

    expect(result.countdown).toEqual({
      days: 1,
      hours: 0,
      minutes: 0,
      seconds: 0,
    });
    expect(result.completionPercentage).toBe(50);
    expect(formatLiveCountdown(result)).toBe("1일 00:00:00");
  });

  it("shows a different six-decimal percentage one second later on a 21-month-scale term", () => {
    const longProfile = {
      callUpDate: "2026-03-16",
      expectedDischargeDate: "2027-12-16",
    } as const;
    const first = calculateLiveServiceProgress(
      longProfile,
      new Date("2026-09-27T06:00:00.000Z"),
    );
    const second = calculateLiveServiceProgress(
      longProfile,
      new Date("2026-09-27T06:00:01.000Z"),
    );

    expect(formatLiveCompletionPercentage(first)).not.toBe(
      formatLiveCompletionPercentage(second),
    );
    expect(formatLiveCompletionPercentage(first)).toMatch(/^\d+\.\d{6}%$/);
  });

  it("clamps completion after discharge", () => {
    const result = calculateLiveServiceProgress(
      profile,
      new Date("2026-01-03T00:00:01+09:00"),
    );

    expect(result.remainingMilliseconds).toBe(0);
    expect(result.completionPercentage).toBe(100);
  });
  it("never rounds up to 100% before the actual completion instant", () => {
    const end = Date.parse("2026-01-03T00:00:00+09:00");
    const before = calculateLiveServiceProgress(profile, new Date(end - 1));
    expect(before.completionPercentage).toBeLessThan(100);
    expect(formatLiveCompletionPercentage(before)).not.toBe("100.000000%");
    expect(
      formatLiveCompletionPercentage(
        calculateLiveServiceProgress(profile, new Date(end)),
      ),
    ).toBe("100.000000%");
  });
  it("clamps to zero before call-up", () => {
    const before = calculateLiveServiceProgress(
      profile,
      new Date("2025-12-01T00:00:00+09:00"),
    );
    expect(formatLiveCompletionPercentage(before)).toBe("0.000000%");
  });
});
