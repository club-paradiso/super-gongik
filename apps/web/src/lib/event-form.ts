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
  type DateOnly,
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
