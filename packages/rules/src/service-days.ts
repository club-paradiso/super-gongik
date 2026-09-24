import {
  addDays,
  attendanceBasisFingerprint,
  compareDateOnly,
  daysInMonth,
  dayOfWeek,
  formatDateOnly,
  isLeaveEventType,
  isLive,
  parseYearMonth,
  type AttendanceMonth,
  type DateOnly,
  type ServiceEvent,
  type ServiceProfile,
  type YearMonth,
} from "@super-gongik/domain";

/**
 * How one calendar day of a month counts for 중식비·교통비 (사회복무요원
 * 복무관리 규정 제41조④). Meal and transport are decided separately.
 *
 * - OUTSIDE_SERVICE: before the call-up date or after the discharge date.
 * - NOT_SCHEDULED: not one of the user's confirmed working weekdays.
 * - DECLARED_NON_WORKING: a scheduled weekday the user marked as a holiday
 *   or institution closure for this month.
 * - FULL_DAY_LEAVE: a scheduled day fully covered by a charged all-day leave.
 *   This is a classification only: no primary source (제41조④, the MMA 2026
 *   payment standard) states per leave type whether 중식비·교통비 are paid on
 *   such a day, so eligibility stays undecided until the user decides.
 * - NEEDS_DECISION: the records do not settle attendance (half-day or
 *   minute leave, outing, late arrival, early leave, education, training, or
 *   an all-day leave whose charged dates inside its range are not provable).
 * - WORKED: a scheduled working day with no record against it.
 */
export type ServiceDayKind =
  | "OUTSIDE_SERVICE"
  | "NOT_SCHEDULED"
  | "DECLARED_NON_WORKING"
  | "FULL_DAY_LEAVE"
  | "NEEDS_DECISION"
  | "WORKED";

export type ServiceDay = {
  date: DateOnly;
  kind: ServiceDayKind;
  /** Event ids that influenced the classification. */
  eventIds: string[];
  /** null while a day that requires a decision has none yet. */
  mealEligible: boolean | null;
  transportEligible: boolean | null;
  /**
   * true when the primary sources do not settle eligibility for this day
   * (FULL_DAY_LEAVE and NEEDS_DECISION), so an explicit user decision is
   * required before the month's day counts exist.
   */
  requiresDecision: boolean;
  /** true when the eligibility comes from the user's explicit decision. */
  decidedByUser: boolean;
};

export type ServiceDayMissing =
  | "WORK_PATTERN"
  | "WORK_WEEKDAYS"
  | "MONTH_CONFIRMATION"
  | "MONTH_RECONFIRMATION"
  | "DAY_DECISIONS";

export type MonthServiceDays = {
  month: YearMonth;
  status: "READY" | "NEEDS_INPUT" | "UNSUPPORTED";
  missing: ServiceDayMissing[];
  days: ServiceDay[];
  undecidedDates: DateOnly[];
  /** Only non-null when status is READY. */
  mealEligibleDays: number | null;
  transportEligibleDays: number | null;
  explanation: string;
};

const DECISION_EVENT_TYPES = new Set([
  "OUTING",
  "LATE_ARRIVAL",
  "EARLY_LEAVE",
  "EDUCATION",
  "TRAINING",
  "SERVICE_SUSPENSION",
  "SERVICE_ABSENCE",
  "EXCESS_ANNUAL_ABSENCE",
]);

function covers(event: ServiceEvent, date: DateOnly) {
  return (
    compareDateOnly(event.startDate, date) <= 0 &&
    compareDateOnly(date, event.endDate) <= 0
  );
}

