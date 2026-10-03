import {
  type DateOnly,
  type UserData,
  type ServiceProfile,
  type YearMonth,
  yearMonthOf,
} from "@super-gongik/domain";
import {
  derivePayBandSchedule,
  evaluateMonthlyCompensation,
  findAttendanceMonth,
} from "@super-gongik/rules";

/**
 * The money screen's month evaluation, kept free of React so the native
 * client shows the same figures. The selected month is evaluated on today
 * for the current month, else on the 15th (any in-month date selects the
 * same month-wide bundle).
 */
export function moneyAsOfDate(month: YearMonth, today: DateOnly): DateOnly {
  return month === yearMonthOf(today) ? today : (`${month}-15` as DateOnly);
}

export function evaluateMoneyMonth(
  data: UserData,
  profile: ServiceProfile,
  month: YearMonth,
  today: DateOnly,
) {
  const asOfDate = moneyAsOfDate(month, today);
  return {
    asOfDate,
    compensation: evaluateMonthlyCompensation(profile, asOfDate, {
      events: data.events,
      attendance: findAttendanceMonth(data.attendanceMonths, month),
      attendanceMonths: data.attendanceMonths,
    }),
    schedule: derivePayBandSchedule(profile, asOfDate),
  };
}
