import { z } from "zod";

import { inclusiveDaySpan } from "../calendar/month";
import {
  compareDateOnly,
  isDateOnly,
  type DateOnly,
} from "../service/date-only";

/**
 * Canonical service-event types. Imported and manually entered records share
 * this single vocabulary; no feature keeps a parallel event list.
 */
export const SERVICE_EVENT_TYPES = [
  "ANNUAL_LEAVE",
  "SICK_LEAVE",
  "OFFICIAL_LEAVE",
  "SPECIAL_LEAVE",
  "COMPASSIONATE_LEAVE",
  "OUTING",
  "LATE_ARRIVAL",
  "EARLY_LEAVE",
  "EDUCATION",
  "TRAINING",
  "SERVICE_SUSPENSION",
  "SERVICE_ABSENCE",
  "EXCESS_ANNUAL_ABSENCE",
  "USER_NOTE",
] as const;

export type ServiceEventType = (typeof SERVICE_EVENT_TYPES)[number];

export const LEAVE_EVENT_TYPES: readonly ServiceEventType[] = [
  "ANNUAL_LEAVE",
  "SICK_LEAVE",
  "OFFICIAL_LEAVE",
  "SPECIAL_LEAVE",
  "COMPASSIONATE_LEAVE",
];

export const ATTENDANCE_EVENT_TYPES: readonly ServiceEventType[] = [
  "OUTING",
  "LATE_ARRIVAL",
  "EARLY_LEAVE",
];

export const COMPENSATION_NONPAYABLE_EVENT_TYPES: readonly ServiceEventType[] =
  ["SERVICE_SUSPENSION", "SERVICE_ABSENCE", "EXCESS_ANNUAL_ABSENCE"];

export function isCompensationNonPayableEventType(
  type: ServiceEventType,
): boolean {
  return COMPENSATION_NONPAYABLE_EVENT_TYPES.includes(type);
}

export const SICK_LEAVE_CATEGORIES = [
  "ORDINARY",
  "PUBLIC_DUTY",
  "UNKNOWN",
] as const;
export type SickLeaveCategory = (typeof SICK_LEAVE_CATEGORIES)[number];
export const sickLeaveCategorySchema = z.enum(SICK_LEAVE_CATEGORIES);

export const SERVICE_EVENT_TYPE_LABELS: Record<ServiceEventType, string> = {
  ANNUAL_LEAVE: "연가",
  SICK_LEAVE: "병가",
  OFFICIAL_LEAVE: "공가",
  SPECIAL_LEAVE: "특별휴가",
  COMPASSIONATE_LEAVE: "청원휴가",
  OUTING: "외출",
  LATE_ARRIVAL: "지각",
  EARLY_LEAVE: "조퇴",
  EDUCATION: "교육",
  TRAINING: "훈련",
  SERVICE_SUSPENSION: "복무중단",
  SERVICE_ABSENCE: "복무이탈",
  EXCESS_ANNUAL_ABSENCE: "연가초과 결근",
  USER_NOTE: "메모",
};

export function isLeaveEventType(type: ServiceEventType): boolean {
  return LEAVE_EVENT_TYPES.includes(type);
}

export const serviceEventTypeSchema = z.enum(SERVICE_EVENT_TYPES);

export const dateOnlySchema = z
  .string()
  .refine(isDateOnly, "유효한 날짜가 아니에요.")
  .transform((value) => value as DateOnly);

const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const clockTimeSchema = z
  .string()
  .regex(CLOCK_PATTERN, "HH:MM 형식의 시각이 필요해요.");

