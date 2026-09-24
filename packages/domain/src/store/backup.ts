import {
  SERVICE_EVENT_TYPE_LABELS,
  isLive,
  serviceEventContentKey,
  type ServiceEvent,
} from "../events/model";
import { compareLeaveRecords } from "../events/validation";
import type { LeaveAdjustment } from "../leave/records";
import {
  CURRENT_SCHEMA_VERSION,
  decodeUserData,
  type UserData,
} from "./schema";

export const BACKUP_FORMAT = "super-gongik.backup" as const;
export const BACKUP_FORMAT_VERSION = 1 as const;
/** Reject absurdly large files before parsing them. */
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  exportedAt: string;
  schemaVersion: number;
  data: UserData;
};

export function createBackup(data: UserData, exportedAt: string): BackupFile {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    data,
  };
}

export function serializeBackup(backup: BackupFile): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

export type BackupSummary = {
  exportedAt: string;
  profileId: string | null;
  callUpDate: string | null;
  events: number;
  deletedEvents: number;
  adjustments: number;
  snapshots: number;
  imports: number;
};

export type ParsedBackup =
  | { ok: true; data: UserData; summary: BackupSummary }
  | { ok: false; error: string };

export function summarizeUserData(
  data: UserData,
  exportedAt: string,
): BackupSummary {
  return {
    exportedAt,
    profileId: data.profile?.id ?? null,
    callUpDate: data.profile?.callUpDate ?? null,
    events: data.events.filter(isLive).length,
    deletedEvents: data.events.filter((event) => !isLive(event)).length,
    adjustments: data.leaveAdjustments.filter(isLive).length,
    snapshots: data.leaveSnapshots.filter(isLive).length,
    imports: data.imports.length,
  };
}

/** Validate a backup completely before anything is written. */
export function parseBackup(text: string): ParsedBackup {
  if (text.length > MAX_BACKUP_BYTES) {
    return { ok: false, error: "백업 파일이 너무 커요 (10MB 초과)." };
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: "JSON 형식이 아니에요. 슈퍼공익 백업 파일인지 확인해 주세요.",
    };
  }

  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "슈퍼공익 백업 파일이 아니에요." };
  }
  const file = value as Partial<BackupFile>;
  if (file.format !== BACKUP_FORMAT) {
    return { ok: false, error: "슈퍼공익 백업 파일이 아니에요." };
  }
  if (file.formatVersion !== BACKUP_FORMAT_VERSION) {
    return {
      ok: false,
      error: `지원하지 않는 백업 형식 버전(${String(file.formatVersion)})이에요. 앱을 최신으로 업데이트해 주세요.`,
    };
  }

  const decoded = decodeUserData(file.data);
  if (decoded.kind === "NEWER_VERSION") {
    return {
      ok: false,
      error:
        "더 새로운 버전의 앱에서 만든 백업이에요. 앱을 업데이트한 뒤 복원해 주세요.",
    };
  }
  if (decoded.kind === "INVALID") {
    return {
      ok: false,
      error: `백업 내용이 올바르지 않아요 (${decoded.reason}).`,
    };
  }

  const exportedAt = typeof file.exportedAt === "string" ? file.exportedAt : "";
  return {
    ok: true,
    data: decoded.data,
    summary: summarizeUserData(decoded.data, exportedAt),
  };
}

export type MergeStats = {
  addedEvents: number;
  updatedEvents: number;
  restoredEvents: number;
  /** Current live events the backup had deleted; merge keeps them live. */
  keptLiveOverBackupDeletion: number;
  skippedDuplicateEvents: number;
  skippedConflictingEvents: number;
  addedAdjustments: number;
  restoredAdjustments: number;
  skippedAdjustments: number;
  addedSnapshots: number;
  restoredSnapshots: number;
  addedImports: number;
  reactivatedImports: number;
  profileUpdated: boolean;
  /** Human-readable reasons for everything that was kept as-is. */
  conflicts: string[];
};

export type MergeResult =
  | { ok: true; data: UserData; stats: MergeStats }
  | { ok: false; error: string };

type Versioned = {
  revision: number;
  updatedAt: string;
  deletedAt: string | null;
};

function isNewer<T extends Versioned>(candidate: T, current: T): boolean {
  if (candidate.revision !== current.revision) {
    return candidate.revision > current.revision;
  }
  return candidate.updatedAt > current.updatedAt;
}

function correctionKey(item: LeaveAdjustment) {
  return [
    item.kind,
    item.creditKey ?? "",
    item.effectiveDate,
    item.amountHalfDays,
    item.amountMinutes,
    item.reason,
  ].join("|");
}

/**
 * Merge — non-destructive recovery.
 *
 * Contract (applies to events, adjustments, snapshots and imports alike):
 * 1. Nothing live in the current document is ever deleted. Tombstones in the
 *    backup never remove a current live record.
 * 2. Records missing locally are added; records deleted locally but live in
 *    the backup are restored (with a new revision) — the backup is treated as
 *    recovery evidence.
 * 3. For a record live on both sides, the newer revision wins only if it does
 *    not create a conflict.
 * 4. Anything that would charge the same leave twice (content duplicate or
 *    provable time overlap) or would give one credit two confirmations is
 *    skipped, the current state is kept, and the reason is reported.
 * 5. Import records are re-derived from their records: a batch is ACTIVE if
 *    and only if it has at least one live event or snapshot after the merge.
 *    Snapshots of a batch whose events could not be restored stay deleted.
 *
 * Use `replaceUserData` for an exact, destructive restoration.
 */
