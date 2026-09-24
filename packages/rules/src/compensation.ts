import type { DateOnly } from "@super-gongik/domain";

import {
  COMPENSATION_RULE_BUNDLES,
  type CompensationRuleBundle,
} from "./bundles";
import { createCalculationResult } from "./calculation";
import { selectRuleByDate } from "./selector";

type RuleInput = {
  /** The payment date or month day being evaluated; selects the bundle. */
  calculationDate: DateOnly;
  /** Injected for tests; production uses the verified bundles. */
  bundles?: readonly CompensationRuleBundle[];
};

/** Calculation inputs as recorded in results (injected bundles excluded). */
function publicInputs<T extends { bundles?: unknown }>(input: T) {
  const { bundles: _bundles, ...rest } = input;
  void _bundles;
  return rest as Record<string, unknown>;
}

export function requireCompensationRule(
  input: RuleInput,
): CompensationRuleBundle {
  const selection = selectRuleByDate(
    "COMPENSATION",
    input.bundles ?? COMPENSATION_RULE_BUNDLES,
    input.calculationDate,
  );
  if (selection.status !== "SUPPORTED") {
    throw new RangeError(selection.warnings.join(" "));
  }

  return selection.rule;
}

/**
 * Full-month base pay for a service-month *ordinal*: the calendar month that
 * contains the call-up date is month 1 (병역법 시행령 제62조① "소집월부터
 * 2개월까지"), plus any institution-confirmed 제62조② credit in whole months.
 */
export function calculateMonthlyBasePay(input: {
  calculationDate: DateOnly;
  bundles?: readonly CompensationRuleBundle[];
  serviceMonthOrdinal: number;
}) {
  if (
    !Number.isInteger(input.serviceMonthOrdinal) ||
    input.serviceMonthOrdinal < 1
  ) {
    throw new RangeError(
      "Service month ordinals start at 1 (the call-up month).",
    );
  }
  const bundle = requireCompensationRule(input);
  const band = bundle.basePay.serviceMonthBands.find(
    (candidate) =>
      input.serviceMonthOrdinal >= candidate.fromServiceMonthOrdinal &&
      (candidate.toServiceMonthOrdinal === null ||
        input.serviceMonthOrdinal <= candidate.toServiceMonthOrdinal),
  );

  if (!band) {
    throw new RangeError("No verified base-pay band applies.");
  }

  return createCalculationResult({
    domain: "COMPENSATION",
    status: "SUPPORTED" as const,
    value: { monthlyBasePay: band.monthlyAmount },
    bundle,
    inputs: publicInputs(input),
    breakdown: {
      equivalentRank: band.equivalentRank,
      fromServiceMonthOrdinal: band.fromServiceMonthOrdinal,
      toServiceMonthOrdinal: band.toServiceMonthOrdinal,
      amountSource: bundle.basePay.amountSource,
    },
  });
}

/**
 * 중식비: legal basis verified (실비), rate supplied by the institution. The
 * unverified reference amount is exposed for display only and never used.
 */
export function calculateMealAllowance(input: {
  calculationDate: DateOnly;
  bundles?: readonly CompensationRuleBundle[];
  institutionDailyMealRate: number | null;
  mealEligibleDays: number;
}) {
  const bundle = requireCompensationRule(input);
  if (input.institutionDailyMealRate === null) {
    return createCalculationResult({
      domain: "COMPENSATION",
      status: "NEEDS_INPUT" as const,
      value: null,
      bundle,
      inputs: publicInputs(input),
      breakdown: {
        missingFields: ["institutionDailyMealRate"],
        unverifiedReferenceDailyAmount:
          bundle.meal.unverifiedReferenceDailyAmount,
        mustNotUseReference: true,
      },
      warnings: [bundle.meal.warning],
    });
  }

  return createCalculationResult({
    domain: "COMPENSATION",
    status: "SUPPORTED" as const,
    value: {
      dailyMealRate: input.institutionDailyMealRate,
      mealAllowance: input.institutionDailyMealRate * input.mealEligibleDays,
    },
    bundle,
    inputs: publicInputs(input),
    breakdown: {
      mealEligibleDays: input.mealEligibleDays,
      legalBasis: bundle.meal.legalBasis,
    },
    assumptions: ["1일 중식비는 사용자가 입력한 기관 확인 금액이에요."],
  });
}

/** 교통비: 실비 on a public-transit-fare basis; no national default exists. */
export function calculateTransportAllowance(input: {
  calculationDate: DateOnly;
  bundles?: readonly CompensationRuleBundle[];
  dailyPublicTransitFare: number | null;
  transportEligibleDays: number;
}) {
  const bundle = requireCompensationRule(input);
  if (input.dailyPublicTransitFare === null) {
    return createCalculationResult({
      domain: "COMPENSATION",
      status: "NEEDS_INPUT" as const,
      value: null,
      bundle,
      inputs: publicInputs(input),
      breakdown: { missingFields: ["dailyPublicTransitFare"] },
      warnings: [bundle.transport.warning],
    });
  }

  return createCalculationResult({
    domain: "COMPENSATION",
    status: "SUPPORTED" as const,
    value: {
      dailyTransportFare: input.dailyPublicTransitFare,
      transportAllowance:
        input.dailyPublicTransitFare * input.transportEligibleDays,
    },
    bundle,
    inputs: publicInputs(input),
    breakdown: {
      transportEligibleDays: input.transportEligibleDays,
      legalBasis: bundle.transport.legalBasis,
    },
    assumptions: ["1일 교통비는 사용자가 입력한 대중교통 왕복 요금이에요."],
  });
}

/**
 * Base-pay situations the verified rule structure covers but whose exact
 * arithmetic is not established: call-up/discharge months (제41조⑤) and
 * months that may contain non-payable days (제41조⑥).
 */
export function evaluateCompensationSafetyGate(input: {
  calculationDate: DateOnly;
  bundles?: readonly CompensationRuleBundle[];
  partialMonth?: boolean;
  possibleNonPayableDays?: boolean;
}) {
  const bundle = requireCompensationRule(input);

  if (input.partialMonth) {
    return createCalculationResult({
      domain: "COMPENSATION",
      status: "GATED_AMBIGUOUS_PRORATION" as const,
      value: null,
      bundle,
      inputs: publicInputs(input),
      breakdown: {
        verifiedStructure: bundle.proration.firstAndLastMonth.verifiedStructure,
        verifiedDivisorCandidate:
          bundle.proration.firstAndLastMonth.verifiedDivisorCandidate,
        unresolved: bundle.proration.firstAndLastMonth.unresolved,
        mustNotGuessRounding: true,
      },
      warnings: [bundle.proration.firstAndLastMonth.reason],
    });
  }

  if (input.possibleNonPayableDays) {
    return createCalculationResult({
      domain: "COMPENSATION",
      status: "GATED_NON_PAYABLE_DAYS" as const,
      value: null,
      bundle,
      inputs: publicInputs(input),
      breakdown: {
        knownCategories: bundle.proration.nonPayableDays.knownCategories,
      },
      warnings: [bundle.proration.nonPayableDays.reason],
    });
  }

  return createCalculationResult({
    domain: "COMPENSATION",
    status: "SUPPORTED" as const,
    value: { safeToCalculateVerifiedComponents: true },
    bundle,
    inputs: publicInputs(input),
  });
}
