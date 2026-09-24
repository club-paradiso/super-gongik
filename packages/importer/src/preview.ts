import { createId } from "@super-gongik/domain";

import { classifyEventType } from "./classify";
import { fingerprintEventCandidate } from "./fingerprint";
import {
  assessColumnMappings,
  findMappedHeader,
  mapColumns,
} from "./mapping";
import { normalizeEventRow, parseDateCell, parseQuantity } from "./normalize";
import type {
  ColumnMapping,
  ImportBatchDescriptor,
  ImportWarning,
  ImportWarningCode,
  ImportPreview,
  ImportSourceFormat,
  LeaveSnapshotCandidate,
  ServiceEventCandidate,
  TabularAdapterResult,
  TabularRow,
} from "./types";

/** Rows carrying these warnings are never pre-selected for commit. */
export const BLOCKING_WARNING_CODES: readonly ImportWarningCode[] = [
  "AMBIGUOUS_HALF_DAY",
  "AMBIGUOUS_DAY_FRACTION",
  "AMBIGUOUS_NUMERIC_DURATION",
  "AMBIGUOUS_SNAPSHOT_QUANTITY",
  "EMPTY_SNAPSHOT",
  "MIXED_DAY_AND_TIME",
];

export function createImportBatchDescriptor(input: {
  fileName: string;
  sourceFormat: ImportSourceFormat;
  fileSha256?: string | null;
  createdAt?: string;
  id?: string;
}): ImportBatchDescriptor {
  return {
    id: input.id ?? createId(),
    fileName: input.fileName,
    sourceFormat: input.sourceFormat,
    fileSha256: input.fileSha256 ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

function getValue(
  row: TabularRow,
  mappings: ReturnType<typeof mapColumns>,
  target: Parameters<typeof findMappedHeader>[1],
) {
  const header = findMappedHeader(mappings, target);
  return header ? row[header] : null;
}

function normalizeSnapshotRow(
  row: TabularRow,
  sourceRowIndex: number,
  mappings: ReturnType<typeof mapColumns>,
): LeaveSnapshotCandidate {
  const classification = classifyEventType(
    getValue(row, mappings, "eventType"),
  );
  const quantity = (target: "granted" | "used" | "remaining") =>
    parseQuantity(
      getValue(row, mappings, target),
      findMappedHeader(mappings, target),
    );
  const granted = quantity("granted");
  const used = quantity("used");
  const remaining = quantity("remaining");
  const warnings: ImportWarning[] = [...classification.warnings];

  if (
    granted.ambiguousNumber ||
    used.ambiguousNumber ||
    remaining.ambiguousNumber
  ) {
    warnings.push({
      code: "AMBIGUOUS_SNAPSHOT_QUANTITY",
      message:
        "기관 잔액 값에 일·시간·분 단위가 없어 자동 저장하지 않습니다. 원문 단위를 확인해 주세요.",
    });
  }

  const hasAnyQuantity = [
    granted.days,
    granted.minutes,
    used.days,
    used.minutes,
    remaining.days,
    remaining.minutes,
  ].some((value) => value !== null);

  if (!hasAnyQuantity) {
    warnings.push({
      code: "EMPTY_SNAPSHOT",
      message:
        "부여·사용·잔여 중 해석 가능한 값이 없어 기관 잔액으로 저장하지 않습니다.",
    });
  }

  return {
    sourceRowIndex,
    leaveType: classification.eventType,
    asOfDate:
      parseDateCell(getValue(row, mappings, "asOfDate")) ??
      parseDateCell(getValue(row, mappings, "date")),
    grantedDays: granted.days,
    grantedMinutes: granted.minutes,
    usedDays: used.days,
    usedMinutes: used.minutes,
    remainingDays: remaining.days,
    remainingMinutes: remaining.minutes,
    confidence: classification.confidence,
    warnings,
    raw: row,
  };
}

export async function buildImportPreview(
  tabular: TabularAdapterResult,
  batch: ImportBatchDescriptor,
  mappingOverride?: ColumnMapping[],
): Promise<ImportPreview> {
  const mappings = mappingOverride ?? mapColumns(tabular.headers);
  const shape = assessColumnMappings(mappings);
  const events: ServiceEventCandidate[] = [];
  const snapshots: LeaveSnapshotCandidate[] = [];
  const unresolvedRowIndexes: number[] = [];

  for (let index = 0; index < tabular.rows.length; index += 1) {
    const row = tabular.rows[index];
    const sourceRowIndex = tabular.rowSourceIndexes?.[index] ?? index + 2;

    if (shape.kind === "SNAPSHOT") {
      const snapshot = normalizeSnapshotRow(row, sourceRowIndex, mappings);
      snapshots.push(snapshot);
      if (
        !snapshot.leaveType ||
        snapshot.confidence < 0.7 ||
        snapshot.warnings.some((warning) =>
          BLOCKING_WARNING_CODES.includes(warning.code),
        )
      ) {
        unresolvedRowIndexes.push(sourceRowIndex);
      }
      continue;
    }

    const candidate = normalizeEventRow(row, sourceRowIndex, mappings);
    if (candidate.date && candidate.eventType) {
      candidate.fingerprint = await fingerprintEventCandidate(candidate);
    }
    events.push(candidate);

    if (
      !candidate.date ||
      !candidate.eventType ||
      candidate.confidence < 0.7 ||
      candidate.warnings.some((warning) =>
        BLOCKING_WARNING_CODES.includes(warning.code),
      )
    ) {
      unresolvedRowIndexes.push(sourceRowIndex);
    }
  }

  return { batch, mappings, events, snapshots, unresolvedRowIndexes };
}
