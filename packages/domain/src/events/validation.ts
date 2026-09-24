import {
  countWeekdays,
  dateRangesOverlap,
  inclusiveDaySpan,
} from "../calendar/month";
import { compareDateOnly, type DateOnly } from "../service/date-only";
import {
  SERVICE_EVENT_TYPE_LABELS,
  clockToMinutes,
  isLeaveEventType,
  isLive,
  serviceEventContentKey,
  serviceEventDraftShape,
  structuralEventIssues,
  type ServiceEvent,
  type ServiceEventDraft,
} from "./model";

export type EventIssueCode =
  | "INVALID_FIELD"
  | "END_BEFORE_START"
  | "RANGE_TOO_LONG"
  | "MULTI_DAY_PARTIAL"
  | "DAY_COUNT_EXCEEDS_RANGE"
  | "HALF_DAY_NOT_ANNUAL_LEAVE"
  | "END_TIME_NOT_AFTER_START"
  | "MISSING_DURATION"
  | "LEAVE_OVERLAP"
  | "LEAVE_OVERLAP_UNRESOLVED"
  | "DURATION_DIFFERS_FROM_TIMES"
  | "OUTSIDE_SERVICE_PERIOD"
  | "POSSIBLE_DUPLICATE"
  | "DAY_COUNT_DIFFERS_FROM_WEEKDAYS"
  | "COMPENSATION_ABSENCE_MUST_BE_ALL_DAY"
  | "SICK_CATEGORY_NOT_SICK_LEAVE";

export type EventIssue = {
  code: EventIssueCode;
  message: string;
  field?: string;
};

export type EventValidation = {
  errors: EventIssue[];
  warnings: EventIssue[];
};

export type EventValidationContext = {
  existingEvents: readonly ServiceEvent[];
  /** Id of the event being edited, so it does not conflict with itself. */
  editingId?: string | null;
  servicePeriod?: {
    callUpDate: DateOnly;
    expectedDischargeDate: DateOnly;
  } | null;
  /** Imports may carry an unresolved minute duration; manual entry may not. */
  allowUnresolvedDuration?: boolean;
};

/** More than this many calendar days in one record is treated as a typo. */
export const MAX_EVENT_SPAN_DAYS = 120;

const STRUCTURAL_MESSAGES: Record<string, { message: string; field: string }> =
  {
    END_BEFORE_START: {
      message: "종료일이 시작일보다 빠를 수 없어요.",
      field: "endDate",
    },
    MULTI_DAY_PARTIAL: {
      message: "반일·시간 단위 기록은 하루 안에서만 입력할 수 있어요.",
      field: "endDate",
    },
    DAY_COUNT_EXCEEDS_RANGE: {
      message: "차감 일수가 선택한 기간의 날짜 수보다 많아요.",
      field: "dayCount",
    },
    HALF_DAY_NOT_ANNUAL_LEAVE: {
      message:
        "반일 단위는 연가(반가)에만 쓸 수 있어요. 시간 단위로 입력해 주세요.",
      field: "timing",
    },
    END_TIME_NOT_AFTER_START: {
      message: "종료 시각이 시작 시각보다 늦어야 해요.",
      field: "endTime",
    },
    COMPENSATION_ABSENCE_MUST_BE_ALL_DAY: {
      message:
        "복무중단·복무이탈·연가초과 결근은 기본 보수 미지급일을 확정할 수 있도록 하루 단위로 기록해 주세요.",
      field: "timing",
    },
    SICK_CATEGORY_NOT_SICK_LEAVE: {
      message: "병가 구분은 병가 기록에만 넣을 수 있어요.",
      field: "sickLeaveCategory",
    },
  };

/**
 * Where inside a day a leave record sits, as far as the record proves it.
 * FULL: whole day(s). HALF: the half-day unit (half may be unknown).
 * TIMED: explicit start/end. UNTIMED: minutes without a position.
 */
type LeaveSlot =
  | { kind: "FULL" }
  | { kind: "HALF"; half: "AM" | "PM" | null }
  | { kind: "TIMED"; start: number; end: number }
  | { kind: "UNTIMED" };

