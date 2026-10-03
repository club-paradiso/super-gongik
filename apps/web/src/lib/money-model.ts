import {
  type AttendanceDayOverride,
  type AttendanceMonthInput,
  type CompensationRoundingPolicy,
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
  type MonthlyCompensationEvaluation,
  type ServiceDay,
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

// ── Month attendance confirmation ───────────────────────────────────────────

export const DAY_KIND_LABELS: Record<ServiceDay["kind"], string> = {
  OUTSIDE_SERVICE: "복무 기간 밖",
  NOT_SCHEDULED: "근무 요일 아님",
  DECLARED_NON_WORKING: "공휴일·휴무",
  FULL_DAY_LEAVE: "종일 휴가",
  NEEDS_DECISION: "직접 정해야 함",
  WORKED: "근무일",
};

/**
 * Which days the attendance editor offers. Scheduled in-service weekdays can
 * be marked as holidays; days the records leave open need an explicit
 * meal/transport decision (hidden once marked as a holiday).
 */
export function attendanceEditorDays(
  days: readonly ServiceDay[],
  nonWorking: ReadonlySet<DateOnly>,
) {
  return {
    scheduled: days.filter(
      (day) =>
        day.kind === "WORKED" ||
        day.kind === "DECLARED_NON_WORKING" ||
        (day.kind === "NEEDS_DECISION" && !nonWorking.has(day.date)) ||
        day.kind === "FULL_DAY_LEAVE",
    ),
    decisionDays: days.filter(
      (day) => day.requiresDecision && !nonWorking.has(day.date),
    ),
  };
}

export type AttendanceDraft = {
  month: YearMonth;
  nonWorkingDates: readonly DateOnly[];
  /** Partial answers are allowed while editing. */
  decisions: ReadonlyArray<Partial<AttendanceDayOverride>>;
  hadNonPayableAbsence: boolean;
  nonPayableDates: readonly DateOnly[];
  nonPayableDatesConfirmed: boolean;
  roundingPolicy: CompensationRoundingPolicy | null;
};

/**
 * The `saveAttendanceMonth` input for an editor state: only open days with
 * both answers are saved, and dates the records already make non-payable are
 * always included.
 */
export function attendanceMonthInput(
  draft: AttendanceDraft,
  evaluation: MonthlyCompensationEvaluation,
): AttendanceMonthInput {
  const nonWorking = new Set(draft.nonWorkingDates);
  const days = evaluation.serviceDays?.days ?? [];
  const liveDecisionDates = new Set(
    attendanceEditorDays(days, nonWorking).decisionDays.map((day) => day.date),
  );
  const derived = evaluation.basePayAdjustment?.derivedNonPayableDates ?? [];
  return {
    month: draft.month,
    nonWorkingDates: [...nonWorking],
    dayOverrides: draft.decisions.flatMap((item) =>
      item.date &&
      liveDecisionDates.has(item.date) &&
      typeof item.mealEligible === "boolean" &&
      typeof item.transportEligible === "boolean"
        ? [
            {
              date: item.date,
              mealEligible: item.mealEligible,
              transportEligible: item.transportEligible,
            },
          ]
        : [],
    ),
    hadNonPayableAbsence: draft.hadNonPayableAbsence,
    nonPayableDates: [...new Set([...draft.nonPayableDates, ...derived])],
    nonPayableDatesConfirmed: draft.nonPayableDatesConfirmed,
    roundingPolicy: draft.roundingPolicy,
  };
}