export function mergeUserData(
  current: UserData,
  incoming: UserData,
  context: { now: string; deviceId: string },
): MergeResult {
  if (!incoming.profile) {
    return { ok: false, error: "백업에 복무 프로필이 없어 합칠 수 없어요." };
  }
  if (current.profile && current.profile.id !== incoming.profile.id) {
    return {
      ok: false,
      error:
        "다른 복무 프로필의 백업이에요. 합치기 대신 '덮어쓰기'로만 복원할 수 있어요.",
    };
  }

  const stats: MergeStats = {
    addedEvents: 0,
    updatedEvents: 0,
    restoredEvents: 0,
    keptLiveOverBackupDeletion: 0,
    skippedDuplicateEvents: 0,
    skippedConflictingEvents: 0,
    addedAdjustments: 0,
    restoredAdjustments: 0,
    skippedAdjustments: 0,
    addedSnapshots: 0,
    restoredSnapshots: 0,
    addedImports: 0,
    reactivatedImports: 0,
    profileUpdated: false,
    conflicts: [],
  };
  const touch = <T extends Versioned & { deviceId: string }>(
    record: T,
    base: T,
  ): T => ({
    ...record,
    deletedAt: null,
    revision: Math.max(record.revision, base.revision) + 1,
    updatedAt: context.now,
    deviceId: context.deviceId,
  });

  // ── Events ──────────────────────────────────────────────────────────────
  const events = new Map(current.events.map((event) => [event.id, event]));
  const liveOthers = (excludeId: string) =>
    [...events.values()].filter(
      (event) => isLive(event) && event.id !== excludeId,
    );
  const blocker = (
    candidate: ServiceEvent,
  ): "DUPLICATE" | "CONFLICT" | null => {
    const others = liveOthers(candidate.id);
    const key = serviceEventContentKey(candidate);
    if (others.some((other) => serviceEventContentKey(other) === key)) {
      return "DUPLICATE";
    }
    return others.some(
      (other) => compareLeaveRecords(candidate, other) === "CONFLICT",
    )
      ? "CONFLICT"
      : null;
  };
  const describe = (event: ServiceEvent) =>
    `${event.startDate} ${SERVICE_EVENT_TYPE_LABELS[event.eventType]}`;

  const orderedIncoming = [...incoming.events].sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  );
  for (const event of orderedIncoming) {
    const existing = events.get(event.id);
    if (!existing) {
      if (!isLive(event)) {
        events.set(event.id, event); // history only; changes nothing live
        continue;
      }
      const blocked = blocker(event);
      if (blocked === "DUPLICATE") {
        stats.skippedDuplicateEvents += 1;
        continue;
      }
      if (blocked === "CONFLICT") {
        stats.skippedConflictingEvents += 1;
        stats.conflicts.push(
          `${describe(event)}: 기존 휴가와 시간이 겹쳐 추가하지 않았어요.`,
        );
        continue;
      }
      events.set(event.id, event);
      stats.addedEvents += 1;
      continue;
    }

    if (!isLive(event)) {
      if (isLive(existing)) stats.keptLiveOverBackupDeletion += 1;
      else if (isNewer(event, existing)) events.set(event.id, event);
      continue;
    }

    if (isLive(existing)) {
      if (!isNewer(event, existing)) continue;
      const blocked = blocker(event);
      if (blocked) {
        stats.skippedConflictingEvents += 1;
        stats.conflicts.push(
          `${describe(event)}: 백업의 수정본이 다른 기록과 겹쳐 현재 기록을 유지했어요.`,
        );
        continue;
      }
      events.set(event.id, event);
      stats.updatedEvents += 1;
      continue;
    }

    const restored = touch(event, existing);
    const blocked = blocker(restored);
    if (blocked) {
      if (blocked === "DUPLICATE") stats.skippedDuplicateEvents += 1;
      else {
        stats.skippedConflictingEvents += 1;
        stats.conflicts.push(
          `${describe(event)}: 되살리면 다른 휴가와 겹쳐 삭제 상태를 유지했어요.`,
        );
      }
      continue;
    }
    events.set(event.id, restored);
    stats.restoredEvents += 1;
  }

  // ── Leave adjustments ───────────────────────────────────────────────────
  const adjustments = new Map(
    current.leaveAdjustments.map((item) => [item.id, item]),
  );
  const adjustmentBlocker = (candidate: LeaveAdjustment): string | null => {
    const others = [...adjustments.values()].filter(
      (item) => isLive(item) && item.id !== candidate.id,
    );
    if (
      candidate.kind === "GRANT_CONFIRMATION" &&
      others.some(
        (item) =>
          item.kind === "GRANT_CONFIRMATION" &&
          item.creditKey === candidate.creditKey,
      )
    ) {
      return `${candidate.creditKey} 부여 확인값이 이미 있어 현재 값을 유지했어요.`;
    }
    const key = correctionKey(candidate);
    return others.some((item) => correctionKey(item) === key) ? "" : null;
  };
  for (const item of incoming.leaveAdjustments) {
    const existing = adjustments.get(item.id);
    if (!isLive(item)) {
      if (!existing) adjustments.set(item.id, item);
      else if (!isLive(existing) && isNewer(item, existing))
        adjustments.set(item.id, item);
      continue;
    }
    if (existing && isLive(existing)) {
      if (isNewer(item, existing)) adjustments.set(item.id, item);
      continue;
    }
    const candidate = existing ? touch(item, existing) : item;
    const blocked = adjustmentBlocker(candidate);
    if (blocked !== null) {
      stats.skippedAdjustments += 1;
      if (blocked) stats.conflicts.push(blocked);
      continue;
    }
    adjustments.set(item.id, candidate);
    if (existing) stats.restoredAdjustments += 1;
    else stats.addedAdjustments += 1;
  }

  // ── Imports and snapshots (batch-consistent) ────────────────────────────
  const finalEvents = [...events.values()];
  const batchHasLiveEvents = (batchId: string) =>
    finalEvents.some(
      (event) =>
        isLive(event) &&
        event.source.kind === "IMPORT" &&
        event.source.batchId === batchId,
    );
  const batchHasEvents = (batchId: string) =>
    finalEvents.some(
      (event) =>
        event.source.kind === "IMPORT" && event.source.batchId === batchId,
    );

  const snapshots = new Map(
    current.leaveSnapshots.map((item) => [item.id, item]),
  );
  for (const item of incoming.leaveSnapshots) {
    const existing = snapshots.get(item.id);
    const batchUsable =
      batchHasLiveEvents(item.importBatchId) ||
      !batchHasEvents(item.importBatchId);
    if (!existing) {
      if (isLive(item) && !batchUsable) {
        // Its batch's events could not come back; keep it as history only.
        snapshots.set(item.id, { ...item, deletedAt: context.now });
      } else {
        snapshots.set(item.id, item);
        if (isLive(item)) stats.addedSnapshots += 1;
      }
      continue;
    }
    if (isLive(item) && !isLive(existing) && batchUsable) {
      snapshots.set(item.id, { ...existing, deletedAt: null });
      stats.restoredSnapshots += 1;
    }
  }
  const finalSnapshots = [...snapshots.values()];

  const imports = new Map(current.imports.map((item) => [item.id, item]));
  for (const item of incoming.imports) {
    if (!imports.has(item.id)) {
      imports.set(item.id, item);
      stats.addedImports += 1;
    }
  }
  const incomingImportIds = new Set(incoming.imports.map((item) => item.id));
  for (const [id, record] of imports) {
    if (!incomingImportIds.has(id)) continue;
    const live =
      batchHasLiveEvents(id) ||
      finalSnapshots.some((item) => isLive(item) && item.importBatchId === id);
    if (live && record.status !== "ACTIVE") {
      imports.set(id, { ...record, status: "ACTIVE", rolledBackAt: null });
      stats.reactivatedImports += 1;
    } else if (!live && record.status === "ACTIVE" && batchHasEvents(id)) {
      imports.set(id, {
        ...record,
        status: "ROLLED_BACK",
        rolledBackAt: context.now,
      });
    }
  }

  let profile = current.profile ?? incoming.profile;
  if (
    current.profile &&
    incoming.profile.updatedAt > current.profile.updatedAt
  ) {
    profile = incoming.profile;
    stats.profileUpdated = true;
  }

  return {
    ok: true,
    data: {
      ...current,
      profile,
      events: finalEvents,
      leaveAdjustments: [...adjustments.values()],
      leaveSnapshots: finalSnapshots,
      imports: [...imports.values()].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    },
    stats,
  };
}

/**
 * Invariant every command and merge must keep: a rolled-back import batch
 * has no live events or snapshots. (An ACTIVE batch may legitimately end up
 * empty when the user deletes its records one by one.)
 */
export function importConsistencyIssues(data: UserData): string[] {
  const issues: string[] = [];
  for (const record of data.imports) {
    if (record.status !== "ROLLED_BACK") continue;
    const liveEvents = data.events.some(
      (event) =>
        isLive(event) &&
        event.source.kind === "IMPORT" &&
        event.source.batchId === record.id,
    );
    const liveSnapshots = data.leaveSnapshots.some(
      (item) => isLive(item) && item.importBatchId === record.id,
    );
    if (liveEvents || liveSnapshots) {
      issues.push(`${record.id}: rolled back but has live records`);
    }
  }
  return issues;
}

/** Replace everything with a backup, keeping this device's identity. */
export function replaceUserData(
  current: UserData,
  incoming: UserData,
): UserData {
  return {
    ...incoming,
    deviceId: current.deviceId,
    documentRevision: current.documentRevision,
    savedAt: current.savedAt,
  };
}
