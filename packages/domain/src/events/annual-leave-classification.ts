import {
  ATTENDANCE_EVENT_TYPES,
  clockToMinutes,
  type EventTiming,
  type ServiceEventType,
} from "./model";

export const ANNUAL_LEAVE_CUMULATIVE_MINUTES_PER_DAY = 8 * 60;

export type AnnualLeaveUsageKind =
  | "FULL_DAY"
  | "HALF_DAY"
  | "LATE_ARRIVAL"
  | "EARLY_LEAVE"
  | "OUTING"
  | "PARTIAL";

export type AnnualLeaveUsageClassification = {
  kind: AnnualLeaveUsageKind;
  label: string;
  eventType: ServiceEventType;
  automatic: boolean;
  halfDayPart: "AM" | "PM" | null;
  reason: string;
};

export function isAnnualLeaveAttendanceType(
  eventType: ServiceEventType,
): boolean {
  return ATTENDANCE_EVENT_TYPES.includes(eventType);
}

function partialFallback(
  eventType: ServiceEventType,
  reason: string,
): AnnualLeaveUsageClassification {
  return {
    kind: "PARTIAL",
    label: "시간 연가",
    eventType,
    automatic: false,
    halfDayPart: null,
    reason,
  };
}

/**
 * Classify how an annual-leave charge appears in the daily service record.
 *
 * Half-day leave is an explicit approval unit. It is never inferred merely
 * because a duration happens to be four hours. For minute-based use, the
 * position of the absence inside the confirmed workday determines whether it
 * is late arrival, early leave, or outing.
 */
export function classifyAnnualLeaveUsage(input: {
  eventType: ServiceEventType;
  timing: EventTiming;
  workdayStartTime: string | null;
  workdayEndTime: string | null;
}): AnnualLeaveUsageClassification | null {
  const { eventType, timing, workdayStartTime, workdayEndTime } = input;
  if (eventType !== "ANNUAL_LEAVE" && !isAnnualLeaveAttendanceType(eventType)) {
    return null;
  }

  if (timing.kind === "ALL_DAY") {
    return {
      kind: "FULL_DAY",
      label: "종일 연가",
      eventType: "ANNUAL_LEAVE",
      automatic: true,
      halfDayPart: null,
      reason: "하루 단위 연가로 기록해요.",
    };
  }

  if (timing.kind === "HALF_DAY") {
    return {
      kind: "HALF_DAY",
      label: "반가",
      eventType: "ANNUAL_LEAVE",
      automatic: true,
      halfDayPart: timing.half,
      reason:
        "반가는 시간 수가 아니라 14:00를 경계로 한 오전·오후 반일 승인 단위예요. 임의의 4시간이라고 반가가 되지는 않아요.",
    };
  }

  if (!timing.startTime || !timing.endTime) {
    return partialFallback(
      eventType,
      "시작·종료 시각을 모두 입력하면 지각·조퇴·외출을 자동 구분해요.",
    );
  }
  if (!workdayStartTime || !workdayEndTime) {
    return partialFallback(
      eventType,
      "근무 시작·종료 시각을 먼저 확인하면 지각·조퇴·외출을 자동 구분할 수 있어요.",
    );
  }

  const start = clockToMinutes(timing.startTime);
  const end = clockToMinutes(timing.endTime);
  const workStart = clockToMinutes(workdayStartTime);
  const workEnd = clockToMinutes(workdayEndTime);
  if (end <= start || workEnd <= workStart) {
    return partialFallback(eventType, "입력한 시각 순서를 확인해 주세요.");
  }

  if (start <= workStart && end >= workEnd) {
    return {
      kind: "FULL_DAY",
      label: "종일 연가",
      eventType: "ANNUAL_LEAVE",
      automatic: true,
      halfDayPart: null,
      reason: `${workdayStartTime}–${workdayEndTime} 근무시간 전체를 덮어 종일 연가로 봐요.`,
    };
  }

  const halfDayBoundary = 14 * 60;
  if (
    workStart < halfDayBoundary &&
    halfDayBoundary < workEnd &&
    start <= workStart &&
    end === halfDayBoundary
  ) {
    return {
      kind: "HALF_DAY",
      label: "오전 반가",
      eventType: "ANNUAL_LEAVE",
      automatic: true,
      halfDayPart: "AM",
      reason:
        "근무 시작부터 14:00까지라 복무관리 규정의 오전 반일 경계와 정확히 맞아요.",
    };
  }

  if (
    workStart < halfDayBoundary &&
    halfDayBoundary < workEnd &&
    start === halfDayBoundary &&
    end >= workEnd
  ) {
    return {
      kind: "HALF_DAY",
      label: "오후 반가",
      eventType: "ANNUAL_LEAVE",
      automatic: true,
      halfDayPart: "PM",
      reason:
        "14:00부터 근무 종료까지라 복무관리 규정의 오후 반일 경계와 정확히 맞아요.",
    };
  }

  if (start <= workStart && end > workStart && end < workEnd) {
    return {
      kind: "LATE_ARRIVAL",
      label: "허가지각",
      eventType: "LATE_ARRIVAL",
      automatic: true,
      halfDayPart: null,
      reason: `근무 시작 ${workdayStartTime}부터 쉬고 ${timing.endTime}에 복귀하므로 허가지각으로 기록해요.`,
    };
  }

  if (start > workStart && start < workEnd && end >= workEnd) {
    return {
      kind: "EARLY_LEAVE",
      label: "허가조퇴",
      eventType: "EARLY_LEAVE",
      automatic: true,
      halfDayPart: null,
      reason: `${timing.startTime}부터 근무 종료 ${workdayEndTime}까지 쉬므로 허가조퇴로 기록해요.`,
    };
  }

  if (start > workStart && end < workEnd) {
    return {
      kind: "OUTING",
      label: "허가외출",
      eventType: "OUTING",
      automatic: true,
      halfDayPart: null,
      reason: "근무시간 중간 구간만 비우므로 허가외출로 기록해요.",
    };
  }

  return partialFallback(
    eventType,
    "입력한 시간대가 확인된 근무시간 경계와 맞지 않아 자동 구분하지 않았어요.",
  );
}
