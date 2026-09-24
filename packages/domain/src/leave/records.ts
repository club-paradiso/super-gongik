import { z } from "zod";

import {
  dateOnlySchema,
  importSourceFormatSchema,
  serviceEventTypeSchema,
  syncFieldsSchema,
} from "../events/model";

/**
 * A user-authored ledger entry. Leave usage is never stored here — it is
 * always derived from service events. Adjustments exist only for:
 *
 * - GRANT_CONFIRMATION: the user confirms (or overrides) a credit that no
 *   verified rule bundle can supply for its grant date.
 * - CORRECTION: an explicit, reasoned correction, typically to reconcile with
 *   an institution record. Amounts are signed integers.
 */
export const leaveAdjustmentSchema = syncFieldsSchema
  .extend({
    leaveType: z.literal("ANNUAL_LEAVE"),
    kind: z.enum(["GRANT_CONFIRMATION", "CORRECTION"]),
    creditKey: z.string().min(1).nullable(),
    effectiveDate: dateOnlySchema,
    amountHalfDays: z.number().int(),
    amountMinutes: z.number().int(),
    reason: z.string().trim().min(1).max(200),
  })
  .superRefine((adjustment, context) => {
    if (adjustment.kind === "GRANT_CONFIRMATION") {
      if (adjustment.creditKey === null) {
        context.addIssue({ code: "custom", message: "creditKey is required." });
      }
      if (adjustment.amountHalfDays < 0 || adjustment.amountMinutes !== 0) {
        context.addIssue({
          code: "custom",
          message: "A grant confirmation must be a non-negative day amount.",
        });
      }
    }
  });

export type LeaveAdjustment = z.infer<typeof leaveAdjustmentSchema>;

/**
 * Point-in-time balance evidence from an institution document. Day values are
 * kept exactly as printed; they are never expanded into dated events.
 */
export const leaveSnapshotSchema = z.object({
  id: z.string().min(1),
  serviceProfileId: z.string().min(1),
  importBatchId: z.string().min(1),
  leaveType: serviceEventTypeSchema.nullable(),
  asOfDate: dateOnlySchema.nullable(),
  grantedDays: z.number().nonnegative().nullable(),
  grantedMinutes: z.number().int().nonnegative().nullable(),
  usedDays: z.number().nonnegative().nullable(),
  usedMinutes: z.number().int().nonnegative().nullable(),
  remainingDays: z.number().nonnegative().nullable(),
  remainingMinutes: z.number().int().nonnegative().nullable(),
  confidence: z.number().min(0).max(1),
  sourceRowIndex: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
  deletedAt: z.string().datetime({ offset: true }).nullable(),
});

export type LeaveSnapshot = z.infer<typeof leaveSnapshotSchema>;

export const importRecordSchema = z.object({
  id: z.string().min(1),
  serviceProfileId: z.string().min(1),
  fileName: z.string(),
  sourceFormat: importSourceFormatSchema,
  fileSha256: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  eventCount: z.number().int().nonnegative(),
  snapshotCount: z.number().int().nonnegative(),
  skippedDuplicateCount: z.number().int().nonnegative(),
  status: z.enum(["ACTIVE", "ROLLED_BACK"]),
  rolledBackAt: z.string().datetime({ offset: true }).nullable(),
});

export type ImportRecord = z.infer<typeof importRecordSchema>;
