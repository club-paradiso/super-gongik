import { attendanceBasisFingerprint } from "../compensation/fingerprint";
import {
  attendanceMonthSchema,
  compensationSnapshotSchema,
  type AttendanceMonth,
  type AttendanceMonthInput,
  type CompensationSnapshot,
  type CompensationSnapshotInput,
} from "../compensation/records";
import {
  isLive,
  serviceEventContentKey,
  serviceEventSchema,
  type EventSource,
  type ServiceEvent,
  type ServiceEventDraft,
} from "../events/model";
import {
  validateServiceEventDraft,
  type EventIssue,
} from "../events/validation";
import {
  leaveAdjustmentSchema,
  leaveSnapshotSchema,
  type ImportRecord,
  type LeaveAdjustment,
  type LeaveSnapshot,
} from "../leave/records";
import type { DateOnly } from "../service/date-only";
import {
  buildServiceProfile,
  updateServiceProfile,
  type ServiceProfile,
  type ServiceProfileInput,
} from "../service/profile";
import { createEmptyUserData, type UserData } from "./schema";

export type CommandContext = {
  now: string;
  deviceId: string;
  createId: () => string;
};

export type CommandResult<T = undefined> =
  { ok: true; data: UserData; value: T } | { ok: false; errors: EventIssue[] };

function fail(message: string): { ok: false; errors: EventIssue[] } {
  return { ok: false, errors: [{ code: "INVALID_FIELD", message }] };
}

function requireProfile(data: UserData): ServiceProfile | null {
  return data.profile;
}

function servicePeriod(profile: ServiceProfile) {
  return {
    callUpDate: profile.callUpDate,
    expectedDischargeDate: profile.expectedDischargeDate,
  };
}

// ── Profile ────────────────────────────────────────────────────────────────

export function createProfile(
  data: UserData,
  input: ServiceProfileInput,
  context: CommandContext,
): CommandResult<ServiceProfile> {
  if (data.profile) return fail("이미 복무 프로필이 있어요.");
  try {
    const id = context.createId();
    const profile = buildServiceProfile(input, {
      id,
      localProfileId: id,
      timestamp: context.now,
    });
    return { ok: true, data: { ...data, profile }, value: profile };
  } catch {
    return fail("소집일과 소집해제 예정일을 다시 확인해 주세요.");
  }
}

export function editProfile(
  data: UserData,
  input: ServiceProfileInput,
  context: CommandContext,
): CommandResult<ServiceProfile> {
  const current = requireProfile(data);
  if (!current) return fail("복무 프로필이 없어요.");
  try {
    const profile = updateServiceProfile(current, input, context.now);
    return { ok: true, data: { ...data, profile }, value: profile };
  } catch {
    return fail("입력한 날짜와 금액을 다시 확인해 주세요.");
  }
}

/** Remove every local record. Callers must confirm and offer export first. */
export function deleteAllData(data: UserData): CommandResult {
  return {
    ok: true,
    data: {
      ...createEmptyUserData(data.deviceId),
      documentRevision: data.documentRevision,
    },
    value: undefined,
  };
}

// ── Service events ─────────────────────────────────────────────────────────

export function createServiceEvent(
  data: UserData,
  draftInput: unknown,
  context: CommandContext,
): CommandResult<ServiceEvent> {
  const profile = requireProfile(data);
  if (!profile) return fail("복무 프로필을 먼저 만들어 주세요.");
  const validation = validateServiceEventDraft(draftInput, {
    existingEvents: data.events,
    servicePeriod: servicePeriod(profile),
  });
  if (validation.errors.length || !validation.draft) {
    return { ok: false, errors: validation.errors };
  }

  const event = serviceEventSchema.parse({
    ...validation.draft,
    id: context.createId(),
    serviceProfileId: profile.id,
    status: "CONFIRMED",
    source: { kind: "MANUAL" },
    createdAt: context.now,
    updatedAt: context.now,
    deletedAt: null,
    revision: 1,
    deviceId: context.deviceId,
  });
  return {
    ok: true,
    data: { ...data, events: [...data.events, event] },
    value: event,
  };
}