export function clockToMinutes(value: string): number {
  const match = CLOCK_PATTERN.exec(value);
  if (!match) throw new RangeError(`Invalid clock time: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export const MAX_PARTIAL_MINUTES = 24 * 60 - 1;

/**
 * How much of the day an event occupies.
 *
 * - ALL_DAY: whole days. `dayCount` is the explicit, user-confirmed number of
 *   charged days inside [startDate, endDate]; weekends/holidays are not
 *   inferred by the model.
 * - HALF_DAY: the rule-backed half-day annual-leave unit (two halves = one
 *   day). It is deliberately *not* converted to minutes.
 * - PARTIAL: an explicit minute duration. `durationMinutes` is null only for
 *   imported rows whose duration could not be resolved; such events are
 *   surfaced as unresolved and are never silently charged.
 */
export const eventTimingSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ALL_DAY"),
    dayCount: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("HALF_DAY"),
    half: z.enum(["AM", "PM"]).nullable(),
  }),
  z.object({
    kind: z.literal("PARTIAL"),
    durationMinutes: z
      .number()
      .int()
      .positive()
      .max(MAX_PARTIAL_MINUTES)
      .nullable(),
    startTime: clockTimeSchema.nullable(),
    endTime: clockTimeSchema.nullable(),
  }),
]);

export type EventTiming = z.infer<typeof eventTimingSchema>;

export const importSourceFormatSchema = z.enum([
  "CSV",
  "XLSX",
  "PDF_TEXT",
  "PDF_OCR",
  "HWP",
  "HWPX",
  "UNKNOWN",
]);

export type ImportSourceFormat = z.infer<typeof importSourceFormatSchema>;

export const eventSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("MANUAL") }),
  z.object({
    kind: z.literal("IMPORT"),
    batchId: z.string().min(1),
    format: importSourceFormatSchema,
    fileName: z.string(),
    fingerprint: z.string().min(1),
    confidence: z.number().min(0).max(1),
    sourceRowIndex: z.number().int().nonnegative(),
  }),
]);

export type EventSource = z.infer<typeof eventSourceSchema>;

/** Fields every mutable, sync-capable user record carries. */
export const syncFieldsSchema = z.object({
  id: z.string().min(1),
  serviceProfileId: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  deletedAt: z.string().datetime({ offset: true }).nullable(),
  revision: z.number().int().positive(),
  deviceId: z.string().min(1),
});

export type SyncFields = z.infer<typeof syncFieldsSchema>;

export const serviceEventDraftShape = z.object({
  eventType: serviceEventTypeSchema,
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  timing: eventTimingSchema,
  title: z.string().trim().max(80).nullable(),
  note: z.string().trim().max(500).nullable(),
  /**
   * Compensation-relevant sick-leave classification. Missing/UNKNOWN means
   * the app must not decide whether the leave counts toward the ordinary
   * 30-day threshold.
   */
  sickLeaveCategory: sickLeaveCategorySchema.nullable().optional(),
});

export type ServiceEventDraft = z.infer<typeof serviceEventDraftShape>;

/**
 * Structural invariants that must hold for every stored event, regardless of
 * whether it was typed in or imported.
 */
export function structuralEventIssues(draft: ServiceEventDraft): string[] {
  const issues: string[] = [];
  if (compareDateOnly(draft.startDate, draft.endDate) > 0) {
    issues.push("END_BEFORE_START");
    return issues;
  }

  const span = inclusiveDaySpan(draft.startDate, draft.endDate);
  if (draft.timing.kind !== "ALL_DAY" && span !== 1) {
    issues.push("MULTI_DAY_PARTIAL");
  }
  if (draft.timing.kind === "ALL_DAY" && draft.timing.dayCount > span) {
    issues.push("DAY_COUNT_EXCEEDS_RANGE");
  }
  if (draft.timing.kind === "HALF_DAY" && draft.eventType !== "ANNUAL_LEAVE") {
    issues.push("HALF_DAY_NOT_ANNUAL_LEAVE");
  }
  if (
    isCompensationNonPayableEventType(draft.eventType) &&
    draft.timing.kind !== "ALL_DAY"
  ) {
    issues.push("COMPENSATION_ABSENCE_MUST_BE_ALL_DAY");
  }
  if (
    draft.eventType !== "SICK_LEAVE" &&
    draft.sickLeaveCategory !== undefined &&
    draft.sickLeaveCategory !== null
  ) {
    issues.push("SICK_CATEGORY_NOT_SICK_LEAVE");
  }
  if (
    draft.timing.kind === "PARTIAL" &&
    draft.timing.startTime &&
    draft.timing.endTime &&
    clockToMinutes(draft.timing.endTime) <=
      clockToMinutes(draft.timing.startTime)
  ) {
    issues.push("END_TIME_NOT_AFTER_START");
  }
  return issues;
}

export const serviceEventSchema = serviceEventDraftShape
  .extend(syncFieldsSchema.shape)
  .extend({
    status: z.literal("CONFIRMED"),
    source: eventSourceSchema,
  })
  .superRefine((event, context) => {
    for (const issue of structuralEventIssues(event)) {
      context.addIssue({ code: "custom", message: issue });
    }
  });

export type ServiceEvent = z.infer<typeof serviceEventSchema>;

export function isLive<T extends { deletedAt: string | null }>(record: T) {
  return record.deletedAt === null;
}

/**
 * Content key used to detect the same fact arriving through different paths
 * (manual entry, another export file, a merged backup). Notes and titles are
 * excluded on purpose: they vary between sources for the same leave.
 */
export function serviceEventContentKey(
  event: Pick<
    ServiceEventDraft,
    "eventType" | "startDate" | "endDate" | "timing"
  >,
): string {
  const timing = event.timing;
  const timingKey =
    timing.kind === "ALL_DAY"
      ? `D${timing.dayCount}`
      : timing.kind === "HALF_DAY"
        ? `H${timing.half ?? "?"}`
        : `P${timing.durationMinutes ?? "?"}@${timing.startTime ?? ""}-${timing.endTime ?? ""}`;
  return [event.eventType, event.startDate, event.endDate, timingKey].join("|");
}
