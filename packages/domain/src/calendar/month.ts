import {
  addDays,
  compareDateOnly,
  differenceInCalendarDays,
  formatDateOnly,
  parseDateOnly,
  type DateOnly,
} from "../service/date-only";

export type YearMonth = `${number}-${number}`;

const YEAR_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

export function parseYearMonth(value: string): { year: number; month: number } {
  const match = YEAR_MONTH_PATTERN.exec(value);
  const month = Number(match?.[2]);
  if (!match || month < 1 || month > 12) {
    throw new RangeError(`Invalid year-month value: ${value}`);
  }
  return { year: Number(match[1]), month };
}

export function yearMonthOf(date: DateOnly): YearMonth {
  return date.slice(0, 7) as YearMonth;
}

export function addMonthsToYearMonth(value: YearMonth, amount: number) {
  const { year, month } = parseYearMonth(value);
  const absolute = year * 12 + (month - 1) + amount;
  const nextYear = Math.floor(absolute / 12);
  const nextMonth = absolute - nextYear * 12 + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}` as YearMonth;
}

export function daysInMonth(value: YearMonth): number {
  const { year, month } = parseYearMonth(value);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0 = Sunday … 6 = Saturday, computed on the civil date (no time zone). */
export function dayOfWeek(date: DateOnly): number {
  const { year, month, day } = parseDateOnly(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function isWeekend(date: DateOnly): boolean {
  const weekday = dayOfWeek(date);
  return weekday === 0 || weekday === 6;
}

/** Inclusive number of calendar days in [start, end]. */
export function inclusiveDaySpan(start: DateOnly, end: DateOnly): number {
  return differenceInCalendarDays(end, start) + 1;
}

/**
 * Monday–Friday days in [start, end]. Public holidays are intentionally not
 * modelled: callers must present this only as an editable suggestion.
 */
export function countWeekdays(start: DateOnly, end: DateOnly): number {
  if (compareDateOnly(start, end) > 0) return 0;
  let count = 0;
  for (let cursor = start; compareDateOnly(cursor, end) <= 0;) {
    if (!isWeekend(cursor)) count += 1;
    cursor = addDays(cursor, 1);
  }
  return count;
}

export type MonthGridCell = {
  date: DateOnly;
  inMonth: boolean;
};

/**
 * Sunday-first month grid padded to whole weeks, as used on Korean calendars.
 */
export function buildMonthGrid(value: YearMonth): MonthGridCell[][] {
  const { year, month } = parseYearMonth(value);
  const first = formatDateOnly({ year, month, day: 1 });
  const last = formatDateOnly({ year, month, day: daysInMonth(value) });
  const gridStart = addDays(first, -dayOfWeek(first));
  const gridEnd = addDays(last, 6 - dayOfWeek(last));
  const weeks: MonthGridCell[][] = [];

  for (let cursor = gridStart; compareDateOnly(cursor, gridEnd) <= 0;) {
    const week: MonthGridCell[] = [];
    for (let index = 0; index < 7; index += 1) {
      week.push({ date: cursor, inMonth: yearMonthOf(cursor) === value });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }

  return weeks;
}

export function dateRangesOverlap(
  a: { startDate: DateOnly; endDate: DateOnly },
  b: { startDate: DateOnly; endDate: DateOnly },
): boolean {
  return (
    compareDateOnly(a.startDate, b.endDate) <= 0 &&
    compareDateOnly(b.startDate, a.endDate) <= 0
  );
}

/**
 * End date for an all-day record that only states a start date and a charged
 * day count (common in institution exports). Weekends are skipped so the
 * range can hold the count; the count itself stays the source of truth and
 * callers must flag the derived end date for user review.
 */
export function endDateForChargedDays(
  start: DateOnly,
  dayCount: number,
): DateOnly {
  let cursor = start;
  let remaining = Math.max(0, dayCount - 1);
  while (remaining > 0) {
    cursor = addDays(cursor, 1);
    if (!isWeekend(cursor)) remaining -= 1;
  }
  return cursor;
}