function leaveSlot(event: ServiceEventDraft): LeaveSlot {
  const timing = event.timing;
  if (timing.kind === "ALL_DAY") return { kind: "FULL" };
  if (timing.kind === "HALF_DAY") return { kind: "HALF", half: timing.half };
  if (timing.startTime && timing.endTime) {
    return {
      kind: "TIMED",
      start: clockToMinutes(timing.startTime),
      end: clockToMinutes(timing.endTime),
    };
  }
  return { kind: "UNTIMED" };
}

export type LeaveOverlapVerdict = "CONFLICT" | "UNRESOLVED" | "NONE";

/**
 * Can two leave records on overlapping dates charge the same time?
 *
 * - CONFLICT: provably the same time (full day vs anything, the same half,
 *   intersecting explicit times, or identical content).
 * - UNRESOLVED: the records do not carry enough position information to
 *   decide (e.g. minutes without start/end, half day vs minutes; the half-day
 *   hours depend on the institution schedule). Never silently accepted:
 *   callers surface it as a warning that must be acknowledged.
 * - NONE: provably disjoint (AM vs PM, non-intersecting times).
 */
export function compareLeaveRecords(
  a: ServiceEventDraft,
  b: ServiceEventDraft,
): LeaveOverlapVerdict {
  if (!isLeaveEventType(a.eventType) || !isLeaveEventType(b.eventType)) {
    return "NONE";
  }
  if (!dateRangesOverlap(a, b)) return "NONE";
  if (serviceEventContentKey(a) === serviceEventContentKey(b))
    return "CONFLICT";

  const x = leaveSlot(a);
  const y = leaveSlot(b);
  if (x.kind === "FULL" || y.kind === "FULL") return "CONFLICT";
  if (x.kind === "HALF" && y.kind === "HALF") {
    if (x.half === null || y.half === null) return "UNRESOLVED";
    return x.half === y.half ? "CONFLICT" : "NONE";
  }
  if (x.kind === "TIMED" && y.kind === "TIMED") {
    return x.start < y.end && y.start < x.end ? "CONFLICT" : "NONE";
  }
  return "UNRESOLVED";
}

/** Pairs of live leave records that already conflict or may conflict. */
export function findLeaveOverlaps(events: readonly ServiceEvent[]): {
  conflicts: Array<[string, string]>;
  unresolved: Array<[string, string]>;
} {
  const live = events.filter(
    (event) => isLive(event) && isLeaveEventType(event.eventType),
  );
  const conflicts: Array<[string, string]> = [];
  const unresolved: Array<[string, string]> = [];
  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      const verdict = compareLeaveRecords(live[i]!, live[j]!);
      if (verdict === "CONFLICT") conflicts.push([live[i]!.id, live[j]!.id]);
      if (verdict === "UNRESOLVED") unresolved.push([live[i]!.id, live[j]!.id]);
    }
  }
  return { conflicts, unresolved };
}

/**
 * Validate a draft against structural invariants and the user's existing
 * timeline. Errors block saving; warnings must be shown and acknowledged.
 */
