import {
  ANNUAL_LEAVE_CUMULATIVE_MINUTES_PER_DAY,
  addDays,
  compareDateOnly,
  daysSinceDischarge,
  differenceInCalendarDays,
  formatLeaveQuantity,
  nextServiceMilestone,
  serviceMilestoneOn,
  type DateOnly,
  type LeaveQuantity,
  type ServiceEvent,
  type ServiceMilestoneKind,
  type ServiceProfile,
} from "@super-gongik/domain";
import {
  derivePayBandSchedule,
  type PayBandSchedule,
} from "@super-gongik/rules";

import type { AppProjection } from "@/lib/projections";

/**
 * Presentation model for the home screen. Pure: every value is derived from
 * the projection, the profile and `today`, so each home state is testable
 * without rendering. No policy lives here.
 */

export type HeroPhase =
  | "PRE_SERVICE"
  | "IN_SERVICE"
  | "FINAL_STRETCH"
  | "DISCHARGE_DAY"
  | "COMPLETED";

/** D-30 and under reads as the last stretch. */
export const FINAL_STRETCH_DAYS = 30;

export type HomeMilestone = {
  label: string;
  date: DateOnly;
  daysUntil: number;
  detail: string | null;
  source: "SERVICE" | "PAY_BAND";
};

export type HomeHero = {
  phase: HeroPhase;
  eyebrow: string;
  headline: string;
  /** Screen-reader sentence for the headline + date (no punctuation noise). */
  headlineSpoken: string;
  dateLine: string;
  stateLabel: string;
  /** Day-based completion, floored to one decimal (never shows 100.0 early). */
  percent: number;
  percentLabel: string;
  elapsedDays: number;
  remainingDays: number;
  totalServiceDays: number;
  /** Whether the live, continuous percentage is meaningful right now. */
  live: boolean;
  next: HomeMilestone | null;
  reachedToday: string | null;
};

export type HomeLeave =
  | { kind: "BEFORE_SERVICE"; caption: string }
  | {
      kind: "NEEDS_CONFIRMATION";
      caption: string;
    }
  | {
      kind: "READY";
      remaining: string;
      caption: string;
      attendance: string | null;
    };

export type HomePay =
  | {
      kind: "TOTAL";
      amount: number;
      caption: string;
      band: string | null;
    }
  | {
      kind: "BASE_ONLY";
      amount: number;
      caption: string;
      band: string | null;
    }
  | { kind: "PENDING"; caption: string; band: string | null }
  | { kind: "NONE"; caption: string };

export type HomeAgendaItem = {
  event: ServiceEvent;
  daysUntil: number;
  isToday: boolean;
};

export type HomeModel = {
  hero: HomeHero;
  leave: HomeLeave;
  pay: HomePay;
  today: HomeAgendaItem[];
  upcoming: HomeAgendaItem[];
  completed: boolean;
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function formatShortDate(date: DateOnly) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return `${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))} (${WEEKDAYS[weekday]})`;
}

export function formatLongDate(date: DateOnly) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return `${date.slice(0, 4)}년 ${Number(date.slice(5, 7))}월 ${Number(
    date.slice(8, 10),
  )}일 (${WEEKDAYS[weekday]})`;
}

/** "오늘", "내일", "3일 후" — relative wording for a future date. */
export function relativeDays(days: number) {
  if (days === 0) return "오늘";
  if (days === 1) return "내일";
  if (days === 2) return "모레";
  return `${days.toLocaleString("ko-KR")}일 후`;
}

export function formatDdayNumber(days: number) {
  return days === 0 ? "D-Day" : `D-${days.toLocaleString("ko-KR")}`;
}

/** Floors so the display reaches 100.0 only when service is complete. */
export function floorPercent(elapsed: number, total: number) {
  if (total <= 0) return 100;
  return Math.floor((elapsed / total) * 1000) / 10;
}

const won = new Intl.NumberFormat("ko-KR");

export function formatWon(amount: number) {
  return `${won.format(amount)}원`;
}

function payBandMilestone(
  schedule: PayBandSchedule,
  today: DateOnly,
): HomeMilestone | null {
  if (schedule.status !== "READY" || !schedule.next) return null;
  const next = schedule.next;
  return {
    label: `${next.label} 급여 단계`,
    date: next.startDate,
    daysUntil: differenceInCalendarDays(next.startDate, today),
    detail:
      next.monthlyAmount !== null
        ? `월 기본 보수 ${formatWon(next.monthlyAmount)} (${next.amountRuleVersion}년 기준)`
        : `${next.startDate.slice(0, 4)}년 보수 기준이 확인되면 금액을 보여 드려요`,
    source: "PAY_BAND",
  };
}

