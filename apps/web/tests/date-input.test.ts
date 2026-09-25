import { describe, expect, it } from "vitest";

import { formatDateInputDisplay } from "../src/lib/date-display";

describe("formatDateInputDisplay", () => {
  it("formats a calendar date in Korean with its weekday", () => {
    expect(formatDateInputDisplay("2026-09-25")).toBe("2026년 9월 25일 (금)");
    expect(formatDateInputDisplay("2027-08-02")).toBe("2027년 8월 2일 (월)");
  });

  it("does not shift the day across time zones", () => {
    expect(formatDateInputDisplay("2026-01-01")).toBe("2026년 1월 1일 (목)");
  });

  it("returns an empty string for incomplete or invalid values", () => {
    expect(formatDateInputDisplay("")).toBe("");
    expect(formatDateInputDisplay("2026-02-30")).toBe("");
    expect(formatDateInputDisplay("2026-9-1")).toBe("");
  });
});
