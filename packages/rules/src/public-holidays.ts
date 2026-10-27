import type { DateOnly } from "@super-gongik/domain";

import holidaysJson from "../holidays/kr-public-holidays.json";

/**
 * 관공서 공휴일 (대체·임시공휴일 포함) from 한국천문연구원 특일 정보
 * (data.go.kr 15012690), refreshed with scripts/fetch-kasi-holidays.cjs.
 *
 * Used to count expected 출근일 and to pre-mark a month's holidays in the
 * attendance editor. Pay calculation itself does not read it: a month's
 * 중식비·교통비 days still use the non-working days the user saves.
 */
type HolidayFile = {
  source: {
    title: string;
    authority: string;
    url: string;
    fetchedAt: string;
  };
  years: Record<string, Array<{ date: string; name: string }>>;
};

const file = holidaysJson as HolidayFile;

export const PUBLIC_HOLIDAY_SOURCE = file.source;

/** Years the file covers. A year is listed only once it was announced. */
export const PUBLIC_HOLIDAY_YEARS: readonly number[] = Object.keys(file.years)
  .map(Number)
  .sort((a, b) => a - b);

const names = new Map<string, string>();
for (const holidays of Object.values(file.years)) {
  for (const { date, name } of holidays) {
    // Two holidays can fall on one date (e.g. 어린이날 and 부처님오신날).
    names.set(date, names.has(date) ? `${names.get(date)}·${name}` : name);
  }
}

export function publicHolidayName(date: DateOnly): string | null {
  return names.get(date) ?? null;
}

export function isPublicHolidayYearCovered(year: number): boolean {
  return PUBLIC_HOLIDAY_YEARS.includes(year);
}

export type HolidaySuggestion = { date: DateOnly; name: string };

/** Day kinds that can be a scheduled working day for meal/transport pay. */
const SCHEDULED_KINDS: ReadonlySet<string> = new Set([
  "WORKED",
  "NEEDS_DECISION",
  "FULL_DAY_LEAVE",
  "FULL_DAY_ABSENCE",
]);

/**
 * 관공서 공휴일 that fall on the user's scheduled working days. These are
 * offered to the user as non-working days for a month's 중식비·교통비
 * count; pay still waits until the user saves (confirms) the month.
 *
 * `covered` is false when the month's year is not in the holiday file, so a
 * caller can tell "no holidays" apart from "no data".
 */
export function suggestedHolidayNonWorkingDays(
  days: ReadonlyArray<{ date: DateOnly; kind: string }>,
): { covered: boolean; holidays: HolidaySuggestion[] } {
  const holidays: HolidaySuggestion[] = [];
  let covered = days.length > 0;
  for (const day of days) {
    if (!isPublicHolidayYearCovered(Number(day.date.slice(0, 4)))) {
      covered = false;
      continue;
    }
    if (!SCHEDULED_KINDS.has(day.kind)) continue;
    const name = publicHolidayName(day.date);
    if (name) holidays.push({ date: day.date, name });
  }
  return { covered, holidays };
}