export function updateServiceEvent(
  data: UserData,
  id: string,
  draftInput: unknown,
  context: CommandContext,
): CommandResult<ServiceEvent> {
  const profile = requireProfile(data);
  const existing = data.events.find((event) => event.id === id);
  if (!profile || !existing || !isLive(existing)) {
    return fail("수정할 기록을 찾지 못했어요.");
  }
  const validation = validateServiceEventDraft(draftInput, {
    existingEvents: data.events,
    editingId: id,
    servicePeriod: servicePeriod(profile),
  });
  if (validation.errors.length || !validation.draft) {
    return { ok: false, errors: validation.errors };
  }

  const updated = serviceEventSchema.parse({
    ...existing,
    ...validation.draft,
    updatedAt: context.now,
    revision: existing.revision + 1,
    deviceId: context.deviceId,
  });
  return {
    ok: true,
    data: {
      ...data,
      events: data.events.map((event) => (event.id === id ? updated : event)),
    },
    value: updated,
  };
}

export function deleteServiceEvent(
  data: UserData,
  id: string,
  context: CommandContext,
): CommandResult<ServiceEvent> {
  const existing = data.events.find((event) => event.id === id);
  if (!existing || !isLive(existing))
    return fail("삭제할 기록을 찾지 못했어요.");
  const deleted: ServiceEvent = {
    ...existing,
    deletedAt: context.now,
    updatedAt: context.now,
    revision: existing.revision + 1,
    deviceId: context.deviceId,
  };
  return {
    ok: true,
    data: {
      ...data,
      events: data.events.map((event) => (event.id === id ? deleted : event)),
    },
    value: deleted,
  };
}

export function restoreServiceEvent(
  data: UserData,
  id: string,
  context: CommandContext,
): CommandResult<ServiceEvent> {
  const profile = requireProfile(data);
  const existing = data.events.find((event) => event.id === id);
  if (!profile || !existing || isLive(existing)) {
    return fail("되돌릴 기록을 찾지 못했어요.");
  }
  const validation = validateServiceEventDraft(existing, {
    existingEvents: data.events,
    editingId: id,
    servicePeriod: servicePeriod(profile),
    allowUnresolvedDuration: true,
  });
  if (validation.errors.length) return { ok: false, errors: validation.errors };

  const restored: ServiceEvent = {
    ...existing,
    deletedAt: null,
    updatedAt: context.now,
    revision: existing.revision + 1,
    deviceId: context.deviceId,
  };
  // Restoring a record of a rolled-back import makes that batch active
  // again, so a rolled-back batch never owns live records.
  const batchId =
    existing.source.kind === "IMPORT" ? existing.source.batchId : null;
  return {
    ok: true,
    data: {
      ...data,
      events: data.events.map((event) => (event.id === id ? restored : event)),
      imports: data.imports.map((record) =>
        record.id === batchId && record.status === "ROLLED_BACK"
          ? { ...record, status: "ACTIVE" as const, rolledBackAt: null }
          : record,
      ),
    },
    value: restored,
  };
}

// ── Import ─────────────────────────────────────────────────────────────────

export type ImportSource = Extract<EventSource, { kind: "IMPORT" }>;

export type ImportDraft = { draft: ServiceEventDraft; source: ImportSource };

export type ImportRowDecision =
  | { status: "NEW"; draft: ImportDraft; warnings: EventIssue[] }
  | { status: "DUPLICATE_IMPORT"; draft: ImportDraft; existingId: string }
  | { status: "DUPLICATE_CONTENT"; draft: ImportDraft; existingId: string }
  | { status: "CONFLICT"; draft: ImportDraft; errors: EventIssue[] };

/**
 * Decide, for every accepted import row, whether committing it is safe. The
 * same function drives the preview and the commit, so what the user sees is
 * exactly what gets written.
 */
