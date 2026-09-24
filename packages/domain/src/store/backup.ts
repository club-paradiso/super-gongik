import { isLive, serviceEventContentKey } from "../events/model";
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
  skippedDuplicateEvents: number;
  addedAdjustments: number;
  addedSnapshots: number;
  addedImports: number;
};

export type MergeResult =
  | { ok: true; data: UserData; stats: MergeStats }
  | { ok: false; error: string };

function newerRecord<T extends { revision: number; updatedAt: string }>(
  a: T,
  b: T,
): T {
  if (a.revision !== b.revision) return a.revision > b.revision ? a : b;
  return a.updatedAt >= b.updatedAt ? a : b;
}

/**
 * Merge a backup into the current document without deleting anything:
 * records are unioned by id; for the same id the higher revision (then the
 * later update) wins; an incoming live event whose content duplicates a
 * different live event is skipped so leave is never charged twice.
 */
export function mergeUserData(
  current: UserData,
  incoming: UserData,
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
    skippedDuplicateEvents: 0,
    addedAdjustments: 0,
    addedSnapshots: 0,
    addedImports: 0,
  };

  const events = new Map(current.events.map((event) => [event.id, event]));
  const liveContent = new Set(
    current.events.filter(isLive).map((event) => serviceEventContentKey(event)),
  );
  for (const event of incoming.events) {
    const existing = events.get(event.id);
    if (existing) {
      const winner = newerRecord(existing, event);
      if (winner !== existing) {
        events.set(event.id, winner);
        stats.updatedEvents += 1;
      }
      continue;
    }
    if (isLive(event) && liveContent.has(serviceEventContentKey(event))) {
      stats.skippedDuplicateEvents += 1;
      continue;
    }
    events.set(event.id, event);
    if (isLive(event)) liveContent.add(serviceEventContentKey(event));
    stats.addedEvents += 1;
  }

  const adjustments = new Map(
    current.leaveAdjustments.map((item) => [item.id, item]),
  );
  for (const item of incoming.leaveAdjustments) {
    const existing = adjustments.get(item.id);
    if (!existing) stats.addedAdjustments += 1;
    adjustments.set(item.id, existing ? newerRecord(existing, item) : item);
  }

  const snapshots = new Map(
    current.leaveSnapshots.map((item) => [item.id, item]),
  );
  for (const item of incoming.leaveSnapshots) {
    if (!snapshots.has(item.id)) {
      snapshots.set(item.id, item);
      stats.addedSnapshots += 1;
    }
  }

  const imports = new Map(current.imports.map((item) => [item.id, item]));
  for (const item of incoming.imports) {
    if (!imports.has(item.id)) {
      imports.set(item.id, item);
      stats.addedImports += 1;
    }
  }

  const profile =
    current.profile && current.profile.updatedAt >= incoming.profile.updatedAt
      ? current.profile
      : incoming.profile;

  return {
    ok: true,
    data: {
      ...current,
      profile,
      events: [...events.values()],
      leaveAdjustments: [...adjustments.values()],
      leaveSnapshots: [...snapshots.values()],
      imports: [...imports.values()].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    },
    stats,
  };
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
