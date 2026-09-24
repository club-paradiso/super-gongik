import {
  calculateServiceMonthIndex,
  calculateServiceProgress,
  isPartialServiceMonth,
  type DateOnly,
  type ServiceProfile,
} from "@super-gongik/domain";

import { COMPENSATION_RULE_BUNDLES } from "./bundles";
import type { RuleSourceReference } from "./calculation";
import {
  calculateMonthlyBasePay,
  calculateTransportAllowance,
  evaluateCompensationSafetyGate,
  evaluateMealAllowance,
} from "./compensation";
import { selectRuleByDate } from "./selector";

export type CompensationComponentStatus =
  "CALCULATED" | "SUGGESTED_ONLY" | "NEEDS_INPUT" | "GATED" | "UNSUPPORTED";

export type CompensationComponent = {
  key: "BASE_PAY" | "MEAL" | "TRANSPORT";
  label: string;
  status: CompensationComponentStatus;
  /** Monthly amount. Only ever non-null when status is CALCULATED. */
  monthlyAmount: number | null;
  /** Per-day rate shown for reference (e.g. suggested meal rate). */
  dailyRate: number | null;
  explanation: string;
};

export type MonthlyCompensationEvaluation = {
  status: "PARTIAL_ESTIMATE" | "GATED" | "NEEDS_PROFILE" | "UNSUPPORTED";
  asOfDate: DateOnly;
  serviceMonthIndex: number | null;
  equivalentRank: string | null;
  components: CompensationComponent[];
  /** Always null until every component can be calculated without guessing. */
  total: null;
  rule: {
    id: string;
    version: string;
    verifiedAt: string;
    sources: RuleSourceReference[];
  } | null;
  headline: string;
  assumptions: string[];
  warnings: string[];
};

const RANK_LABELS: Record<string, string> = {
  PRIVATE_SECOND_CLASS: "이병 상당",
  PRIVATE_FIRST_CLASS: "일병 상당",
  CORPORAL: "상병 상당",
  SERGEANT: "병장 상당",
};

function unsupported(
  asOfDate: DateOnly,
  headline: string,
  status: MonthlyCompensationEvaluation["status"] = "UNSUPPORTED",
): MonthlyCompensationEvaluation {
  return {
    status,
    asOfDate,
    serviceMonthIndex: null,
    equivalentRank: null,
    components: [],
    total: null,
    rule: null,
    headline,
    assumptions: [],
    warnings: [],
  };
}

/**
 * Explainable monthly compensation view for the month containing `asOfDate`.
 *
 * Only verified, context-complete components produce numbers. Meal and
 * transport need the number of eligible service days, which the app does not
 * yet derive, so the monthly total is deliberately never calculated.
 */