export function validateServiceEventDraft(
  input: unknown,
  context: EventValidationContext,
): EventValidation & { draft: ServiceEventDraft | null } {
  const errors: EventIssue[] = [];
  const warnings: EventIssue[] = [];
  const parsed = serviceEventDraftShape.safeParse(input);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({
        code: "INVALID_FIELD",
        message: issue.message,
        field: issue.path.join("."),
      });
    }
    return { errors, warnings, draft: null };
  }

  const draft = parsed.data;
  for (const code of structuralEventIssues(draft)) {
    const detail = STRUCTURAL_MESSAGES[code];
    errors.push({
      code: code as EventIssueCode,
      message: detail?.message ?? code,
      field: detail?.field,
    });
  }
  if (errors.length) return { errors, warnings, draft };

  const span = inclusiveDaySpan(draft.startDate, draft.endDate);
  if (span > MAX_EVENT_SPAN_DAYS) {
    errors.push({
      code: "RANGE_TOO_LONG",
      message: `한 기록은 ${MAX_EVENT_SPAN_DAYS}일을 넘을 수 없어요. 날짜를 다시 확인해 주세요.`,
      field: "endDate",
    });
  }

  const timing = draft.timing;
  if (timing.kind === "PARTIAL") {
    if (timing.durationMinutes === null && !context.allowUnresolvedDuration) {
      errors.push({
        code: "MISSING_DURATION",
        message: "사용 시간을 분 단위로 입력해 주세요.",
        field: "durationMinutes",
      });
    }
    if (timing.durationMinutes !== null && timing.startTime && timing.endTime) {
      const between =
        clockToMinutes(timing.endTime) - clockToMinutes(timing.startTime);
      if (between !== timing.durationMinutes) {
        warnings.push({
          code: "DURATION_DIFFERS_FROM_TIMES",
          message: `시작·종료 시각 사이는 ${between}분인데 사용 시간은 ${timing.durationMinutes}분이에요. 휴게시간 등으로 다르다면 그대로 저장하세요.`,
          field: "durationMinutes",
        });
      }
    }
  }

  if (timing.kind === "ALL_DAY" && span > 1) {
    const weekdays = countWeekdays(draft.startDate, draft.endDate);
    if (weekdays !== timing.dayCount) {
      warnings.push({
        code: "DAY_COUNT_DIFFERS_FROM_WEEKDAYS",
        message: `기간 안의 평일은 ${weekdays}일인데 차감 일수는 ${timing.dayCount}일이에요. 기관에서 차감한 일수와 같은지 확인해 주세요.`,
        field: "dayCount",
      });
    }
  }

  const period = context.servicePeriod;
  if (
    period &&
    (compareDateOnly(draft.startDate, period.callUpDate) < 0 ||
      compareDateOnly(draft.endDate, period.expectedDischargeDate) > 0)
  ) {
    warnings.push({
      code: "OUTSIDE_SERVICE_PERIOD",
      message: "복무 기간(소집일~소집해제 예정일) 밖의 날짜가 포함되어 있어요.",
      field: "startDate",
    });
  }

  const others = context.existingEvents.filter(
    (event) => isLive(event) && event.id !== context.editingId,
  );
  const contentKey = serviceEventContentKey(draft);
  const duplicate = others.find(
    (event) => serviceEventContentKey(event) === contentKey,
  );
  if (duplicate && !isLeaveEventType(draft.eventType)) {
    // Leave duplicates are blocked below as LEAVE_OVERLAP; attendance and
    // notes do not charge leave, so a duplicate only needs confirmation.
    warnings.push({
      code: "POSSIBLE_DUPLICATE",
      message: `같은 날짜·종류·시간의 기록이 이미 있어요 (${duplicate.source.kind === "IMPORT" ? "파일에서 가져옴" : "직접 입력"}). 두 번 차감되지 않도록 확인해 주세요.`,
    });
  }

  if (isLeaveEventType(draft.eventType)) {
    for (const other of others) {
      const verdict = compareLeaveRecords(draft, other);
      if (verdict === "NONE") continue;
      const label = SERVICE_EVENT_TYPE_LABELS[other.eventType];
      if (verdict === "CONFLICT") {
        errors.push({
          code: "LEAVE_OVERLAP",
          message: `${other.startDate}에 이미 ${label} 기록이 있어 같은 시간을 두 번 차감하게 돼요. 기존 기록을 수정해 주세요.`,
          field: "startDate",
        });
        break;
      }
      warnings.push({
        code: "LEAVE_OVERLAP_UNRESOLVED",
        message: `${other.startDate}의 ${label} 기록과 시간이 겹치는지 알 수 없어요. 두 기록이 서로 다른 시간이 맞는지 확인해 주세요. 시작·종료 시각을 넣으면 정확히 확인할 수 있어요.`,
        field: "startDate",
      });
    }
  }

  return { errors, warnings, draft };
}