export function planImportRows(
  data: UserData,
  drafts: readonly ImportDraft[],
): ImportRowDecision[] {
  const profile = data.profile;
  const live = data.events.filter(isLive);
  const byFingerprint = new Map<string, string>();
  const byContent = new Map<string, string>();
  for (const event of live) {
    if (event.source.kind === "IMPORT") {
      byFingerprint.set(event.source.fingerprint, event.id);
    }
    byContent.set(serviceEventContentKey(event), event.id);
  }

  const accepted: ServiceEvent[] = [];
  return drafts.map((item) => {
    const fingerprintMatch = byFingerprint.get(item.source.fingerprint);
    if (fingerprintMatch) {
      return {
        status: "DUPLICATE_IMPORT",
        draft: item,
        existingId: fingerprintMatch,
      };
    }
    const contentMatch = byContent.get(serviceEventContentKey(item.draft));
    if (contentMatch) {
      return {
        status: "DUPLICATE_CONTENT",
        draft: item,
        existingId: contentMatch,
      };
    }

    const validation = validateServiceEventDraft(item.draft, {
      existingEvents: [...live, ...accepted],
      servicePeriod: profile ? servicePeriod(profile) : null,
      allowUnresolvedDuration: true,
    });
    if (validation.errors.length) {
      return { status: "CONFLICT", draft: item, errors: validation.errors };
    }

    accepted.push({
      ...item.draft,
      id: `planned-${accepted.length}`,
      serviceProfileId: profile?.id ?? "",
      status: "CONFIRMED",
      source: item.source,
      createdAt: "1970-01-01T00:00:00.000Z",
      updatedAt: "1970-01-01T00:00:00.000Z",
      deletedAt: null,
      revision: 1,
      deviceId: "planning",
    });
    return { status: "NEW", draft: item, warnings: validation.warnings };
  });
}

export type ImportSnapshotInput = Omit<
  LeaveSnapshot,
  "id" | "serviceProfileId" | "importBatchId" | "createdAt" | "deletedAt"
>;

export type CommitImportInput = {
  batch: {
    id: string;
    fileName: string;
    sourceFormat: ImportRecord["sourceFormat"];
    fileSha256: string | null;
    createdAt: string;
  };
  drafts: readonly ImportDraft[];
  snapshots: readonly ImportSnapshotInput[];
  /** Rows the importer already skipped as duplicates before planning. */
  skippedBeforePlanning?: number;
};

export type CommitImportSummary = {
  added: number;
  skippedDuplicates: number;
  rejected: number;
  snapshots: number;
};

export function commitImport(
  data: UserData,
  input: CommitImportInput,
  context: CommandContext,
): CommandResult<CommitImportSummary> {
  const profile = requireProfile(data);
  if (!profile) return fail("복무 프로필을 먼저 만들어 주세요.");
  if (data.imports.some((record) => record.id === input.batch.id)) {
    return fail("이미 저장한 가져오기예요.");
  }

  const decisions = planImportRows(data, input.drafts);
  const events: ServiceEvent[] = [];
  for (const decision of decisions) {
    if (decision.status !== "NEW") continue;
    events.push(
      serviceEventSchema.parse({
        ...decision.draft.draft,
        id: context.createId(),
        serviceProfileId: profile.id,
        status: "CONFIRMED",
        source: { ...decision.draft.source, batchId: input.batch.id },
        createdAt: context.now,
        updatedAt: context.now,
        deletedAt: null,
        revision: 1,
        deviceId: context.deviceId,
      }),
    );
  }

  const snapshots: LeaveSnapshot[] = input.snapshots.map((snapshot) =>
    leaveSnapshotSchema.parse({
      ...snapshot,
      id: context.createId(),
      serviceProfileId: profile.id,
      importBatchId: input.batch.id,
      createdAt: context.now,
      deletedAt: null,
    }),
  );

  if (events.length === 0 && snapshots.length === 0) {
    return fail(
      "저장할 새 기록이 없어요. 중복이거나 확인이 필요한 행만 남았어요.",
    );
  }

  const skippedDuplicates =
    decisions.filter(
      (decision) =>
        decision.status === "DUPLICATE_IMPORT" ||
        decision.status === "DUPLICATE_CONTENT",
    ).length + (input.skippedBeforePlanning ?? 0);
  const rejected = decisions.filter(
    (decision) => decision.status === "CONFLICT",
  ).length;

  const record: ImportRecord = {
    id: input.batch.id,
    serviceProfileId: profile.id,
    fileName: input.batch.fileName,
    sourceFormat: input.batch.sourceFormat,
    fileSha256: input.batch.fileSha256,
    createdAt: input.batch.createdAt,
    eventCount: events.length,
    snapshotCount: snapshots.length,
    skippedDuplicateCount: skippedDuplicates,
    status: "ACTIVE",
    rolledBackAt: null,
  };

  return {
    ok: true,
    data: {
      ...data,
      events: [...data.events, ...events],
      leaveSnapshots: [...data.leaveSnapshots, ...snapshots],
      imports: [record, ...data.imports],
    },
    value: {
      added: events.length,
      skippedDuplicates,
      rejected,
      snapshots: snapshots.length,
    },
  };
}

