/**
 * Inputs for the cross-language conformance fixtures in `contracts/fixtures`.
 *
 * Each suite is a list of calls into the native facade (`call` for pure
 * functions, `command` for store commands with a fixed context, `projection`
 * for the screen contract). The TypeScript reference computes the expected
 * output; the Swift tests replay the same inputs through JavaScriptCore and,
 * for the Swift-native slice, through the Swift port, and must produce the
 * identical JSON.
 */
import {
  createBackup,
  createEmptyUserData,
  serializeBackup,
  type ServiceEventDraft,
  type UserData,
} from "@super-gongik/domain";

import { fullDocument } from "../../domain/tests/fixtures";
import {
  allDay,
  halfDay,
  partial,
  userDataWithProfile,
} from "../../domain/tests/helpers";

export type FixtureCase =
  | { id: string; kind: "call"; fn: string; args: unknown[] }
  | {
      id: string;
      kind: "command";
      command: string;
      data: unknown;
      args: unknown[];
      context: { now: string; deviceId: string; ids: string[] };
    }
  | { id: string; kind: "projection"; data: unknown; today: string };

export type FixtureSuite = {
  suite: string;
  description: string;
  /** Which Swift engines must reproduce it. */
  engines: Array<"jsc" | "swift">;
  cases: FixtureCase[];
};

const call = (id: string, fn: string, ...args: unknown[]): FixtureCase => ({
  id,
  kind: "call",
  fn,
  args,
});

const instant = (iso: string) => ({ $instant: iso });

