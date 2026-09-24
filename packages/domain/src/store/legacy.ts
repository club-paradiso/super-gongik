import {
  SERVICE_EVENT_TYPES,
  importSourceFormatSchema,
  serviceEventSchema,
  type EventTiming,
  type ServiceEvent,
  type ServiceEventType,
} from "../events/model";
import {
  importRecordSchema,
  leaveSnapshotSchema,
  type ImportRecord,
  type LeaveSnapshot,
} from "../leave/records";
import { endDateForChargedDays } from "../calendar/month";
import { isDateOnly, type DateOnly } from "../service/date-only";
import { parseServiceProfile, type ServiceProfile } from "../service/profile";
import {
  CURRENT_SCHEMA_VERSION,
  userDataSchema,
  type UserData,
} from "./schema";

/**
 * Storage layout written by releases before the canonical document existed:
 *
 * - `super-gongik.service-profile.v1` — the guest profile JSON
 * - `super-gongik:service-records:v1:<profileId>` — imported events,
 *   institution snapshots, import history and the workday setting
 * - `super-gongik:device-id:v1` — random device id
 */
export const LEGACY_KEYS = {
  profile: "super-gongik.service-profile.v1",
  recordsPrefix: "super-gongik:service-records:v1:",
  deviceId: "super-gongik:device-id:v1",
} as const;

export type LegacyInput = {
  profileRaw: string | null;
  recordsRaw: string | null;
  deviceIdRaw: string | null;
};

export type LegacyMigration =
  | { kind: "NONE" }
  | { kind: "CORRUPT_PROFILE" }
  | { kind: "MIGRATED"; data: UserData; issues: string[] };

type LegacyEvent = {
  id?: unknown;
  eventType?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  durationMinutes?: unknown;
  allDay?: unknown;
  title?: unknown;
  note?: unknown;
  metadata?: Record<string, unknown> | null;
  createdAt?: unknown;
  updatedAt?: unknown;
  deletedAt?: unknown;
  revision?: unknown;
  deviceId?: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function legacyTiming(event: LegacyEvent): {
  timing: EventTiming;
  issue: string | null;
} {
  const metadata = event.metadata ?? {};
  const minutes = event.durationMinutes;
  const dayCount = metadata.importDayCount;
  const startTime = asString(event.startsAt)?.slice(11, 16) ?? null;
  const endTime = asString(event.endsAt)?.slice(11, 16) ?? null;
  const clock = (value: string | null) =>
    value && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) && value !== "00:00"
      ? value
      : null;

  // The v1 ledger charged explicit minutes whenever they existed, even on rows
  // marked all-day, and charged whole days only when minutes were absent.
  // Preserve exactly that behaviour.
  if (typeof minutes === "number") {
    if (Number.isInteger(minutes) && minutes > 0 && minutes < 1440) {
      return {
        timing: {
          kind: "PARTIAL",
          durationMinutes: minutes,
          startTime: clock(startTime),
          endTime: clock(endTime),
        },
        issue: null,
      };
    }
    return {
      timing: {
        kind: "PARTIAL",
        durationMinutes: null,
        startTime: null,
        endTime: null,
      },
      issue: `사용 시간 ${minutes}분을 그대로 옮길 수 없어 '시간 확인 필요'로 표시했어요.`,
    };
  }

  if (event.allDay === true) {
    const count = typeof dayCount === "number" ? dayCount : 1;
    if (Number.isInteger(count) && count >= 1) {
      return { timing: { kind: "ALL_DAY", dayCount: count }, issue: null };
    }
    return {
      timing: {
        kind: "PARTIAL",
        durationMinutes: null,
        startTime: null,
        endTime: null,
      },
      issue: `원본 일수 ${String(count)}일을 그대로 옮길 수 없어 '시간 확인 필요'로 표시했어요.`,
    };
  }

  return {
    timing: {
      kind: "PARTIAL",
      durationMinutes: null,
      startTime: clock(startTime),
      endTime: clock(endTime),
    },
    issue: null,
  };
}

