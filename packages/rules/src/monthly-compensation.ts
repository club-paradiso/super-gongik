import {
  calculateServiceMonthIndex,
  calculateServiceProgress,
  daysInMonth,
  differenceInCalendarDays,
  isLive,
  isPartialServiceMonth,
  yearMonthOf,
  type AttendanceMonth,
  type CompensationRoundingPolicy,
  type DateOnly,
  type ServiceEvent,
  type ServiceProfile,
  type YearMonth,
} from "@super-gongik/domain";

import {
  COMPENSATION_RULE_BUNDLES,
  type CompensationRuleBundle,
} from "./bundles";
import type { RuleSourceReference } from "./calculation";
import {
  calculateMealAllowance,
  calculateMonthlyBasePay,
  calculateTransportAllowance,
} from "./compensation";
import { selectRuleByDate } from "./selector";
import {
  deriveMonthServiceDays,
  sickLeaveDaysUpperBound,
  type MonthServiceDays,
} from "./service-days";

export type CompensationComponentStatus =
  "CALCULATED" | "NEEDS_INPUT" | "GATED" | "UNSUPPORTED";

export type CompensationComponent = {
  key: "BASE_PAY" | "MEAL" | "TRANSPORT";
  label: string;
  status: CompensationComponentStatus;
  /** Monthly amount. Only ever non-null when status is CALCULATED. */
  monthlyAmount: number | null;
  /** Per-day rate used (meal/transport), always a user/institution input. */
  dailyRate: number | null;
  /** Days multiplied by `dailyRate`; null until the day count is settled. */
  eligibleDays: number | null;
  /**
   * Where `dailyRate` came from, so a user-entered amount can never be read
   * as an official one: OFFICIAL_MINIMUM (the MMA 2026 standard) or
   * USER_INPUT (institution amount / personal fare). null when no rate.
   */
  rateSource: "OFFICIAL_MINIMUM" | "USER_INPUT" | null;
  /** Primary-source basis of the rule applied. */
  basis: string;
  explanation: string;
};

export type BasePayAdjustment = {
  roundingPolicy: CompensationRoundingPolicy | null;
  nonPayableDates: DateOnly[];
  nonPayableDatesConfirmed: boolean;
  calendarDaysInMonth: number;
  serviceCalendarDays: number | null;
  payableCalendarDays: number | null;
  rawProratedAmount: number | null;
  roundedAmount: number | null;
};

export type MonthlyCompensationEvaluation = {
  /**
   * COMPLETE: every component calculated and a total exists.
   * PARTIAL: at least one component is not calculable; no total.
   * UNSUPPORTED: no verified rule or outside the service period.
   */
  status: "COMPLETE" | "PARTIAL" | "UNSUPPORTED";
  month: YearMonth;
  asOfDate: DateOnly;
  /** Service-month ordinal incl. confirmed prior-service credit; 1 = call-up month. */
  serviceMonthOrdinal: number | null;
  equivalentRank: string | null;
  components: CompensationComponent[];
  /** Sum of all components, only when every component is CALCULATED. */
  total: number | null;
  serviceDays: MonthServiceDays | null;
  basePayAdjustment: BasePayAdjustment | null;
  rule: {
    id: string;
    version: string;
    effectiveFrom: string;
    effectiveUntil: string | null;
    verifiedAt: string;
    /** Each source with the SHA-256 of the stored file it was read from. */
    sources: Array<RuleSourceReference & { sha256: string | null }>;
  } | null;
  headline: string;
  /** Plain statements of what cannot be calculated yet and why. */
  unresolved: string[];
  assumptions: string[];
  warnings: string[];
};

const RANK_LABELS: Record<string, string> = {
  PRIVATE_SECOND_CLASS: "이병 상당",
  PRIVATE_FIRST_CLASS: "일병 상당",
  CORPORAL: "상병 상당",
  SERGEANT: "병장 상당",
};