function ids(prefix: string, count = 8) {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`);
}

const CTX = (prefix: string, now = "2026-10-01T03:00:00.000Z") => ({
  now,
  deviceId: "device-fixture",
  ids: ids(prefix),
});

// ── Periods used across suites ─────────────────────────────────────────────

const PERIODS = {
  standard: { callUpDate: "2026-05-04", expectedDischargeDate: "2028-02-03" },
  leapSpan: { callUpDate: "2027-06-15", expectedDischargeDate: "2029-03-14" },
  fourHundredDays: {
    callUpDate: "2026-01-01",
    expectedDischargeDate: "2027-02-05",
  },
  sameDay: { callUpDate: "2026-10-03", expectedDischargeDate: "2026-10-03" },
  yearEnd: { callUpDate: "2025-12-31", expectedDischargeDate: "2027-09-30" },
} as const;

// ── dates ──────────────────────────────────────────────────────────────────

const dates: FixtureSuite = {
  suite: "dates",
  description:
    "Civil-date parsing and arithmetic (date-only.ts) and the Seoul calendar date of instants.",
  engines: ["jsc", "swift"],
  cases: [
    ...[
      "2026-10-03",
      "2028-02-29",
      "2027-02-29",
      "2026-13-01",
      "2026-00-10",
      "2026-04-31",
      "2026-4-01",
      " 2026-04-01",
      "0000-01-01",
      "0099-12-31",
      "0100-01-01",
      "9999-12-31",
    ].map((value) =>
      call(`parse ${JSON.stringify(value)}`, "parseDateOnly", value),
    ),
    ...(
      [
        ["2026-12-31", 1],
        ["2027-01-01", -1],
        ["2028-02-28", 1],
        ["2028-02-29", 1],
        ["2027-02-28", 1],
        ["2026-10-03", 527],
        ["2026-10-03", -10000],
        ["2100-02-28", 1],
        ["2000-02-28", 1],
      ] as const
    ).map(([date, amount]) =>
      call(`addDays ${date} ${amount}`, "addDays", date, amount),
    ),
    ...(
      [
        ["2026-01-31", 1],
        ["2028-01-31", 1],
        ["2026-03-31", -1],
        ["2026-05-04", 21],
        ["2026-12-15", 1],
        ["2026-01-15", -13],
        ["2025-08-31", 6],
      ] as const
    ).map(([date, months]) =>
      call(
        `addCalendarMonths ${date} ${months}`,
        "addCalendarMonths",
        date,
        months,
      ),
    ),
    ...(
      [
        ["2028-02-03", "2026-05-04"],
        ["2026-05-04", "2028-02-03"],
        ["2029-03-01", "2028-02-28"],
        ["2026-10-03", "2026-10-03"],
      ] as const
    ).map(([later, earlier]) =>
      call(
        `difference ${later} ${earlier}`,
        "differenceInCalendarDays",
        later,
        earlier,
      ),
    ),
    ...[
      "2026-10-03T14:59:59.999Z",
      "2026-10-03T15:00:00.000Z",
      "2026-12-31T15:00:00.000Z",
      "2028-02-28T15:00:00.000Z",
      "2026-06-30T23:59:59.000+09:00",
      // Korea observed DST in 1987–1988; Intl follows the tz database.
      "1988-06-01T14:30:00.000Z",
    ].map((iso) =>
      call(`seoul date of ${iso}`, "dateOnlyInTimeZone", instant(iso)),
    ),
    ...["2026-10-03", "2028-02-29", "1970-01-01"].map((date) =>
      call(`seoulStartOfDay ${date}`, "seoulStartOfDay", date),
    ),
  ],
};

// ── service progress / D-Day ───────────────────────────────────────────────

function progressCases(): FixtureCase[] {
  const out: FixtureCase[] = [];
  const probes: Record<keyof typeof PERIODS, string[]> = {
    standard: [
      "2026-05-03",
      "2026-05-04",
      "2026-05-05",
      "2026-10-03",
      "2027-05-04",
      "2028-02-02",
      "2028-02-03",
      "2028-02-04",
      "2030-01-01",
    ],
    leapSpan: ["2028-02-28", "2028-02-29", "2028-03-01", "2029-03-13"],
    // 1/400 = 0.25 % → toFixed(1) tie: JavaScript rounds the tie up to 0.3.
    fourHundredDays: [
      "2026-01-02",
      "2026-01-04",
      "2026-01-06",
      "2026-02-20",
      "2026-07-20",
      "2027-02-04",
    ],
    sameDay: ["2026-10-02", "2026-10-03", "2026-10-04"],
    yearEnd: ["2025-12-30", "2025-12-31", "2026-01-01", "2027-09-29"],
  };
  for (const [name, todays] of Object.entries(probes)) {
    const period = PERIODS[name as keyof typeof PERIODS];
    for (const today of todays) {
      out.push(
        call(
          `progress ${name} @ ${today}`,
          "calculateServiceProgress",
          period,
          today,
        ),
      );
    }
  }
  out.push(
    call(
      "progress rejects call-up after discharge",
      "calculateServiceProgress",
      { callUpDate: "2027-01-01", expectedDischargeDate: "2026-01-01" },
      "2026-06-01",
    ),
  );
  // Exhaustive day sweep over a whole short period catches any rounding drift.
  const sweep = {
    callUpDate: "2026-03-02",
    expectedDischargeDate: "2027-12-01",
  };
  for (let offset = -1; offset <= 640; offset += 7) {
    const date = new Date(Date.UTC(2026, 2, 2 + offset))
      .toISOString()
      .slice(0, 10);
    out.push(
      call(`progress sweep ${date}`, "calculateServiceProgress", sweep, date),
    );
  }
  return out;
}

const serviceProgress: FixtureSuite = {
  suite: "service-progress",
  description:
    "calculateServiceProgress: states, D-Day, day counts and the one-decimal percentage (JS toFixed rounding).",
  engines: ["jsc", "swift"],
  cases: progressCases(),
};

// ── live progress (web lib) ────────────────────────────────────────────────

const liveInstants = [
  "2026-05-03T14:59:59.999Z",
  "2026-05-03T15:00:00.000Z",
  "2026-05-03T15:00:00.001Z",
  "2026-10-03T06:41:12.345Z",
  "2027-02-28T23:59:59.999Z",
  "2028-02-02T14:59:59.000Z",
  "2028-02-02T15:00:00.000Z",
  "2028-03-01T00:00:00.000Z",
];

const liveProgress: FixtureSuite = {
  suite: "live-progress",
  description:
    "Second-level progress (apps/web/src/lib/live-service-progress.ts), continuous completion and the floored home percentage.",
  engines: ["jsc", "swift"],
  cases: [
    ...liveInstants.map((iso) =>
      call(
        `live ${iso}`,
        "calculateLiveServiceProgress",
        PERIODS.standard,
        instant(iso),
      ),
    ),
    ...liveInstants.map((iso) =>
      call(
        `live percent text ${iso}`,
        "liveCompletionText",
        PERIODS.standard,
        instant(iso),
      ),
    ),
    ...liveInstants.map((iso) =>
      call(
        `continuous ${iso}`,
        "continuousServiceCompletion",
        PERIODS.standard,
        instant(iso),
      ),
    ),
    call(
      "continuous same-day before",
      "continuousServiceCompletion",
      PERIODS.sameDay,
      instant("2026-10-02T00:00:00Z"),
    ),
    call(
      "continuous same-day after",
      "continuousServiceCompletion",
      PERIODS.sameDay,
      instant("2026-10-03T00:00:00Z"),
    ),
    call(
      "live same-day",
      "calculateLiveServiceProgress",
      PERIODS.sameDay,
      instant("2026-10-01T00:00:00Z"),
    ),
    ...(
      [
        [0, 639],
        [1, 639],
        [638, 639],
        [639, 639],
        [1, 3],
        [2, 3],
        [0, 0],
        [137, 400],
      ] as const
    ).map(([elapsed, total]) =>
      call(`floorPercent ${elapsed}/${total}`, "floorPercent", elapsed, total),
    ),
    ...[0, 1, 2, 3, 527, 1234].map((days) =>
      call(`formatDdayNumber ${days}`, "formatDdayNumber", days),
    ),
  ],
};

// ── milestones ─────────────────────────────────────────────────────────────

const milestones: FixtureSuite = {
  suite: "milestones",
  description: "Service milestones and the next/today milestone selection.",
  engines: ["jsc"],
  cases: [
    ...Object.entries(PERIODS).map(([name, period]) =>
      call(`milestones ${name}`, "listServiceMilestones", period),
    ),
    ...[
      "2026-05-04",
      "2026-08-11",
      "2027-05-04",
      "2028-02-02",
      "2028-02-03",
    ].flatMap((today) => [
      call(
        `next milestone @ ${today}`,
        "nextServiceMilestone",
        PERIODS.standard,
        today,
      ),
      call(
        `milestone on ${today}`,
        "serviceMilestoneOn",
        PERIODS.standard,
        today,
      ),
      call(
        `days since discharge @ ${today}`,
        "daysSinceDischarge",
        PERIODS.standard,
        today,
      ),
    ]),
  ],
};

// ── leave rules and ledger ─────────────────────────────────────────────────

function withEvents(base: UserData, drafts: ServiceEventDraft[]): UserData {
  const profileId = base.profile!.id;
  return {
    ...base,
    events: drafts.map((draft, index) => ({
      ...draft,
      id: `ev-${index + 1}`,
      serviceProfileId: profileId,
      status: "CONFIRMED" as const,
      source: { kind: "MANUAL" as const },
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      deletedAt: null,
      revision: 1,
      deviceId: "device-fixture",
    })),
  };
}

const workday = userDataWithProfile({
  workdayMinutes: 480,
  workdayStartTime: "09:00",
  workdayEndTime: "18:00",
});

/** 8 hours of permitted lateness/early leave/outing = one annual-leave day. */
const minuteAccumulation = withEvents(workday, [
  partial("LATE_ARRIVAL", "2026-06-01", 120),
  partial("EARLY_LEAVE", "2026-06-02", 180),
  partial("OUTING", "2026-06-03", 90),
  partial("OUTING", "2026-06-04", 90),
  partial("OUTING", "2026-06-05", 45),
  halfDay("2026-06-08", "AM"),
  halfDay("2026-06-08", "PM"),
  allDay("ANNUAL_LEAVE", "2026-06-10", "2026-06-12", 3),
  partial("LATE_ARRIVAL", "2026-06-15", null),
  allDay("SICK_LEAVE", "2026-06-16"),
]);

function ledgerCall(id: string, data: UserData, today: string): FixtureCase {
  return call(id, "buildLedgerForProfile", data, data.profile, today);
}

function minuteAccumulationEvents() {
  return minuteAccumulation.events;
}

const leave: FixtureSuite = {
  suite: "leave",
  description:
    "Effective-dated annual-leave credits, half-day and minute charging, 8-hour accumulation, reconciliation and the full ledger.",
  engines: ["jsc"],
  cases: [
    ...[
      ["2025-11-03", "2026-10-03"],
      ["2026-04-22", "2026-10-03"],
      ["2026-04-23", "2026-10-03"],
      ["2026-05-04", "2026-05-03"],
      ["2026-05-04", "2027-05-04"],
      ["2026-08-28", "2028-01-01"],
      ["2026-09-01", "2026-10-03"],
    ].map(([callUpDate, referenceDate]) =>
      call(
        `credits call-up ${callUpDate} as of ${referenceDate}`,
        "deriveAnnualLeaveCredits",
        { callUpDate, referenceDate },
      ),
    ),
    ...minuteAccumulation.events.map((event) =>
      call(
        `quantity ${event.id} ${event.eventType}`,
        "eventLeaveQuantity",
        event,
      ),
    ),
    ledgerCall("ledger minute accumulation", minuteAccumulation, "2026-10-03"),
    ledgerCall("ledger full document", fullDocument(), "2026-10-03"),
    ledgerCall(
      "ledger full document before grant",
      fullDocument(),
      "2026-05-03",
    ),
    ...[
      [{ days: 1, halfDays: 0, minutes: 0 }, 480],
      [{ days: 0, halfDays: 1, minutes: 0 }, 480],
      [{ days: 2, halfDays: 1, minutes: 90 }, 480],
      [{ days: 0, halfDays: 0, minutes: 480 }, null],
      [{ days: -1, halfDays: 0, minutes: -30 }, 480],
    ].map(([quantity, minutesPerDay], index) =>
      call(
        `format quantity ${index}`,
        "formatLeaveQuantity",
        quantity,
        minutesPerDay,
      ),
    ),
    ...[0, 59, 60, 61, 480, 1441].map((minutes) =>
      call(`format minutes ${minutes}`, "formatDurationMinutes", minutes),
    ),
  ],
};

// ── events: validation, overlaps, classification ───────────────────────────

const existing = withEvents(workday, [
  allDay("ANNUAL_LEAVE", "2026-07-01"),
  halfDay("2026-07-08", "AM"),
  {
    ...partial("OUTING", "2026-07-09", 60),
    timing: {
      kind: "PARTIAL",
      durationMinutes: 60,
      startTime: "13:00",
      endTime: "14:00",
    },
  },
]).events;

const PERIOD = {
  callUpDate: "2026-05-04",
  expectedDischargeDate: "2028-02-03",
};

function validate(
  id: string,
  draft: unknown,
  editingId: string | null = null,
): FixtureCase {
  return call(id, "validateServiceEventDraft", draft, {
    existingEvents: existing,
    editingId,
    servicePeriod: PERIOD,
  });
}

const events: FixtureSuite = {
  suite: "events",
  description:
    "Draft validation, leave overlap detection (conflict vs unresolved), annual-leave usage classification.",
  engines: ["jsc"],
  cases: [
    validate("valid all-day", allDay("ANNUAL_LEAVE", "2026-07-02")),
    validate(
      "full day over existing full day",
      allDay("ANNUAL_LEAVE", "2026-07-01"),
    ),
    validate("same half day", halfDay("2026-07-08", "AM")),
    validate("other half day", halfDay("2026-07-08", "PM")),
    validate("half day vs minutes unresolved", halfDay("2026-07-09", "PM")),
    validate("intersecting explicit times", {
      ...partial("LATE_ARRIVAL", "2026-07-09", 60),
      timing: {
        kind: "PARTIAL",
        durationMinutes: 60,
        startTime: "13:30",
        endTime: "14:30",
      },
    }),
    validate(
      "editing itself is not an overlap",
      allDay("ANNUAL_LEAVE", "2026-07-01"),
      "ev-1",
    ),
    validate("before call-up", allDay("ANNUAL_LEAVE", "2026-05-01")),
    validate(
      "end before start",
      allDay("ANNUAL_LEAVE", "2026-07-05", "2026-07-03"),
    ),
    validate("half day only for annual leave", {
      ...halfDay("2026-07-20", "AM"),
      eventType: "SICK_LEAVE",
    }),
    validate("multi-day partial", {
      ...partial("OUTING", "2026-07-20", 30),
      endDate: "2026-07-21",
    }),
    validate(
      "non-payable must be all day",
      partial("SERVICE_ABSENCE", "2026-07-22", 60),
    ),
    validate(
      "day count exceeds range",
      allDay("ANNUAL_LEAVE", "2026-07-20", "2026-07-21", 3),
    ),
    validate("garbage input", { eventType: "PARTY", startDate: "x" }),
    call("overlaps of stored events", "findLeaveOverlaps", existing),
    ...(
      [
        ["LATE_ARRIVAL", "09:00", "13:00"],
        ["EARLY_LEAVE", "14:00", "18:00"],
        ["OUTING", "09:00", "18:00"],
        ["OUTING", "11:00", "12:30"],
        ["LATE_ARRIVAL", "09:00", "10:00"],
      ] as const
    ).map(([eventType, startTime, endTime]) =>
      call(
        `classify ${eventType} ${startTime}-${endTime}`,
        "classifyAnnualLeaveUsage",
        {
          eventType,
          timing: {
            kind: "PARTIAL",
            durationMinutes: null,
            startTime,
            endTime,
          },
          workdayStartTime: "09:00",
          workdayEndTime: "18:00",
        },
      ),
    ),
    call("classify without schedule", "classifyAnnualLeaveUsage", {
      eventType: "OUTING",
      timing: {
        kind: "PARTIAL",
        durationMinutes: 60,
        startTime: "10:00",
        endTime: "11:00",
      },
      workdayStartTime: null,
      workdayEndTime: null,
    }),
    call("event taxonomy", "eventTaxonomy"),
    call(
      "describe stored events",
      "describeEvents",
      minuteAccumulationEvents(),
    ),
    call("month grid 2026-02", "buildMonthGrid", "2026-02"),
    call("month grid 2028-02", "buildMonthGrid", "2028-02"),
    call("weekdays in range", "countWeekdays", "2026-10-01", "2026-10-31"),
  ],
};

// ── event editor form model ────────────────────────────────────────────────

const blankForm = {
  eventType: "ANNUAL_LEAVE",
  mode: "ALL_DAY",
  startDate: "2026-07-13",
  endDate: "2026-07-13",
  dayCount: "1",
  dayCountTouched: false,
  half: "AM",
  startTime: "",
  endTime: "",
  hours: "",
  minutes: "",
  durationTouched: false,
  sickLeaveCategory: "",
  title: "",
  note: "",
};

const eventForm: FixtureSuite = {
  suite: "event-form",
  description:
    "Event editor form model shared with the web editor: initial state, edit coercions, draft building with automatic classification.",
  engines: ["jsc"],
  cases: [
    call("initial for new event", "eventFormInitial", null, "2026-07-13"),
    call(
      "initial for existing half day",
      "eventFormInitial",
      existing[1],
      "2026-07-13",
    ),
    call(
      "initial for existing outing",
      "eventFormInitial",
      existing[2],
      "2026-07-13",
    ),
    call("range derives weekday count", "eventFormPatch", blankForm, {
      endDate: "2026-07-19",
    }),
    call(
      "touched day count is kept",
      "eventFormPatch",
      { ...blankForm, dayCountTouched: true, dayCount: "2" },
      { endDate: "2026-07-19" },
    ),
    call("non-payable counts calendar days", "eventFormPatch", blankForm, {
      eventType: "SERVICE_ABSENCE",
      endDate: "2026-07-19",
    }),
    call(
      "non-payable forces all day",
      "eventFormPatch",
      { ...blankForm, mode: "PARTIAL" },
      { eventType: "SERVICE_SUSPENSION" },
    ),
    call(
      "half day only for annual leave",
      "eventFormPatch",
      { ...blankForm, mode: "HALF_DAY" },
      { eventType: "SICK_LEAVE" },
    ),
    call(
      "times derive duration",
      "eventFormPatch",
      { ...blankForm, mode: "PARTIAL", eventType: "OUTING" },
      { startTime: "13:00", endTime: "15:30" },
    ),
    call(
      "touched duration is kept",
      "eventFormPatch",
      {
        ...blankForm,
        mode: "PARTIAL",
        eventType: "OUTING",
        durationTouched: true,
        hours: "1",
        minutes: "0",
      },
      { startTime: "13:00", endTime: "15:30" },
    ),
    call(
      "evaluate morning lateness becomes half day",
      "eventFormEvaluate",
      {
        ...blankForm,
        eventType: "LATE_ARRIVAL",
        mode: "PARTIAL",
        startTime: "09:00",
        endTime: "14:00",
        hours: "5",
        minutes: "0",
      },
      workday.profile,
      existing,
      null,
    ),
    call(
      "evaluate full-day outing becomes all day",
      "eventFormEvaluate",
      {
        ...blankForm,
        eventType: "OUTING",
        mode: "PARTIAL",
        startTime: "09:00",
        endTime: "18:00",
        hours: "9",
        minutes: "0",
      },
      workday.profile,
      existing,
      null,
    ),
    call(
      "evaluate overlap with existing leave",
      "eventFormEvaluate",
      { ...blankForm, startDate: "2026-07-01", endDate: "2026-07-01" },
      workday.profile,
      existing,
      null,
    ),
    call(
      "evaluate sick leave defaults category",
      "eventFormEvaluate",
      { ...blankForm, eventType: "SICK_LEAVE" },
      workday.profile,
      existing,
      null,
    ),
    call(
      "money month current",
      "evaluateMoneyMonth",
      fullDocument(),
      fullDocument().profile,
      "2026-10",
      "2026-10-03",
    ),
    call(
      "money month past",
      "evaluateMoneyMonth",
      fullDocument(),
      fullDocument().profile,
      "2026-07",
      "2026-10-03",
    ),
    call(
      "expected discharge from call-up",
      "calculateExpectedDischargeDate",
      "2026-05-04",
    ),
    call(
      "expected discharge leap",
      "calculateExpectedDischargeDate",
      "2026-05-31",
    ),
  ],
};

// ── commands: create / edit / delete / restore / leave adjustments ─────────

const base = { ...userDataWithProfile(), deviceId: "device-fixture" };
const created = withEvents(base, [allDay("ANNUAL_LEAVE", "2026-07-01")]);
const deletedDoc = {
  ...created,
  events: created.events.map((event) => ({
    ...event,
    deletedAt: "2026-09-02T00:00:00.000Z",
    revision: 2,
    updatedAt: "2026-09-02T00:00:00.000Z",
  })),
};

const command = (
  id: string,
  name: string,
  data: unknown,
  args: unknown[],
  context = CTX(name),
): FixtureCase => ({ id, kind: "command", command: name, data, args, context });

const commands: FixtureSuite = {
  suite: "commands",
  description:
    "Store commands as pure functions with a fixed clock, device id and id sequence.",
  engines: ["jsc"],
  cases: [
    command(
      "create profile",
      "createProfile",
      createEmptyUserData("device-fixture"),
      [
        {
          callUpDate: "2026-05-04",
          expectedDischargeDate: "2028-02-03",
          serviceCategory: null,
          workplaceType: null,
          defaultCommuteCost: null,
          defaultMealAllowanceOverride: null,
          timezone: "Asia/Seoul",
        },
      ],
    ),
    command("create profile twice fails", "createProfile", base, [
      { callUpDate: "2026-05-04", expectedDischargeDate: "2028-02-03" },
    ]),
    command(
      "create profile invalid dates",
      "createProfile",
      createEmptyUserData("d"),
      [{ callUpDate: "2028-05-04", expectedDischargeDate: "2026-02-03" }],
    ),
    command("edit profile", "editProfile", base, [
      {
        ...base.profile,
        workdayMinutes: 480,
        workdayStartTime: "09:00",
        workdayEndTime: "18:00",
        priorServiceCredit: "NONE",
      },
    ]),
    command("create event", "createServiceEvent", base, [
      { ...allDay("ANNUAL_LEAVE", "2026-07-01"), note: "  여름 휴가  " },
    ]),
    command("create overlapping event fails", "createServiceEvent", created, [
      allDay("ANNUAL_LEAVE", "2026-07-01"),
    ]),
    command("create half day", "createServiceEvent", created, [
      halfDay("2026-07-02", "PM"),
    ]),
    command("update event", "updateServiceEvent", created, [
      "ev-1",
      allDay("ANNUAL_LEAVE", "2026-07-03"),
    ]),
    command("update missing event", "updateServiceEvent", created, [
      "nope",
      allDay("ANNUAL_LEAVE", "2026-07-03"),
    ]),
    command("delete event", "deleteServiceEvent", created, ["ev-1"]),
    command("restore event", "restoreServiceEvent", deletedDoc, ["ev-1"]),
    command("confirm credit", "confirmLeaveCredit", base, [
      {
        creditKey: "YEAR_1",
        grantDate: "2026-05-04",
        days: 15,
        reason: "기관 확인",
      },
    ]),
    command("confirm credit out of range", "confirmLeaveCredit", base, [
      { creditKey: "YEAR_1", grantDate: "2026-05-04", days: 61, reason: "x" },
    ]),
    command("add correction", "addLeaveCorrection", base, [
      {
        effectiveDate: "2026-09-01",
        halfDays: -1,
        minutes: 30,
        reason: "기관 기록 반영",
      },
    ]),
    command("save attendance month", "saveAttendanceMonth", base, [
      {
        month: "2026-07",
        nonWorkingDates: ["2026-07-17"],
        dayOverrides: [],
        hadNonPayableAbsence: false,
      },
    ]),
  ],
};

// ── compensation and pay steps ─────────────────────────────────────────────

const PROFILES = {
  unanswered: userDataWithProfile().profile,
  noPrior: userDataWithProfile({ priorServiceCredit: "NONE" }).profile,
  withMealAndCommute: userDataWithProfile({
    priorServiceCredit: "NONE",
    defaultMealAllowanceOverride: 9000,
    defaultCommuteCost: 3000,
    workPattern: "WEEKDAY_DAYTIME",
    workWeekdays: [1, 2, 3, 4, 5],
  }).profile,
  priorCredit: userDataWithProfile({
    priorServiceCredit: "HAS_PRIOR_SERVICE",
    priorServiceBasis: "ARTICLE_62_2_7_ALTERNATIVE_SERVICE",
    priorServiceCreditedMonths: 7,
  }).profile,
  priorPartial: userDataWithProfile({
    priorServiceCredit: "HAS_PRIOR_SERVICE",
    priorServiceBasis: "ARTICLE_62_2_7_ALTERNATIVE_SERVICE",
    priorServiceCreditedMonths: 7,
    priorServiceCreditHasPartialMonth: true,
  }).profile,
};

const compensation: FixtureSuite = {
  suite: "compensation",
  description:
    "Monthly compensation with safety gates (no total when a component is unknown), pay band schedule and pay step.",
  engines: ["jsc"],
  cases: [
    ...Object.entries(PROFILES).flatMap(([name, profile]) =>
      ["2026-05-20", "2026-10-03", "2027-03-15", "2028-02-01"].flatMap(
        (date) => [
          call(
            `compensation ${name} @ ${date}`,
            "evaluateMonthlyCompensation",
            profile,
            date,
            {
              events: [],
              attendance: null,
            },
          ),
          call(
            `pay bands ${name} @ ${date}`,
            "derivePayBandSchedule",
            profile,
            date,
          ),
        ],
      ),
    ),
  ],
};

// ── backup / restore / merge ───────────────────────────────────────────────

const full = fullDocument();
const backupText = serializeBackup(
  createBackup(full, "2026-10-01T00:00:00.000Z"),
);
const tampered = backupText.replace("여름 휴가", "겨울 휴가");
const v2Document = JSON.stringify({
  ...createEmptyUserData("device-old"),
  schemaVersion: 2,
  attendanceMonths: undefined,
  compensationSnapshots: undefined,
});

/** Same record edited on two devices without ancestry: a real conflict. */
function concurrentEdit() {
  const local = withEvents({ ...base, deviceId: "device-a" }, [
    { ...allDay("ANNUAL_LEAVE", "2026-07-01"), note: "local edit" },
  ]);
  local.events[0] = { ...local.events[0], revision: 2, deviceId: "device-a" };
  const remote = withEvents({ ...base, deviceId: "device-b" }, [
    { ...allDay("ANNUAL_LEAVE", "2026-07-01"), note: "remote edit" },
  ]);
  remote.events[0] = { ...remote.events[0], revision: 2, deviceId: "device-b" };
  return { local, remote };
}

/** Same device, higher revision: provable descent, no conflict. */
function descendant() {
  const older = withEvents(base, [allDay("ANNUAL_LEAVE", "2026-07-01")]);
  const newer = withEvents(base, [
    { ...allDay("ANNUAL_LEAVE", "2026-07-01"), note: "edited" },
  ]);
  newer.events[0] = { ...newer.events[0], revision: 3 };
  return { older, newer };
}

/** Remote tombstone that descends from the local live record. */
function tombstone() {
  const live = withEvents(base, [allDay("ANNUAL_LEAVE", "2026-07-01")]);
  const dead = withEvents(base, [allDay("ANNUAL_LEAVE", "2026-07-01")]);
  dead.events[0] = {
    ...dead.events[0],
    revision: 2,
    deletedAt: "2026-09-03T00:00:00.000Z",
  };
  return { live, dead };
}

const MERGE_CTX = {
  now: "2026-10-01T03:00:00.000Z",
  deviceId: "device-fixture",
};

const backup: FixtureSuite = {
  suite: "backup",
  description:
    "Backup serialization, digest, parsing, migration from schema v2, newer-version refusal, merge/replace planning, conflicts and tombstones.",
  engines: ["jsc"],
  cases: [
    call("canonical json", "canonicalJson", {
      b: [1, "가", null, { d: true, c: 0.5 }],
      a: -0,
    }),
    call("sha256 of korean", "sha256Hex", "슈퍼공익 SUPER-GONGIK 🫡"),
    call("sha256 of empty", "sha256Hex", ""),
    call("create backup", "createBackup", full, "2026-10-01T00:00:00.000Z"),
    call("parse backup", "parseBackup", backupText),
    call("parse tampered backup", "parseBackup", tampered),
    call("parse not json", "parseBackup", "{not json"),
    call("parse empty object", "parseBackup", "{}"),
    call(
      "decode v2 document migrates",
      "decodeUserData",
      JSON.parse(v2Document),
    ),
    call("decode newer schema refused", "decodeUserData", {
      ...createEmptyUserData("d"),
      schemaVersion: 99,
    }),
    call("decode invalid owner", "decodeUserData", {
      ...full,
      events: full.events.map((event) => ({
        ...event,
        serviceProfileId: "someone-else",
      })),
    }),
    call("summarize", "summarizeUserData", full, "2026-10-01T00:00:00.000Z"),
    call(
      "merge concurrent edit conflicts",
      "analyzeMerge",
      concurrentEdit().local,
      concurrentEdit().remote,
      MERGE_CTX,
      {},
    ),
    call(
      "merge concurrent edit resolved incoming",
      "mergeUserData",
      concurrentEdit().local,
      concurrentEdit().remote,
      MERGE_CTX,
      { resolutions: { "events:ev-1": "INCOMING" } },
    ),
    call(
      "merge descendant wins",
      "mergeUserData",
      descendant().older,
      descendant().newer,
      MERGE_CTX,
      {},
    ),
    call(
      "merge stale copy loses",
      "mergeUserData",
      descendant().newer,
      descendant().older,
      MERGE_CTX,
      {},
    ),
    call(
      "backup tombstone kept live",
      "mergeUserData",
      tombstone().live,
      tombstone().dead,
      MERGE_CTX,
      {},
    ),
    call(
      "sync tombstone applied",
      "mergeUserData",
      tombstone().live,
      tombstone().dead,
      MERGE_CTX,
      {
        incomingDeletions: "APPLY_NEWER",
      },
    ),
    call(
      "stale live copy does not resurrect",
      "mergeUserData",
      tombstone().dead,
      tombstone().live,
      MERGE_CTX,
      {},
    ),
    call(
      "replace keeps device id",
      "replaceUserData",
      { ...base, deviceId: "this-device" },
      full,
    ),
    call(
      "plan merge into empty",
      "planRestore",
      createEmptyUserData("device-new"),
      full,
      {
        mode: "MERGE",
        ...MERGE_CTX,
      },
    ),
    call("plan replace over data", "planRestore", base, full, {
      mode: "REPLACE",
      ...MERGE_CTX,
    }),
    call("plan merge same profile", "planRestore", full, full, {
      mode: "MERGE",
      ...MERGE_CTX,
    }),
    call("execute replace unconfirmed", "executeRestore", base, full, {
      mode: "REPLACE",
      ...MERGE_CTX,
      expectedDocumentRevision: base.documentRevision,
    }),
    call("execute replace confirmed", "executeRestore", base, full, {
      mode: "REPLACE",
      ...MERGE_CTX,
      expectedDocumentRevision: base.documentRevision,
      confirmDestructive: true,
    }),
  ],
};

// ── projection: the screen contract ────────────────────────────────────────

const projection: FixtureSuite = {
  suite: "projection",
  description:
    "Everything the native screens render for a date: web buildAppProjection + buildHomeModel, credits, pay bands.",
  engines: ["jsc"],
  cases: [
    {
      id: "no profile",
      kind: "projection",
      data: createEmptyUserData("d"),
      today: "2026-10-03",
    },
    ...[
      "2026-05-01",
      "2026-07-08",
      "2026-10-03",
      "2028-01-20",
      "2028-02-03",
      "2028-06-01",
    ].map((today): FixtureCase => ({
      id: `full document @ ${today}`,
      kind: "projection",
      data: full,
      today,
    })),
    {
      id: "minute accumulation @ 2026-10-03",
      kind: "projection",
      data: minuteAccumulation,
      today: "2026-10-03",
    },
  ],
};

export const SUITES: FixtureSuite[] = [
  dates,
  serviceProgress,
  liveProgress,
  milestones,
  leave,
  events,
  eventForm,
  commands,
  compensation,
  backup,
  projection,
];