function milestoneDetail(kind: ServiceMilestoneKind, value: number) {
  switch (kind) {
    case "DAYS_REMAINING":
      return value === 1 ? "내일이 소집해제일" : `남은 복무 ${value}일`;
    case "PERCENT":
      return value === 50 ? "복무 반환점" : `전체 복무의 ${value}% 지점`;
    case "SERVICE_DAY":
      return "소집일을 1일째로 세어요";
    case "SERVICE_YEAR":
      return "소집 1주년";
    case "DISCHARGE":
      return "복무 마지막 날";
    default:
      return null;
  }
}

function buildHero(
  profile: ServiceProfile,
  projection: AppProjection,
  schedule: PayBandSchedule,
  today: DateOnly,
): HomeHero {
  const { progress } = projection;
  const discharge = profile.expectedDischargeDate;
  const percent =
    progress.state === "COMPLETED"
      ? 100
      : floorPercent(progress.elapsedDays, progress.totalServiceDays);
  const base = {
    percent,
    percentLabel: `${percent.toFixed(1)}%`,
    elapsedDays: progress.elapsedDays,
    remainingDays: progress.remainingDays,
    totalServiceDays: progress.totalServiceDays,
  };

  const serviceNext = nextServiceMilestone(profile, today);
  const bandNext = payBandMilestone(schedule, today);
  const serviceCandidate: HomeMilestone | null = serviceNext
    ? {
        label: serviceNext.label,
        date: serviceNext.date,
        daysUntil: differenceInCalendarDays(serviceNext.date, today),
        detail: milestoneDetail(serviceNext.kind, serviceNext.value),
        source: "SERVICE",
      }
    : null;
  // The nearer of the two; on a tie the service milestone reads better.
  const next =
    serviceCandidate && bandNext
      ? compareDateOnly(bandNext.date, serviceCandidate.date) < 0
        ? bandNext
        : serviceCandidate
      : (serviceCandidate ?? bandNext);

  const reached = serviceMilestoneOn(profile, today);
  const bandToday =
    schedule.status === "READY" &&
    schedule.current &&
    schedule.current.startDate === today &&
    schedule.current.startDate !== profile.callUpDate
      ? `오늘부터 ${schedule.current.label} 급여 단계`
      : null;
  const reachedToday =
    reached && reached.kind !== "CALL_UP" && reached.kind !== "DISCHARGE"
      ? `오늘 ${reached.label} 달성`
      : bandToday;

  if (progress.state === "NOT_STARTED") {
    const untilCallUp = differenceInCalendarDays(profile.callUpDate, today);
    return {
      ...base,
      phase: "PRE_SERVICE",
      eyebrow: "소집까지",
      headline: formatDdayNumber(untilCallUp),
      headlineSpoken: `소집까지 ${untilCallUp}일`,
      dateLine: `${formatLongDate(profile.callUpDate)} 소집`,
      stateLabel: "소집 전",
      live: false,
      next: {
        label: `${formatLongDate(discharge)} 소집해제`,
        date: discharge,
        daysUntil: progress.dDay,
        detail: `복무 기간 ${progress.totalServiceDays.toLocaleString("ko-KR")}일`,
        source: "SERVICE",
      },
      reachedToday: null,
    };
  }

  if (progress.state === "COMPLETED") {
    const since = daysSinceDischarge(profile, today) ?? 0;
    if (since === 0) {
      return {
        ...base,
        phase: "DISCHARGE_DAY",
        eyebrow: "오늘 소집해제",
        headline: "D-Day",
        headlineSpoken: "오늘 소집해제일이에요",
        dateLine: `${formatLongDate(discharge)} 소집해제`,
        stateLabel: "소집해제일",
        live: false,
        next: null,
        reachedToday: "복무를 마쳤어요. 수고 많으셨어요.",
      };
    }
    return {
      ...base,
      phase: "COMPLETED",
      eyebrow: "수고 많으셨어요",
      headline: "복무 완료",
      headlineSpoken: `복무 완료, 소집해제 후 ${since}일 지났어요`,
      dateLine: `${formatLongDate(discharge)} 소집해제 · 오늘로 ${since.toLocaleString("ko-KR")}일째`,
      stateLabel: "복무 완료",
      live: false,
      next: null,
      reachedToday: null,
    };
  }

  const finalStretch = progress.dDay <= FINAL_STRETCH_DAYS;
  return {
    ...base,
    phase: finalStretch ? "FINAL_STRETCH" : "IN_SERVICE",
    eyebrow: "소집해제까지",
    headline: formatDdayNumber(progress.dDay),
    headlineSpoken: `소집해제까지 ${progress.dDay}일`,
    dateLine: `${formatLongDate(discharge)} 소집해제`,
    stateLabel:
      progress.dDay <= 7
        ? "마지막 주"
        : finalStretch
          ? "마지막 한 달"
          : "복무 중",
    live: true,
    next,
    reachedToday,
  };
}

