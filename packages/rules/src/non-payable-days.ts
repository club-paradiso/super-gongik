import {
  addDays,
  attendanceBasisFingerprint,
  compareDateOnly,
  dayOfWeek,
  daysInMonth,
  formatDateOnly,
  isCompensationNonPayableEventType,
  isLive,
  parseYearMonth,
  type AttendanceMonth,
  type DateOnly,
  type ServiceEvent,
  type ServiceProfile,
  type YearMonth,
} from "@super-gongik/domain";

export type DerivedNonPayableReason =
  | "SICK_LEAVE_OVER_30"
  | "SERVICE_SUSPENSION"
  | "SERVICE_ABSENCE"
  | "EXCESS_ANNUAL_ABSENCE";

export type DerivedNonPayableDay = {
  date: DateOnly;
  reason: DerivedNonPayableReason;
  eventIds: string[];
};

export type NonPayableDerivation = {
  month: YearMonth;
  dates: DateOnly[];
  days: DerivedNonPayableDay[];
  unresolved: string[];
  sickLeave: {
    thresholdDays: 30;
    ordinaryCumulativeDaysThroughMonth: number | null;
    publicDutyDaysIgnored: number;
  };
};

function datesBetween(start: DateOnly, end: DateOnly): DateOnly[] {
  const dates: DateOnly[] = [];
  for (let cursor = start; compareDateOnly(cursor, end) <= 0;) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function monthBounds(month: YearMonth) {
  const { year, month: number } = parseYearMonth(month);
  return {
    first: formatDateOnly({ year, month: number, day: 1 }),
    last: formatDateOnly({ year, month: number, day: daysInMonth(month) }),
  };
}

function monthOf(date: DateOnly): YearMonth {
  return date.slice(0, 7) as YearMonth;
}

function sickLeaveUpperBoundThrough(
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

function liveAttendance(
  attendanceMonths: readonly AttendanceMonth[],
  month: YearMonth,
): AttendanceMonth | null {
  return (
    attendanceMonths.find(
      (record) => isLive(record) && record.month === month,
    ) ?? null
  );
}

function exactChargedDates(
  event: ServiceEvent,
  input: {
    profile: Pick<
      ServiceProfile,
      "callUpDate" | "expectedDischargeDate" | "workPattern" | "workWeekdays"
    >;
    events: readonly ServiceEvent[];
    attendanceMonths: readonly AttendanceMonth[];
  },
): DateOnly[] | null {
  if (event.timing.kind !== "ALL_DAY") return null;
  const range = datesBetween(event.startDate, event.endDate);
  if (event.timing.dayCount === range.length) return range;

  if (
    input.profile.workPattern !== "WEEKDAY_DAYTIME" ||
    input.profile.workWeekdays === null
  ) {
    return null;
  }

  const weekdays = new Set(input.profile.workWeekdays);
  const months = [...new Set(range.map(monthOf))];
  const attendanceByMonth = new Map<YearMonth, AttendanceMonth>();
  for (const month of months) {
    const attendance = liveAttendance(input.attendanceMonths, month);
    if (!attendance) return null;
    const currentFingerprint = attendanceBasisFingerprint(
      input.profile,
      input.events,
      month,
    );
    if (attendance.basisFingerprint !== currentFingerprint) return null;
    attendanceByMonth.set(month, attendance);
  }

  const scheduled = range.filter((date) => {
    const attendance = attendanceByMonth.get(monthOf(date));
    if (!attendance) return false;
    return (
      weekdays.has(dayOfWeek(date)) &&
      !attendance.nonWorkingDates.includes(date)
    );
  });

  return event.timing.dayCount === scheduled.length ? scheduled : null;
}

function pushDay(
  map: Map<DateOnly, DerivedNonPayableDay>,
  date: DateOnly,
  reason: DerivedNonPayableReason,
  eventId: string,
) {
  const existing = map.get(date);
  if (!existing) {
    map.set(date, { date, reason, eventIds: [eventId] });
    return;
  }
  if (!existing.eventIds.includes(eventId)) existing.eventIds.push(eventId);
}

/**
 * Derive Article 41(6) non-payable dates for one calendar month.
 *
 * The function intentionally fails closed. An unknown sick-leave category,
 * partial sick-leave duration, stale attendance confirmation, or ambiguous
 * charged-date range never becomes an automatic deduction.
 */
export function deriveMonthNonPayableDates(input: {
  profile: Pick<
    ServiceProfile,
    "callUpDate" | "expectedDischargeDate" | "workPattern" | "workWeekdays"
  >;
  events: readonly ServiceEvent[];
  attendanceMonths?: readonly AttendanceMonth[];
  month: YearMonth;
}): NonPayableDerivation {
  const attendanceMonths = input.attendanceMonths ?? [];
  const { first, last } = monthBounds(input.month);
  const liveEvents = input.events.filter(
    (event) =>
      isLive(event) &&
      compareDateOnly(event.startDate, last) <= 0 &&
      compareDateOnly(event.endDate, input.profile.callUpDate) >= 0,
  );
  const derived = new Map<DateOnly, DerivedNonPayableDay>();
  const unresolved: string[] = [];

  // Explicit Article 41(6) event categories only affect the target month.
  for (const event of liveEvents.filter(
    (item) =>
      isCompensationNonPayableEventType(item.eventType) &&
      compareDateOnly(item.endDate, first) >= 0,
  )) {
    const exact = exactChargedDates(event, {
      profile: input.profile,
      events: input.events,
      attendanceMonths,
    });
    if (!exact) {
      unresolved.push(
        `${event.startDate} ${event.eventType}: 미지급 날짜를 정확히 확정할 수 없어요.`,
      );
      continue;
    }
    const reason = event.eventType as DerivedNonPayableReason;
    for (const date of exact) {
      if (date >= first && date <= last) {
        pushDay(derived, date, reason, event.id);
      }
    }
  }

  const currentSick = liveEvents.filter(
    (event) =>
      event.eventType === "SICK_LEAVE" &&
      compareDateOnly(event.endDate, first) >= 0 &&
      compareDateOnly(event.startDate, last) <= 0,
  );
  const currentOrdinaryOrUnknown = currentSick.filter(
    (event) => (event.sickLeaveCategory ?? "UNKNOWN") !== "PUBLIC_DUTY",
  );

  let ordinaryCumulativeDaysThroughMonth: number | null = 0;
  let publicDutyDaysIgnored = 0;

  const sickUpperBound = sickLeaveUpperBoundThrough(liveEvents, last);

  if (currentOrdinaryOrUnknown.length > 0 && sickUpperBound > 30) {
    const ordinaryDates: Array<{ date: DateOnly; eventId: string }> = [];
    let sickHistoryResolved = true;

    for (const event of liveEvents
      .filter(
        (item) =>
          item.eventType === "SICK_LEAVE" &&
          compareDateOnly(item.startDate, last) <= 0,
      )
      .sort(
        (a, b) =>
          a.startDate.localeCompare(b.startDate) ||
          a.endDate.localeCompare(b.endDate) ||
          a.id.localeCompare(b.id),
      )) {
      const category = event.sickLeaveCategory ?? "UNKNOWN";
      if (category === "PUBLIC_DUTY") {
        const exact = exactChargedDates(event, {
          profile: input.profile,
          events: input.events,
          attendanceMonths,
        });
        if (exact) {
          publicDutyDaysIgnored += exact.filter((date) => date <= last).length;
        }
        continue;
      }
      if (category === "UNKNOWN") {
        sickHistoryResolved = false;
        unresolved.push(
          `${event.startDate} 병가가 공무수행상 질병·부상인지 확인되지 않아 30일 누적 기준을 자동 판정할 수 없어요.`,
        );
        continue;
      }

      const exact = exactChargedDates(event, {
        profile: input.profile,
        events: input.events,
        attendanceMonths,
      });
      if (!exact) {
        sickHistoryResolved = false;
        unresolved.push(
          `${event.startDate} 일반 병가의 실제 차감 날짜를 확정할 수 없어 30일 누적 기준을 자동 판정할 수 없어요.`,
        );
        continue;
      }
      for (const date of exact) {
        if (
          date >= input.profile.callUpDate &&
          date <= input.profile.expectedDischargeDate &&
          date <= last
        ) {
          ordinaryDates.push({ date, eventId: event.id });
        }
      }
    }

    if (sickHistoryResolved) {
      const byDate = new Map<DateOnly, string[]>();
      for (const item of ordinaryDates) {
        const ids = byDate.get(item.date) ?? [];
        if (!ids.includes(item.eventId)) ids.push(item.eventId);
        byDate.set(item.date, ids);
      }
      const ordered = [...byDate.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      );
      ordinaryCumulativeDaysThroughMonth = ordered.length;
      for (const [date, eventIds] of ordered.slice(30)) {
        if (date < first || date > last) continue;
        for (const eventId of eventIds) {
          pushDay(derived, date, "SICK_LEAVE_OVER_30", eventId);
        }
      }
    } else {
      ordinaryCumulativeDaysThroughMonth = null;
    }
  }

  const days = [...derived.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  return {
    month: input.month,
    dates: days.map((day) => day.date),
    days,
    unresolved: [...new Set(unresolved)],
    sickLeave: {
      thresholdDays: 30,
      ordinaryCumulativeDaysThroughMonth,
      publicDutyDaysIgnored,
    },
  };
}
