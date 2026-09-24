import { z } from "zod";

import {
  SEOUL_TIME_ZONE,
  addCalendarMonths,
  addDays,
  compareDateOnly,
  isDateOnly,
  type DateOnly,
} from "./date-only";

export const STANDARD_SERVICE_MONTHS = 21;

const dateOnlySchema = z
  .string()
  .refine(isDateOnly, "유효한 날짜를 입력해 주세요.")
  .transform((value) => value as DateOnly);

export const serviceProfileInputSchema = z
  .object({
    callUpDate: dateOnlySchema,
    expectedDischargeDate: dateOnlySchema,
    serviceCategory: z.string().trim().max(80).nullable().default(null),
    workplaceType: z.string().trim().max(80).nullable().default(null),
    defaultCommuteCost: z.number().nonnegative().nullable().default(null),
    defaultMealAllowanceOverride: z
      .number()
      .nonnegative()
      .nullable()
      .default(null),
    timezone: z.string().min(1).default(SEOUL_TIME_ZONE),
    /**
     * Ordinary workday length at the user's institution, in minutes. Needed
     * only to combine minute-based partial leave with day-based balances;
     * never defaulted because schedules are institution-specific.
     */
    workdayMinutes: z
      .number()
      .int()
      .min(60)
      .max(24 * 60)
      .nullable()
      .default(null),
    /**
     * Whether prior service is credited toward pay grade (병역법 시행령
     * 제62조제2항 cases). null = not answered; compensation stays gated.
     */
    priorServiceCredit: z
      .enum(["NONE", "HAS_PRIOR_SERVICE"])
      .nullable()
      .default(null),
  })
  .superRefine((profile, context) => {
    if (
      compareDateOnly(profile.callUpDate, profile.expectedDischargeDate) > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["expectedDischargeDate"],
        message: "소집해제 예정일은 소집일보다 빠를 수 없어요.",
      });
    }
  });

export type ServiceProfileInput = z.input<typeof serviceProfileInputSchema>;
export type ValidServiceProfileInput = z.output<
  typeof serviceProfileInputSchema
>;

export type ServiceProfile = ValidServiceProfileInput & {
  id: string;
  ownerId: null;
  localProfileId: string;
  createdAt: string;
  updatedAt: string;
};

export type ProfileMetadata = {
  id: string;
  localProfileId: string;
  timestamp: string;
};

export function calculateExpectedDischargeDate(
  callUpDate: DateOnly,
  serviceMonths: number = STANDARD_SERVICE_MONTHS,
): DateOnly {
  if (!Number.isInteger(serviceMonths) || serviceMonths <= 0) {
    throw new RangeError("Service months must be a positive integer.");
  }

  return addDays(addCalendarMonths(callUpDate, serviceMonths), -1);
}

export function buildServiceProfile(
  input: ServiceProfileInput,
  metadata: ProfileMetadata,
): ServiceProfile {
  const validated = serviceProfileInputSchema.parse(input);

  return {
    ...validated,
    id: metadata.id,
    ownerId: null,
    localProfileId: metadata.localProfileId,
    createdAt: metadata.timestamp,
    updatedAt: metadata.timestamp,
  };
}

export function updateServiceProfile(
  currentProfile: ServiceProfile,
  input: ServiceProfileInput,
  updatedAt: string,
): ServiceProfile {
  const updated = buildServiceProfile(input, {
    id: currentProfile.id,
    localProfileId: currentProfile.localProfileId,
    timestamp: currentProfile.createdAt,
  });

  return {
    ...updated,
    ownerId: currentProfile.ownerId,
    updatedAt,
  };
}

export const storedServiceProfileSchema = serviceProfileInputSchema.extend({
  id: z.string().min(1),
  ownerId: z.null(),
  localProfileId: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export function parseServiceProfile(value: unknown): ServiceProfile {
  return storedServiceProfileSchema.parse(value);
}
