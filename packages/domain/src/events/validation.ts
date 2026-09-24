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
  | "PARTIAL_DURING_FULL_DAY_LEAVE"
  | "DURATION_DIFFERS_FROM_TIMES"
  | "OUTSIDE_SERVICE_PERIOD"
  | "POSSIBLE_DUPLICATE"
  | "DAY_COUNT_DIFFERS_FROM_WEEKDAYS";

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
  };

type Occupancy = "FULL" | "AM" | "PM" | "HALF_UNKNOWN" | "PARTIAL";

function occupancy(event: ServiceEventDraft): Occupancy {
  if (event.timing.kind === "ALL_DAY") return "FULL";
  if (event.timing.kind === "HALF_DAY")
    return event.timing.half ?? "HALF_UNKNOWN";
  return "PARTIAL";
}

function leaveOccupanciesConflict(a: Occupancy, b: Occupancy): boolean {
  if (a === "PARTIAL" || b === "PARTIAL") return false;
  if (a === "FULL" || b === "FULL") return true;
  if (a === "HALF_UNKNOWN" || b === "HALF_UNKNOWN") return false;
  return a === b;
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
  if (duplicate) {
    warnings.push({
      code: "POSSIBLE_DUPLICATE",
      message: `같은 날짜·종류·시간의 기록이 이미 있어요 (${duplicate.source.kind === "IMPORT" ? "파일에서 가져옴" : "직접 입력"}). 두 번 차감되지 않도록 확인해 주세요.`,
    });
  }

  if (isLeaveEventType(draft.eventType)) {
    const mine = occupancy(draft);
    for (const other of others) {
      if (!isLeaveEventType(other.eventType) || other === duplicate) continue;
      if (!dateRangesOverlap(draft, other)) continue;
      const theirs = occupancy(other);
      const label = SERVICE_EVENT_TYPE_LABELS[other.eventType];
      if (leaveOccupanciesConflict(mine, theirs)) {
        errors.push({
          code: "LEAVE_OVERLAP",
          message: `${other.startDate}에 이미 ${label} 기록이 있어 같은 시간을 두 번 차감하게 돼요.`,
          field: "startDate",
        });
        break;
      }
      if (
        (mine === "PARTIAL" && theirs === "FULL") ||
        (mine === "FULL" && theirs === "PARTIAL")
      ) {
        warnings.push({
          code: "PARTIAL_DURING_FULL_DAY_LEAVE",
          message: `${other.startDate}의 ${label} 기록과 겹쳐요. 종일 휴가일에 시간 단위 휴가를 함께 쓰는 것이 맞는지 확인해 주세요.`,
          field: "startDate",
        });
      }
    }
  }

  if (duplicate && errors.every((issue) => issue.code !== "LEAVE_OVERLAP")) {
    // A byte-for-byte duplicate of a leave record would double-charge it.
    if (isLeaveEventType(draft.eventType) && draft.timing.kind !== "PARTIAL") {
      errors.push({
        code: "LEAVE_OVERLAP",
        message: "같은 휴가 기록이 이미 있어요. 기존 기록을 수정해 주세요.",
        field: "startDate",
      });
    }
  }

  return { errors, warnings, draft };
}
