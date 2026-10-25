/**
 * The event editor's form model, kept free of React so the native client can
 * run the same rules: how a form becomes a draft (including the automatic
 * annual-leave usage classification), and how edits are coerced (half days
 * only for annual leave, non-payable absences always all-day, derived day
 * counts and durations). `validateServiceEventDraft` still checks every
 * draft before it is stored.
 */
import {
  classifyAnnualLeaveUsage,
  clockToMinutes,
  countWeekdays,
  inclusiveDaySpan,
  isDateOnly,
  isCompensationNonPayableEventType,
  isLeaveEventType,
  type DateOnly,
  type EventIssue,
  type ServiceEvent,
  type ServiceEventType,
  type ServiceProfile,
  type SickLeaveCategory,
} from "@super-gongik/domain";

export type Mode = "ALL_DAY" | "HALF_DAY" | "PARTIAL";

export type FormState = {
  eventType: ServiceEventType;
  mode: Mode;
  startDate: string;
  endDate: string;
  dayCount: string;
  dayCountTouched: boolean;
  half: "AM" | "PM" | "";
  startTime: string;
  endTime: string;
  hours: string;
  minutes: string;
  durationTouched: boolean;
  sickLeaveCategory: SickLeaveCategory | "";
  title: string;
  note: string;
};

export function initialState(
  event: ServiceEvent | null,
  date: DateOnly,
): FormState {
  if (!event) {
    return {
      eventType: "ANNUAL_LEAVE",
      mode: "ALL_DAY",
      startDate: date,
      endDate: date,
      dayCount: "1",
      dayCountTouched: false,
      half: "AM",
      startTime: "",
      endTime: "",
      hours: "",
      minutes: "",
      durationTouched: false,
      sickLeaveCategory: "",
      title: "",
      note: "",
    };
  }

  const timing = event.timing;
  const minutes = timing.kind === "PARTIAL" ? timing.durationMinutes : null;
  return {
    eventType: event.eventType,
    mode: timing.kind,
    startDate: event.startDate,
    endDate: event.endDate,
    dayCount: timing.kind === "ALL_DAY" ? String(timing.dayCount) : "1",
    dayCountTouched: true,
    half: timing.kind === "HALF_DAY" ? (timing.half ?? "") : "AM",
    startTime: timing.kind === "PARTIAL" ? (timing.startTime ?? "") : "",
    endTime: timing.kind === "PARTIAL" ? (timing.endTime ?? "") : "",
    hours: minutes === null ? "" : String(Math.floor(minutes / 60)),
    minutes: minutes === null ? "" : String(minutes % 60),
    durationTouched: true,
    sickLeaveCategory:
      event.eventType === "SICK_LEAVE"
        ? (event.sickLeaveCategory ?? "UNKNOWN")
        : "",
    title: event.title ?? "",
    note: event.note ?? "",
  };
}

function toNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function timingFromForm(form: FormState) {
  if (form.mode === "ALL_DAY") {
    return { kind: "ALL_DAY", dayCount: toNumber(form.dayCount) } as const;
  }
  if (form.mode === "HALF_DAY") {
    return { kind: "HALF_DAY", half: form.half || null } as const;
  }
  const hours = toNumber(form.hours) ?? 0;
  const minutes = toNumber(form.minutes) ?? 0;
  const total = hours * 60 + minutes;
  return {
    kind: "PARTIAL",
    durationMinutes: form.hours === "" && form.minutes === "" ? null : total,
    startTime: form.startTime || null,
    endTime: form.endTime || null,
  } as const;
}

export function buildDraft(form: FormState, profile: ServiceProfile) {
  let timing: unknown = timingFromForm(form);
  let eventType = form.eventType;
  const classification = classifyAnnualLeaveUsage({
    eventType: form.eventType,
    timing: timing as ServiceEvent["timing"],
    workdayStartTime: profile.workdayStartTime ?? null,
    workdayEndTime: profile.workdayEndTime ?? null,
  });

  if (form.mode === "PARTIAL" && classification?.automatic) {
    eventType = classification.eventType;
    if (classification.kind === "FULL_DAY") {
      timing = { kind: "ALL_DAY", dayCount: 1 };
    } else if (
      classification.kind === "HALF_DAY" &&
      classification.halfDayPart
    ) {
      timing = { kind: "HALF_DAY", half: classification.halfDayPart };
    }
  }

  const endDate =
    (timing as { kind?: string }).kind === "ALL_DAY"
      ? form.endDate
      : form.startDate;

  return {
    eventType,
    startDate: form.startDate,
    endDate,
    timing,
    title: form.title.trim() || null,
    note: form.note.trim() || null,
    sickLeaveCategory:
      eventType === "SICK_LEAVE" ? form.sickLeaveCategory || "UNKNOWN" : null,
  };
}

/** Apply an edit to the form and re-derive dependent fields. */
export function applyFormPatch(
  current: FormState,
  patch: Partial<FormState>,
): FormState {
  const next = { ...current, ...patch };
  if (next.mode === "HALF_DAY" && next.eventType !== "ANNUAL_LEAVE") {
    next.mode = "PARTIAL";
  }
  if (
    isCompensationNonPayableEventType(next.eventType) &&
    next.mode !== "ALL_DAY"
  ) {
    next.mode = "ALL_DAY";
  }
  if (
    next.mode === "ALL_DAY" &&
    !next.dayCountTouched &&
    isDateOnly(next.startDate) &&
    isDateOnly(next.endDate) &&
    next.startDate <= next.endDate
  ) {
    next.dayCount = String(
      isCompensationNonPayableEventType(next.eventType)
        ? inclusiveDaySpan(next.startDate, next.endDate)
        : Math.max(1, countWeekdays(next.startDate, next.endDate)),
    );
  }
  if (
    next.mode === "PARTIAL" &&
    !next.durationTouched &&
    /^\d{2}:\d{2}$/.test(next.startTime) &&
    /^\d{2}:\d{2}$/.test(next.endTime)
  ) {
    const between =
      clockToMinutes(next.endTime) - clockToMinutes(next.startTime);
    if (between > 0) {
      next.hours = String(Math.floor(between / 60));
      next.minutes = String(between % 60);
    }
  }
  return next;
}