function datesBetween(start: DateOnly, end: DateOnly): DateOnly[] {
  const dates: DateOnly[] = [];
  for (let cursor = start; compareDateOnly(cursor, end) <= 0;) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

/**
 * Which dates inside an all-day leave range are charged, when provable:
 * every date when the charged count equals the range, or exactly the
 * scheduled working dates when the count equals their number. Otherwise the
 * charged dates are unknown and null is returned.
 */
function chargedDates(
  event: ServiceEvent,
  isScheduledWorkingDay: (date: DateOnly) => boolean,
): Set<DateOnly> | null {
  if (event.timing.kind !== "ALL_DAY") return null;
  const range = datesBetween(event.startDate, event.endDate);
  if (event.timing.dayCount === range.length) return new Set(range);
  const scheduled = range.filter(isScheduledWorkingDay);
  return event.timing.dayCount === scheduled.length ? new Set(scheduled) : null;
}

/**
 * Classify every day of `month` from the service period, the confirmed work
 * schedule, the service-event timeline and the month's attendance
 * confirmation. Counts are produced only when nothing is left to guess.
 */
export function deriveMonthServiceDays(input: {
  profile: Pick<
    ServiceProfile,
    "callUpDate" | "expectedDischargeDate" | "workPattern" | "workWeekdays"
  >;
  month: YearMonth;
  events: readonly ServiceEvent[];
  attendance: AttendanceMonth | null;
}): MonthServiceDays {
  const { profile, month, attendance } = input;
  const missing: ServiceDayMissing[] = [];
  const base = {
    month,
    days: [] as ServiceDay[],
    undecidedDates: [] as DateOnly[],
    mealEligibleDays: null,
    transportEligibleDays: null,
  };

  if (profile.workPattern === null) missing.push("WORK_PATTERN");
  else if (profile.workPattern !== "WEEKDAY_DAYTIME") {
    return {
      ...base,
      status: "UNSUPPORTED",
      missing: [],
      explanation:
        "야간 교대(근무일수 1일=2일)·합숙·기타 복무형태의 근무일 계산은 지원하지 않아요.",
    };
  }
  if (profile.workWeekdays === null) missing.push("WORK_WEEKDAYS");
  if (missing.length > 0) {
    return {
      ...base,
      status: "NEEDS_INPUT",
      missing,
      explanation: "복무형태와 근무 요일을 먼저 확인해 주세요.",
    };
  }

  const weekdays = new Set(profile.workWeekdays ?? []);
  const nonWorking = new Set(attendance?.nonWorkingDates ?? []);
  const overrides = new Map(
    (attendance?.dayOverrides ?? []).map((item) => [item.date, item]),
  );
  const isScheduledWorkingDay = (date: DateOnly) =>
    weekdays.has(dayOfWeek(date)) && !nonWorking.has(date);

  const { year, month: monthNumber } = parseYearMonth(month);
  const first = formatDateOnly({ year, month: monthNumber, day: 1 });
  const last = formatDateOnly({
    year,
    month: monthNumber,
    day: daysInMonth(month),
  });
  const monthEvents = input.events.filter(
    (event) =>
      compareDateOnly(event.startDate, last) <= 0 &&
      compareDateOnly(first, event.endDate) <= 0,
  );
  const liveEvents = monthEvents.filter(
    (event) => isLive(event) && event.eventType !== "USER_NOTE",
  );

  const days: ServiceDay[] = datesBetween(first, last).map((date) => {
    const inService =
      compareDateOnly(profile.callUpDate, date) <= 0 &&
      compareDateOnly(date, profile.expectedDischargeDate) <= 0;
    if (!inService) {
      return {
        date,
        kind: "OUTSIDE_SERVICE",
        eventIds: [],
        mealEligible: false,
        transportEligible: false,
        requiresDecision: false,
        decidedByUser: false,
      };
    }

    let kind: ServiceDayKind = "WORKED";
    const eventIds: string[] = [];
    if (!weekdays.has(dayOfWeek(date))) kind = "NOT_SCHEDULED";
    else if (nonWorking.has(date)) kind = "DECLARED_NON_WORKING";
    else {
      for (const event of liveEvents.filter((item) => covers(item, date))) {
        eventIds.push(event.id);
        if (isLeaveEventType(event.eventType)) {
          if (event.timing.kind !== "ALL_DAY") {
            kind = "NEEDS_DECISION";
            continue;
          }
          const charged = chargedDates(event, isScheduledWorkingDay);
          if (charged === null) kind = "NEEDS_DECISION";
          else if (charged.has(date) && kind !== "NEEDS_DECISION") {
            kind = "FULL_DAY_LEAVE";
          }
        } else if (DECISION_EVENT_TYPES.has(event.eventType)) {
          kind = "NEEDS_DECISION";
        }
      }
    }

    const requiresDecision =
      kind === "FULL_DAY_LEAVE" || kind === "NEEDS_DECISION";
    const override = overrides.get(date);
    if (override) {
      return {
        date,
        kind,
        eventIds,
        mealEligible: override.mealEligible,
        transportEligible: override.transportEligible,
        requiresDecision,
        decidedByUser: true,
      };
    }
    // Only a plain working day (eligible) and a non-scheduled or declared
    // non-working day (no attendance, nothing to pay) are settled without the
    // user; every leave or partial-attendance day waits for a decision.
    const eligible = requiresDecision ? null : kind === "WORKED";
    return {
      date,
      kind,
      eventIds,
      mealEligible: eligible,
      transportEligible: eligible,
      requiresDecision,
      decidedByUser: false,
    };
  });

  const undecidedDates = days
    .filter(
      (day) => day.mealEligible === null || day.transportEligible === null,
    )
    .map((day) => day.date);

  if (!attendance) missing.push("MONTH_CONFIRMATION");
  else {
    // A confirmation answers the schedule and records as they were; any
    // later change to either needs a fresh confirmation.
    const current = attendanceBasisFingerprint(profile, input.events, month);
    if (current !== attendance.basisFingerprint) {
      missing.push("MONTH_RECONFIRMATION");
    }
  }
  if (undecidedDates.length > 0) missing.push("DAY_DECISIONS");

  if (missing.length > 0) {
    return {
      ...base,
      days,
      undecidedDates,
      status: "NEEDS_INPUT",
      missing,
      explanation: missing.includes("MONTH_CONFIRMATION")
        ? "이 달의 공휴일·기관 휴무일을 확인해야 근무일 수를 셀 수 있어요."
        : missing.includes("MONTH_RECONFIRMATION")
          ? "확인 이후 기록이나 근무 요일이 바뀌어 이 달을 다시 확인해야 해요."
          : "휴가·외출 등 기록이 있는 날의 중식비·교통비 지급 여부를 정해 주세요.",
    };
  }

  return {
    ...base,
    days,
    undecidedDates,
    status: "READY",
    missing: [],
    mealEligibleDays: days.filter((day) => day.mealEligible).length,
    transportEligibleDays: days.filter((day) => day.transportEligible).length,
    explanation:
      "근무 요일 중 공휴일·휴무일·종일 휴가를 뺀 날과 직접 정한 날을 셌어요.",
  };
}

/**
 * Upper bound of sick-leave days recorded on or before `through`. All-day
 * records count their charged days; half-day and minute records count as a
 * whole day each, so the bound never understates.
 */
export function sickLeaveDaysUpperBound(
  events: readonly ServiceEvent[],
  through: DateOnly,
): number {
  return events
    .filter(
      (event) =>
        isLive(event) &&
        event.eventType === "SICK_LEAVE" &&
        compareDateOnly(event.startDate, through) <= 0,
    )
    .reduce(
      (sum, event) =>
        sum + (event.timing.kind === "ALL_DAY" ? event.timing.dayCount : 1),
      0,
    );
}
