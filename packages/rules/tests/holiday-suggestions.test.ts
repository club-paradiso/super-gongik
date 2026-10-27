import type { DateOnly } from "@super-gongik/domain";
import { describe, expect, it } from "vitest";

import { suggestedHolidayNonWorkingDays } from "../src";

const d = (value: string) => value as DateOnly;

describe("suggestedHolidayNonWorkingDays", () => {
  it("offers 관공서 공휴일 on scheduled days, including 대체공휴일", () => {
    const result = suggestedHolidayNonWorkingDays([
      { date: d("2026-10-02"), kind: "WORKED" },
      { date: d("2026-10-03"), kind: "NOT_SCHEDULED" },
      { date: d("2026-10-05"), kind: "WORKED" },
      { date: d("2026-10-09"), kind: "NEEDS_DECISION" },
    ]);
    expect(result).toEqual({
      covered: true,
      holidays: [
        { date: "2026-10-05", name: "대체공휴일(개천절)" },
        { date: "2026-10-09", name: "한글날" },
      ],
    });
  });

  it("skips days outside service and days already declared off", () => {
    const result = suggestedHolidayNonWorkingDays([
      { date: d("2026-10-05"), kind: "OUTSIDE_SERVICE" },
      { date: d("2026-10-09"), kind: "DECLARED_NON_WORKING" },
    ]);
    expect(result.holidays).toEqual([]);
    expect(result.covered).toBe(true);
  });

  it("reports a year without holiday data as not covered", () => {
    const result = suggestedHolidayNonWorkingDays([
      { date: d("2031-01-01"), kind: "WORKED" },
    ]);
    expect(result).toEqual({ covered: false, holidays: [] });
  });

  it("reports an empty month as not covered", () => {
    expect(suggestedHolidayNonWorkingDays([]).covered).toBe(false);
  });
});
