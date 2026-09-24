import {
  STANDARD_SERVICE_MONTHS,
  addCalendarMonths,
  type AnnualLeaveCreditInput,
  type DateOnly,
} from "@super-gongik/domain";

import { LEAVE_RULE_BUNDLES } from "./bundles";
import { selectRuleByDate } from "./selector";

type Tranche = {
  key: "YEAR_1" | "YEAR_2";
  label: string;
  grantDate: DateOnly;
  pick: (allocation: {
    firstYearDays: number;
    afterFirstYearDays: number;
  }) => number;
};

/**
 * Derive ordinary annual-leave credits for the standard 21-month term from
 * 병역법 시행규칙 별표 1의2: 15 days within the first year from call-up and 13
 * days after it.
 *
 * Each tranche selects the leave bundle effective on its own grant date. When
 * no verified bundle covers that date, the tranche is returned as
 * PENDING_CONFIRMATION: the current value is exposed only as a reference and
 * is not counted until the user confirms what the institution granted.
 */
export function deriveAnnualLeaveCredits(input: {
  callUpDate: DateOnly;
  referenceDate: DateOnly;
  mandatoryServiceMonths?: number;
}): AnnualLeaveCreditInput[] {
  const months = input.mandatoryServiceMonths ?? STANDARD_SERVICE_MONTHS;
  const tranches: Tranche[] = [
    {
      key: "YEAR_1",
      label: "1년차 연가",
      grantDate: input.callUpDate,
      pick: (allocation) => allocation.firstYearDays,
    },
    {
      key: "YEAR_2",
      label: "2년차 연가",
      grantDate: addCalendarMonths(input.callUpDate, 12),
      pick: (allocation) => allocation.afterFirstYearDays,
    },
  ];

  const reference = selectRuleByDate(
    "LEAVE",
    LEAVE_RULE_BUNDLES,
    input.referenceDate,
  );
  const referenceAllocation =
    reference.status === "SUPPORTED" && months === 21
      ? reference.rule.annualLeave.periodAllocation.standard21Month
      : null;

  return tranches.map((tranche) => {
    const selection = selectRuleByDate(
      "LEAVE",
      LEAVE_RULE_BUNDLES,
      tranche.grantDate,
    );
    const allocation =
      selection.status === "SUPPORTED" && months === 21
        ? selection.rule.annualLeave.periodAllocation.standard21Month
        : null;
    const referenceDays = referenceAllocation
      ? tranche.pick(referenceAllocation)
      : null;

    if (selection.status === "SUPPORTED" && allocation?.autoCalculate) {
      return {
        key: tranche.key,
        label: tranche.label,
        grantDate: tranche.grantDate,
        status: "RULE_VERIFIED",
        days: tranche.pick(allocation),
        referenceDays,
        ruleId: selection.rule.ruleId,
        ruleVersion: selection.rule.version,
        explanation: `${selection.rule.version} 시행 연가 규칙(병역법 시행규칙 별표 1의2) 기준이에요.`,
      };
    }

    return {
      key: tranche.key,
      label: tranche.label,
      grantDate: tranche.grantDate,
      status: "PENDING_CONFIRMATION",
      days: null,
      referenceDays,
      ruleId: null,
      ruleVersion: null,
      explanation:
        months !== 21
          ? `의무복무기간 ${months}개월의 연가 배정은 아직 자동 계산하지 않아요. 기관에서 받은 일수를 확인해 주세요.`
          : `${tranche.grantDate}에 적용되는 검증된 연가 규칙이 없어요. 현재 규칙을 과거 날짜에 대신 쓰지 않으니 기관에서 받은 일수를 확인해 주세요.`,
    };
  });
}
