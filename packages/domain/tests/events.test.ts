import { describe, expect, it } from "vitest";

import {
  createServiceEvent,
  serviceEventContentKey,
  validateServiceEventDraft,
  type ServiceEvent,
} from "../src";
import {
  allDay,
  context,
  halfDay,
  partial,
  userDataWithProfile,
} from "./helpers";

function existing(...drafts: Parameters<typeof createServiceEvent>[1][]) {
  let data = userDataWithProfile();
  const ctx = context();
  for (const draft of drafts) {
    const result = createServiceEvent(data, draft, ctx);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    data = result.data;
  }
  return data.events;
}

function codes(events: ServiceEvent[], draft: unknown) {
  const result = validateServiceEventDraft(draft, {
    existingEvents: events,
    servicePeriod: {
      callUpDate: "2026-05-04",
      expectedDischargeDate: "2028-02-03",
    },
  });
  return {
    errors: result.errors.map((issue) => issue.code),
    warnings: result.warnings.map((issue) => issue.code),
  };
}

describe("service event validation", () => {
  it("rejects impossible ranges and partial events spanning days", () => {
    expect(
      codes([], allDay("ANNUAL_LEAVE", "2026-09-10", "2026-09-09")).errors,
    ).toEqual(["END_BEFORE_START"]);
    expect(
      codes([], {
        ...partial("OUTING", "2026-09-10", 60),
        endDate: "2026-09-11",
      }).errors,
    ).toContain("MULTI_DAY_PARTIAL");
    expect(
      codes([], allDay("ANNUAL_LEAVE", "2026-09-10", "2026-09-11", 3)).errors,
    ).toContain("DAY_COUNT_EXCEEDS_RANGE");
    expect(
      codes([], { ...allDay("ANNUAL_LEAVE", "2026-02-30") }).errors,
    ).toContain("INVALID_FIELD");
  });

  it("rejects invalid partial durations and non-annual half days", () => {
    expect(codes([], partial("OUTING", "2026-09-10", null)).errors).toContain(
      "MISSING_DURATION",
    );
    expect(codes([], partial("OUTING", "2026-09-10", 0)).errors).toContain(
      "INVALID_FIELD",
    );
    expect(codes([], partial("OUTING", "2026-09-10", 90.5)).errors).toContain(
      "INVALID_FIELD",
    );
    expect(
      codes([], { ...halfDay("2026-09-10", "AM"), eventType: "SICK_LEAVE" })
        .errors,
    ).toContain("HALF_DAY_NOT_ANNUAL_LEAVE");
    expect(
      codes([], {
        ...partial("OUTING", "2026-09-10", 60),
        timing: {
          kind: "PARTIAL",
          durationMinutes: 60,
          startTime: "15:00",
          endTime: "14:00",
        },
      }).errors,
    ).toContain("END_TIME_NOT_AFTER_START");
  });

  it("blocks leave that would be charged twice for the same time", () => {
    const events = existing(allDay("ANNUAL_LEAVE", "2026-09-10"));
    expect(
      codes(events, allDay("SICK_LEAVE", "2026-09-09", "2026-09-11", 3)).errors,
    ).toContain("LEAVE_OVERLAP");
    expect(codes(events, halfDay("2026-09-10", "PM")).errors).toContain(
      "LEAVE_OVERLAP",
    );
    expect(
      codes(events, allDay("ANNUAL_LEAVE", "2026-09-10")).errors,
    ).toContain("LEAVE_OVERLAP");
  });

  it("allows morning and afternoon half days but not the same half twice", () => {
    const events = existing(halfDay("2026-09-10", "AM"));
    expect(codes(events, halfDay("2026-09-10", "PM")).errors).toEqual([]);
    expect(codes(events, halfDay("2026-09-10", "AM")).errors).toContain(
      "LEAVE_OVERLAP",
    );
  });

  it("warns instead of blocking partial leave on a full-day leave and outside service", () => {
    const events = existing(allDay("ANNUAL_LEAVE", "2026-09-10"));
    expect(codes(events, partial("SICK_LEAVE", "2026-09-10", 120))).toEqual({
      errors: [],
      warnings: ["PARTIAL_DURING_FULL_DAY_LEAVE"],
    });
    expect(codes([], allDay("ANNUAL_LEAVE", "2026-05-01")).warnings).toContain(
      "OUTSIDE_SERVICE_PERIOD",
    );
  });

  it("warns about duplicated attendance entries and weekend day counts", () => {
    const events = existing(partial("OUTING", "2026-09-10", 60));
    expect(
      codes(events, partial("OUTING", "2026-09-10", 60)).warnings,
    ).toContain("POSSIBLE_DUPLICATE");
    // Fri–Mon contains two weekdays; charging four needs confirmation.
    expect(
      codes([], allDay("ANNUAL_LEAVE", "2026-09-25", "2026-09-28", 4)).warnings,
    ).toContain("DAY_COUNT_DIFFERS_FROM_WEEKDAYS");
  });

  it("builds the same content key for manual and imported facts", () => {
    const draft = allDay("ANNUAL_LEAVE", "2026-09-10");
    expect(serviceEventContentKey(draft)).toBe(
      serviceEventContentKey({ ...draft, note: "다른 메모" } as typeof draft),
    );
  });
});
