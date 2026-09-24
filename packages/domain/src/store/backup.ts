import { isLive } from "../events/model";
import { canonicalJson, sha256Hex } from "./integrity";
import {
  CURRENT_SCHEMA_VERSION,
  decodeUserData,
  type UserData,
} from "./schema";

export const BACKUP_FORMAT = "super-gongik.backup" as const;
/**
 * Backup envelope versions:
 * - 1: `{ format, formatVersion, exportedAt, schemaVersion, data }`
 * - 2: adds `integrity` (SHA-256 over canonical JSON). Version 1 files stay
 *   readable; they are reported as having no integrity information.
 */
export const BACKUP_FORMAT_VERSION = 2 as const;
export const SUPPORTED_BACKUP_FORMAT_VERSIONS = [1, 2] as const;
/** Reject absurdly large files before parsing them (UTF-16 code units). */
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

/**
 * Corruption check, not authentication: the digest can be recomputed by
 * anyone who edits the file. Covers `exportedAt`, `schemaVersion` and `data`.
 */
export type BackupIntegrity = {
  algorithm: "SHA-256";
  canonicalization: "JCS";
  digest: string;
};

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  exportedAt: string;
  schemaVersion: number;
  integrity: BackupIntegrity;
  data: UserData;
};

export function computeBackupDigest(input: {
  exportedAt: unknown;
  schemaVersion: unknown;
  data: unknown;
}): string {
  return sha256Hex(
    canonicalJson({
      data: input.data,
      exportedAt: input.exportedAt,
      schemaVersion: input.schemaVersion,
    }),
  );
}

export function createBackup(data: UserData, exportedAt: string): BackupFile {
  // Round-trip through JSON so the digest covers exactly what gets written
  // (optional `undefined` members disappear on both sides).
  const plain = JSON.parse(JSON.stringify(data)) as UserData;
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    integrity: {
      algorithm: "SHA-256",
      canonicalization: "JCS",
      digest: computeBackupDigest({
        exportedAt,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        data: plain,
      }),
    },
    data: plain,
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
  attendanceMonths: number;
  compensationSnapshots: number;
};

export type BackupInfo = {
  formatVersion: (typeof SUPPORTED_BACKUP_FORMAT_VERSIONS)[number];
  exportedAt: string;
  /** Schema version of the document inside the file, before migration. */
  schemaVersion: number;
  /** Set when the document was migrated up to the current schema. */
  migratedFrom: number | null;
  migrationIssues: string[];
  /** `NOT_PRESENT` only for format 1 files, which predate the checksum. */
  integrity: "VERIFIED" | "NOT_PRESENT";
};

export type BackupErrorKind =
  /** Larger than MAX_BACKUP_BYTES. */
  | "TOO_LARGE"
  /** Not JSON at all. */
  | "MALFORMED_JSON"
  /** Looks like a SUPER GONGIK backup but the JSON is cut off or damaged. */
  | "TRUNCATED"
  /** Valid JSON, but not a SUPER GONGIK backup. */
  | "FOREIGN_FILE"
  /** Backup envelope from a newer app. */
  | "UNSUPPORTED_FORMAT_VERSION"
  /** The checksum does not match the content. */
  | "INTEGRITY_MISMATCH"
  /** The document inside was written by a newer app. */
  | "NEWER_SCHEMA"
  /** Envelope or document violates the schema. */
  | "INVALID_STRUCTURE";

export type ParsedBackup =
  | { ok: true; data: UserData; summary: BackupSummary; info: BackupInfo }
  | { ok: false; kind: BackupErrorKind; error: string };

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
    attendanceMonths: data.attendanceMonths.filter(isLive).length,
    compensationSnapshots: data.compensationSnapshots.filter(isLive).length,
  };
}

const fail = (kind: BackupErrorKind, error: string): ParsedBackup => ({
  ok: false,
  kind,
  error,
});

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Validate a backup completely before anything is written. Pure: never
 * touches storage, so callers can preview and cancel freely.
 */
