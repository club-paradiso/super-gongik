import { describe, expect, it } from "vitest";

import { classifyAnnualLeaveUsage } from "../src";

const schedule = {
  workdayStartTime: "09:00",
  workdayEndTime: "18:00",
} as const;

function partial(startTime: string, endTime: string, durationMinutes: number) {
  return {
    kind: "PARTIAL" as const,
    startTime,
    endTime,
    durationMinutes,
  };
}

describe("annual leave attendance classification", () => {
  it("classifies 09:00–13:00 as authorized late arrival, not half-day leave", () => {
    const result = classifyAnnualLeaveUsage({
      eventType: "ANNUAL_LEAVE",
      timing: partial("09:00", "13:00", 240),
      ...schedule,
    });

    expect(result).toMatchObject({
      kind: "LATE_ARRIVAL",
      label: "허가지각",
      eventType: "LATE_ARRIVAL",
      automatic: true,
    });
  });

  it("never infers half-day leave from a four-hour duration alone", () => {
    const result = classifyAnnualLeaveUsage({
      eventType: "ANNUAL_LEAVE",
      timing: partial("10:00", "14:00", 240),
      ...schedule,
    });

    expect(result?.kind).toBe("OUTING");
    expect(result?.kind).not.toBe("HALF_DAY");
  });

  it("uses the 14:00 boundary for exact morning and afternoon half-day ranges", () => {
    expect(
      classifyAnnualLeaveUsage({
        eventType: "ANNUAL_LEAVE",
        timing: partial("09:00", "14:00", 300),
        ...schedule,
      }),
    ).toMatchObject({
      kind: "HALF_DAY",
      label: "오전 반가",
      halfDayPart: "AM",
    });

    expect(
      classifyAnnualLeaveUsage({
        eventType: "ANNUAL_LEAVE",
        timing: partial("14:00", "18:00", 240),
        ...schedule,
      }),
    ).toMatchObject({
      kind: "HALF_DAY",
      label: "오후 반가",
      halfDayPart: "PM",
    });
  });

  it("classifies non-half-day end and middle intervals by position", () => {
    expect(
      classifyAnnualLeaveUsage({
        eventType: "ANNUAL_LEAVE",
        timing: partial("15:00", "18:00", 180),
        ...schedule,
      })?.kind,
    ).toBe("EARLY_LEAVE");

    expect(
      classifyAnnualLeaveUsage({
        eventType: "ANNUAL_LEAVE",
        timing: partial("11:00", "12:00", 60),
        ...schedule,
      })?.kind,
    ).toBe("OUTING");
  });

  it("keeps explicit half-day approval separate from minute-based attendance", () => {
    const result = classifyAnnualLeaveUsage({
      eventType: "ANNUAL_LEAVE",
      timing: { kind: "HALF_DAY", half: "AM" },
      ...schedule,
    });

    expect(result).toMatchObject({
      kind: "HALF_DAY",
      label: "반가",
      eventType: "ANNUAL_LEAVE",
    });
  });

  it("does not guess attendance shape without confirmed workday clocks", () => {
    const result = classifyAnnualLeaveUsage({
      eventType: "ANNUAL_LEAVE",
      timing: partial("09:00", "13:00", 240),
      workdayStartTime: null,
      workdayEndTime: null,
    });

    expect(result).toMatchObject({
      kind: "PARTIAL",
      automatic: false,
    });
  });
});
