import {
  SERVICE_EVENT_TYPE_LABELS,
  formatDurationMinutes,
  type ServiceEvent,
  type ServiceEventType,
} from "@super-gongik/domain";

export type EventCategory =
  | "leave"
  | "sick"
  | "attendance"
  | "duty"
  | "nonpayable"
  | "note";

export const EVENT_CATEGORY: Record<ServiceEventType, EventCategory> = {
  ANNUAL_LEAVE: "leave",
  OFFICIAL_LEAVE: "leave",
  SPECIAL_LEAVE: "leave",
  COMPASSIONATE_LEAVE: "leave",
  SICK_LEAVE: "sick",
  OUTING: "attendance",
  LATE_ARRIVAL: "attendance",
  EARLY_LEAVE: "attendance",
  EDUCATION: "duty",
  TRAINING: "duty",
  SERVICE_SUSPENSION: "nonpayable",
  SERVICE_ABSENCE: "nonpayable",
  EXCESS_ANNUAL_ABSENCE: "nonpayable",
  USER_NOTE: "note",
};

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  leave: "휴가",
  sick: "병가",
  attendance: "근태",
  duty: "교육·훈련",
  nonpayable: "보수 미지급",
  note: "메모",
};

export const EVENT_TYPE_GROUPS: Array<{
  label: string;
  types: ServiceEventType[];
}> = [
  {
    label: "휴가",
    types: [
      "ANNUAL_LEAVE",
      "SICK_LEAVE",
      "OFFICIAL_LEAVE",
      "SPECIAL_LEAVE",
      "COMPASSIONATE_LEAVE",
    ],
  },
  { label: "근태", types: ["OUTING", "LATE_ARRIVAL", "EARLY_LEAVE"] },
  { label: "교육·훈련", types: ["EDUCATION", "TRAINING"] },
  {
    label: "보수 미지급 사유",
    types: [
      "SERVICE_SUSPENSION",
      "SERVICE_ABSENCE",
      "EXCESS_ANNUAL_ABSENCE",
    ],
  },
  { label: "기타", types: ["USER_NOTE"] },
];

export function eventLabel(event: Pick<ServiceEvent, "eventType" | "title">) {
  return event.title || SERVICE_EVENT_TYPE_LABELS[event.eventType];
}

function shortDate(date: string) {
  return `${date.slice(5, 7)}.${date.slice(8, 10)}`;
}

export function describeTiming(event: ServiceEvent): string {
  const timing = event.timing;
  if (timing.kind === "ALL_DAY") {
    if (event.startDate === event.endDate) {
      return timing.dayCount === 1 ? "종일" : `종일 · ${timing.dayCount}일`;
    }
    return `${shortDate(event.startDate)}–${shortDate(event.endDate)} · ${timing.dayCount}일`;
  }
  if (timing.kind === "HALF_DAY") {
    return timing.half === "AM"
      ? "오전 반일"
      : timing.half === "PM"
        ? "오후 반일"
        : "반일";
  }
  if (timing.durationMinutes === null) return "시간 확인 필요";
  const range =
    timing.startTime && timing.endTime
      ? ` (${timing.startTime}–${timing.endTime})`
      : "";
  return `${formatDurationMinutes(timing.durationMinutes)}${range}`;
}

export function formatKoreanMonth(yearMonth: string) {
  return `${yearMonth.slice(0, 4)}년 ${Number(yearMonth.slice(5, 7))}월`;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function formatDayHeading(date: string, weekday: number) {
  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 (${WEEKDAYS[weekday]})`;
}

export { WEEKDAYS };