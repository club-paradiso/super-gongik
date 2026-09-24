import compensation2026Json from "../compensation/2026.json";
import leave20260423Json from "../leave/2026-04-23.json";
import leave20260828Json from "../leave/2026-08-28.json";
import service20260423Json from "../service/2026-04-23.json";

import { parseRuleBundle, type RuleBundle } from "./schema";

export type LeaveRuleBundle = RuleBundle & {
  annualLeave: {
    statutoryCap: {
      maxDays: number;
      grantSemantics: string;
    };
    periodAllocation: {
      standard21Month: {
        firstYearDays: number;
        afterFirstYearDays: number;
        ordinaryTotalDays: number;
        autoCalculate: boolean;
      };
      knownAllocations?: Array<{
        mandatoryServiceMonths: number;
        firstYearDays?: number;
        afterFirstYearDays?: number;
        ordinaryTotalDays?: number;
        wholeServiceDays?: number;
      }>;
    };
    halfDay: {
      allowed: boolean;
      twoHalfDaysEqualOneDay: boolean;
    };
  };
  compassionateLeave: {
    categories: Array<{
      code: string;
      maxDays?: number;
      days?: number;
      grantSemantics: string;
    }>;
    excludedBecauseNotYetEffective?: Array<{
      code: string;
      becomesEffective: string;
    }>;
  };
};

export type CompensationRuleBundle = RuleBundle & {
  currency: "KRW";
  basePay: {
    serviceMonthBands: Array<{
      fromServiceMonthOrdinal: number;
      toServiceMonthOrdinal: number | null;
      equivalentRank: string;
      monthlyAmount: number;
    }>;
    amountSource: string;
    priorServiceCredit: {
      status: string;
      supportedInput: string;
      reason: string;
    };
  };
  meal: {
    legalBasis: string;
    unverifiedReferenceDailyAmount: number;
    warning: string;
  };
  transport: {
    legalBasis: string;
    requiredInputs: string[];
    warning: string;
  };
  eligibleDays: {
    supportedWorkPattern: string;
    unsupportedReason: string;
    fullDayLeaveBasis: string;
  };
  proration: {
    firstAndLastMonth: {
      autoCalculate: boolean;
      verifiedStructure: string;
      verifiedDivisorCandidate: string;
      unresolved: string[];
      reason: string;
    };
    nonPayableDays: {
      knownCategories: string[];
      sickLeaveCumulativeLimitDays: number;
      reason: string;
    };
  };
};

function loadBundle<T extends RuleBundle>(value: unknown): T {
  return parseRuleBundle(value) as T;
}

export const LEAVE_RULE_BUNDLES: readonly LeaveRuleBundle[] = [
  loadBundle<LeaveRuleBundle>(leave20260423Json),
  loadBundle<LeaveRuleBundle>(leave20260828Json),
];

export const COMPENSATION_RULE_BUNDLES: readonly CompensationRuleBundle[] = [
  loadBundle<CompensationRuleBundle>(compensation2026Json),
];

export const SERVICE_RULE_BUNDLES: readonly RuleBundle[] = [
  loadBundle<RuleBundle>(service20260423Json),
];
