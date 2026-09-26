import {
  addCalendarMonths,
  addDays,
  compareDateOnly,
  differenceInCalendarDays,
  parseDateOnly,
  type DateOnly,
} from "./date-only";
import type { ServiceProfile } from "./profile";
import { calculateServiceProgress } from "./progress";

/**
 * Calendar milestones of a service period. They are pure date arithmetic
 * over the same model as `calculateServiceProgress` (call-up date = elapsed
 * 0, expected discharge date = 100 %), so a milestone never disagrees with
 * the D-day or percentage shown next to it.
 */
export type ServiceMilestoneKind =
  | "CALL_UP"
  | "DISCHARGE"
  | "DAYS_REMAINING"
  | "PERCENT"
  | "SERVICE_DAY"
  | "SERVICE_YEAR";

export type ServiceMilestone = {
  kind: ServiceMilestoneKind;
  date: DateOnly;
  /** Days remaining, percent, or service-day ordinal, depending on kind. */
  value: number;
  label: string;
};

/** "D-N" milestones counted back from the expected discharge date. */
export const DAYS_REMAINING_MILESTONES = [
  500, 300, 200, 100, 50, 30, 7, 1,
] as const;

/** Completion percentages worth marking. */
export const PERCENT_MILESTONES = [25, 50, 75, 90, 95, 99] as const;

/** Tie-break when two milestones fall on the same date (lower wins). */
const KIND_PRIORITY: Record<ServiceMilestoneKind, number> = {
  DISCHARGE: 0,
  CALL_UP: 1,
  PERCENT: 2,
  DAYS_REMAINING: 3,
  SERVICE_YEAR: 4,
  SERVICE_DAY: 5,
};

type Period = Pick<ServiceProfile, "callUpDate" | "expectedDischargeDate">;

function strictlyInside(period: Period, date: DateOnly) {
  return (
    compareDateOnly(date, period.callUpDate) > 0 &&
    compareDateOnly(date, period.expectedDischargeDate) < 0
  );
}

/** Every milestone of the period, in date order. */
export function listServiceMilestones(period: Period): ServiceMilestone[] {
  const total = differenceInCalendarDays(
    period.expectedDischargeDate,
    period.callUpDate,
  );
  const milestones: ServiceMilestone[] = [
    {
      kind: "CALL_UP",
      date: period.callUpDate,
      value: 0,
      label: "소집일",
    },
    {
      kind: "DISCHARGE",
      date: period.expectedDischargeDate,
      value: 100,
      label: "소집해제",
    },
  ];

  if (total > 0) {
    for (const percent of PERCENT_MILESTONES) {
      // First day whose elapsed/total reaches the percentage, in integers.
      const elapsed = Math.ceil((percent * total) / 100);
      const date = addDays(period.callUpDate, elapsed);
      if (strictlyInside(period, date)) {
        milestones.push({
          kind: "PERCENT",
          date,
          value: percent,
          label: `복무 ${percent}%`,
        });
      }
    }

    for (const days of DAYS_REMAINING_MILESTONES) {
      const date = addDays(period.expectedDischargeDate, -days);
      if (strictlyInside(period, date)) {
        milestones.push({
          kind: "DAYS_REMAINING",
          date,
          value: days,
          label: `D-${days}`,
        });
      }
    }

    // Counted like other Korean anniversaries: the call-up date is day 1.
    const dayHundred = addDays(period.callUpDate, 99);
    if (strictlyInside(period, dayHundred)) {
      milestones.push({
        kind: "SERVICE_DAY",
        date: dayHundred,
        value: 100,
        label: "복무 100일째",
      });
    }
    const firstYear = addCalendarMonths(period.callUpDate, 12);
    if (strictlyInside(period, firstYear)) {
      milestones.push({
        kind: "SERVICE_YEAR",
        date: firstYear,
        value: 1,
        label: "복무 1년",
      });
    }
  }

  return milestones.sort(
    (left, right) =>
      compareDateOnly(left.date, right.date) ||
      KIND_PRIORITY[left.kind] - KIND_PRIORITY[right.kind],
  );
}

/** The first milestone strictly after `today`, or null after discharge. */
export function nextServiceMilestone(
  period: Period,
  today: DateOnly,
): ServiceMilestone | null {
  return (
    listServiceMilestones(period).find(
      (milestone) => compareDateOnly(milestone.date, today) > 0,
    ) ?? null
  );
}

/** The most notable milestone that falls exactly on `today`, if any. */
export function serviceMilestoneOn(
  period: Period,
  today: DateOnly,
): ServiceMilestone | null {
  return (
    listServiceMilestones(period).find(
      (milestone) => milestone.date === today,
    ) ?? null
  );
}

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Epoch milliseconds of 00:00 in Asia/Seoul (fixed UTC+9, no DST) on `date`. */
export function seoulStartOfDay(date: DateOnly): number {
  const { year, month, day } = parseDateOnly(date);
  return Date.UTC(year, month - 1, day) - SEOUL_OFFSET_MS;
}

/**
 * Completion as a continuous fraction in [0, 1] at `instant`.
 *
 * This is the day-based model of `calculateServiceProgress` evaluated between
 * midnights: at 00:00 Asia/Seoul of any date it equals exactly
 * `elapsedDays / totalServiceDays` for that date, and it reaches 1 at the
 * start of the expected discharge date, where the day model reports
 * COMPLETED. It adds resolution, not a different definition.
 */
export function continuousServiceCompletion(
  period: Period,
  instant: Date,
): number {
  const start = seoulStartOfDay(period.callUpDate);
  const end = seoulStartOfDay(period.expectedDischargeDate);
  if (end <= start) return instant.getTime() >= start ? 1 : 0;
  const fraction = (instant.getTime() - start) / (end - start);
  return Math.min(1, Math.max(0, fraction));
}

/** Days from `today` until `date` (negative when past). */
export function daysUntil(date: DateOnly, today: DateOnly): number {
  return differenceInCalendarDays(date, today);
}

/**
 * Days since the expected discharge date for a completed period, 0 on the
 * discharge date itself, null while in service or before call-up.
 */
export function daysSinceDischarge(
  period: Period,
  today: DateOnly,
): number | null {
  const progress = calculateServiceProgress(period, today);
  if (progress.state !== "COMPLETED") return null;
  return Math.max(
    0,
    differenceInCalendarDays(today, period.expectedDischargeDate),
  );
}