/**
 * Undo one import batch. Only events whose source names this batch are
 * soft-deleted; manual records and other batches are never touched.
 */
export function rollbackImport(
  data: UserData,
  batchId: string,
  context: CommandContext,
): CommandResult<{ removedEvents: number }> {
  const record = data.imports.find((item) => item.id === batchId);
  if (!record || record.status !== "ACTIVE") {
    return fail("취소할 가져오기를 찾지 못했어요.");
  }

  let removedEvents = 0;
  const events = data.events.map((event) => {
    if (
      isLive(event) &&
      event.source.kind === "IMPORT" &&
      event.source.batchId === batchId
    ) {
      removedEvents += 1;
      return {
        ...event,
        deletedAt: context.now,
        updatedAt: context.now,
        revision: event.revision + 1,
        deviceId: context.deviceId,
      };
    }
    return event;
  });

  return {
    ok: true,
    data: {
      ...data,
      events,
      leaveSnapshots: data.leaveSnapshots.map((snapshot) =>
        snapshot.importBatchId === batchId && snapshot.deletedAt === null
          ? { ...snapshot, deletedAt: context.now }
          : snapshot,
      ),
      imports: data.imports.map((item) =>
        item.id === batchId
          ? {
              ...item,
              status: "ROLLED_BACK" as const,
              rolledBackAt: context.now,
            }
          : item,
      ),
    },
    value: { removedEvents },
  };
}

// ── Leave adjustments ──────────────────────────────────────────────────────

export function confirmLeaveCredit(
  data: UserData,
  input: {
    creditKey: string;
    grantDate: DateOnly;
    days: number;
    reason: string;
  },
  context: CommandContext,
): CommandResult<LeaveAdjustment> {
  const profile = requireProfile(data);
  if (!profile) return fail("복무 프로필이 없어요.");
  if (!Number.isInteger(input.days * 2) || input.days < 0 || input.days > 60) {
    return fail("부여 일수는 0~60일, 반일 단위로 입력해 주세요.");
  }

  const previous = data.leaveAdjustments.filter(
    (item) =>
      isLive(item) &&
      item.kind === "GRANT_CONFIRMATION" &&
      item.creditKey === input.creditKey,
  );
  const adjustment = leaveAdjustmentSchema.parse({
    id: context.createId(),
    serviceProfileId: profile.id,
    leaveType: "ANNUAL_LEAVE",
    kind: "GRANT_CONFIRMATION",
    creditKey: input.creditKey,
    effectiveDate: input.grantDate,
    amountHalfDays: input.days * 2,
    amountMinutes: 0,
    reason: input.reason,
    createdAt: context.now,
    updatedAt: context.now,
    deletedAt: null,
    revision: 1,
    deviceId: context.deviceId,
  });

  return {
    ok: true,
    data: {
      ...data,
      leaveAdjustments: [
        ...data.leaveAdjustments.map((item) =>
          previous.includes(item)
            ? {
                ...item,
                deletedAt: context.now,
                updatedAt: context.now,
                revision: item.revision + 1,
              }
            : item,
        ),
        adjustment,
      ],
    },
    value: adjustment,
  };
}

export function addLeaveCorrection(
  data: UserData,
  input: {
    effectiveDate: DateOnly;
    halfDays: number;
    minutes: number;
    reason: string;
  },
  context: CommandContext,
): CommandResult<LeaveAdjustment> {
  const profile = requireProfile(data);
  if (!profile) return fail("복무 프로필이 없어요.");
  if (!Number.isInteger(input.halfDays) || !Number.isInteger(input.minutes)) {
    return fail("보정량은 반일·분 단위의 정수여야 해요.");
  }
  if (input.halfDays === 0 && input.minutes === 0) {
    return fail("보정할 양을 입력해 주세요.");
  }
  if (!input.reason.trim()) return fail("보정 사유를 입력해 주세요.");

  const parsed = leaveAdjustmentSchema.safeParse({
    id: context.createId(),
    serviceProfileId: profile.id,
    leaveType: "ANNUAL_LEAVE",
    kind: "CORRECTION",
    creditKey: null,
    effectiveDate: input.effectiveDate,
    amountHalfDays: input.halfDays,
    amountMinutes: input.minutes,
    reason: input.reason,
    createdAt: context.now,
    updatedAt: context.now,
    deletedAt: null,
    revision: 1,
    deviceId: context.deviceId,
  });
  if (!parsed.success) return fail("보정 내용을 다시 확인해 주세요.");

  return {
    ok: true,
    data: {
      ...data,
      leaveAdjustments: [...data.leaveAdjustments, parsed.data],
    },
    value: parsed.data,
  };
}

