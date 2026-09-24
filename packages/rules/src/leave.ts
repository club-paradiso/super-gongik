import type { DateOnly } from "@super-gongik/domain";

import { LEAVE_RULE_BUNDLES, type LeaveRuleBundle } from "./bundles";
import { createCalculationResult, type CalculationResult } from "./calculation";
import { selectRuleByDate } from "./selector";

type AnnualLeaveAllocation = {
  firstYearDays: number;
  afterFirstYearDays: number;
  ordinaryTotalDays: number;
  mustNotUseStatutoryCapAsBalance: true;
};

/**
 * Every leave calculation requires an explicit calculation date. There is no
 * default: a default would let a historical event silently use a future
 * bundle.
 */
function requireLeaveRule(date: DateOnly): LeaveRuleBundle {
  const selection = selectRuleByDate("LEAVE", LEAVE_RULE_BUNDLES, date);
  if (selection.status !== "SUPPORTED") {
    throw new RangeError(selection.warnings.join(" "));
  }

  return selection.rule;
}

export function calculateAnnualLeaveAllocation(
  mandatoryServiceMonths: number,
  calculationDate: DateOnly,
): CalculationResult<AnnualLeaveAllocation, "SUPPORTED"> {
  const bundle = requireLeaveRule(calculationDate);
  const standard = bundle.annualLeave.periodAllocation.standard21Month;

  if (mandatoryServiceMonths !== 21 || !standard.autoCalculate) {
    throw new RangeError(
      "Only the verified standard 21-month allocation is enabled in this slice.",
    );
  }

  return createCalculationResult({
    domain: "LEAVE",
    status: "SUPPORTED",
    value: {
      firstYearDays: standard.firstYearDays,
      afterFirstYearDays: standard.afterFirstYearDays,
      ordinaryTotalDays: standard.ordinaryTotalDays,
      mustNotUseStatutoryCapAsBalance: true,
    },
    bundle,
    inputs: { mandatoryServiceMonths },
    breakdown: {
      firstYearDays: standard.firstYearDays,
      afterFirstYearDays: standard.afterFirstYearDays,
      statutoryCapDays: bundle.annualLeave.statutoryCap.maxDays,
    },
    assumptions: ["일반 21개월 복무이며 추가 조건부 연가는 포함하지 않습니다."],
  });
}

export function validateOrdinaryAnnualLeaveBalance(
  mandatoryServiceMonths: number,
  requestedOrdinaryBalanceDays: number,
  calculationDate: DateOnly,
) {
  const allocation = calculateAnnualLeaveAllocation(
    mandatoryServiceMonths,
    calculationDate,
  );
  const bundle = requireLeaveRule(calculationDate);
  const expected = allocation.value?.ordinaryTotalDays;

  if (
    requestedOrdinaryBalanceDays === bundle.annualLeave.statutoryCap.maxDays &&
    requestedOrdinaryBalanceDays !== expected
  ) {
    return createCalculationResult({
      domain: "LEAVE",
      status: "REJECT_OR_WARN" as const,
      value: null,
      bundle,
      inputs: { mandatoryServiceMonths, requestedOrdinaryBalanceDays },
      breakdown: {
        ordinaryAllocatedDays: expected,
        statutoryCapDays: bundle.annualLeave.statutoryCap.maxDays,
      },
      warnings: [
        "31 days is the statutory ceiling, not the standard 21-month ordinary allocation.",
      ],
    });
  }

  return allocation;
}

export function calculateHalfDayAnnualLeaveCharge(
  halfDayAnnualLeaveCount: number,
  calculationDate: DateOnly,
) {
  const bundle = requireLeaveRule(calculationDate);
  const supported =
    bundle.annualLeave.halfDay.allowed &&
    bundle.annualLeave.halfDay.twoHalfDaysEqualOneDay;

  if (!supported || !Number.isInteger(halfDayAnnualLeaveCount)) {
    throw new RangeError("The half-day request is not supported by this rule.");
  }

  return createCalculationResult({
    domain: "LEAVE",
    status: "SUPPORTED" as const,
    value: { chargedAnnualLeaveDays: halfDayAnnualLeaveCount / 2 },
    bundle,
    inputs: { halfDayAnnualLeaveCount },
    breakdown: { halfDaysPerDay: 2 },
  });
}

export function evaluateCompassionateLeaveRequest(input: {
  eventDate: DateOnly;
  leaveCode: string;
  requestedDays?: number;
}) {
  const bundle = requireLeaveRule(input.eventDate);
  const category = bundle.compassionateLeave.categories.find(
    (item) => item.code === input.leaveCode,
  );
  const excluded =
    bundle.compassionateLeave.excludedBecauseNotYetEffective?.find(
      (item) => item.code === input.leaveCode,
    );

  if (!category && excluded) {
    return createCalculationResult({
      domain: "LEAVE",
      status: "NOT_YET_EFFECTIVE" as const,
      value: null,
      bundle,
      inputs: input,
      breakdown: { becomesEffective: excluded.becomesEffective },
      warnings: ["해당 휴가 항목은 사건일 당시 아직 시행되지 않았습니다."],
    });
  }

  if (!category) {
    return createCalculationResult({
      domain: "LEAVE",
      status: "UNSUPPORTED_LEAVE_CODE" as const,
      value: null,
      bundle,
      inputs: input,
      warnings: ["선택한 휴가 항목을 적용 규칙에서 찾을 수 없습니다."],
    });
  }

  const maximumDays = category.maxDays ?? category.days;
  if (
    maximumDays !== undefined &&
    input.requestedDays !== undefined &&
    input.requestedDays > maximumDays
  ) {
    return createCalculationResult({
      domain: "LEAVE",
      status: "EXCEEDS_RULE_MAXIMUM" as const,
      value: { maximumDays },
      bundle,
      inputs: input,
      breakdown: { grantSemantics: category.grantSemantics },
      warnings: ["요청 일수가 규칙상 최대 일수를 초과합니다."],
    });
  }

  return createCalculationResult({
    domain: "LEAVE",
    status: "ELIGIBILITY_REQUIRES_APPROVAL_CONTEXT" as const,
    value: { maximumDays },
    bundle,
    inputs: input,
    breakdown: { grantSemantics: category.grantSemantics },
    assumptions: ["최대 일수는 자동 승인이나 확정 부여를 의미하지 않습니다."],
    warnings: ["기관 승인 및 자격 맥락 확인이 필요합니다."],
  });
}
