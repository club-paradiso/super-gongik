import { z } from "zod";

import {
  attendanceMonthSchema,
  compensationSnapshotSchema,
} from "../compensation/records";
import { serviceEventSchema } from "../events/model";
import {
  importRecordSchema,
  leaveAdjustmentSchema,
  leaveSnapshotSchema,
} from "../leave/records";
import { storedServiceProfileSchema } from "../service/profile";

/**
 * The complete local user document. Every client (web today, native later)
 * persists exactly this shape, so backups and future sync share one contract.
 */
export const CURRENT_SCHEMA_VERSION = 3 as const;

export const userDataSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    /** Monotonic write counter used to detect writes from another tab. */
    documentRevision: z.number().int().nonnegative(),
    savedAt: z.string().datetime({ offset: true }).nullable(),
    deviceId: z.string().min(1),
    profile: storedServiceProfileSchema.nullable(),
    events: z.array(serviceEventSchema),
    leaveAdjustments: z.array(leaveAdjustmentSchema),
    leaveSnapshots: z.array(leaveSnapshotSchema),
    imports: z.array(importRecordSchema),
    attendanceMonths: z.array(attendanceMonthSchema),
    compensationSnapshots: z.array(compensationSnapshotSchema),
  })
  .superRefine((data, context) => {
    const ownerId = data.profile?.id ?? null;
    const collections = [
      ["events", data.events],
      ["leaveAdjustments", data.leaveAdjustments],
      ["leaveSnapshots", data.leaveSnapshots],
      ["imports", data.imports],
      ["attendanceMonths", data.attendanceMonths],
      ["compensationSnapshots", data.compensationSnapshots],
    ] as const;

    for (const [name, records] of collections) {
      const seen = new Set<string>();
      records.forEach((record, index) => {
        if (seen.has(record.id)) {
          context.addIssue({
            code: "custom",
            path: [name, index, "id"],
            message: `Duplicate ${name} id ${record.id}.`,
          });
        }
        seen.add(record.id);
        if (record.serviceProfileId !== ownerId) {
          context.addIssue({
            code: "custom",
            path: [name, index, "serviceProfileId"],
            message: "Record does not belong to the stored service profile.",
          });
        }
      });
    }

    const liveMonths = new Set<string>();
    data.attendanceMonths.forEach((record, index) => {
      if (record.deletedAt !== null) return;
      if (liveMonths.has(record.month)) {
        context.addIssue({
          code: "custom",
          path: ["attendanceMonths", index, "month"],
          message: `Duplicate live attendance month ${record.month}.`,
        });
      }
      liveMonths.add(record.month);
    });
  });

export type UserData = z.infer<typeof userDataSchema>;

export function createEmptyUserData(deviceId: string): UserData {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    documentRevision: 0,
    savedAt: null,
    deviceId,
    profile: null,
    events: [],
    leaveAdjustments: [],
    leaveSnapshots: [],
    imports: [],
    attendanceMonths: [],
    compensationSnapshots: [],
  };
}

export type DecodeResult =
  | {
      kind: "OK";
      data: UserData;
      migratedFrom: number | null;
      issues: string[];
    }
  | { kind: "NEWER_VERSION"; foundVersion: number }
  | { kind: "INVALID"; reason: string };

type Migration = (value: Record<string, unknown>) => {
  value: Record<string, unknown>;
  issues: string[];
};

/**
 * Document migrations keyed by the version they upgrade *from*. Version 1
 * never existed as a single document (see `legacy.ts`), so the chain starts
 * at 2.
 */
const MIGRATIONS: Record<number, Migration> = {
  // v3 adds month attendance confirmations and compensation snapshots. Both
  // start empty: nothing in a v2 document can be converted into them.
  2: (value) => ({
    value: {
      ...value,
      schemaVersion: 3,
      attendanceMonths: [],
      compensationSnapshots: [],
    },
    issues: [],
  }),
};

export function decodeUserData(value: unknown): DecodeResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { kind: "INVALID", reason: "문서가 객체가 아니에요." };
  }

  let current = value as Record<string, unknown>;
  const version = current.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return { kind: "INVALID", reason: "schemaVersion이 없어요." };
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    return { kind: "NEWER_VERSION", foundVersion: version };
  }

  const issues: string[] = [];
  for (let from = version; from < CURRENT_SCHEMA_VERSION; from += 1) {
    const migrate = MIGRATIONS[from];
    if (!migrate) {
      return {
        kind: "INVALID",
        reason: `schemaVersion ${version}에서 올릴 수 있는 마이그레이션이 없어요.`,
      };
    }
    const migrated = migrate(current);
    current = migrated.value;
    issues.push(...migrated.issues);
  }

  const parsed = userDataSchema.safeParse(current);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      kind: "INVALID",
      reason: `${first?.path.join(".") || "document"}: ${first?.message ?? "invalid"}`,
    };
  }

  return {
    kind: "OK",
    data: parsed.data,
    migratedFrom: version === CURRENT_SCHEMA_VERSION ? null : version,
    issues,
  };
}

export function decodeUserDataText(text: string): DecodeResult {
  try {
    return decodeUserData(JSON.parse(text));
  } catch {
    return { kind: "INVALID", reason: "JSON으로 읽을 수 없어요." };
  }
}
