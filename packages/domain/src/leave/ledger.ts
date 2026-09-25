import {
  ANNUAL_LEAVE_CUMULATIVE_MINUTES_PER_DAY,
  isAnnualLeaveAttendanceType,
} from "../events/annual-leave-classification";
import { findLeaveOverlaps } from "../events/validation";
import {
  ATTENDANCE_EVENT_TYPES,
  SERVICE_EVENT_TYPES,
  SERVICE_EVENT_TYPE_LABELS,
  isLive,
  type ServiceEvent,
  type ServiceEventType,
} from "../events/model";
import { compareDateOnly, type DateOnly } from "../service/date-only";
import type { LeaveAdjustment, LeaveSnapshot } from "./records";

/**
 * Annual-leave credit as supplied by the rules layer. The domain ledger does
 * not know policy; it only knows whether a credit is backed by a verified
 * rule bundle or still needs explicit user/institution confirmation.
 */
export type AnnualLeaveCreditInput = {
  key: string;
  label: string;
  grantDate: DateOnly;
  status: "RULE_VERIFIED" | "PENDING_CONFIRMATION";
  /** Whole days from the verified rule; null while pending. */
  days: number | null;
  /** Value from the currently effective rule, shown only as a reference. */
  referenceDays: number | null;
  ruleId: string | null;
  ruleVersion: string | null;
  explanation: string;
};

/**
 * A balance is two independent integers. Half-days are the smallest
 * rule-backed day unit (two half-day annual leaves equal one day). Minute
 * charges come from explicit partial-day records. Authorized late arrival,
 * early leave and outing minutes carry into annual leave at eight cumulative
 * hours per day; half-day approval remains a separate unit.
 */
export type LeaveQuantity = { halfDays: number; minutes: number };

export const ZERO_QUANTITY: LeaveQuantity = { halfDays: 0, minutes: 0 };

export function addQuantities(...values: LeaveQuantity[]): LeaveQuantity {
  return values.reduce(
    (sum, value) => ({
      halfDays: sum.halfDays + value.halfDays,
      minutes: sum.minutes + value.minutes,
    }),
    ZERO_QUANTITY,
  );
}

export function negateQuantity(value: LeaveQuantity): LeaveQuantity {
  return { halfDays: -value.halfDays, minutes: -value.minutes };
}

/** Total in minutes, or null when the workday length is unknown and needed. */
export function quantityToMinutes(
  value: LeaveQuantity,
  workdayMinutes: number | null,
): number | null {
  if (workdayMinutes === null) {
    return value.halfDays === 0 ? value.minutes : null;
  }
  return (value.halfDays * workdayMinutes) / 2 + value.minutes;
}

export function eventLeaveQuantity(event: ServiceEvent): LeaveQuantity | null {
  const timing = event.timing;
  if (timing.kind === "ALL_DAY") {
    return { halfDays: timing.dayCount * 2, minutes: 0 };
  }
  if (timing.kind === "HALF_DAY") return { halfDays: 1, minutes: 0 };
  if (timing.durationMinutes === null) return null;
  return { halfDays: 0, minutes: timing.durationMinutes };
}

export type CreditState = AnnualLeaveCreditInput & {
  /** Half-days actually counted in the balance (null = not counted). */
  countedHalfDays: number | null;
  confirmation: LeaveAdjustment | null;
  granted: boolean;
  state: "COUNTED" | "CONFIRMED_BY_USER" | "PENDING_CONFIRMATION" | "UPCOMING";
};

export type LedgerEntry = {
  date: DateOnly;
  kind: "CREDIT" | "USAGE" | "CORRECTION";
  label: string;
  delta: LeaveQuantity;
  running: LeaveQuantity;
  referenceId: string;
  scheduled: boolean;
};

export type BalanceStatus =
  "RESOLVED" | "NEEDS_CREDIT_CONFIRMATION" | "NEEDS_WORKDAY_MINUTES";

export type AnnualLeaveBalance = {
  asOf: DateOnly;
  granted: LeaveQuantity;
  upcomingCredits: LeaveQuantity;
  corrections: LeaveQuantity;
  used: LeaveQuantity;
  scheduled: LeaveQuantity;
  /** granted + corrections − used (records dated on/before `asOf`). */
  available: LeaveQuantity;
  /** available − scheduled future usage. */
  remainingAfterScheduled: LeaveQuantity;
  unresolvedEventIds: string[];
  pendingCreditKeys: string[];
  status: BalanceStatus;
};