export function deleteLeaveAdjustment(
  data: UserData,
  id: string,
  context: CommandContext,
): CommandResult {
  const existing = data.leaveAdjustments.find((item) => item.id === id);
  if (!existing || !isLive(existing)) return fail("보정 기록을 찾지 못했어요.");
  return {
    ok: true,
    data: {
      ...data,
      leaveAdjustments: data.leaveAdjustments.map((item) =>
        item.id === id
          ? {
              ...item,
              deletedAt: context.now,
              updatedAt: context.now,
              revision: item.revision + 1,
              deviceId: context.deviceId,
            }
          : item,
      ),
    },
    value: undefined,
  };
}

// ── Compensation inputs and history ────────────────────────────────────────

/**
 * Create or replace the single live attendance confirmation for a month.
 * Replacing bumps the revision of the same record so merges stay ordered.
 */
export function saveAttendanceMonth(
  data: UserData,
  input: AttendanceMonthInput,
  context: CommandContext,
): CommandResult<AttendanceMonth> {
  const profile = requireProfile(data);
  if (!profile) return fail("복무 프로필을 먼저 만들어 주세요.");
  const existing = data.attendanceMonths.find(
    (item) => isLive(item) && item.month === input.month,
  );
  const parsed = attendanceMonthSchema.safeParse({
    month: input.month,
    nonWorkingDates: [...new Set(input.nonWorkingDates)].sort(),
    dayOverrides: [...input.dayOverrides].sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
    hadNonPayableAbsence: input.hadNonPayableAbsence,
    // Computed from the stored data, not supplied by the caller.
    basisFingerprint: attendanceBasisFingerprint(
      profile,
      data.events,
      input.month,
    ),
    id: existing?.id ?? context.createId(),
    serviceProfileId: profile.id,
    createdAt: existing?.createdAt ?? context.now,
    updatedAt: context.now,
    deletedAt: null,
    revision: existing ? existing.revision + 1 : 1,
    deviceId: context.deviceId,
  });
  if (!parsed.success) {
    return fail(
      parsed.error.issues[0]?.message ?? "확인 내용을 다시 봐 주세요.",
    );
  }
  const record = parsed.data;
  return {
    ok: true,
    data: {
      ...data,
      attendanceMonths: existing
        ? data.attendanceMonths.map((item) =>
            item.id === existing.id ? record : item,
          )
        : [...data.attendanceMonths, record],
    },
    value: record,
  };
}

/** Append an immutable compensation snapshot. */
export function saveCompensationSnapshot(
  data: UserData,
  input: CompensationSnapshotInput,
  context: CommandContext,
): CommandResult<CompensationSnapshot> {
  const profile = requireProfile(data);
  if (!profile) return fail("복무 프로필을 먼저 만들어 주세요.");
  const parsed = compensationSnapshotSchema.safeParse({
    ...input,
    generatedAt: context.now,
    id: context.createId(),
    serviceProfileId: profile.id,
    createdAt: context.now,
    updatedAt: context.now,
    deletedAt: null,
    revision: 1,
    deviceId: context.deviceId,
  });
  if (!parsed.success) return fail("저장할 계산 결과가 올바르지 않아요.");
  return {
    ok: true,
    data: {
      ...data,
      compensationSnapshots: [...data.compensationSnapshots, parsed.data],
    },
    value: parsed.data,
  };
}

export function deleteCompensationSnapshot(
  data: UserData,
  id: string,
  context: CommandContext,
): CommandResult {
  const existing = data.compensationSnapshots.find((item) => item.id === id);
  if (!existing || !isLive(existing))
    return fail("저장된 계산을 찾지 못했어요.");
  return {
    ok: true,
    data: {
      ...data,
      compensationSnapshots: data.compensationSnapshots.map((item) =>
        item.id === id
          ? {
              ...item,
              deletedAt: context.now,
              updatedAt: context.now,
              revision: item.revision + 1,
              deviceId: context.deviceId,
            }
          : item,
      ),
    },
    value: undefined,
  };
}
