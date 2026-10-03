import {
  ANNUAL_LEAVE_CUMULATIVE_MINUTES_PER_DAY,
  formatLeaveQuantity,
  isDateOnly,
  type DateOnly,
  type LeaveLedger,
  type LeaveQuantity,
  type UserData,
} from "@super-gongik/domain";
import {
  currentPayStepOrdinal,
  deriveAnnualLeaveCredits,
  derivePayBandSchedule,
} from "@super-gongik/rules";

// The web home model and projection glue are pure modules with no React or
// DOM imports. The native client runs them unchanged instead of
// re-implementing their phase, milestone and pay-card decisions in Swift, so
// both clients show the same hero, leave card and pay card for the same data.
import { buildHomeModel } from "@/lib/home-model";
import { buildAppProjection } from "@/lib/projections";
import {
  CATEGORY_LABELS,
  EVENT_CATEGORY,
  describeTiming,
  eventLabel,
} from "@/lib/event-display";

/**
 * Display strings for the leave screen, formatted exactly as the web ledger
 * panel formats them: balances and entries with the 8-hour cumulative day
 * (`ANNUAL_LEAVE_CUMULATIVE_MINUTES_PER_DAY`), per-type totals without a
 * workday assumption.
 */
function presentLedger(ledger: LeaveLedger) {
  const format = (value: LeaveQuantity) =>
    formatLeaveQuantity(value, ANNUAL_LEAVE_CUMULATIVE_MINUTES_PER_DAY);
  const balance = ledger.balance;
  return {
    balance: {
      granted: format(balance.granted),
      upcomingCredits: format(balance.upcomingCredits),
      corrections: format(balance.corrections),
      used: format(balance.used),
      scheduled: format(balance.scheduled),
      available: format(balance.available),
      remainingAfterScheduled: format(balance.remainingAfterScheduled),
    },
    entries: ledger.entries.map((entry) => ({
      delta: format(entry.delta),
      running: format(entry.running),
    })),
    byType: ledger.byType.map((item) => formatLeaveQuantity(item.total, null)),
    attendanceTotal: format({
      halfDays: 0,
      minutes:
        ledger.attendanceMinutes.OUTING +
        ledger.attendanceMinutes.LATE_ARRIVAL +
        ledger.attendanceMinutes.EARLY_LEAVE,
    }),
    reconciliation:
      ledger.reconciliation.status === "MATCH" ||
      ledger.reconciliation.status === "DIFFERENT"
        ? {
            institutionRemaining: format(
              ledger.reconciliation.institutionRemaining,
            ),
            appRemaining: format(ledger.reconciliation.appRemaining),
            difference: format(ledger.reconciliation.difference),
          }
        : null,
  };
}

/**
 * What every native screen renders for one Seoul civil date: the web's
 * `buildAppProjection` and `buildHomeModel`, plus the credit list and pay
 * band schedule the money and leave screens read directly.
 */
export function buildNativeProjection(data: UserData, today: string) {
  if (!isDateOnly(today)) throw new RangeError(`Invalid date: ${today}`);
  const date = today as DateOnly;
  const profile = data.profile;
  if (!profile) return { today: date, profile: null } as const;

  const projection = buildAppProjection(data, profile, date);
  const payBands = derivePayBandSchedule(profile, date);
  return {
    today: date,
    profile,
    ...projection,
    home: buildHomeModel(profile, projection, date),
    leaveText: presentLedger(projection.ledger),
    eventDisplay: Object.fromEntries(
      projection.liveEvents.map((event) => [
        event.id,
        {
          category: EVENT_CATEGORY[event.eventType],
          categoryLabel: CATEGORY_LABELS[EVENT_CATEGORY[event.eventType]],
          label: eventLabel(event),
          timing: describeTiming(event),
        },
      ]),
    ),
    credits: deriveAnnualLeaveCredits({
      callUpDate: profile.callUpDate,
      referenceDate: date,
    }),
    payBands,
    // Same inputs as the web money tab and home model.
    payStepOrdinal: currentPayStepOrdinal(
      payBands,
      projection.compensation.serviceMonthOrdinal,
    ),
  };
}

export type NativeProjection = ReturnType<typeof buildNativeProjection>;