const DAY_MISSING_LABELS: Record<string, string> = {
  WORK_PATTERN: "복무형태(주간 출퇴근 여부)",
  WORK_WEEKDAYS: "근무 요일",
  MONTH_CONFIRMATION: "이 달 공휴일·휴무일 확인",
  MONTH_RECONFIRMATION: "기록 변경 뒤 이 달 다시 확인",
  DAY_DECISIONS: "출근 여부를 정해야 하는 날",
};

function unsupported(
  month: YearMonth,
  asOfDate: DateOnly,
  headline: string,
): MonthlyCompensationEvaluation {
  return {
    status: "UNSUPPORTED",
    month,
    asOfDate,
    serviceMonthOrdinal: null,
    equivalentRank: null,
    components: [],
    total: null,
    serviceDays: null,
    basePayAdjustment: null,
    rule: null,
    headline,
    unresolved: [headline],
    assumptions: [],
    warnings: [],
  };
}

function monthBounds(month: YearMonth) {
  return {
    first: `${month}-01` as DateOnly,
    last: `${month}-${String(daysInMonth(month)).padStart(2, "0")}` as DateOnly,
  };
}

function supportsTenWonTruncation(
  policy: CompensationRoundingPolicy | null,
): boolean {
  return (
    policy === "NATIONAL_TREASURY_ARTICLE_47" ||
    policy === "INSTITUTION_CONFIRMED_TRUNCATE_SUB_10"
  );
}

function truncateSubTenWon(amount: number): number {
  return Math.floor(amount / 10) * 10;
}

/**
 * Explainable compensation for the calendar month containing `asOfDate`.
 *
 * A component produces a number only from a verified rule, the applicable
 * date and explicit user inputs. The total exists only when all three
 * components do; partial sums are never shown.
 */
