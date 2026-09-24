import type {
  ImportSourceFormat,
  ServiceEventType,
} from "@super-gongik/domain";

export type { ImportSourceFormat };

export type CanonicalColumn =
  | "date"
  | "eventType"
  | "duration"
  | "startTime"
  | "endTime"
  | "note"
  | "granted"
  | "used"
  | "remaining"
  | "asOfDate";

export type TabularCell = string | number | boolean | Date | null | undefined;
export type TabularRow = Record<string, TabularCell>;

/** Imports target the canonical domain vocabulary; there is no second list. */
export type ImportableServiceEventType = ServiceEventType;

export interface ColumnMapping {
  sourceHeader: string;
  target: CanonicalColumn;
  confidence: number;
}

export type TabularTableKind = "EVENTS" | "SNAPSHOT" | "UNRECOGNIZED";

export interface TableShapeAssessment {
  kind: TabularTableKind;
  score: number;
  mappings: ColumnMapping[];
}

export type ImportWarningCode =
  | "MISSING_DATE"
  | "MISSING_EVENT_TYPE"
  | "MISSING_DURATION"
  | "UNRECOGNIZED_DATE"
  | "UNRECOGNIZED_EVENT_TYPE"
  | "UNRECOGNIZED_DURATION"
  | "AMBIGUOUS_HALF_DAY"
  | "AMBIGUOUS_DAY_FRACTION"
  | "AMBIGUOUS_NUMERIC_DURATION"
  | "AMBIGUOUS_SNAPSHOT_QUANTITY"
  | "EMPTY_SNAPSHOT"
  | "MIXED_DAY_AND_TIME"
  | "HALF_DAY_UNIT"
  | "LOW_CONFIDENCE";

export interface ImportWarning {
  code: ImportWarningCode;
  message: string;
}

export interface ServiceEventCandidate {
  sourceRowIndex: number;
  eventType: ImportableServiceEventType | null;
  date: string | null;
  allDay: boolean;
  durationDays: number | null;
  durationMinutes: number | null;
  startTime: string | null;
  endTime: string | null;
  /** Source says "반가" without an explicit duration: a rule-backed half day. */
  halfDay: boolean;
  halfDayPart: "AM" | "PM" | null;
  note: string | null;
  confidence: number;
  warnings: ImportWarning[];
  fingerprint: string | null;
  raw: TabularRow;
}

export interface LeaveSnapshotCandidate {
  sourceRowIndex: number;
  leaveType: ImportableServiceEventType | null;
  asOfDate: string | null;
  grantedDays: number | null;
  grantedMinutes: number | null;
  usedDays: number | null;
  usedMinutes: number | null;
  remainingDays: number | null;
  remainingMinutes: number | null;
  confidence: number;
  warnings: ImportWarning[];
  raw: TabularRow;
}

export interface ImportBatchDescriptor {
  id: string;
  fileName: string;
  sourceFormat: ImportSourceFormat;
  fileSha256: string | null;
  createdAt: string;
}

export interface ImportPreview {
  batch: ImportBatchDescriptor;
  mappings: ColumnMapping[];
  events: ServiceEventCandidate[];
  snapshots: LeaveSnapshotCandidate[];
  unresolvedRowIndexes: number[];
}

export interface TabularAdapterResult {
  format: ImportSourceFormat;
  headers: string[];
  rows: TabularRow[];
  /**
   * Source-native 1-based row indexes when the adapter can preserve them.
   * This keeps preview/audit metadata aligned with title rows and blank rows.
   */
  rowSourceIndexes?: number[];
  sourceLabel?: string | null;
}

export interface ImportFileAdapter<TInput = unknown> {
  canHandle(input: TInput): boolean;
  parse(input: TInput): Promise<TabularAdapterResult>;
}