export type ReconciliationResult =
  | { status: "NO_SNAPSHOT" }
  | {
      status: "NOT_COMPARABLE";
      snapshot: LeaveSnapshot;
      reason: string;
    }
  | {
      status: "MATCH" | "DIFFERENT";
      snapshot: LeaveSnapshot;
      comparedAt: DateOnly;
      institutionRemaining: LeaveQuantity;
      appRemaining: LeaveQuantity;
      /** institution − app; applying this as a correction reconciles. */
      difference: LeaveQuantity;
      assumptions: string[];
    };

export type TypeUsageSummary = {
  eventType: ServiceEventType;
  label: string;
  count: number;
  total: LeaveQuantity;
  unresolvedCount: number;
};

export type LeaveLedger = {
  credits: CreditState[];
  balance: AnnualLeaveBalance;
  entries: LedgerEntry[];
  byType: TypeUsageSummary[];
  attendanceMinutes: {
    OUTING: number;
    LATE_ARRIVAL: number;
    EARLY_LEAVE: number;
  };
  reconciliation: ReconciliationResult;
  workdayMinutes: number | null;
  assumptions: string[];
  warnings: string[];
};

export type LeaveLedgerInput = {
  credits: readonly AnnualLeaveCreditInput[];
  events: readonly ServiceEvent[];
  adjustments: readonly LeaveAdjustment[];
  snapshots: readonly LeaveSnapshot[];
  workdayMinutes: number | null;
  today: DateOnly;
};

