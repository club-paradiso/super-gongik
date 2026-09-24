import { createId } from "@super-gongik/domain";

import { classifyEventType } from "./classify";
import { fingerprintEventCandidate } from "./fingerprint";
import { findMappedHeader, mapColumns } from "./mapping";
import { normalizeEventRow, parseDateCell, parseQuantity } from "./normalize";
import type {
  ColumnMapping,
  ImportBatchDescriptor,
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

function isSnapshotShape(mappings: ReturnType<typeof mapColumns>) {
  return mappings.some((mapping) =>
    ["granted", "used", "remaining"].includes(mapping.target),
  );
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
    warnings: classification.warnings,
    raw: row,
  };
}

export async function buildImportPreview(
  tabular: TabularAdapterResult,
  batch: ImportBatchDescriptor,
  mappingOverride?: ColumnMapping[],
): Promise<ImportPreview> {
  const mappings = mappingOverride ?? mapColumns(tabular.headers);
  const hasDateColumn = mappings.some((mapping) => mapping.target === "date");
  const snapshotShape = isSnapshotShape(mappings);
  const events: ServiceEventCandidate[] = [];
  const snapshots: LeaveSnapshotCandidate[] = [];
  const unresolvedRowIndexes: number[] = [];

  for (let index = 0; index < tabular.rows.length; index += 1) {
    const row = tabular.rows[index];
    const sourceRowIndex = index + 2;

    if (snapshotShape && !hasDateColumn) {
      const snapshot = normalizeSnapshotRow(row, sourceRowIndex, mappings);
      snapshots.push(snapshot);
      if (!snapshot.leaveType || snapshot.confidence < 0.7) {
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
