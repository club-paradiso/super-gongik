"use client";

import { Trash2, X } from "lucide-react";
import {
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  SERVICE_EVENT_TYPE_LABELS,
  classifyAnnualLeaveUsage,
  clockToMinutes,
  countWeekdays,
  inclusiveDaySpan,
  isDateOnly,
  isAnnualLeaveAttendanceType,
  isCompensationNonPayableEventType,
  isLeaveEventType,
  validateServiceEventDraft,
  type DateOnly,
  type EventIssue,
  type ServiceEvent,
  type ServiceEventType,
  type ServiceProfile,
  type SickLeaveCategory,
} from "@super-gongik/domain";

import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { EVENT_TYPE_GROUPS } from "@/lib/event-display";

type Mode = "ALL_DAY" | "HALF_DAY" | "PARTIAL";

type FormState = {
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

export type EventSaveResult =
  { ok: true } | { ok: false; errors: EventIssue[] };

function initialState(event: ServiceEvent | null, date: DateOnly): FormState {
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

function timingFromForm(form: FormState) {
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

function buildDraft(form: FormState, profile: ServiceProfile) {
  let timing: unknown = timingFromForm(form);
  let eventType = form.eventType;
  const classification = classifyAnnualLeaveUsage({
    eventType: form.eventType,
    timing: timing as ServiceEvent["timing"],
    workdayStartTime: profile.workdayStartTime,
    workdayEndTime: profile.workdayEndTime,
  });

  if (form.mode === "PARTIAL" && classification?.automatic) {
    eventType = classification.eventType;
    if (classification.kind === "FULL_DAY") {
      timing = { kind: "ALL_DAY", dayCount: 1 };
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
      eventType === "SICK_LEAVE"
        ? form.sickLeaveCategory || "UNKNOWN"
        : null,
  };
}

export function EventEditor({
  event,
  initialDate,
  profile,
  events,
  onSave,
  onDelete,
  onClose,
}: {
  event: ServiceEvent | null;
  initialDate: DateOnly;
  profile: ServiceProfile;
  events: readonly ServiceEvent[];
  onSave: (draft: ReturnType<typeof buildDraft>) => Promise<EventSaveResult>;
  onDelete?: (event: ServiceEvent) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [form, setForm] = useState(() => initialState(event, initialDate));
  const [errors, setErrors] = useState<EventIssue[]>([]);
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const rawTiming = useMemo(() => timingFromForm(form), [form]);
  const usageClassification = useMemo(
    () =>
      classifyAnnualLeaveUsage({
        eventType: form.eventType,
        timing: rawTiming as ServiceEvent["timing"],
        workdayStartTime: profile.workdayStartTime,
        workdayEndTime: profile.workdayEndTime,
      }),
    [form.eventType, profile.workdayEndTime, profile.workdayStartTime, rawTiming],
  );
  const draft = useMemo(() => buildDraft(form, profile), [form, profile]);
  const validation = useMemo(
    () =>
      validateServiceEventDraft(draft, {
        existingEvents: events,
        editingId: event?.id ?? null,
        servicePeriod: {
          callUpDate: profile.callUpDate,
          expectedDischargeDate: profile.expectedDischargeDate,
        },
      }),
    [draft, event?.id, events, profile],
  );
  const warningsKey = validation.warnings
    .map((issue) => issue.message)
    .join("|");
  const isLeave = isLeaveEventType(form.eventType);
  const isAnnualCharge =
    form.eventType === "ANNUAL_LEAVE" ||
    isAnnualLeaveAttendanceType(form.eventType);

  function update(patch: Partial<FormState>) {
    setForm((current) => {
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
    });
    setErrors([]);
  }

  async function handleSubmit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (validation.errors.length) {
      setErrors(validation.errors);
      return;
    }
    if (validation.warnings.length && acknowledged !== warningsKey) {
      setAcknowledged(warningsKey);
      return;
    }
    setSaving(true);
    const result = await onSave(draft);
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dialogRef.current?.close();
  }

  const showWarnings =
    validation.warnings.length > 0 && acknowledged === warningsKey;

  return (
    <dialog
      aria-labelledby={titleId}
      className="sheet"
      onClose={onClose}
      ref={dialogRef}
    >
      <form className="sheet__form" onSubmit={handleSubmit} noValidate>
        <span aria-hidden="true" className="sheet__grabber" />
        <header className="sheet__header">
          <h2 id={titleId}>{event ? "기록 수정" : "기록 추가"}</h2>
          <button
            aria-label="닫기"
            className="icon-button"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            <X aria-hidden="true" size={22} />
          </button>
        </header>

        <div className="sheet__body">
          {event?.source.kind === "IMPORT" ? (
            <p className="sheet__source">
              {event.source.fileName || "파일"} {event.source.sourceRowIndex}
              행에서 가져온 기록이에요. 수정해도 가져오기 취소 시 함께 삭제돼요.
            </p>
          ) : null}

          <label className="form-field">
            <span>종류</span>
            <select
              value={form.eventType}
              onChange={(change) =>
                update({ eventType: change.target.value as ServiceEventType })
              }
            >
              {EVENT_TYPE_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.types.map((type) => (
                    <option key={type} value={type}>
                      {SERVICE_EVENT_TYPE_LABELS[type]}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {form.eventType === "SICK_LEAVE" ? (
            <label className="form-field">
              <span>병가 구분</span>
              <select
                value={form.sickLeaveCategory}
                onChange={(change) =>
                  update({
                    sickLeaveCategory: change.target.value as SickLeaveCategory,
                  })
                }
              >
                <option value="">선택해 주세요</option>
                <option value="ORDINARY">공무 외 질병·부상</option>
                <option value="PUBLIC_DUTY">공무수행상 질병·부상</option>
                <option value="UNKNOWN">아직 확인하지 못함</option>
              </select>
              <small>
                공무수행상 질병·부상 병가는 30일 초과 미지급 계산에서 제외돼요.
                확인 전에는 자동 공제하지 않아요.
              </small>
            </label>
          ) : null}

          <fieldset className="segmented" aria-label="기록 단위">
            {(
              [
                ["ALL_DAY", isAnnualCharge ? "종일 연가" : "하루 단위"],
                ["HALF_DAY", isAnnualCharge ? "반가" : "반일"],
                ["PARTIAL", isAnnualCharge ? "시간 사용" : "시간 단위"],
              ] as const
            ).map(([mode, label]) => (
              <label
                className={
                  form.mode === mode
                    ? "segmented__item is-active"
                    : "segmented__item"
                }
                key={mode}
              >
                <input
                  checked={form.mode === mode}
                  disabled={
                    (mode === "HALF_DAY" &&
                      form.eventType !== "ANNUAL_LEAVE") ||
                    (mode !== "ALL_DAY" &&
                      isCompensationNonPayableEventType(form.eventType))
                  }
                  name="mode"
                  onChange={() => update({ mode })}
                  type="radio"
                />
                {label}
              </label>
            ))}
          </fieldset>
          {isCompensationNonPayableEventType(form.eventType) ? (
            <p className="field-hint">
              이 기록은 기본 보수 미지급일 근거로 쓰이므로 하루 단위로만
              저장해요.
            </p>
          ) : form.eventType !== "ANNUAL_LEAVE" && !isAnnualCharge ? (
            <p className="field-hint">반일은 연가(반가)에만 쓸 수 있어요.</p>
          ) : form.mode === "HALF_DAY" ? (
            <p className="field-hint">
              반가는 단순한 4시간 사용이 아니에요. 오전·오후 반일 승인
              단위이며 14:00를 기준으로 구분해요.
            </p>
          ) : null}

          {form.mode === "ALL_DAY" ? (
            <div className="field-row">
              <label className="form-field">
                <span>시작일</span>
                <DateInput
                  required
                  value={form.startDate}
                  onValueChange={(value) =>
                    update({
                      startDate: value,
                      endDate: form.endDate < value ? value : form.endDate,
                    })
                  }
                />
              </label>
              <label className="form-field">
                <span>종료일</span>
                <DateInput
                  required
                  min={form.startDate}
                  value={form.endDate}
                  onValueChange={(value) => update({ endDate: value })}
                />
              </label>
              <label className="form-field field-row__full">
                <span>{isLeave ? "차감 일수" : "일수"}</span>
                <input
                  inputMode="numeric"
                  min="1"
                  step="1"
                  type="number"
                  value={form.dayCount}
                  onChange={(change) =>
                    update({
                      dayCount: change.target.value,
                      dayCountTouched: true,
                    })
                  }
                />
                <small>
                  {isCompensationNonPayableEventType(form.eventType)
                    ? "선택한 날짜 범위를 그대로 셌어요. 일부 날짜만 해당하면 기록을 나눠 주세요."
                    : "주말은 빼고 자동으로 셌어요. 공휴일은 직접 확인해 주세요."}
                </small>
              </label>
            </div>
          ) : (
            <label className="form-field">
              <span>날짜</span>
              <DateInput
                required
                value={form.startDate}
                onValueChange={(value) =>
                  update({
                    startDate: value,
                    endDate: value,
                  })
                }
              />
            </label>
          )}

          {form.mode === "HALF_DAY" ? (
            <fieldset className="segmented" aria-label="오전 또는 오후">
              {(
                [
                  ["AM", "오전"],
                  ["PM", "오후"],
                ] as const
              ).map(([half, label]) => (
                <label
                  className={
                    form.half === half
                      ? "segmented__item is-active"
                      : "segmented__item"
                  }
                  key={half}
                >
                  <input
                    checked={form.half === half}
                    name="half"
                    onChange={() => update({ half })}
                    type="radio"
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          ) : null}

          {form.mode === "PARTIAL" ? (
            <div className="field-row">
              <label className="form-field">
                <span>시작 시각 (선택)</span>
                <input
                  type="time"
                  value={form.startTime}
                  onChange={(change) =>
                    update({ startTime: change.target.value })
                  }
                />
              </label>
              <label className="form-field">
                <span>종료 시각 (선택)</span>
                <input
                  type="time"
                  value={form.endTime}
                  onChange={(change) =>
                    update({ endTime: change.target.value })
                  }
                />
              </label>
              <label className="form-field">
                <span>사용 시간</span>
                <div className="unit-input">
                  <input
                    aria-label="시간"
                    inputMode="numeric"
                    min="0"
                    max="23"
                    type="number"
                    value={form.hours}
                    onChange={(change) =>
                      update({
                        hours: change.target.value,
                        durationTouched: true,
                      })
                    }
                  />
                  <span>시간</span>
                </div>
              </label>
              <label className="form-field">
                <span className="visually-hidden">분</span>
                <div className="unit-input unit-input--offset">
                  <input
                    aria-label="분"
                    inputMode="numeric"
                    min="0"
                    max="59"
                    type="number"
                    value={form.minutes}
                    onChange={(change) =>
                      update({
                        minutes: change.target.value,
                        durationTouched: true,
                      })
                    }
                  />
                  <span>분</span>
                </div>
              </label>
            </div>
          ) : null}

          {usageClassification ? (
            <div className="sheet__source" role="status">
              <strong>자동 구분: {usageClassification.label}</strong>
              <br />
              {usageClassification.reason}
              {usageClassification.kind === "LATE_ARRIVAL" ? (
                <>
                  <br />
                  입력 시간이 4시간이어도 반가로 바꾸지 않고 허가지각으로
                  저장하며, 누계 8시간을 연가 1일로 공제해요.
                </>
              ) : null}
            </div>
          ) : null}

          <label className="form-field">
            <span>메모 (선택)</span>
            <input
              maxLength={500}
              placeholder="사유나 기관 결재 번호 등"
              value={form.note}
              onChange={(change) => update({ note: change.target.value })}
            />
          </label>

          {errors.length ? (
            <ul className="issue-list issue-list--error" role="alert">
              {errors.map((issue) => (
                <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>
              ))}
            </ul>
          ) : null}
          {showWarnings ? (
            <ul className="issue-list issue-list--warning" role="status">
              {validation.warnings.map((issue) => (
                <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <footer className="sheet__actions">
          {event && onDelete ? (
            <Button
              aria-label="이 기록 삭제"
              className="sheet__delete"
              onClick={() => {
                onDelete(event);
                dialogRef.current?.close();
              }}
              type="button"
              variant="danger"
            >
              <Trash2 aria-hidden="true" size={18} />
              <span className="sheet__delete-label">삭제</span>
            </Button>
          ) : null}
          <Button disabled={saving} type="submit">
            {showWarnings ? "확인했어요, 저장" : "저장"}
          </Button>
        </footer>
      </form>
    </dialog>
  );
}