function latestConfirmation(
  adjustments: readonly LeaveAdjustment[],
  key: string,
): LeaveAdjustment | null {
  return (
    adjustments
      .filter(
        (item) =>
          isLive(item) &&
          item.kind === "GRANT_CONFIRMATION" &&
          item.creditKey === key,
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
  );
}

function resolveCredits(
  input: Pick<LeaveLedgerInput, "credits" | "adjustments">,
  asOf: DateOnly,
): CreditState[] {
  return input.credits.map((credit) => {
    const confirmation = latestConfirmation(input.adjustments, credit.key);
    const granted = compareDateOnly(credit.grantDate, asOf) <= 0;
    const countedHalfDays = confirmation
      ? confirmation.amountHalfDays
      : credit.status === "RULE_VERIFIED" && credit.days !== null
        ? credit.days * 2
        : null;

    let state: CreditState["state"];
    if (!granted) state = "UPCOMING";
    else if (confirmation) state = "CONFIRMED_BY_USER";
    else if (countedHalfDays === null) state = "PENDING_CONFIRMATION";
    else state = "COUNTED";

    return { ...credit, countedHalfDays, confirmation, granted, state };
  });
}

function annualChargeEvents(events: readonly ServiceEvent[]) {
  return events
    .filter(
      (event) =>
        isLive(event) &&
        (event.eventType === "ANNUAL_LEAVE" ||
          isAnnualLeaveAttendanceType(event.eventType)),
    )
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

function normalizeAnnualMinuteCarry(value: LeaveQuantity): LeaveQuantity {
  if (value.minutes === 0) return value;
  const wholeDays = Math.trunc(
    value.minutes / ANNUAL_LEAVE_CUMULATIVE_MINUTES_PER_DAY,
  );
  if (wholeDays === 0) return value;
  return {
    halfDays: value.halfDays + wholeDays * 2,
    minutes:
      value.minutes -
      wholeDays * ANNUAL_LEAVE_CUMULATIVE_MINUTES_PER_DAY,
  };
}

function corrections(adjustments: readonly LeaveAdjustment[]) {
  return adjustments
    .filter((item) => isLive(item) && item.kind === "CORRECTION")
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
}

export function computeAnnualLeaveBalance(
  input: Omit<LeaveLedgerInput, "snapshots" | "today">,
  asOf: DateOnly,
): AnnualLeaveBalance {
  const credits = resolveCredits(input, asOf);
  let granted = ZERO_QUANTITY;
  let upcomingCredits = ZERO_QUANTITY;
  const pendingCreditKeys: string[] = [];

  for (const credit of credits) {
    if (credit.countedHalfDays === null) {
      if (credit.granted) pendingCreditKeys.push(credit.key);
      continue;
    }
    const amount = { halfDays: credit.countedHalfDays, minutes: 0 };
    if (credit.granted) granted = addQuantities(granted, amount);
    else upcomingCredits = addQuantities(upcomingCredits, amount);
  }

  let used = ZERO_QUANTITY;
  let scheduled = ZERO_QUANTITY;
  const unresolvedEventIds: string[] = [];
  for (const event of annualChargeEvents(input.events)) {
    const amount = eventLeaveQuantity(event);
    if (amount === null) {
      unresolvedEventIds.push(event.id);
      continue;
    }
    if (compareDateOnly(event.startDate, asOf) <= 0) {
      used = addQuantities(used, amount);
    } else {
      scheduled = addQuantities(scheduled, amount);
    }
  }

  used = normalizeAnnualMinuteCarry(used);
  scheduled = normalizeAnnualMinuteCarry(scheduled);

  const correctionTotal = corrections(input.adjustments)
    .filter((item) => compareDateOnly(item.effectiveDate, asOf) <= 0)
    .reduce(
      (sum, item) =>
        addQuantities(sum, {
          halfDays: item.amountHalfDays,
          minutes: item.amountMinutes,
        }),
      ZERO_QUANTITY,
    );

  const available = addQuantities(
    granted,
    correctionTotal,
    negateQuantity(used),
  );
  const remainingAfterScheduled = addQuantities(
    available,
    negateQuantity(scheduled),
  );

  let status: BalanceStatus = "RESOLVED";
  if (pendingCreditKeys.length) status = "NEEDS_CREDIT_CONFIRMATION";

  return {
    asOf,
    granted,
    upcomingCredits,
    corrections: correctionTotal,
    used,
    scheduled,
    available,
    remainingAfterScheduled,
    unresolvedEventIds,
    pendingCreditKeys,
    status,
  };
}

function snapshotQuantity(snapshot: LeaveSnapshot): LeaveQuantity | null {
  if (snapshot.remainingDays === null && snapshot.remainingMinutes === null) {
    return null;
  }
  const doubled = (snapshot.remainingDays ?? 0) * 2;
  if (!Number.isInteger(doubled)) return null;
  return { halfDays: doubled, minutes: snapshot.remainingMinutes ?? 0 };
}

export function reconcileWithInstitution(
  input: Omit<LeaveLedgerInput, "today">,
  today: DateOnly,
): ReconciliationResult {
  const snapshot =
    input.snapshots
      .filter((item) => isLive(item) && item.leaveType === "ANNUAL_LEAVE")
      .sort((a, b) =>
        (b.asOfDate ?? b.createdAt).localeCompare(a.asOfDate ?? a.createdAt),
      )[0] ?? null;

  if (!snapshot) return { status: "NO_SNAPSHOT" };

  const institutionRemaining = snapshotQuantity(snapshot);
  if (!institutionRemaining) {
    return {
      status: "NOT_COMPARABLE",
      snapshot,
      reason:
        snapshot.remainingDays === null && snapshot.remainingMinutes === null
          ? "기관 자료에 잔여량이 없어 비교할 수 없어요."
          : `기관 잔여 ${snapshot.remainingDays}일은 반일 단위가 아니어서 근무시간 가정 없이 비교할 수 없어요.`,
    };
  }

  const comparedAt = snapshot.asOfDate ?? today;
  const balance = computeAnnualLeaveBalance(input, comparedAt);
  if (balance.pendingCreditKeys.length) {
    return {
      status: "NOT_COMPARABLE",
      snapshot,
      reason: "확인되지 않은 연가 부여분이 있어 기관 잔여와 비교할 수 없어요.",
    };
  }

  const appRemaining = balance.available;
  let difference = addQuantities(
    institutionRemaining,
    negateQuantity(appRemaining),
  );
  const assumptions: string[] = [];
  if (snapshot.asOfDate === null) {
    assumptions.push(
      "기관 자료에 기준일이 없어 오늘 날짜 기준 잔여와 비교했어요.",
    );
  }

  const differenceMinutes = quantityToMinutes(
    difference,
    ANNUAL_LEAVE_CUMULATIVE_MINUTES_PER_DAY,
  );
  if (differenceMinutes === 0) difference = ZERO_QUANTITY;
  const matched =
    (difference.halfDays === 0 && difference.minutes === 0) ||
    differenceMinutes === 0;

  return {
    status: matched ? "MATCH" : "DIFFERENT",
    snapshot,
    comparedAt,
    institutionRemaining,
    appRemaining,
    difference,
    assumptions,
  };
}

function buildEntries(
  input: Omit<LeaveLedgerInput, "snapshots">,
  credits: CreditState[],
): LedgerEntry[] {
  type Pending = Omit<LedgerEntry, "running">;
  const rows: Pending[] = [];

  for (const credit of credits) {
    if (credit.countedHalfDays === null || !credit.granted) continue;
    rows.push({
      date: credit.grantDate,
      kind: "CREDIT",
      label: credit.confirmation ? `${credit.label} (직접 확인)` : credit.label,
      delta: { halfDays: credit.countedHalfDays, minutes: 0 },
      referenceId: credit.key,
      scheduled: false,
    });
  }

  for (const event of annualChargeEvents(input.events)) {
    const amount = eventLeaveQuantity(event);
    if (!amount) continue;
    rows.push({
      date: event.startDate,
      kind: "USAGE",
      label: isAnnualLeaveAttendanceType(event.eventType)
        ? `${SERVICE_EVENT_TYPE_LABELS[event.eventType]} (연가 누계)`
        : event.timing.kind === "HALF_DAY"
          ? "반가"
          : event.timing.kind === "PARTIAL"
            ? "시간 단위 연가"
            : "연가",
      delta: negateQuantity(amount),
      referenceId: event.id,
      scheduled: compareDateOnly(event.startDate, input.today) > 0,
    });
  }

  for (const item of corrections(input.adjustments)) {
    rows.push({
      date: item.effectiveDate,
      kind: "CORRECTION",
      label: `보정: ${item.reason}`,
      delta: { halfDays: item.amountHalfDays, minutes: item.amountMinutes },
      referenceId: item.id,
      scheduled: compareDateOnly(item.effectiveDate, input.today) > 0,
    });
  }

  const order = { CREDIT: 0, CORRECTION: 1, USAGE: 2 } as const;
  rows.sort(
    (a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind],
  );

  let running = ZERO_QUANTITY;
  return rows.map((row) => {
    running = normalizeAnnualMinuteCarry(addQuantities(running, row.delta));
    return { ...row, running };
  });
}

function summarizeTypes(events: readonly ServiceEvent[]): TypeUsageSummary[] {
  return SERVICE_EVENT_TYPES.map((eventType) => {
    const matching = events.filter(
      (event) => isLive(event) && event.eventType === eventType,
    );
    let total = ZERO_QUANTITY;
    let unresolvedCount = 0;
    for (const event of matching) {
      const amount = eventLeaveQuantity(event);
      if (amount) total = addQuantities(total, amount);
      else unresolvedCount += 1;
    }
    return {
      eventType,
      label: SERVICE_EVENT_TYPE_LABELS[eventType],
      count: matching.length,
      total,
      unresolvedCount,
    };
  });
}

/**
 * Derive the complete leave ledger from canonical records. Nothing here is
 * persisted: the ledger is always reconstructible from credits, events and
 * explicit adjustments.
 */
export function buildLeaveLedger(input: LeaveLedgerInput): LeaveLedger {
  const credits = resolveCredits(input, input.today);
  const balance = computeAnnualLeaveBalance(input, input.today);
  const byType = summarizeTypes(input.events);
  const attendance = { OUTING: 0, LATE_ARRIVAL: 0, EARLY_LEAVE: 0 };
  for (const type of ATTENDANCE_EVENT_TYPES) {
    const summary = byType.find((item) => item.eventType === type);
    if (summary) {
      attendance[type as keyof typeof attendance] = summary.total.minutes;
    }
  }

  const assumptions = [
    "연가 사용량은 캘린더 기록에서만 계산해요. 따로 입력한 사용량은 없어요.",
    "1년차 미사용 연가가 2년차로 이어진다고 보고 누적 잔여를 보여줘요. 이월 기준은 기관에 확인하세요.",
    "반가는 반일(0.5일) 승인 단위이며, 단순히 4시간이라고 반가로 바꾸지 않아요.",
    "질병·부상 외 지각·조퇴·외출은 구분 없이 누계 8시간을 연가 1일로 공제해요.",
  ];
  const warnings: string[] = [];

  if (balance.pendingCreditKeys.length) {
    warnings.push(
      "소집일 당시 적용 규칙이 검증되지 않은 연가 부여분이 있어요. 기관에서 받은 일수를 확인해야 잔여 연가를 계산할 수 있어요.",
    );
  }
  if (balance.unresolvedEventIds.length) {
    warnings.push(
      `사용 시간이 확인되지 않은 연가 기록 ${balance.unresolvedEventIds.length}건은 잔여 계산에서 뺐어요.`,
    );
  }
  // Records saved before overlap validation existed, or imported with
  // unresolved positions, are surfaced rather than silently summed.
  const overlaps = findLeaveOverlaps(input.events);
  if (overlaps.conflicts.length) {
    warnings.push(
      `같은 시간을 두 번 차감하는 휴가 기록이 ${overlaps.conflicts.length}쌍 있어요. 캘린더에서 하나를 수정하거나 삭제해 주세요.`,
    );
  }
  if (overlaps.unresolved.length) {
    warnings.push(
      `같은 날 시간이 겹치는지 확인할 수 없는 휴가 기록이 ${overlaps.unresolved.length}쌍 있어요. 시작·종료 시각을 넣으면 확인할 수 있어요.`,
    );
  }
  return {
    credits,
    balance,
    entries: buildEntries(input, credits),
    byType,
    attendanceMinutes: attendance,
    reconciliation: reconcileWithInstitution(input, input.today),
    workdayMinutes: input.workdayMinutes,
    assumptions,
    warnings,
  };
}
