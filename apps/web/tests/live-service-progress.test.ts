import { describe, expect, it } from "vitest";

import {
  calculateLiveServiceProgress,
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
    expect(formatLiveCountdown(result)).toBe("D-1 00:00:00");
  });

  it("clamps completion after discharge", () => {
    const result = calculateLiveServiceProgress(
      profile,
      new Date("2026-01-03T00:00:01+09:00"),
    );

    expect(result.remainingMilliseconds).toBe(0);
    expect(result.completionPercentage).toBe(100);
  });
});
