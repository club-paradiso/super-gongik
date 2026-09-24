import {
  calculateServiceMonthIndex,
  calculateServiceProgress,
  isPartialServiceMonth,
  type DateOnly,
  type ServiceProfile,
} from "@super-gongik/domain";
import {
  calculateAnnualLeaveAllocation,
  calculateMonthlyBasePay,
  calculateTransportAllowance,
  evaluateCompensationSafetyGate,
  evaluateMealAllowance,
} from "@super-gongik/rules";

export type CompensationPreview = {
  status: "READY_FOR_CONTEXT" | "GATED" | "UNSUPPORTED";
  basePay: number | null;
  suggestedMealRate: number | null;
  transportConfigured: boolean;
  message: string;
  ruleVersion: string | null;
};

export function getDashboardProjection(
  profile: ServiceProfile,
  today: DateOnly,
) {
  const progress = calculateServiceProgress(profile, today);
  const annualLeave = calculateAnnualLeaveAllocation(21, today).value;

  return {
    progress,
    annualLeaveDays: annualLeave?.ordinaryTotalDays ?? null,
    compensation: getCompensationPreview(profile, today),
  };
}

export function getCompensationPreview(
  profile: ServiceProfile,
  today: DateOnly,
): CompensationPreview {
  const calendarYear = Number(today.slice(0, 4));

  try {
    const gate = evaluateCompensationSafetyGate({
      calendarYear,
      partialMonth: isPartialServiceMonth(profile, today),
    });

    if (gate.status !== "SUPPORTED") {
      return {
        status: "GATED",
        basePay: null,
        suggestedMealRate: null,
        transportConfigured: profile.defaultCommuteCost !== null,
        message:
          "첫 달과 마지막 달 계산 기준을 확인한 뒤 예상 보수를 제공할게요.",
        ruleVersion: gate.ruleVersion,
      };
    }

    const serviceMonthIndex = calculateServiceMonthIndex(
      profile.callUpDate,
      today,
    );
    const basePay = calculateMonthlyBasePay({
      calendarYear,
      serviceMonthIndex,
    });
    const meal = evaluateMealAllowance({
      calendarYear,
      mealRateConfirmedByProfile: false,
    });
    const transport = calculateTransportAllowance({
      calendarYear,
      commuteFareOrInstitutionApprovedTransportRate: profile.defaultCommuteCost,
      eligibleServiceDays: 0,
    });

    return {
      status: "READY_FOR_CONTEXT",
      basePay: basePay.value?.monthlyBasePay ?? null,
      suggestedMealRate:
        typeof meal.breakdown.suggestedDailyMealRate === "number"
          ? meal.breakdown.suggestedDailyMealRate
          : null,
      transportConfigured: transport.status === "SUPPORTED",
      message:
        "1일 통근비와 중식비 제안값을 확인하면 예상 보수를 검토할 수 있어요.",
      ruleVersion: basePay.ruleVersion,
    };
  } catch {
    return {
      status: "UNSUPPORTED",
      basePay: null,
      suggestedMealRate: null,
      transportConfigured: profile.defaultCommuteCost !== null,
      message: `${calendarYear}년 검증 규칙이 준비되면 예상 보수를 제공할게요.`,
      ruleVersion: null,
    };
  }
}