export function evaluateMonthlyCompensation(
  profile: ServiceProfile,
  asOfDate: DateOnly,
): MonthlyCompensationEvaluation {
  const calendarYear = Number(asOfDate.slice(0, 4));
  const selection = selectRuleByDate(
    "COMPENSATION",
    COMPENSATION_RULE_BUNDLES,
    `${calendarYear}-01-01` as DateOnly,
  );
  if (selection.status !== "SUPPORTED") {
    return unsupported(
      asOfDate,
      `${calendarYear}년 보수 규칙이 아직 검증되지 않아 계산하지 않아요.`,
    );
  }

  const bundle = selection.rule;
  const rule = {
    id: bundle.ruleId,
    version: bundle.version,
    verifiedAt: bundle.verifiedAt,
    sources: bundle.sources.map((source) => ({
      title: source.title,
      authority: source.authority,
      url: source.url,
    })),
  };

  const progress = calculateServiceProgress(profile, asOfDate);
  if (progress.state === "NOT_STARTED") {
    return {
      ...unsupported(asOfDate, "소집일 이후부터 보수를 보여드려요."),
      rule,
    };
  }
  if (progress.state === "COMPLETED") {
    return {
      ...unsupported(asOfDate, "복무를 마친 뒤의 보수는 계산하지 않아요."),
      rule,
    };
  }

  const serviceMonthIndex = calculateServiceMonthIndex(
    profile.callUpDate,
    asOfDate,
  );
  const assumptions: string[] = [];
  const warnings: string[] = [];

  let base: CompensationComponent;
  let equivalentRank: string | null = null;
  let status: MonthlyCompensationEvaluation["status"] = "PARTIAL_ESTIMATE";
  let headline =
    "확인된 기본 보수만 계산했어요. 중식비·교통비는 조건을 확인해야 해요.";

  const gate = evaluateCompensationSafetyGate({
    calendarYear,
    partialMonth: isPartialServiceMonth(profile, asOfDate),
    hasPriorServiceCreditCase:
      profile.priorServiceCredit === "HAS_PRIOR_SERVICE",
  });

  if (profile.priorServiceCredit === null) {
    status = "NEEDS_PROFILE";
    headline = "이전 복무 경력 여부를 알려 주시면 기본 보수를 보여드려요.";
    base = {
      key: "BASE_PAY",
      label: "기본 보수",
      status: "NEEDS_INPUT",
      monthlyAmount: null,
      dailyRate: null,
      explanation:
        "이전 복무 경력이 있으면 보수 등급이 달라질 수 있어(병역법 시행령 제62조제2항) 확인 전에는 계산하지 않아요.",
    };
  } else if (gate.status !== "SUPPORTED") {
    status = "GATED";
    headline =
      gate.status === "UNSUPPORTED_PENDING_PRIOR_SERVICE_PROFILE_MODEL"
        ? "이전 복무 경력 인정 계산은 아직 검증 중이라 기본 보수를 계산하지 않아요."
        : "소집 첫 달과 마지막 달은 일할 계산 기준을 검증한 뒤 제공해요.";
    base = {
      key: "BASE_PAY",
      label: "기본 보수",
      status: "GATED",
      monthlyAmount: null,
      dailyRate: null,
      explanation: gate.warnings[0] ?? headline,
    };
    warnings.push(...gate.warnings);
  } else {
    const pay = calculateMonthlyBasePay({ calendarYear, serviceMonthIndex });
    equivalentRank =
      RANK_LABELS[String(pay.breakdown.equivalentRank)] ??
      String(pay.breakdown.equivalentRank);
    base = {
      key: "BASE_PAY",
      label: "기본 보수",
      status: "CALCULATED",
      monthlyAmount: pay.value?.monthlyBasePay ?? null,
      dailyRate: null,
      explanation: `복무 ${serviceMonthIndex + 1}개월 차(${equivalentRank}) ${calendarYear}년 군인 봉급표 기준이에요.`,
    };
    assumptions.push("이전 복무 경력이 없다고 확인한 프로필 기준이에요.");
  }

  const meal = evaluateMealAllowance({
    calendarYear,
    mealRateConfirmedByProfile: false,
  });
  const suggested = meal.breakdown.suggestedDailyMealRate;
  const mealComponent: CompensationComponent = {
    key: "MEAL",
    label: "중식비",
    status: "SUGGESTED_ONLY",
    monthlyAmount: null,
    dailyRate: typeof suggested === "number" ? suggested : null,
    explanation: `${calendarYear}년 제안값이에요. 병무청 지급기준 첨부 원문을 직접 확인하기 전이라 합계에 넣지 않아요. 실제 지급은 출근일 기준이에요.`,
  };
  warnings.push(...meal.warnings);

  const transport = calculateTransportAllowance({
    calendarYear,
    commuteFareOrInstitutionApprovedTransportRate: profile.defaultCommuteCost,
    eligibleServiceDays: 0,
  });
  const transportComponent: CompensationComponent =
    transport.status === "SUPPORTED"
      ? {
          key: "TRANSPORT",
          label: "교통비",
          status: "NEEDS_INPUT",
          monthlyAmount: null,
          dailyRate: profile.defaultCommuteCost,
          explanation:
            "입력한 1일 통근비에 실제 출근일 수를 곱해 지급돼요. 출근일 수 계산은 아직 제공하지 않아요.",
        }
      : {
          key: "TRANSPORT",
          label: "교통비",
          status: "NEEDS_INPUT",
          monthlyAmount: null,
          dailyRate: null,
          explanation:
            "통근 운임이나 기관 승인 금액이 있어야 해요. 전국 공통 금액으로 추정하지 않아요.",
        };

  return {
    status,
    asOfDate,
    serviceMonthIndex,
    equivalentRank,
    components: [base, mealComponent, transportComponent],
    total: null,
    rule,
    headline,
    assumptions,
    warnings,
  };
}
