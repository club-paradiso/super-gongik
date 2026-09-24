import { z } from "zod";

import { parseYearMonth, type YearMonth } from "../calendar/month";
import { dateOnlySchema, syncFieldsSchema } from "../events/model";

export const yearMonthSchema = z
  .string()
  .refine((value) => {
    try {
      parseYearMonth(value);
      return true;
    } catch {
      return false;
    }
  }, "YYYY-MM 형식의 월이 필요해요.")
  .transform((value) => value as YearMonth);

/**
 * A day whose meal/transport eligibility the user decided explicitly. Meal and
 * transport are separate because the rule pays them as separate 실비 items and
 * a day can qualify for one but not the other (e.g. half-day leave).
 */
export const attendanceDayOverrideSchema = z.object({
  date: dateOnlySchema,
  mealEligible: z.boolean(),
  transportEligible: z.boolean(),
});

export type AttendanceDayOverride = z.infer<typeof attendanceDayOverrideSchema>;

/**
 * The user's confirmation of one month's working-day facts that the app
 * cannot infer from rules: which scheduled days were holidays or institution
 * closures, how ambiguous days count, and whether any non-payable day
 * (복무중단·복무이탈·결근) occurred. Meal/transport amounts are only computed
 * for a month that has one of these.
 */
export const attendanceMonthSchema = syncFieldsSchema
  .extend({
    month: yearMonthSchema,
    /** Scheduled weekdays that were not working days (공휴일, 기관 휴무 등). */
    nonWorkingDates: z.array(dateOnlySchema),
    dayOverrides: z.array(attendanceDayOverrideSchema),
    /**
     * 사회복무요원 복무관리 규정 제41조⑥ categories other than sick leave:
     * 복무중단일, 복무이탈일, 연가일수를 초과한 결근일. The app does not model
     * these events, so the user states whether any occurred.
     */
    hadNonPayableAbsence: z.boolean(),
    /** `attendanceBasisFingerprint` of the data the user confirmed against. */
    basisFingerprint: z.string(),
  })
  .superRefine((record, context) => {
    const inMonth = (date: string) => date.startsWith(`${record.month}-`);
    const seen = new Set<string>();
    record.nonWorkingDates.forEach((date, index) => {
      if (!inMonth(date) || seen.has(date)) {
        context.addIssue({
          code: "custom",
          path: ["nonWorkingDates", index],
          message: "해당 월의 중복 없는 날짜만 넣을 수 있어요.",
        });
      }
      seen.add(date);
    });
    const overridden = new Set<string>();
    record.dayOverrides.forEach((item, index) => {
      if (!inMonth(item.date) || overridden.has(item.date)) {
        context.addIssue({
          code: "custom",
          path: ["dayOverrides", index, "date"],
          message: "해당 월의 중복 없는 날짜만 넣을 수 있어요.",
        });
      }
      overridden.add(item.date);
    });
  });

export type AttendanceMonth = z.infer<typeof attendanceMonthSchema>;

export type AttendanceMonthInput = Pick<
  AttendanceMonth,
  "month" | "nonWorkingDates" | "dayOverrides" | "hadNonPayableAbsence"
>;

/**
 * An immutable record of a compensation evaluation as it was shown, so later
 * rule changes never rewrite history. The domain package stores the rules
 * engine's result as opaque JSON; `ruleId`/`ruleVersion`/`total` are lifted
 * out so history can be listed without re-parsing it.
 */
export const compensationSnapshotSchema = syncFieldsSchema.extend({
  month: yearMonthSchema,
  generatedAt: z.string().datetime({ offset: true }),
  ruleId: z.string().min(1),
  ruleVersion: z.string().min(1),
  // Not forced to an integer: rates are user inputs and may carry decimals.
  total: z.number().nonnegative().nullable(),
  evaluation: z.record(z.string(), z.unknown()),
});

export type CompensationSnapshot = z.infer<typeof compensationSnapshotSchema>;

export type CompensationSnapshotInput = Pick<
  CompensationSnapshot,
  "month" | "ruleId" | "ruleVersion" | "total" | "evaluation"
>;
