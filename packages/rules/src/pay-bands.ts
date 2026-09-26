import {
  addCalendarMonths,
  calculateServiceMonthIndex,
  compareDateOnly,
  type DateOnly,
  type ServiceProfile,
} from "@super-gongik/domain";

import {
  COMPENSATION_RULE_BUNDLES,
  type CompensationRuleBundle,
} from "./bundles";
import { EQUIVALENT_RANK_LABELS } from "./monthly-compensation";
import { selectRuleByDate } from "./selector";

export type PayBandStep = {
  equivalentRank: string;
  /** e.g. "상병 상당". */
  label: string;
  fromServiceMonthOrdinal: number;
  /** First date this band applies (call-up date for the band in force then). */
  startDate: DateOnly;
  /**
   * Monthly amount from the verified bundle that covers `startDate`. null
   * when no verified rule covers that date yet — a later year's table is
   * never assumed to equal the current one.
   */
  monthlyAmount: number | null;
  amountRuleVersion: string | null;
};

export type PayBandSchedule =
  | {
      status: "READY";
      /** Bundle whose band boundaries were used (the one in force on asOf). */
      ruleVersion: string;
      creditedMonths: number;
      current: PayBandStep | null;
      next: PayBandStep | null;
      steps: PayBandStep[];
    }
  | {
      status: "NEEDS_INPUT" | "UNSUPPORTED";
      reason: string;
    };

/**
 * When each base-pay band (이병·일병·상병·병장 상당) begins for this profile.
 *
 * Boundaries follow 병역법 시행령 제62조①: the calendar month containing the
 * call-up date is service month 1, plus an institution-confirmed 제62조②
 * credit in whole months. Band boundaries come from the bundle in force on
 * `asOfDate`; each amount is taken only from a bundle verified for the date
 * the band starts. This is a schedule of *when*, not a payroll calculation:
 * proration, non-payable days and allowances stay in
 * `evaluateMonthlyCompensation`.
 */
export function derivePayBandSchedule(
  profile: Pick<
    ServiceProfile,
    | "callUpDate"
    | "expectedDischargeDate"
    | "priorServiceCredit"
    | "priorServiceCreditedMonths"
    | "priorServiceCreditHasPartialMonth"
  >,
  asOfDate: DateOnly,
  bundles: readonly CompensationRuleBundle[] = COMPENSATION_RULE_BUNDLES,
): PayBandSchedule {
  let credit: number;
  if (profile.priorServiceCredit === null) {
    return {
      status: "NEEDS_INPUT",
      reason: "이전 복무 경력 여부를 알려 주시면 급여 단계를 보여 드려요.",
    };
  } else if (profile.priorServiceCredit === "NONE") {
    credit = 0;
  } else if (
    profile.priorServiceCreditHasPartialMonth ||
    profile.priorServiceCreditedMonths === null
  ) {
    return {
      status: "NEEDS_INPUT",
      reason:
        "복무기관이 확인한 인정 개월 수가 있어야 급여 단계를 정할 수 있어요.",
    };
  } else {
    credit = profile.priorServiceCreditedMonths;
  }

  const selection = selectRuleByDate("COMPENSATION", bundles, asOfDate);
  if (selection.status !== "SUPPORTED") {
    return {
      status: "UNSUPPORTED",
      reason: "오늘 적용되는 검증된 보수 규칙이 없어요.",
    };
  }
  const bands = selection.rule.basePay.serviceMonthBands;
  const callUpMonthStart = `${profile.callUpDate.slice(0, 7)}-01` as DateOnly;

  const steps: PayBandStep[] = [];
  for (const band of bands) {
    const monthOffset = band.fromServiceMonthOrdinal - 1 - credit;
    const startDate =
      monthOffset <= 0
        ? profile.callUpDate
        : addCalendarMonths(callUpMonthStart, monthOffset);
    if (compareDateOnly(startDate, profile.expectedDischargeDate) > 0) break;
    // Skip bands wholly superseded before call-up by prior-service credit.
    const endOrdinal = band.toServiceMonthOrdinal;
    if (endOrdinal !== null && endOrdinal - credit < 1) continue;

    const amountSelection = selectRuleByDate(
      "COMPENSATION",
      bundles,
      startDate,
    );
    let monthlyAmount: number | null = null;
    let amountRuleVersion: string | null = null;
    if (amountSelection.status === "SUPPORTED") {
      const ordinal =
        calculateServiceMonthIndex(profile.callUpDate, startDate) + 1 + credit;
      const amountBand = amountSelection.rule.basePay.serviceMonthBands.find(
        (candidate) =>
          ordinal >= candidate.fromServiceMonthOrdinal &&
          (candidate.toServiceMonthOrdinal === null ||
            ordinal <= candidate.toServiceMonthOrdinal),
      );
      if (amountBand?.equivalentRank === band.equivalentRank) {
        monthlyAmount = amountBand.monthlyAmount;
        amountRuleVersion = amountSelection.rule.version;
      }
    }

    steps.push({
      equivalentRank: band.equivalentRank,
      label: EQUIVALENT_RANK_LABELS[band.equivalentRank] ?? band.equivalentRank,
      fromServiceMonthOrdinal: band.fromServiceMonthOrdinal,
      startDate,
      monthlyAmount,
      amountRuleVersion,
    });
  }

  const current =
    [...steps]
      .reverse()
      .find((step) => compareDateOnly(step.startDate, asOfDate) <= 0) ?? null;
  const next =
    steps.find((step) => compareDateOnly(step.startDate, asOfDate) > 0) ?? null;

  return {
    status: "READY",
    ruleVersion: selection.rule.version,
    creditedMonths: credit,
    current,
    next,
    steps,
  };
}