export function parseBackup(text: string): ParsedBackup {
  if (text.length > MAX_BACKUP_BYTES) {
    return fail("TOO_LARGE", "백업 파일이 너무 커요 (10MB 초과).");
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return text.trimStart().startsWith("{") && text.includes(BACKUP_FORMAT)
      ? fail(
          "TRUNCATED",
          "슈퍼공익 백업 파일이지만 내용이 잘렸거나 손상됐어요. 원래 파일을 다시 내려받아 주세요.",
        )
      : fail(
          "MALFORMED_JSON",
          "JSON 형식이 아니에요. 슈퍼공익 백업 파일인지 확인해 주세요.",
        );
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("FOREIGN_FILE", "슈퍼공익 백업 파일이 아니에요.");
  }
  const file = value as Record<string, unknown>;
  if (file.format !== BACKUP_FORMAT) {
    return fail("FOREIGN_FILE", "슈퍼공익 백업 파일이 아니에요.");
  }

  const formatVersion = file.formatVersion;
  if (
    typeof formatVersion === "number" &&
    Number.isInteger(formatVersion) &&
    formatVersion > BACKUP_FORMAT_VERSION
  ) {
    return fail(
      "UNSUPPORTED_FORMAT_VERSION",
      `더 새로운 앱에서 만든 백업 형식(${formatVersion})이에요. 앱을 최신으로 업데이트한 뒤 복원해 주세요.`,
    );
  }
  if (formatVersion !== 1 && formatVersion !== 2) {
    return fail(
      "INVALID_STRUCTURE",
      `알 수 없는 백업 형식 버전(${String(formatVersion)})이에요.`,
    );
  }

  let integrity: BackupInfo["integrity"] = "NOT_PRESENT";
  if (formatVersion === 2) {
    const declared = file.integrity as Partial<BackupIntegrity> | undefined;
    if (
      typeof declared !== "object" ||
      declared === null ||
      declared.algorithm !== "SHA-256" ||
      declared.canonicalization !== "JCS" ||
      typeof declared.digest !== "string" ||
      !DIGEST_PATTERN.test(declared.digest)
    ) {
      return fail(
        "INVALID_STRUCTURE",
        "백업 파일의 무결성 정보가 없거나 형식이 잘못됐어요.",
      );
    }
    let actual: string;
    try {
      actual = computeBackupDigest({
        exportedAt: file.exportedAt,
        schemaVersion: file.schemaVersion,
        data: file.data,
      });
    } catch {
      return fail("INVALID_STRUCTURE", "백업 내용을 읽을 수 없어요.");
    }
    if (actual !== declared.digest) {
      return fail(
        "INTEGRITY_MISMATCH",
        "백업 파일의 내용이 만들 때와 달라요(체크섬 불일치). 파일이 손상됐거나 수정됐을 수 있어요. 원래 파일로 다시 시도해 주세요.",
      );
    }
    integrity = "VERIFIED";
    if (
      typeof file.exportedAt !== "string" ||
      Number.isNaN(Date.parse(file.exportedAt))
    ) {
      return fail("INVALID_STRUCTURE", "백업 시각 정보가 올바르지 않아요.");
    }
  }

  const data = file.data as { schemaVersion?: unknown } | null | undefined;
  const dataVersion =
    typeof data === "object" && data !== null ? data.schemaVersion : undefined;
  if (formatVersion === 2 && file.schemaVersion !== dataVersion) {
    return fail(
      "INVALID_STRUCTURE",
      "백업 머리말과 본문의 스키마 버전이 서로 달라요.",
    );
  }

  const decoded = decodeUserData(file.data);
  if (decoded.kind === "NEWER_VERSION") {
    return fail(
      "NEWER_SCHEMA",
      `더 새로운 버전의 앱(데이터 형식 ${decoded.foundVersion})에서 만든 백업이에요. 앱을 업데이트한 뒤 복원해 주세요.`,
    );
  }
  if (decoded.kind === "INVALID") {
    return fail(
      "INVALID_STRUCTURE",
      `백업 내용이 올바르지 않아요 (${decoded.reason}).`,
    );
  }

  const exportedAt = typeof file.exportedAt === "string" ? file.exportedAt : "";
  return {
    ok: true,
    data: decoded.data,
    summary: summarizeUserData(decoded.data, exportedAt),
    info: {
      formatVersion,
      exportedAt,
      schemaVersion: dataVersion as number,
      migratedFrom: decoded.migratedFrom,
      migrationIssues: decoded.issues,
      integrity,
    },
  };
}
