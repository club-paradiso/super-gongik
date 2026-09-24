import { describe, expect, it } from "vitest";

import {
  createServiceEvent,
  serviceEventContentKey,
  validateServiceEventDraft,
  type ServiceEvent,
  type ServiceEventDraft,
} from "../src";
import {
  allDay,
  context,
  halfDay,
  partial,
  userDataWithProfile,
} from "./helpers";

function timed(
  eventType: ServiceEventDraft["eventType"],
  startTime: string,
  endTime: string,
  date = "2026-09-10",
): ServiceEventDraft {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  return {
    ...partial(eventType, date, eh! * 60 + em! - (sh! * 60 + sm!)),
    timing: {
      kind: "PARTIAL",
      durationMinutes: eh! * 60 + em! - (sh! * 60 + sm!),
      startTime,
      endTime,
    },
  };
}

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

  it("blocks a partial leave on a day already charged as full-day leave (case A)", () => {
    const events = existing(allDay("ANNUAL_LEAVE", "2026-09-10"));
    expect(
      codes(events, partial("ANNUAL_LEAVE", "2026-09-10", 120)).errors,
    ).toContain("LEAVE_OVERLAP");
    expect(
      codes(events, partial("SICK_LEAVE", "2026-09-10", 120)).errors,
    ).toContain("LEAVE_OVERLAP");
    // Also inside a multi-day full-day range.
    const range = existing(
      allDay("ANNUAL_LEAVE", "2026-09-07", "2026-09-09", 3),
    );
    expect(
      codes(range, partial("ANNUAL_LEAVE", "2026-09-08", 60)).errors,
    ).toContain("LEAVE_OVERLAP");
  });

  it("blocks an identical partial leave, with or without times (case B)", () => {
    const untimed = existing(partial("ANNUAL_LEAVE", "2026-09-10", 120));
    expect(
      codes(untimed, partial("ANNUAL_LEAVE", "2026-09-10", 120)).errors,
    ).toContain("LEAVE_OVERLAP");
    const timedEvents = existing(timed("ANNUAL_LEAVE", "10:00", "12:00"));
    expect(
      codes(timedEvents, timed("ANNUAL_LEAVE", "10:00", "12:00")).errors,
    ).toContain("LEAVE_OVERLAP");
  });

  it("blocks partial leave whose explicit times intersect and allows disjoint times (case C)", () => {
    const events = existing(timed("ANNUAL_LEAVE", "10:00", "12:00"));
    expect(
      codes(events, timed("ANNUAL_LEAVE", "11:00", "13:00")).errors,
    ).toContain("LEAVE_OVERLAP");
    expect(
      codes(events, timed("SICK_LEAVE", "11:30", "11:45")).errors,
    ).toContain("LEAVE_OVERLAP");
    // Touching intervals do not share a minute.
    expect(codes(events, timed("ANNUAL_LEAVE", "12:00", "13:00"))).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it("flags overlaps it cannot decide instead of pretending certainty", () => {
    const untimed = existing(partial("ANNUAL_LEAVE", "2026-09-10", 60));
    expect(codes(untimed, partial("ANNUAL_LEAVE", "2026-09-10", 90))).toEqual({
      errors: [],
      warnings: ["LEAVE_OVERLAP_UNRESOLVED"],
    });
    expect(
      codes(untimed, timed("SICK_LEAVE", "15:00", "16:00")).warnings,
    ).toEqual(["LEAVE_OVERLAP_UNRESOLVED"]);
    const half = existing(halfDay("2026-09-10", "AM"));
    expect(
      codes(half, timed("ANNUAL_LEAVE", "15:00", "16:00")).warnings,
    ).toEqual(["LEAVE_OVERLAP_UNRESOLVED"]);
    expect(codes(half, halfDay("2026-09-10", null)).warnings).toEqual([
      "LEAVE_OVERLAP_UNRESOLVED",
    ]);
  });

  it("requires Article 41(6) compensation absences to be all-day records", () => {
    expect(
      codes([], partial("SERVICE_ABSENCE", "2026-09-10", 60)).errors,
    ).toContain("COMPENSATION_ABSENCE_MUST_BE_ALL_DAY");
    expect(
      codes([], partial("EXCESS_ANNUAL_ABSENCE", "2026-09-10", 60)).errors,
    ).toContain("COMPENSATION_ABSENCE_MUST_BE_ALL_DAY");
  });

  it("rejects a sick-leave compensation category on a non-sick event", () => {
    expect(
      codes([], {
        ...allDay("ANNUAL_LEAVE", "2026-09-10"),
        sickLeaveCategory: "ORDINARY",
      }).errors,
    ).toContain("SICK_CATEGORY_NOT_SICK_LEAVE");
  });

  it("does not treat attendance records as leave double-charges", () => {
    const events = existing(allDay("ANNUAL_LEAVE", "2026-09-10"));
    expect(codes(events, partial("OUTING", "2026-09-10", 60)).errors).toEqual(
      [],
    );
  });

  it("does not conflict with itself while editing", () => {
    const events = existing(timed("ANNUAL_LEAVE", "10:00", "12:00"));
    const result = validateServiceEventDraft(
      timed("ANNUAL_LEAVE", "10:00", "11:00"),
      {
        existingEvents: events,
        editingId: events[0]!.id,
      },
    );
    expect(result.errors).toEqual([]);
  });

  it("warns about dates outside the service period", () => {
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
