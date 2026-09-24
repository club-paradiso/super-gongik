import type { DateOnly } from "@super-gongik/domain";
import { describe, expect, it } from "vitest";

import boundaryFixturesJson from "../fixtures/2026-boundaries.json";
import {
  calculateAnnualLeaveAllocation,
  calculateHalfDayAnnualLeaveCharge,
  calculateMonthlyBasePay,
  calculateTransportAllowance,
  evaluateCompassionateLeaveRequest,
  evaluateCompensationSafetyGate,
  evaluateMealAllowance,
  validateOrdinaryAnnualLeaveBalance,
} from "../src";

type FixtureCase = {
  id: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
};

const cases = boundaryFixturesJson.cases as FixtureCase[];
// Non-boundary leave fixtures describe the currently effective bundle.
const CURRENT_LEAVE_DATE = "2026-08-28" as DateOnly;

function numberInput(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== "number") {
    throw new TypeError(`${key} must be a number.`);
  }
  return value;
}

function stringInput(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string") {
    throw new TypeError(`${key} must be a string.`);
  }
  return value;
}

function evaluateFixture(testCase: FixtureCase): Record<string, unknown> {
  const input = testCase.input;

  switch (testCase.id) {
    case "leave.standard-21-month-allocation": {
      const result = calculateAnnualLeaveAllocation(
        numberInput(input, "mandatoryServiceMonths"),
        CURRENT_LEAVE_DATE,
      );
      return { status: result.status, ...result.value };
    }
    case "leave.statutory-cap-is-not-standard-balance": {
      const result = validateOrdinaryAnnualLeaveBalance(
        numberInput(input, "mandatoryServiceMonths"),
        numberInput(input, "requestedOrdinaryBalanceDays"),
        CURRENT_LEAVE_DATE,
      );
      return { status: result.status, reason: result.warnings[0] };
    }
    case "leave.half-day-pair": {
      const result = calculateHalfDayAnnualLeaveCharge(
        numberInput(input, "halfDayAnnualLeaveCount"),
        CURRENT_LEAVE_DATE,
      );
      return { status: result.status, ...result.value };
    }
    case "leave.amendment-boundary-before":
    case "leave.amendment-boundary-on-effective-date":
    case "leave.amendment-boundary-over-cap": {
      const requestedDays = input.requestedDays;
      const result = evaluateCompassionateLeaveRequest({
        eventDate: stringInput(input, "eventDate") as DateOnly,
        leaveCode: stringInput(input, "leaveCode"),
        ...(typeof requestedDays === "number" ? { requestedDays } : {}),
      });
      return {
        selectedRuleVersion: result.ruleVersion,
        status: result.status,
        ...result.value,
      };
    }
    case "compensation.base-pay-month-2":
    case "compensation.base-pay-month-3-boundary":
    case "compensation.base-pay-month-8":
    case "compensation.base-pay-month-9-boundary":
    case "compensation.base-pay-month-14":
    case "compensation.base-pay-month-15-boundary": {
      const result = calculateMonthlyBasePay({
        calendarYear: numberInput(input, "calendarYear"),
        serviceMonthIndex: numberInput(input, "serviceMonthIndex"),
      });
      return { status: result.status, ...result.value };
    }
    case "compensation.meal-suggested-rate-unconfirmed": {
      const result = evaluateMealAllowance({
        calendarYear: numberInput(input, "calendarYear"),
        mealRateConfirmedByProfile: false,
      });
      return { status: result.status, ...result.breakdown };
    }
    case "compensation.transport-missing-context": {
      const result = calculateTransportAllowance({
        calendarYear: numberInput(input, "calendarYear"),
        commuteFareOrInstitutionApprovedTransportRate: null,
        eligibleServiceDays: numberInput(input, "eligibleServiceDays"),
      });
      return { status: result.status, ...result.breakdown };
    }
    case "compensation.partial-first-month-gated": {
      const result = evaluateCompensationSafetyGate({
        calendarYear: numberInput(input, "calendarYear"),
        partialMonth: true,
        periodType: stringInput(input, "periodType"),
      });
      return { status: result.status, ...result.breakdown };
    }
    case "compensation.prior-service-credit-gated": {
      const result = evaluateCompensationSafetyGate({
        calendarYear: numberInput(input, "calendarYear"),
        hasPriorServiceCreditCase: true,
      });
      return { status: result.status, ...result.breakdown };
    }
    default:
      throw new Error(`Fixture ${testCase.id} is not connected to a test.`);
  }
}

describe("source-derived 2026 boundary fixtures", () => {
  it.each(cases)("executes $id", (testCase) => {
    expect(evaluateFixture(testCase)).toMatchObject(testCase.expected);
  });

  it("keeps every fixture case connected to executable code", () => {
    expect(cases).toHaveLength(16);
    expect(cases.map((testCase) => testCase.id)).toHaveLength(
      new Set(cases.map((testCase) => testCase.id)).size,
    );
  });
});
