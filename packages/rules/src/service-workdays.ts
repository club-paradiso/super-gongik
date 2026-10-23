import {
  addDays,
  compareDateOnly,
  dayOfWeek,
  isLeaveEventType,
  isLive,
  type AnnualLeaveBalance,
  type AttendanceMonth,
  type DateOnly,
  type ServiceEvent,
  type ServiceProfile,
} from "@super-gongik/domain";

import {
  isPublicHolidayYearCovered,
  publicHolidayName,
} from "./public-holidays";
import { chargedDates } from "./service-days";

/**
 * 실질 복무일수: how many days the user actually goes (or went) to work.
 *
 * - remaining: 출근일 after today up to and including the discharge date.
 * - remainingIfAllLeaveUsed: remaining minus every 연가 day still available
 *   (scheduled leave is already excluded, not-yet-granted 2년차 연가 included).
 * - elapsed: 출근일 from the call-up date up to yesterday.
 *
 * Today belongs to neither side, matching the calendar-day progress.
 *
 * A 출근일 is a confirmed working weekday that is not a 관공서 공휴일, not a
 * holiday or closure the user declared for that month, and not covered by a
 * full-day leave or a full-day 복무중단·복무이탈·연가초과 결근. Partial-day
 * records (반차, 외출, 지각, 조퇴) and 교육·훈련 still count as service days.
 */

export type ServiceWorkdays =
  | {
      status: "READY";
      remaining: number;
      /** null when the leave balance is not settled yet. */
      remainingIfAllLeaveUsed: number | null;
      /** 연가 days subtracted for remainingIfAllLeaveUsed (half-day steps). */
      leaveDaysAssumed: number | null;
      /** Whether leaveDaysAssumed includes 연가 not granted yet (2년차). */
      leaveIncludesUpcoming: boolean;
      elapsed: number;
      /** Years in the counted range whose holidays are not announced yet. */
      uncoveredHolidayYears: number[];
    }
  | { status: "NEEDS_WORK_WEEKDAYS" }
  | { status: "UNSUPPORTED_WORK_PATTERN" };

const ABSENCE_EVENT_TYPES = new Set([
  "SERVICE_SUSPENSION",
  "SERVICE_ABSENCE",
  "EXCESS_ANNUAL_ABSENCE",
]);

function datesBetween(start: DateOnly, end: DateOnly): DateOnly[] {
  const dates: DateOnly[] = [];
  for (let cursor = start; compareDateOnly(cursor, end) <= 0;) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

/** 연가 left in whole half-days; minutes short of a half day cannot skip work. */
function leaveDays(balance: AnnualLeaveBalance): number {
  const halfDays =
    balance.remainingAfterScheduled.halfDays +
    balance.upcomingCredits.halfDays +
    Math.floor(
      (balance.remainingAfterScheduled.minutes +
        balance.upcomingCredits.minutes) /
        240,
    );
  return Math.max(0, halfDays) / 2;
}

export function deriveServiceWorkdays(input: {
  profile: Pick<
    ServiceProfile,
    "callUpDate" | "expectedDischargeDate" | "workPattern" | "workWeekdays"
  >;
  events: readonly ServiceEvent[];
  attendanceMonths: readonly AttendanceMonth[];
  annualLeave: AnnualLeaveBalance | null;
  today: DateOnly;
}): ServiceWorkdays {
  const { profile, today } = input;
  if (profile.workPattern !== null && profile.workPattern !== "WEEKDAY_DAYTIME")
    return { status: "UNSUPPORTED_WORK_PATTERN" };
  if (profile.workWeekdays === null || profile.workWeekdays.length === 0)
    return { status: "NEEDS_WORK_WEEKDAYS" };

  const weekdays = new Set(profile.workWeekdays);
  const declared = new Set(
    input.attendanceMonths.filter(isLive).flatMap((m) => m.nonWorkingDates),
  );
  const isScheduled = (date: DateOnly) =>
    weekdays.has(dayOfWeek(date)) &&
    publicHolidayName(date) === null &&
    !declared.has(date);

  const away = new Set<DateOnly>();
  for (const event of input.events) {
    if (!isLive(event) || event.timing.kind !== "ALL_DAY") continue;
    if (isLeaveEventType(event.eventType)) {
      // Unprovable charged dates: fall back to the scheduled dates in range.
      const charged =
        chargedDates(event, isScheduled) ??
        new Set(datesBetween(event.startDate, event.endDate));
      for (const date of charged) away.add(date);
    } else if (ABSENCE_EVENT_TYPES.has(event.eventType)) {
      for (const date of datesBetween(event.startDate, event.endDate))
        away.add(date);
    }
  }
  const isWorkday = (date: DateOnly) => isScheduled(date) && !away.has(date);
  const count = (start: DateOnly, end: DateOnly) =>
    compareDateOnly(start, end) > 0
      ? 0
      : datesBetween(start, end).filter(isWorkday).length;

  const firstRemaining =
    compareDateOnly(today, profile.callUpDate) < 0
      ? profile.callUpDate
      : addDays(today, 1);
  const remaining = count(firstRemaining, profile.expectedDischargeDate);
  const lastElapsed =
    compareDateOnly(today, profile.expectedDischargeDate) > 0
      ? profile.expectedDischargeDate
      : addDays(today, -1);
  const elapsed = count(profile.callUpDate, lastElapsed);

  const leave =
    input.annualLeave?.status === "RESOLVED"
      ? leaveDays(input.annualLeave)
      : null;
  const uncoveredHolidayYears: number[] = [];
  const endYear = Number(profile.expectedDischargeDate.slice(0, 4));
  for (
    let year = Number(profile.callUpDate.slice(0, 4));
    year <= endYear;
    year += 1
  ) {
    if (!isPublicHolidayYearCovered(year)) uncoveredHolidayYears.push(year);
  }
  return {
    status: "READY",
    remaining,
    remainingIfAllLeaveUsed:
      leave === null ? null : Math.max(0, remaining - leave),
    leaveDaysAssumed: leave,
    leaveIncludesUpcoming:
      leave !== null &&
      (input.annualLeave!.upcomingCredits.halfDays > 0 ||
        input.annualLeave!.upcomingCredits.minutes > 0),
    elapsed,
    uncoveredHolidayYears,
  };
}