export function evaluateMonthlyCompensation(
  profile: ServiceProfile,
  asOfDate: DateOnly,
  options: {
    bundles?: readonly CompensationRuleBundle[];
    events?: readonly ServiceEvent[];
    attendance?: AttendanceMonth | null;
  } = {},
): MonthlyCompensationEvaluation {
  const month = yearMonthOf(asOfDate);
  const bundles = options.bundles ?? COMPENSATION_RULE_BUNDLES;
  const events = options.events ?? [];
  const { first, last } = monthBounds(month);

  // Select by the evaluated date itself so a mid-year amendment applies from
  // its own effective date, and refuse a month the rule changes within.
  const selection = selectRuleByDate("COMPENSATION", bundles, asOfDate);
  if (selection.status !== "SUPPORTED") {
    return unsupported(
      month,
      asOfDate,
      `${asOfDate}에 적용되는 검증된 보수 규칙이 없어 계산하지 않아요.`,
    );
  }
  const bundle = selection.rule;
  for (const edge of [first, last]) {
    const other = selectRuleByDate("COMPENSATION", bundles, edge);
    if (other.status !== "SUPPORTED" || other.rule.version !== bundle.version) {
      return unsupported(
        month,
        asOfDate,
        `${month} 안에서 적용 규칙이 달라져 이 달은 계산하지 않아요.`,
      );
    }
  }
  const ruleInput = { calculationDate: asOfDate, bundles };
  const rule = {
    id: bundle.ruleId,
    version: bundle.version,
    effectiveFrom: bundle.effectiveFrom,
    effectiveUntil: bundle.effectiveUntil,
    verifiedAt: bundle.verifiedAt,
    sources: bundle.sources.map((source) => ({
      title: source.title,
      authority: source.authority,
      url: source.url,
      sha256:
        typeof source.artifactSha256 === "string"
          ? source.artifactSha256
          : typeof source.excerptSha256 === "string"
            ? source.excerptSha256
            : null,
    })),
  };

  const progress = calculateServiceProgress(profile, last);
  if (progress.state === "NOT_STARTED") {
    return {
      ...unsupported(month, asOfDate, "소집 전 달의 보수는 계산하지 않아요."),
      rule,
    };
  }
  if (profile.expectedDischargeDate < first) {
    return {
      ...unsupported(
        month,
        asOfDate,
        "소집해제 이후 달의 보수는 계산하지 않아요.",
      ),
      rule,
    };
  }

  const unresolved: string[] = [];
  const assumptions: string[] = [];
  const warnings: string[] = [];
  const callUpMonthOrdinal =
    calculateServiceMonthIndex(
      profile.callUpDate,
      profile.callUpDate > first ? profile.callUpDate : first,
    ) + 1;

  // ── Base pay ─────────────────────────────────────────────────────────────
  const baseBasis =
    "병역법 시행령 제62조①·②, 공무원보수규정 별표 13, 사회복무요원 복무관리 규정 제41조①·⑤·⑥, 국고금 관리법 제47조(해당 지급기관에 적용되는 경우), 병무청 2026년도 사회복무요원 보수 등 지급 기준";
  let base: CompensationComponent;
  let serviceMonthOrdinal: number | null = null;
  let equivalentRank: string | null = null;
  const baseComponent = (
    status: CompensationComponentStatus,
    explanation: string,
    monthlyAmount: number | null = null,
  ): CompensationComponent => ({
    key: "BASE_PAY",
    label: "기본 보수",
    status,
    monthlyAmount,
    dailyRate: null,
    eligibleDays: null,
    rateSource: null,
    basis: baseBasis,
    explanation,
  });

  let credit: number | null = 0;
  let creditIssue: {
    status: CompensationComponentStatus;
    text: string;
  } | null = null;
  if (profile.priorServiceCredit === null) {
    credit = null;
    creditIssue = {
      status: "NEEDS_INPUT",
      text: "이전 복무 경력(병역법 시행령 제62조제2항) 여부를 알려 주셔야 보수 등급을 정할 수 있어요.",
    };
  } else if (profile.priorServiceCredit === "HAS_PRIOR_SERVICE") {
    if (profile.priorServiceCreditHasPartialMonth) {
      credit = null;
      creditIssue = {
        status: "GATED",
        text: "인정 기간이 개월 단위로 떨어지지 않으면 보수 구간 합산 방법이 원문에 없어 계산하지 않아요.",
      };
    } else if (
      profile.priorServiceBasis === null ||
      profile.priorServiceCreditedMonths === null
    ) {
      credit = null;
      creditIssue = {
        status: "NEEDS_INPUT",
        text: "제62조제2항의 해당 호와 복무기관이 확인한 인정 개월 수를 입력해야 해요.",
      };
    } else {
      credit = profile.priorServiceCreditedMonths;
    }
  }

  const sickUpperBound = sickLeaveDaysUpperBound(events, last);
  const sickLimit =
    bundle.proration.nonPayableDays.sickLeaveCumulativeLimitDays;
  const partialMonth = isPartialServiceMonth(profile, asOfDate);
  const attendance = options.attendance ?? null;
  const exactDatesConfirmed = attendance?.nonPayableDatesConfirmed === true;
  const exactNonPayableDates = exactDatesConfirmed
    ? attendance.nonPayableDates
    : [];
  const hasUnresolvedNonPayableSignal =
    attendance?.hadNonPayableAbsence === true && !exactDatesConfirmed;
  const sickLeaveNeedsExactDates =
    sickUpperBound > sickLimit && !exactDatesConfirmed;
  const roundingPolicy = attendance?.roundingPolicy ?? null;
  const needsAdjustedBasePay = partialMonth || exactNonPayableDates.length > 0;
  let basePayAdjustment: BasePayAdjustment | null = null;

  if (creditIssue) {
    base = baseComponent(creditIssue.status, creditIssue.text);
    unresolved.push(creditIssue.text);
  } else {
    serviceMonthOrdinal = callUpMonthOrdinal + (credit ?? 0);
    const pay = calculateMonthlyBasePay({ ...ruleInput, serviceMonthOrdinal });
    const monthlyBasePay = pay.value?.monthlyBasePay ?? null;
    equivalentRank =
      RANK_LABELS[String(pay.breakdown.equivalentRank)] ??
      String(pay.breakdown.equivalentRank);
    const creditText = credit ? ` + 인정 기간 ${credit}개월` : "";

    const serviceStart =
      profile.callUpDate > first ? profile.callUpDate : first;
    const serviceEnd =
      profile.expectedDischargeDate < last
        ? profile.expectedDischargeDate
        : last;
    const serviceCalendarDays =
      differenceInCalendarDays(serviceEnd, serviceStart) + 1;
    const relevantNonPayableDates = exactNonPayableDates.filter(
      (date) => date >= serviceStart && date <= serviceEnd,
    );
    const payableCalendarDays =
      serviceCalendarDays - relevantNonPayableDates.length;

    basePayAdjustment = {
      roundingPolicy,
      nonPayableDates: relevantNonPayableDates,
      nonPayableDatesConfirmed: exactDatesConfirmed,
      calendarDaysInMonth: daysInMonth(month),
      serviceCalendarDays,
      payableCalendarDays,
      rawProratedAmount: null,
      roundedAmount: null,
    };

    if (hasUnresolvedNonPayableSignal || sickLeaveNeedsExactDates) {
      const text = sickLeaveNeedsExactDates
        ? `병가 기록이 통산 ${sickLimit}일을 넘을 수 있어요(최대 ${sickUpperBound}일). 공무상 여부와 실제 미지급 날짜를 전부 확인해야 기본 보수를 계산할 수 있어요.`
        : "이 달에 미지급 사유가 있었다는 기존 기록은 있지만 정확한 날짜가 없어요. 기본 보수 미지급 날짜를 모두 확인해야 계산할 수 있어요.";
      base = baseComponent("GATED", text);
      unresolved.push(text);
    } else if (
      needsAdjustedBasePay &&
      !supportsTenWonTruncation(roundingPolicy)
    ) {
      const prorationStructure = `월 보수 ÷ 그 달 일수(${daysInMonth(month)}일) × 지급대상 달력일수(휴일도 포함)`;
      const text =
        roundingPolicy === "INSTITUTION_OTHER_OR_UNKNOWN"
          ? `${prorationStructure} 구조까지는 확인됐지만, 지급기관이 국고금 관리법 제47조의 10원 미만 절사와 다른 회계 기준을 쓴다고 확인됐어요. 그 기관의 정확한 끝수 처리 기준을 지원하기 전에는 최종 기본 보수를 계산하지 않아요.`
          : `${prorationStructure} 구조까지는 확인됐어요. 소집·소집해제 달 또는 미지급일이 있는 달은 지급기관의 끝수 처리 기준도 확인해야 하므로, 국고금 관리법 제47조 적용 또는 기관의 10원 미만 절사 적용이 명시적으로 확인된 경우에만 자동 계산해요.`;
      base = baseComponent("GATED", text);
      unresolved.push(text);
    } else if (needsAdjustedBasePay && monthlyBasePay !== null) {
      const raw = (monthlyBasePay / daysInMonth(month)) * payableCalendarDays;
      const rounded = truncateSubTenWon(raw);
      basePayAdjustment = {
        ...basePayAdjustment,
        rawProratedAmount: raw,
        roundedAmount: rounded,
      };
      const policyText =
        roundingPolicy === "NATIONAL_TREASURY_ARTICLE_47"
          ? "국고금 관리법 제47조(10원 미만 끝수 미계산)"
          : "복무기관이 확인한 10원 미만 절사 기준";
      const nonPayableText = relevantNonPayableDates.length
        ? ` · 미지급 ${relevantNonPayableDates.length}일 제외`
        : "";
      base = baseComponent(
        "CALCULATED",
        `${bundle.version}년 월 보수 ${monthlyBasePay.toLocaleString("ko-KR")}원 ÷ ${daysInMonth(month)}일 × 지급대상 ${payableCalendarDays}일${nonPayableText} → ${policyText} 적용 금액이에요.`,
        rounded,
      );
      assumptions.push(
        `기본 보수 끝수 처리: ${policyText}. 적용 정책은 사용자가 확인한 지급기관 정보예요.`,
      );
      if (relevantNonPayableDates.length) {
        assumptions.push(
          `기본 보수 미지급 날짜: ${relevantNonPayableDates.join(", ")}.`,
        );
      }
    } else {
      base = baseComponent(
        "CALCULATED",
        `소집월을 1개월 차로 세어 복무 ${callUpMonthOrdinal}개월 차${creditText} = ${serviceMonthOrdinal}개월 차(${equivalentRank}), ${bundle.version}년 군인 봉급표 금액이에요.`,
        monthlyBasePay,
      );
      if (!attendance) {
        assumptions.push(
          "복무중단·복무이탈·연가 초과 결근이 없는 달로 보고 기본 보수를 계산했어요.",
        );
      }
    }

    if (credit) {
      assumptions.push(
        `이전 복무 인정 기간 ${credit}개월은 입력한 기관 확인 값이에요.`,
      );
    }
  }

  // ── Eligible service days ────────────────────────────────────────────────
  const serviceDays = deriveMonthServiceDays({
    profile,
    month,
    events,
    attendance: options.attendance ?? null,
  });
  const dayProblem =
    serviceDays.status === "READY"
      ? null
      : serviceDays.status === "UNSUPPORTED"
        ? serviceDays.explanation
        : `${serviceDays.explanation} (필요: ${serviceDays.missing.map((code) => DAY_MISSING_LABELS[code] ?? code).join(", ")})`;
  if (dayProblem) unresolved.push(`중식비·교통비: ${dayProblem}`);

  // ── Meal ─────────────────────────────────────────────────────────────────
  const institutionMealRate = profile.defaultMealAllowanceOverride;
  const meal = calculateMealAllowance({
    ...ruleInput,
    institutionDailyMealRate: institutionMealRate,
    mealEligibleDays: serviceDays.mealEligibleDays ?? 0,
  });
  const mealMinimum = bundle.meal.minimumDailyAmount;
  const mealRate = meal.value?.dailyMealRate ?? null;
  const mealRateSource =
    meal.status !== "SUPPORTED"
      ? null
      : institutionMealRate === null
        ? ("OFFICIAL_MINIMUM" as const)
        : ("USER_INPUT" as const);
  const mealBase = {
    key: "MEAL" as const,
    label: "중식비",
    basis: bundle.meal.legalBasis,
  };
  let mealComponent: CompensationComponent;
  if (serviceDays.status === "UNSUPPORTED") {
    mealComponent = {
      ...mealBase,
      status: "UNSUPPORTED",
      monthlyAmount: null,
      dailyRate: mealRate,
      rateSource: mealRateSource,
      eligibleDays: null,
      explanation: serviceDays.explanation,
    };
  } else if (meal.status !== "SUPPORTED") {
    const text = `입력한 기관 중식비가 병무청 ${bundle.version}년 최소기준 ${mealMinimum.toLocaleString("ko-KR")}원보다 낮아요. 기관 금액을 다시 확인하거나 비워 두세요.`;
    mealComponent = {
      ...mealBase,
      status: "NEEDS_INPUT",
      monthlyAmount: null,
      dailyRate: null,
      rateSource: null,
      eligibleDays: serviceDays.mealEligibleDays,
      explanation: text,
    };
    unresolved.push(`중식비: ${text}`);
  } else if (serviceDays.status !== "READY") {
    mealComponent = {
      ...mealBase,
      status: "NEEDS_INPUT",
      monthlyAmount: null,
      dailyRate: mealRate,
      rateSource: mealRateSource,
      eligibleDays: null,
      explanation: serviceDays.explanation,
    };
  } else {
    const rateText =
      mealRateSource === "OFFICIAL_MINIMUM"
        ? `병무청 ${bundle.version}년 최소기준 1일 ${mealMinimum.toLocaleString("ko-KR")}원`
        : `기관 입력 1일 ${mealRate?.toLocaleString("ko-KR")}원`;
    mealComponent = {
      ...mealBase,
      status: "CALCULATED",
      monthlyAmount: meal.value?.mealAllowance ?? null,
      dailyRate: mealRate,
      rateSource: mealRateSource,
      eligibleDays: serviceDays.mealEligibleDays,
      explanation: `${rateText} × 중식비 대상 ${serviceDays.mealEligibleDays}일이에요.`,
    };
    assumptions.push(...meal.assumptions);
  }

  // ── Transport ────────────────────────────────────────────────────────────
  const fare = profile.defaultCommuteCost;
  const transport = calculateTransportAllowance({
    ...ruleInput,
    dailyPublicTransitFare: fare,
    transportEligibleDays: serviceDays.transportEligibleDays ?? 0,
  });
  let transportComponent: CompensationComponent;
  if (serviceDays.status === "UNSUPPORTED") {
    transportComponent = {
      key: "TRANSPORT",
      label: "교통비",
      status: "UNSUPPORTED",
      monthlyAmount: null,
      dailyRate: fare,
      eligibleDays: null,
      rateSource: fare === null ? null : ("USER_INPUT" as const),
      basis: bundle.transport.legalBasis,
      explanation: serviceDays.explanation,
    };
  } else if (transport.status !== "SUPPORTED") {
    const text =
      "1일 교통비를 입력해야 해요. 병무청 기준은 시내버스 왕복 현금요금(환승·지하철 장거리 등 추가비용은 교통카드 실비)이라 경로마다 달라요. 도보 출퇴근도 같은 기준이에요.";
    transportComponent = {
      key: "TRANSPORT",
      label: "교통비",
      status: "NEEDS_INPUT",
      monthlyAmount: null,
      dailyRate: null,
      eligibleDays: serviceDays.transportEligibleDays,
      rateSource: null,
      basis: bundle.transport.legalBasis,
      explanation: text,
    };
    unresolved.push(`교통비: ${text}`);
  } else if (serviceDays.status !== "READY") {
    transportComponent = {
      key: "TRANSPORT",
      label: "교통비",
      status: "NEEDS_INPUT",
      monthlyAmount: null,
      dailyRate: fare,
      eligibleDays: null,
      rateSource: fare === null ? null : ("USER_INPUT" as const),
      basis: bundle.transport.legalBasis,
      explanation: serviceDays.explanation,
    };
  } else {
    transportComponent = {
      key: "TRANSPORT",
      label: "교통비",
      status: "CALCULATED",
      monthlyAmount: transport.value?.transportAllowance ?? null,
      dailyRate: fare,
      eligibleDays: serviceDays.transportEligibleDays,
      rateSource: fare === null ? null : ("USER_INPUT" as const),
      basis: bundle.transport.legalBasis,
      explanation: `사용자 입력 1일 ${fare?.toLocaleString("ko-KR")}원 × 교통비 대상 ${serviceDays.transportEligibleDays}일이에요.`,
    };
    assumptions.push(...transport.assumptions);
  }

  const components = [base, mealComponent, transportComponent];
  const complete = components.every(
    (component) =>
      component.status === "CALCULATED" && component.monthlyAmount !== null,
  );
  const total = complete
    ? components.reduce(
        (sum, component) => sum + (component.monthlyAmount ?? 0),
        0,
      )
    : null;
  if (complete) {
    assumptions.push(
      "합계는 기본 보수·중식비·교통비만 더한 값이에요. 출장 여비와 공제는 들어가지 않아요.",
    );
  }

  return {
    status: complete ? "COMPLETE" : "PARTIAL",
    month,
    asOfDate,
    serviceMonthOrdinal,
    equivalentRank,
    components,
    total,
    serviceDays,
    basePayAdjustment,
    rule,
    headline: complete
      ? `${month} 지급 기준 합계를 모든 항목이 확인된 상태로 계산했어요.`
      : "확인된 항목만 금액을 보여요. 나머지는 아래 조건이 채워져야 계산해요.",
    unresolved,
    assumptions,
    warnings,
  };
}

/** Live attendance confirmation for a month, if the user saved one. */
export function findAttendanceMonth(
  records: readonly AttendanceMonth[],
  month: YearMonth,
): AttendanceMonth | null {
  return records.find((item) => isLive(item) && item.month === month) ?? null;
}