function isNonZero(value: LeaveQuantity) {
  return value.halfDays !== 0 || value.minutes !== 0;
}

function buildLeave(projection: AppProjection): HomeLeave {
  const { ledger, progress } = projection;
  if (progress.state === "NOT_STARTED") {
    return {
      kind: "BEFORE_SERVICE",
      caption: "소집일에 1년차 연가가 부여돼요",
    };
  }
  const balance = ledger.balance;
  if (balance.status === "NEEDS_CREDIT_CONFIRMATION") {
    return {
      kind: "NEEDS_CONFIRMATION",
      caption: "기관에서 받은 부여 일수를 확인해 주세요",
    };
  }
  const attendanceTotal =
    ledger.attendanceMinutes.OUTING +
    ledger.attendanceMinutes.LATE_ARRIVAL +
    ledger.attendanceMinutes.EARLY_LEAVE;
  const scheduled = isNonZero(balance.scheduled)
    ? `예정 ${formatLeaveQuantity(balance.scheduled, ANNUAL_LEAVE_CUMULATIVE_MINUTES_PER_DAY)} 반영`
    : `사용 ${formatLeaveQuantity(balance.used, ANNUAL_LEAVE_CUMULATIVE_MINUTES_PER_DAY)}`;
  return {
    kind: "READY",
    remaining: formatLeaveQuantity(
      balance.remainingAfterScheduled,
      ANNUAL_LEAVE_CUMULATIVE_MINUTES_PER_DAY,
    ),
    caption: scheduled,
    attendance:
      attendanceTotal > 0
        ? `근태 누계 ${formatLeaveQuantity(
            { halfDays: 0, minutes: attendanceTotal },
            null,
          )}`
        : null,
  };
}

function buildPay(
  projection: AppProjection,
  schedule: PayBandSchedule,
): HomePay {
  const { compensation, progress } = projection;
  const band =
    schedule.status === "READY" && schedule.current
      ? schedule.current.label
      : compensation.equivalentRank;
  if (progress.state === "COMPLETED") {
    return { kind: "NONE", caption: "소집해제 후 달은 계산하지 않아요" };
  }
  if (progress.state === "NOT_STARTED") {
    return { kind: "NONE", caption: "소집 후 첫 달부터 계산해요" };
  }
  if (compensation.total !== null) {
    return {
      kind: "TOTAL",
      amount: compensation.total,
      caption: "기본 보수 + 중식비 + 교통비",
      band,
    };
  }
  const base = compensation.components.find((item) => item.key === "BASE_PAY");
  if (base?.status === "CALCULATED" && base.monthlyAmount !== null) {
    return {
      kind: "BASE_ONLY",
      amount: base.monthlyAmount,
      caption: "기본 보수 · 식비·교통비는 확인 후 더해요",
      band,
    };
  }
  return {
    kind: "PENDING",
    caption:
      base?.status === "NEEDS_INPUT"
        ? "내 정보에서 몇 가지만 알려 주세요"
        : "계산 조건을 확인해 주세요",
    band,
  };
}

function agendaItem(event: ServiceEvent, today: DateOnly): HomeAgendaItem {
  const days = differenceInCalendarDays(event.startDate, today);
  return { event, daysUntil: Math.max(0, days), isToday: days <= 0 };
}

export function buildHomeModel(
  profile: ServiceProfile,
  projection: AppProjection,
  today: DateOnly,
  options: { upcomingLimit?: number } = {},
): HomeModel {
  const schedule = derivePayBandSchedule(profile, today);
  const limit = options.upcomingLimit ?? 3;
  const horizon = addDays(today, 1);
  return {
    hero: buildHero(profile, projection, schedule, today),
    leave: buildLeave(projection),
    pay: buildPay(projection, schedule),
    today: projection.todayEvents.map((event) => agendaItem(event, today)),
    upcoming: projection.liveEvents
      .filter((event) => compareDateOnly(event.startDate, horizon) >= 0)
      .slice(0, limit)
      .map((event) => agendaItem(event, today)),
    completed: projection.progress.state === "COMPLETED",
  };
}
