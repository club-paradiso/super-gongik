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

/**
 * 병역법 시행령 제62조제2항 제1호~제7호. Each 호 credits a different period
 * computed under a different provision, so the app records which one applies
 * and takes the resulting period from the institution instead of computing it.
 */
export const PRIOR_SERVICE_BASES = [
  "ARTICLE_62_2_1_SHIPBOARD_RESERVE",
  "ARTICLE_62_2_2_ARTS_SPORTS",
  "ARTICLE_62_2_3_PUBLIC_HEALTH_LEGAL_VET",
  "ARTICLE_62_2_4_RESEARCH_INDUSTRIAL",
  "ARTICLE_62_2_5_MILITARY_SCHOOL_WITHDRAWAL",
  "ARTICLE_62_2_6_ARTICLE_137_RECLASSIFIED",
  "ARTICLE_62_2_7_ALTERNATIVE_SERVICE",
] as const;

export const priorServiceBasisSchema = z.enum(PRIOR_SERVICE_BASES);
export type PriorServiceBasis = z.infer<typeof priorServiceBasisSchema>;

export const PRIOR_SERVICE_BASIS_LABELS: Record<PriorServiceBasis, string> = {
  ARTICLE_62_2_1_SHIPBOARD_RESERVE: "제1호 승선근무예비역 편입 취소",
  ARTICLE_62_2_2_ARTS_SPORTS: "제2호 예술·체육요원 편입 취소",
  ARTICLE_62_2_3_PUBLIC_HEALTH_LEGAL_VET:
    "제3호 공중보건의사·병역판정검사전담의사·공익법무관·공중방역수의사 편입 취소",
  ARTICLE_62_2_4_RESEARCH_INDUSTRIAL:
    "제4호 전문연구요원·산업기능요원 편입 취소",
  ARTICLE_62_2_5_MILITARY_SCHOOL_WITHDRAWAL:
    "제5호 입교 전 신분 복귀(퇴교 전 교육기간)",
  ARTICLE_62_2_6_ARTICLE_137_RECLASSIFIED: "제6호 제137조제7항 보충역 편입",
  ARTICLE_62_2_7_ALTERNATIVE_SERVICE: "제7호 대체역 편입 취소",
};

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
    /** Which 병역법 시행령 제62조제2항 호 applies (HAS_PRIOR_SERVICE only). */
    priorServiceBasis: priorServiceBasisSchema.nullable().default(null),
    /**
     * The credited period as stated by the 복무기관/병무청, in whole months.
     * The law adds a *period* to the month count; the app never derives it
     * (each 호 points to a different computation) and never converts days.
     */
    priorServiceCreditedMonths: z
      .number()
      .int()
      .min(1)
      .max(36)
      .nullable()
      .default(null),
    /** true when the confirmed credited period is not a whole number of months. */
    priorServiceCreditHasPartialMonth: z.boolean().default(false),
    /**
     * 복무형태 (사회복무요원 복무관리 규정 제18조①). Only daytime commuting
     * service has a supported working-day model; night rotation (근무일수
     * 1일 = 2일) and residential service are not calculated.
     */
    workPattern: z
      .enum(["WEEKDAY_DAYTIME", "NIGHT_SHIFT_ROTATION", "RESIDENTIAL", "OTHER"])
      .nullable()
      .default(null),
    /**
     * Confirmed regular working weekdays, 0 = Sunday … 6 = Saturday. null
     * until the user confirms; the UI proposes Monday–Friday (국가공무원
     * 복무규정 제9조① 토요일 휴무 원칙) but never stores it unconfirmed.
     */
    workWeekdays: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .nullable()
      .default(null),
  })
  .superRefine((profile, context) => {
    if (
      profile.priorServiceCredit !== "HAS_PRIOR_SERVICE" &&
      (profile.priorServiceBasis !== null ||
        profile.priorServiceCreditedMonths !== null ||
        profile.priorServiceCreditHasPartialMonth)
    ) {
      context.addIssue({
        code: "custom",
        path: ["priorServiceBasis"],
        message:
          "이전 복무 경력이 있을 때만 인정 근거와 기간을 입력할 수 있어요.",
      });
    }
    if (
      profile.workWeekdays &&
      new Set(profile.workWeekdays).size !== profile.workWeekdays.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["workWeekdays"],
        message: "근무 요일이 중복됐어요.",
      });
    }
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
  /**
   * Content digests of profile versions this one replaced (optional,
   * additive). The profile has no revision; this is its only ordering
   * evidence for merges. See `store/sync-contract.ts`.
   */
  supersedes?: string[];
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
  supersedes: z
    .array(z.string().regex(/^[0-9a-f]{16}$/))
    .max(32)
    .optional(),
});

export function parseServiceProfile(value: unknown): ServiceProfile {
  return storedServiceProfileSchema.parse(value);
}
