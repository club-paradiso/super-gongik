import {
  endDateForChargedDays,
  isDateOnly,
  type DateOnly,
  type EventTiming,
  type ImportDraft,
} from "@super-gongik/domain";

import type {
  ImportBatchDescriptor,
  ImportPreview,
  ServiceEventCandidate,
} from "./types";

export type DraftConversion =
  | { ok: true; draft: ImportDraft; notes: string[] }
  | { ok: false; reason: string };

function minutesBetween(start: string, end: string): number | null {
  const [startHours, startMinutes] = start.split(":").map(Number);
  const [endHours, endMinutes] = end.split(":").map(Number);
  const difference =
    endHours * 60 + endMinutes - (startHours * 60 + startMinutes);
  return difference > 0 ? difference : null;
}

function timingFor(candidate: ServiceEventCandidate):
  | {
      timing: EventTiming;
      endDateFromDays: number | null;
    }
  | { error: string } {
  if (
    candidate.warnings.some((warning) => warning.code === "MIXED_DAY_AND_TIME")
  ) {
    return { error: "일과 시간이 섞여 있어 나눠서 입력해야 해요." };
  }
  if (candidate.halfDay) {
    return {
      timing: { kind: "HALF_DAY", half: candidate.halfDayPart },
      endDateFromDays: null,
    };
  }
  if (candidate.durationDays !== null) {
    if (
      Number.isInteger(candidate.durationDays) &&
      candidate.durationDays >= 1
    ) {
      return {
        timing: { kind: "ALL_DAY", dayCount: candidate.durationDays },
        endDateFromDays: candidate.durationDays,
      };
    }
    return { error: `${candidate.durationDays}일은 분 단위 확인이 필요해요.` };
  }

  const start = candidate.startTime;
  const end = candidate.endTime;
  const orderedTimes =
    start && end && minutesBetween(start, end) !== null
      ? { startTime: start, endTime: end }
      : { startTime: null, endTime: null };

  if (candidate.durationMinutes !== null) {
    if (candidate.durationMinutes <= 0 || candidate.durationMinutes >= 1440) {
      return {
        error: `${candidate.durationMinutes}분은 하루 안의 사용 시간이 아니에요.`,
      };
    }
    return {
      timing: {
        kind: "PARTIAL",
        durationMinutes: candidate.durationMinutes,
        ...orderedTimes,
      },
      endDateFromDays: null,
    };
  }
  if (orderedTimes.startTime && orderedTimes.endTime) {
    return {
      timing: {
        kind: "PARTIAL",
        durationMinutes: minutesBetween(
          orderedTimes.startTime,
          orderedTimes.endTime,
        ),
        ...orderedTimes,
      },
      endDateFromDays: null,
    };
  }
  if (start || end || !candidate.allDay) {
    // A time without a usable duration stays visibly unresolved.
    return {
      timing: {
        kind: "PARTIAL",
        durationMinutes: null,
        startTime: null,
        endTime: null,
      },
      endDateFromDays: null,
    };
  }
  return { timing: { kind: "ALL_DAY", dayCount: 1 }, endDateFromDays: null };
}

/**
 * Convert a previewed row into a canonical event draft. The only inference
 * made is the end date of a multi-day row that states just a start date and a
 * charged day count; that inference is returned as a note for the preview.
 */
export function candidateToImportDraft(
  candidate: ServiceEventCandidate,
  batch: Pick<ImportBatchDescriptor, "id" | "fileName" | "sourceFormat">,
): DraftConversion {
  if (!candidate.date || !isDateOnly(candidate.date)) {
    return { ok: false, reason: "날짜를 확인해 주세요." };
  }
  if (!candidate.eventType)
    return { ok: false, reason: "종류를 선택해 주세요." };
  if (!candidate.fingerprint)
    return { ok: false, reason: "행 식별값을 만들지 못했어요." };

  const resolved = timingFor(candidate);
  if ("error" in resolved) return { ok: false, reason: resolved.error };

  const startDate = candidate.date as DateOnly;
  const notes: string[] = [];
  let endDate = startDate;
  if (resolved.endDateFromDays && resolved.endDateFromDays > 1) {
    endDate = endDateForChargedDays(startDate, resolved.endDateFromDays);
    notes.push(`종료일은 주말을 빼고 ${endDate}로 추정했어요.`);
  }
  if (
    resolved.timing.kind === "PARTIAL" &&
    resolved.timing.durationMinutes === null
  ) {
    notes.push(
      "사용 시간이 없어 '시간 확인 필요'로 저장돼요. 연가 잔여 계산에서는 빠져요.",
    );
  }

  return {
    ok: true,
    notes,
    draft: {
      draft: {
        eventType: candidate.eventType,
        startDate,
        endDate,
        timing: resolved.timing,
        title: null,
        note: candidate.note?.slice(0, 500) ?? null,
      },
      source: {
        kind: "IMPORT",
        batchId: batch.id,
        format: batch.sourceFormat,
        fileName: batch.fileName,
        fingerprint: candidate.fingerprint,
        confidence: Math.min(1, Math.max(0, candidate.confidence)),
        sourceRowIndex: candidate.sourceRowIndex,
      },
    },
  };
}

export function buildImportDrafts(
  preview: ImportPreview,
  acceptedRowIndexes: ReadonlySet<number>,
): {
  drafts: ImportDraft[];
  rejected: Array<{ sourceRowIndex: number; reason: string }>;
} {
  const drafts: ImportDraft[] = [];
  const rejected: Array<{ sourceRowIndex: number; reason: string }> = [];
  for (const candidate of preview.events) {
    if (!acceptedRowIndexes.has(candidate.sourceRowIndex)) continue;
    const conversion = candidateToImportDraft(candidate, preview.batch);
    if (conversion.ok) drafts.push(conversion.draft);
    else
      rejected.push({
        sourceRowIndex: candidate.sourceRowIndex,
        reason: conversion.reason,
      });
  }
  return { drafts, rejected };
}
