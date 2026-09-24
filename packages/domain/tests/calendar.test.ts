import { describe, expect, it } from "vitest";

import {
  buildMonthGrid,
  countWeekdays,
  dateOnlyInTimeZone,
  dayOfWeek,
  daysInMonth,
} from "../src";

describe("calendar month model", () => {
  it("builds a Sunday-first grid for a leap-year February", () => {
    expect(daysInMonth("2028-02")).toBe(29);
    const grid = buildMonthGrid("2028-02");
    const cells = grid.flat();
    expect(cells[0]).toEqual({ date: "2028-01-30", inMonth: false });
    expect(cells.filter((cell) => cell.inMonth)).toHaveLength(29);
    expect(cells.at(-1)?.date).toBe("2028-03-04");
    expect(grid.every((week) => week.length === 7)).toBe(true);
  });

  it("computes weekdays on civil dates without time-zone drift", () => {
    expect(dayOfWeek("2026-09-24")).toBe(4);
    // Fri 2026-09-25 .. Mon 2026-09-28 spans a weekend.
    expect(countWeekdays("2026-09-25", "2026-09-28")).toBe(2);
  });

  it("treats 00:30 in Seoul as the new calendar day", () => {
    // 2026-12-31T15:30Z is 2027-01-01 00:30 in Asia/Seoul.
    expect(dateOnlyInTimeZone(new Date("2026-12-31T15:30:00.000Z"))).toBe(
      "2027-01-01",
    );
    expect(dateOnlyInTimeZone(new Date("2026-12-31T14:59:59.000Z"))).toBe(
      "2026-12-31",
    );
  });
});
