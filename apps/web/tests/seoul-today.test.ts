import { describe, expect, it } from "vitest";

import { msUntilNextSeoulMidnight } from "../src/hooks/use-seoul-today";

describe("Seoul midnight rollover", () => {
  it("waits until 00:00 Asia/Seoul, not UTC midnight", () => {
    // 2026-10-14 23:59:00 KST = 14:59:00 UTC → one minute to go.
    expect(msUntilNextSeoulMidnight(Date.parse("2026-10-14T14:59:00Z"))).toBe(
      60_000,
    );
    // UTC midnight is 09:00 KST: fifteen hours remain.
    expect(msUntilNextSeoulMidnight(Date.parse("2026-10-14T00:00:00Z"))).toBe(
      15 * 3_600_000,
    );
  });

  it("schedules a full day right at Seoul midnight", () => {
    expect(msUntilNextSeoulMidnight(Date.parse("2026-10-14T15:00:00Z"))).toBe(
      24 * 3_600_000,
    );
  });
});