/**
 * Where an all-day record's day count came from, so the editor can tell a
 * suggestion from a value the user typed, and ask for confirmation before a
 * suggested leave charge is saved on an unverified working-day assumption.
 *
 * The suggestion itself is unchanged: weekdays (Monday–Friday) for leave,
 * every calendar day for non-payable absences, never below 1. What is new is
 * that a suggestion is flagged when it cannot have come from the person's
 * actual working days — the range holds no weekday at all, or the profile's
 * work pattern is not a confirmed Monday–Friday daytime schedule — because
 * saving it unread would charge leave the institution may count differently.
 */
export type DayCountBasis = {
  /** `WEEKDAYS` / `CALENDAR_DAYS`: suggested by the form; `USER`: typed. */
  source: "WEEKDAYS" | "CALENDAR_DAYS" | "USER";
  weekdays: number;
  calendarDays: number;
  /** Shown under the field, for every source. */
  hint: string;
  /** A warning the editor must have acknowledged before saving, or null. */
  confirmation: EventIssue | null;
};

const WEEKDAYS_MONDAY_TO_FRIDAY = [1, 2, 3, 4, 5];

function isMondayToFriday(weekdays: readonly number[] | null | undefined) {
  if (!weekdays) return false;
  const sorted = [...weekdays].sort((a, b) => a - b);
  return (
    sorted.length === WEEKDAYS_MONDAY_TO_FRIDAY.length &&
    sorted.every((day, index) => day === WEEKDAYS_MONDAY_TO_FRIDAY[index])
  );
}

export function describeDayCount(
  form: FormState,
  profile: Pick<ServiceProfile, "workPattern" | "workWeekdays">,
): DayCountBasis | null {
  if (
    form.mode !== "ALL_DAY" ||
    !isDateOnly(form.startDate) ||
    !isDateOnly(form.endDate) ||
    form.startDate > form.endDate
  ) {
    return null;
  }
  const weekdays = countWeekdays(form.startDate, form.endDate);
  const calendarDays = inclusiveDaySpan(form.startDate, form.endDate);
  if (form.dayCountTouched) {
    return {
      source: "USER",
      weekdays,
      calendarDays,
      hint: "직접 입력한 일수예요.",
      confirmation: null,
    };
  }
  if (isCompensationNonPayableEventType(form.eventType)) {
    return {
      source: "CALENDAR_DAYS",
      weekdays,
      calendarDays,
      hint: "선택한 날짜 범위를 그대로 셌어요. 일부 날짜만 해당하면 기록을 나눠 주세요.",
      confirmation: null,
    };
  }
  const basis: DayCountBasis = {
    source: "WEEKDAYS",
    weekdays,
    calendarDays,
    hint: "주말은 빼고 자동으로 셌어요. 공휴일은 직접 확인해 주세요.",
    confirmation: null,
  };
  if (!isLeaveEventType(form.eventType)) return basis;

  if (weekdays === 0) {
    basis.confirmation = {
      code: "DAY_COUNT_WEEKEND_ONLY",
      field: "dayCount",
      message:
        "선택한 날짜가 모두 주말이에요. 평일 수로는 0일이라 1일로만 제안했어요. 복무기관의 근무표에 따라 차감 일수를 확인하고 저장해 주세요.",
    };
    return basis;
  }
  if (profile.workPattern !== "WEEKDAY_DAYTIME") {
    basis.confirmation = {
      code: "DAY_COUNT_WORK_PATTERN_UNCONFIRMED",
      field: "dayCount",
      message:
        profile.workPattern === null || profile.workPattern === undefined
          ? "복무형태를 아직 설정하지 않아 주말을 뺀 평일 수로 제안했어요. 교대·합숙 근무면 실제 근무일에 맞게 고치고 저장해 주세요."
          : "복무형태가 주간 출퇴근이 아니어서 평일 수 제안이 맞지 않을 수 있어요. 실제 근무일에 맞게 확인하고 저장해 주세요.",
    };
    return basis;
  }
  if (profile.workWeekdays && !isMondayToFriday(profile.workWeekdays)) {
    basis.confirmation = {
      code: "DAY_COUNT_WORK_PATTERN_UNCONFIRMED",
      field: "dayCount",
      message:
        "설정한 근무 요일이 월~금과 달라 평일 수 제안이 맞지 않을 수 있어요. 실제 근무일 수를 확인하고 저장해 주세요.",
    };
  }
  return basis;
}

/** The shared validation plus the day-count confirmation, as the editors show it. */
export function withDayCountConfirmation<
  Validation extends { errors: EventIssue[]; warnings: EventIssue[] },
>(validation: Validation, basis: DayCountBasis | null): Validation {
  if (!basis?.confirmation) return validation;
  return {
    ...validation,
    warnings: [...validation.warnings, basis.confirmation],
  };
}
