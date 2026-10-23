import type { DateOnly } from "@super-gongik/domain";

import holidaysJson from "../holidays/kr-public-holidays.json";

/**
 * 관공서 공휴일 (대체·임시공휴일 포함) from 한국천문연구원 특일 정보
 * (data.go.kr 15012690), refreshed with scripts/fetch-kasi-holidays.cjs.
 *
 * Used only to count expected 출근일. Pay calculation does not read it: a
 * month's 중식비·교통비 days still use the holidays the user confirms.
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
