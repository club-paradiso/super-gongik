/**
 * The import panel's decisions, kept free of React so the native client
 * imports exactly the same way: each row's status against current records,
 * which rows and balance snapshots are pre-selected, how a user's edits to a
 * row are applied, and what is committed.
 */
import {
  planImportRows,
  type CommitImportInput,
  type CommitImportSummary,
  type ImportRowDecision,
  type UserData,
} from "@super-gongik/domain";
import {
  BLOCKING_WARNING_CODES,
  buildImportDrafts,
  fingerprintEventCandidate,
  type ImportPreview,
  type ImportableServiceEventType,
  type ServiceEventCandidate,
} from "@super-gongik/importer";

export const DECISION_LABELS: Record<ImportRowDecision["status"], string> = {
  NEW: "",
  DUPLICATE_IMPORT: "이미 가져온 기록",
  DUPLICATE_CONTENT: "같은 기록이 이미 있음",
  CONFLICT: "기존 휴가와 겹침",
};

export type RowStatus = {
  decision: ImportRowDecision["status"] | "UNRESOLVED";
  message: string | null;
};

export interface EventOverride {
  date?: string;
  eventType?: ImportableServiceEventType | "";
  durationMinutes?: string;
}

/** Status of every candidate row against the records already stored. */
export function rowStatuses(
  data: UserData,
  preview: ImportPreview,
): Map<number, RowStatus> {
  const all = new Set(preview.events.map((event) => event.sourceRowIndex));
  const { drafts, rejected } = buildImportDrafts(preview, all);
  const statuses = new Map<number, RowStatus>();
  for (const item of rejected) {
    statuses.set(item.sourceRowIndex, {
      decision: "UNRESOLVED",
      message: item.reason,
    });
  }
  for (const decision of planImportRows(data, drafts)) {
    statuses.set(decision.draft.source.sourceRowIndex, {
      decision: decision.status,
      message:
        decision.status === "CONFLICT"
          ? (decision.errors[0]?.message ?? null)
          : decision.status === "NEW"
            ? (decision.warnings.find(
                (warning) => warning.code === "LEAVE_OVERLAP_UNRESOLVED",
              )?.message ?? null)
            : DECISION_LABELS[decision.status] || null,
    });
  }
  return statuses;
}

/**
 * Rows selected by default: new, fully understood, with no undecidable
 * overlap and no blocking warning. Anything else needs an explicit opt-in.
 */
export function defaultAcceptedRows(
  preview: ImportPreview,
  statuses: ReadonlyMap<number, RowStatus>,
): Set<number> {
  return new Set(
    preview.events
      .filter(
        (event) =>
          event.date &&
          event.eventType &&
          statuses.get(event.sourceRowIndex)?.decision === "NEW" &&
          !statuses.get(event.sourceRowIndex)?.message &&
          !event.warnings.some((warning) =>
            BLOCKING_WARNING_CODES.includes(warning.code),
          ),
      )
      .map((event) => event.sourceRowIndex),
  );
}

/** Institution balance rows selected by default (confidence ≥ 0.7). */
export function defaultAcceptedSnapshots(preview: ImportPreview): Set<number> {
  return new Set(
    preview.snapshots
      .filter(
        (snapshot) =>
          snapshot.leaveType &&
          snapshot.confidence >= 0.7 &&
          !snapshot.warnings.some((warning) =>
            BLOCKING_WARNING_CODES.includes(warning.code),
          ),
      )
      .map((snapshot) => snapshot.sourceRowIndex),
  );
}

