import {
  buildLeaveLedger,
  calculateServiceProgress,
  compareDateOnly,
  isLive,
  yearMonthOf,
  type DateOnly,
  type LeaveLedger,
  type ServiceEvent,
  type ServiceProfile,
  type UserData,
} from "@super-gongik/domain";
import {
  deriveAnnualLeaveCredits,
  evaluateMonthlyCompensation,
  findAttendanceMonth,
  type MonthlyCompensationEvaluation,
} from "@super-gongik/rules";

/**
 * Thin application glue: combine domain records with rule-supplied inputs.
 * No policy lives here; every number comes from `@super-gongik/domain` or
 * `@super-gongik/rules`.
 */
export function buildLedgerForProfile(
  data: UserData,
  profile: ServiceProfile,
  today: DateOnly,
): LeaveLedger {
  return buildLeaveLedger({
    credits: deriveAnnualLeaveCredits({
      callUpDate: profile.callUpDate,
      referenceDate: today,
    }),
    events: data.events,
    adjustments: data.leaveAdjustments,
    snapshots: data.leaveSnapshots,
    workdayMinutes: profile.workdayMinutes,
    today,
  });
}

export type AppProjection = {
  progress: ReturnType<typeof calculateServiceProgress>;
  ledger: LeaveLedger;
  compensation: MonthlyCompensationEvaluation;
  liveEvents: ServiceEvent[];
  nextEvent: ServiceEvent | null;
  todayEvents: ServiceEvent[];
};

export function buildAppProjection(
  data: UserData,
  profile: ServiceProfile,
  today: DateOnly,
): AppProjection {
  const liveEvents = data.events
    .filter(isLive)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const todayEvents = liveEvents.filter(
    (event) =>
      compareDateOnly(event.startDate, today) <= 0 &&
      compareDateOnly(today, event.endDate) <= 0,
  );
  return {
    progress: calculateServiceProgress(profile, today),
    ledger: buildLedgerForProfile(data, profile, today),
    compensation: evaluateMonthlyCompensation(profile, today, {
      events: data.events,
      attendance: findAttendanceMonth(
        data.attendanceMonths,
        yearMonthOf(today),
      ),
    }),
    liveEvents,
    nextEvent:
      liveEvents.find((event) => compareDateOnly(event.startDate, today) > 0) ??
      null,
    todayEvents,
  };
}