function migrateEvent(
  raw: LegacyEvent,
  profileId: string,
  fallbackDeviceId: string,
  migratedAt: string,
): { event: ServiceEvent | null; issue: string | null } {
  const startsAt = asString(raw.startsAt);
  const date = startsAt?.slice(0, 10) ?? "";
  const eventType = raw.eventType as ServiceEventType;
  if (!isDateOnly(date) || !SERVICE_EVENT_TYPES.includes(eventType)) {
    return {
      event: null,
      issue: `날짜나 종류를 읽을 수 없는 기록 1건(${String(raw.id)})을 옮기지 못했어요.`,
    };
  }

  const metadata = raw.metadata ?? {};
  const { timing, issue: timingIssue } = legacyTiming(raw);
  let issue = timingIssue;
  let endDate = date as DateOnly;
  if (timing.kind === "ALL_DAY" && timing.dayCount > 1) {
    endDate = endDateForChargedDays(date as DateOnly, timing.dayCount);
    issue = `${date}부터 ${timing.dayCount}일 기록은 종료일을 주말을 빼고 ${endDate}로 추정했어요. 캘린더에서 확인해 주세요.`;
  }
  const batchId = asString(metadata.importBatchId);
  const candidate = {
    id:
      asString(raw.id) ??
      `legacy-${date}-${Math.random().toString(36).slice(2)}`,
    serviceProfileId: profileId,
    eventType,
    startDate: date as DateOnly,
    endDate,
    timing,
    title: asString(raw.title)?.slice(0, 80) ?? null,
    note: asString(raw.note)?.slice(0, 500) ?? null,
    status: "CONFIRMED" as const,
    source: batchId
      ? {
          kind: "IMPORT" as const,
          batchId,
          format: importSourceFormatSchema
            .catch("UNKNOWN")
            .parse(metadata.importSourceFormat),
          fileName: asString(metadata.importSourceFileName) ?? "",
          fingerprint:
            asString(metadata.importFingerprint) ?? `legacy:${raw.id}`,
          confidence:
            typeof metadata.importConfidence === "number"
              ? Math.min(1, Math.max(0, metadata.importConfidence))
              : 0,
          sourceRowIndex:
            typeof metadata.importSourceRowIndex === "number" &&
            Number.isInteger(metadata.importSourceRowIndex) &&
            metadata.importSourceRowIndex >= 0
              ? metadata.importSourceRowIndex
              : 0,
        }
      : { kind: "MANUAL" as const },
    createdAt: asString(raw.createdAt) ?? migratedAt,
    updatedAt: asString(raw.updatedAt) ?? migratedAt,
    deletedAt: asString(raw.deletedAt),
    revision:
      typeof raw.revision === "number" &&
      Number.isInteger(raw.revision) &&
      raw.revision > 0
        ? raw.revision
        : 1,
    deviceId: asString(raw.deviceId) ?? fallbackDeviceId,
  };

  const parsed = serviceEventSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      event: null,
      issue: `${date} 기록 1건의 형식이 맞지 않아 옮기지 못했어요.`,
    };
  }
  return { event: parsed.data, issue };
}

/**
 * Convert the pre-document storage layout into the canonical document.
 * Pure: the repository reads the keys, this function never touches storage,
 * and legacy keys are left in place as an untouched fallback copy.
 */
export function migrateLegacyStorage(
  input: LegacyInput,
  context: { now: string; createDeviceId: () => string },
): LegacyMigration {
  if (!input.profileRaw) return { kind: "NONE" };

  let profile: ServiceProfile;
  try {
    profile = parseServiceProfile(JSON.parse(input.profileRaw));
  } catch {
    return { kind: "CORRUPT_PROFILE" };
  }

  const deviceId = asString(input.deviceIdRaw) ?? context.createDeviceId();
  const issues: string[] = [];
  const events: ServiceEvent[] = [];
  const snapshots: LeaveSnapshot[] = [];
  const imports: ImportRecord[] = [];

  let records: Record<string, unknown> | null = null;
  if (input.recordsRaw) {
    try {
      const parsed = JSON.parse(input.recordsRaw) as unknown;
      if (typeof parsed === "object" && parsed !== null) {
        records = parsed as Record<string, unknown>;
      }
    } catch {
      issues.push(
        "이전 버전의 복무기록 저장본을 읽지 못했어요. 원본은 기기에 그대로 남겨 두었어요.",
      );
    }
  }

  if (records) {
    const workday = records.workdayMinutes;
    if (
      typeof workday === "number" &&
      Number.isInteger(workday) &&
      workday >= 60 &&
      workday <= 1440
    ) {
      profile = {
        ...profile,
        workdayMinutes: profile.workdayMinutes ?? workday,
      };
    }

    for (const raw of Array.isArray(records.events) ? records.events : []) {
      const result = migrateEvent(
        (raw ?? {}) as LegacyEvent,
        profile.id,
        deviceId,
        context.now,
      );
      if (result.event) events.push(result.event);
      if (result.issue) issues.push(result.issue);
    }

    for (const raw of Array.isArray(records.snapshots)
      ? records.snapshots
      : []) {
      const parsed = leaveSnapshotSchema.safeParse({
        ...(raw as object),
        serviceProfileId: profile.id,
      });
      if (parsed.success) snapshots.push(parsed.data);
      else
        issues.push("기관 잔액 기록 1건의 형식이 맞지 않아 옮기지 못했어요.");
    }

    for (const raw of Array.isArray(records.imports) ? records.imports : []) {
      const parsed = importRecordSchema.safeParse({
        ...(raw as object),
        serviceProfileId: profile.id,
      });
      if (parsed.success) imports.push(parsed.data);
      else issues.push("가져오기 이력 1건의 형식이 맞지 않아 옮기지 못했어요.");
    }
  }

  const dedupe = <T extends { id: string }>(items: T[]) => {
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  };

  const data = userDataSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    documentRevision: 0,
    savedAt: null,
    deviceId,
    profile,
    events: dedupe(events),
    leaveAdjustments: [],
    leaveSnapshots: dedupe(snapshots),
    imports: dedupe(imports),
  });

  return { kind: "MIGRATED", data, issues };
}