/** Apply a user's edits to one candidate row and re-derive its fingerprint. */
export async function adjustCandidate(
  candidate: ServiceEventCandidate,
  override: EventOverride | undefined,
): Promise<ServiceEventCandidate> {
  const durationInput = override?.durationMinutes?.trim();
  const hasDurationOverride = Boolean(durationInput);
  const durationMinutes = hasDurationOverride
    ? Number(durationInput)
    : candidate.durationMinutes;
  const validDurationMinutes =
    durationMinutes !== null &&
    durationMinutes !== undefined &&
    Number.isFinite(durationMinutes) &&
    durationMinutes >= 0
      ? durationMinutes
      : null;
  const adjusted: ServiceEventCandidate = {
    ...candidate,
    date: override?.date ?? candidate.date,
    eventType:
      override?.eventType === ""
        ? null
        : (override?.eventType ?? candidate.eventType),
    durationDays: hasDurationOverride ? null : candidate.durationDays,
    durationMinutes: validDurationMinutes,
    halfDay: hasDurationOverride ? false : candidate.halfDay,
    warnings: hasDurationOverride
      ? candidate.warnings.filter(
          (warning) => !BLOCKING_WARNING_CODES.includes(warning.code),
        )
      : candidate.warnings,
  };
  if (adjusted.eventType !== "ANNUAL_LEAVE") adjusted.halfDay = false;
  adjusted.allDay =
    !adjusted.halfDay &&
    ((adjusted.durationDays !== null &&
      Number.isInteger(adjusted.durationDays)) ||
      (adjusted.durationMinutes === null &&
        !adjusted.startTime &&
        !adjusted.endTime));
  adjusted.fingerprint =
    adjusted.date && adjusted.eventType
      ? await fingerprintEventCandidate(adjusted)
      : null;
  return adjusted;
}

/** The `commitImport` input for the accepted rows and snapshots. */
export async function buildImportCommit(
  preview: ImportPreview,
  overrides: Readonly<Record<number, EventOverride>>,
  acceptedRows: ReadonlySet<number>,
  acceptedSnapshots: ReadonlySet<number>,
): Promise<{
  input: CommitImportInput;
  rejected: Array<{ sourceRowIndex: number; reason: string }>;
}> {
  const events = await Promise.all(
    preview.events.map((candidate) =>
      adjustCandidate(candidate, overrides[candidate.sourceRowIndex]),
    ),
  );
  const adjustedPreview: ImportPreview = { ...preview, events };
  const { drafts, rejected } = buildImportDrafts(adjustedPreview, acceptedRows);
  const snapshots = adjustedPreview.snapshots
    .filter(
      (snapshot) =>
        acceptedSnapshots.has(snapshot.sourceRowIndex) &&
        snapshot.leaveType &&
        !snapshot.warnings.some((warning) =>
          BLOCKING_WARNING_CODES.includes(warning.code),
        ),
    )
    .map((snapshot) => ({
      leaveType: snapshot.leaveType,
      asOfDate: snapshot.asOfDate as `${number}-${number}-${number}` | null,
      grantedDays: snapshot.grantedDays,
      grantedMinutes: snapshot.grantedMinutes,
      usedDays: snapshot.usedDays,
      usedMinutes: snapshot.usedMinutes,
      remainingDays: snapshot.remainingDays,
      remainingMinutes: snapshot.remainingMinutes,
      confidence: snapshot.confidence,
      sourceRowIndex: snapshot.sourceRowIndex,
    }));
  return {
    input: {
      batch: preview.batch,
      drafts,
      snapshots: snapshots as CommitImportInput["snapshots"],
    },
    rejected,
  };
}

/** Result sentence after a commit. */
export function describeImportSummary(
  summary: CommitImportSummary,
  rejectedBeforeCommit: number,
): string {
  const pieces = [`복무기록 ${summary.added}건`];
  if (summary.snapshots) pieces.push(`기관 잔액 ${summary.snapshots}건`);
  let text = `${pieces.join(", ")}을 저장했어요.`;
  if (summary.skippedDuplicates)
    text += ` 중복 ${summary.skippedDuplicates}건은 건너뛰었어요.`;
  if (summary.rejected || rejectedBeforeCommit) {
    text += ` 확인이 필요한 ${summary.rejected + rejectedBeforeCommit}건은 저장하지 않았어요.`;
  }
  return text;
}
