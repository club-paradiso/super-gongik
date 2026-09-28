"use client";

import { EmptyState } from "@/components/ui/empty-state";

import {
  CalendarCheck2,
  ChevronLeft,
  ChevronRight,
  Plus,
  RotateCcw,
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import {
  ANNUAL_LEAVE_CUMULATIVE_MINUTES_PER_DAY,
  addMonthsToYearMonth,
  buildMonthGrid,
  compareDateOnly,
  createServiceEvent,
  dayOfWeek,
  deleteServiceEvent,
  formatLeaveQuantity,
  isLive,
  restoreServiceEvent,
  updateServiceEvent,
  yearMonthOf,
  type DateOnly,
  type LeaveLedger,
  type ServiceEvent,
  type ServiceProfile,
  type UserData,
  type UserDataStore,
  type YearMonth,
} from "@super-gongik/domain";

import { EventEditor, type EventSaveResult } from "@/components/event-editor";
import { LeaveLedgerPanel } from "@/components/leave-ledger-panel";
import { Button } from "@/components/ui/button";
import {
  CATEGORY_LABELS,
  EVENT_CATEGORY,
  WEEKDAYS,
  describeTiming,
  eventLabel,
  formatDayHeading,
  formatKoreanMonth,
  type EventCategory,
} from "@/lib/event-display";
import type { AppProjection } from "@/lib/projections";

export type CalendarView = "month" | "agenda" | "ledger";

type EditorState =
  | { mode: "closed" }
  | { mode: "create"; date: DateOnly }
  | { mode: "edit"; event: ServiceEvent };

function eventsOn(events: readonly ServiceEvent[], date: DateOnly) {
  return events.filter(
    (event) =>
      compareDateOnly(event.startDate, date) <= 0 &&
      compareDateOnly(date, event.endDate) <= 0,
  );
}

export function CalendarTab({
  createOnOpen = null,
  data,
  profile,
  projection,
  today,
  store,
  view,
  onViewChange,
}: {
  /** Open the editor for a new record on this date when the tab mounts. */
  createOnOpen?: DateOnly | null;
  data: UserData;
  profile: ServiceProfile;
  projection: AppProjection;
  today: DateOnly;
  store: UserDataStore;
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
}) {
  const [editor, setEditor] = useState<EditorState>(() =>
    createOnOpen ? { mode: "create", date: createOnOpen } : { mode: "closed" },
  );
  const [selectedDate, setSelectedDate] = useState<DateOnly>(
    createOnOpen ?? today,
  );
  const [month, setMonth] = useState<YearMonth>(
    yearMonthOf(createOnOpen ?? today),
  );
  const [undo, setUndo] = useState<ServiceEvent | null>(null);
  const [message, setMessage] = useState("");

  const liveEvents = projection.liveEvents;
  const deletedEvents = useMemo(
    () =>
      data.events
        .filter((event) => !isLive(event))
        .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""))
        .slice(0, 20),
    [data.events],
  );

  async function save(draft: unknown): Promise<EventSaveResult> {
    const result =
      editor.mode === "edit"
        ? await store.run((current, context) =>
            updateServiceEvent(current, editor.event.id, draft, context),
          )
        : await store.run((current, context) =>
            createServiceEvent(current, draft, context),
          );
    if (!result.ok) return result;
    setMessage(
      editor.mode === "edit" ? "기록을 수정했어요." : "기록을 저장했어요.",
    );
    setUndo(null);
    if (editor.mode === "create" || editor.mode === "edit") {
      const saved = result.value as ServiceEvent;
      setSelectedDate(saved.startDate);
      setMonth(yearMonthOf(saved.startDate));
    }
    return { ok: true };
  }

  async function remove(event: ServiceEvent) {
    const result = await store.run((current, context) =>
      deleteServiceEvent(current, event.id, context),
    );
    if (result.ok) {
      setUndo(event);
      setMessage("");
    }
  }

  async function restore(event: ServiceEvent) {
    const result = await store.run((current, context) =>
      restoreServiceEvent(current, event.id, context),
    );
    setUndo(null);
    setMessage(
      result.ok
        ? "기록을 되돌렸어요."
        : (result.errors[0]?.message ?? "되돌리지 못했어요."),
    );
  }

  const strip =
    view !== "ledger" ? (
      <LeaveStrip
        ledger={projection.ledger}
        onOpenLedger={() => onViewChange("ledger")}
        state={projection.progress.state}
      />
    ) : null;

  return (
    <section className="calendar-page" aria-label="복무 캘린더">
      <div className="calendar-toolbar">
        <div
          className="segmented segmented--tabs"
          role="group"
          aria-label="보기 선택"
        >
          {(
            [
              ["month", "월간"],
              ["agenda", "목록"],
              ["ledger", "휴가 내역"],
            ] as const
          ).map(([key, label]) => (
            <button
              aria-pressed={view === key}
              className={
                view === key ? "segmented__item is-active" : "segmented__item"
              }
              key={key}
              onClick={() => onViewChange(key)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <Button
          className="calendar-add"
          onClick={() =>
            setEditor({
              mode: "create",
              date: view === "month" ? selectedDate : today,
            })
          }
          size="compact"
          type="button"
        >
          <Plus aria-hidden="true" size={18} strokeWidth={2.4} />
          <span className="calendar-add__label">기록 추가</span>
        </Button>
      </div>

      {undo ? (
        <div className="undo-bar" role="status">
          <span>{eventLabel(undo)} 기록을 삭제했어요.</span>
          <button onClick={() => void restore(undo)} type="button">
            <RotateCcw aria-hidden="true" size={16} />
            되돌리기
          </button>
        </div>
      ) : message ? (
        <p className="save-message" role="status">
          {message}
        </p>
      ) : null}

      {view === "month" ? (
        <MonthView
          aside={strip}
          events={liveEvents}
          month={month}
          onMonthChange={setMonth}
          onOpenEvent={(event) => setEditor({ mode: "edit", event })}
          onAdd={(date) => setEditor({ mode: "create", date })}
          onSelectDate={setSelectedDate}
          selectedDate={selectedDate}
          today={today}
        />
      ) : null}

      {view === "agenda" ? strip : null}
      {view === "agenda" ? (
        <AgendaView
          deletedEvents={deletedEvents}
          events={liveEvents}
          onOpenEvent={(event) => setEditor({ mode: "edit", event })}
          onRestore={(event) => void restore(event)}
          today={today}
        />
      ) : null}

      {view === "ledger" ? (
        <LeaveLedgerPanel
          data={data}
          ledger={projection.ledger}
          profile={profile}
          store={store}
          today={today}
        />
      ) : null}

      {editor.mode !== "closed" ? (
        <EventEditor
          event={editor.mode === "edit" ? editor.event : null}
          events={data.events}
          initialDate={
            editor.mode === "create" ? editor.date : editor.event.startDate
          }
          key={editor.mode === "edit" ? editor.event.id : `new-${editor.date}`}
          onClose={() => setEditor({ mode: "closed" })}
          onDelete={(event) => void remove(event)}
          onSave={save}
          profile={profile}
        />
      ) : null}
    </section>
  );
}

/** Leave balance kept in sight while planning, one tap from the ledger. */
function LeaveStrip({
  ledger,
  state,
  onOpenLedger,
}: {
  ledger: LeaveLedger;
  state: AppProjection["progress"]["state"];
  onOpenLedger: () => void;
}) {
  if (state === "COMPLETED") return null;
  const balance = ledger.balance;
  const needsConfirmation = balance.status === "NEEDS_CREDIT_CONFIRMATION";
  const scheduled =
    balance.scheduled.halfDays !== 0 || balance.scheduled.minutes !== 0;
  return (
    <button className="leave-strip" onClick={onOpenLedger} type="button">
      <span aria-hidden="true" className="leave-strip__icon">
        <CalendarCheck2 size={18} />
      </span>
      <span className="leave-strip__label">남은 연가</span>
      <strong
        className={
          needsConfirmation
            ? "leave-strip__value leave-strip__value--attention"
            : "leave-strip__value"
        }
      >
        {state === "NOT_STARTED"
          ? "소집 후 부여"
          : needsConfirmation
            ? "부여 일수 확인 필요"
            : formatLeaveQuantity(
                balance.remainingAfterScheduled,
                ANNUAL_LEAVE_CUMULATIVE_MINUTES_PER_DAY,
              )}
      </strong>
      {scheduled && !needsConfirmation ? (
        <span className="leave-strip__hint">
          예정{" "}
          {formatLeaveQuantity(
            balance.scheduled,
            ANNUAL_LEAVE_CUMULATIVE_MINUTES_PER_DAY,
          )}{" "}
          반영
        </span>
      ) : null}
      <span className="leave-strip__end">
        내역
        <ChevronRight aria-hidden="true" size={16} />
      </span>
    </button>
  );
}

/** Category shape: color is never the only cue (circle, diamond, …). */
function CategoryMark({ category }: { category: EventCategory }) {
  return <i aria-hidden="true" className={`mark mark--${category}`} />;
}

function EventChip({ event }: { event: ServiceEvent }) {
  const category = EVENT_CATEGORY[event.eventType];
  return (
    <span className={`event-chip event-chip--${category}`}>
      <CategoryMark category={category} />
      {eventLabel(event)}
    </span>
  );
}

function MonthView({
  aside,
  events,
  month,
  selectedDate,
  today,
  onMonthChange,
  onSelectDate,
  onOpenEvent,
  onAdd,
}: {
  aside: ReactNode;
  events: readonly ServiceEvent[];
  month: YearMonth;
  selectedDate: DateOnly;
  today: DateOnly;
  onMonthChange: (month: YearMonth) => void;
  onSelectDate: (date: DateOnly) => void;
  onOpenEvent: (event: ServiceEvent) => void;
  onAdd: (date: DateOnly) => void;
}) {
  const grid = useMemo(() => buildMonthGrid(month), [month]);
  const selectedEvents = eventsOn(events, selectedDate);

  return (
    <div className="month-layout">
      {aside}
      <div className="month-card">
        <div className="month-header">
          <h2 aria-live="polite">{formatKoreanMonth(month)}</h2>
          <div className="month-header__controls">
            <button
              className="month-header__today"
              onClick={() => {
                onMonthChange(yearMonthOf(today));
                onSelectDate(today);
              }}
              type="button"
            >
              오늘
            </button>
            <button
              aria-label="이전 달"
              className="icon-button"
              onClick={() => onMonthChange(addMonthsToYearMonth(month, -1))}
              type="button"
            >
              <ChevronLeft aria-hidden="true" size={20} />
            </button>
            <button
              aria-label="다음 달"
              className="icon-button"
              onClick={() => onMonthChange(addMonthsToYearMonth(month, 1))}
              type="button"
            >
              <ChevronRight aria-hidden="true" size={20} />
            </button>
          </div>
        </div>

        <div className="month-grid">
          <div className="month-grid__weekdays" aria-hidden="true">
            {WEEKDAYS.map((weekday, index) => (
              <span
                className={
                  index === 0
                    ? "is-sunday"
                    : index === 6
                      ? "is-saturday"
                      : undefined
                }
                key={weekday}
              >
                {weekday}
              </span>
            ))}
          </div>
          {grid.map((week) => (
            <div className="month-grid__week" key={week[0]?.date}>
              {week.map((cell) => {
                const dayEvents = eventsOn(events, cell.date);
                // A multi-day record reads as one continuous bar across days.
                const span = dayEvents.find(
                  (event) => event.startDate !== event.endDate,
                );
                const singles = dayEvents.filter((event) => event !== span);
                const categories = [
                  ...new Set(
                    singles.map((event) => EVENT_CATEGORY[event.eventType]),
                  ),
                ] as EventCategory[];
                const classes = ["month-cell"];
                if (!cell.inMonth) classes.push("is-outside");
                if (cell.date === today) classes.push("is-today");
                if (cell.date === selectedDate) classes.push("is-selected");
                const weekday = dayOfWeek(cell.date);
                if (weekday === 0) classes.push("is-sunday");
                if (weekday === 6) classes.push("is-saturday");
                const spanStarts =
                  span !== undefined &&
                  (span.startDate === cell.date || weekday === 0);
                return (
                  <button
                    aria-current={cell.date === today ? "date" : undefined}
                    aria-label={`${formatDayHeading(cell.date, weekday)}${
                      dayEvents.length
                        ? `, 기록 ${dayEvents.length}건: ${dayEvents
                            .map((event) => eventLabel(event))
                            .join(", ")}`
                        : ""
                    }`}
                    aria-pressed={cell.date === selectedDate}
                    className={classes.join(" ")}
                    key={cell.date}
                    onClick={() => {
                      onSelectDate(cell.date);
                      if (!cell.inMonth) onMonthChange(yearMonthOf(cell.date));
                    }}
                    type="button"
                  >
                    <span className="month-cell__day">
                      {Number(cell.date.slice(8))}
                    </span>
                    <span className="month-cell__lane" aria-hidden="true">
                      {span ? (
                        <span
                          className={[
                            "month-cell__range",
                            `month-cell__range--${EVENT_CATEGORY[span.eventType]}`,
                            spanStarts ? "is-start" : "",
                            span.endDate === cell.date || weekday === 6
                              ? "is-end"
                              : "",
                          ].join(" ")}
                        >
                          {spanStarts ? (
                            <span className="month-cell__range-label">
                              {eventLabel(span)}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </span>
                    <span className="month-cell__marks" aria-hidden="true">
                      {categories.slice(0, 3).map((category) => (
                        <CategoryMark category={category} key={category} />
                      ))}
                    </span>
                    {singles.length ? (
                      <span className="month-cell__chips" aria-hidden="true">
                        {singles.slice(0, 2).map((event) => (
                          <span
                            className={`cell-chip cell-chip--${EVENT_CATEGORY[event.eventType]}`}
                            key={event.id}
                          >
                            <CategoryMark
                              category={EVENT_CATEGORY[event.eventType]}
                            />
                            <span className="cell-chip__text">
                              {eventLabel(event)}
                            </span>
                          </span>
                        ))}
                        {singles.length > 2 ? (
                          <span className="cell-chip cell-chip--more">
                            +{singles.length - 2}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <ul className="legend" aria-label="색상 안내">
          {(Object.keys(CATEGORY_LABELS) as EventCategory[]).map((category) => (
            <li key={category}>
              <CategoryMark category={category} />
              {CATEGORY_LABELS[category]}
            </li>
          ))}
          <li className="legend__span">
            <i aria-hidden="true" className="legend__bar" />
            여러 날
          </li>
        </ul>
      </div>

      <section className="day-panel" aria-label={`${selectedDate} 기록`}>
        <header>
          <h3 className="num">
            {formatDayHeading(selectedDate, dayOfWeek(selectedDate))}
          </h3>
          <button
            className="text-button"
            onClick={() => onAdd(selectedDate)}
            type="button"
          >
            <Plus aria-hidden="true" size={16} />이 날 추가
          </button>
        </header>
        {selectedEvents.length ? (
          <ul className="event-list">
            {selectedEvents.map((event) => (
              <li key={event.id}>
                <EventRow event={event} onOpen={onOpenEvent} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="기록이 없어요"
            description="휴가나 근무 일정을 추가해 보세요."
            compact
          />
        )}
      </section>
    </div>
  );
}

function EventRow({
  event,
  onOpen,
}: {
  event: ServiceEvent;
  onOpen: (event: ServiceEvent) => void;
}) {
  // Keep a time range such as "(16:00–18:00)" together when the row wraps.
  const timing = describeTiming(event);
  const rangeAt = timing.indexOf(" (");
  return (
    <button className="event-row" onClick={() => onOpen(event)} type="button">
      <EventChip event={event} />
      <span className="event-row__body">
        <strong className="num">
          {rangeAt === -1 ? (
            timing
          ) : (
            <>
              {timing.slice(0, rangeAt)}{" "}
              <span className="event-row__range">
                {timing.slice(rangeAt + 1)}
              </span>
            </>
          )}
        </strong>
        {event.note ? <small>{event.note}</small> : null}
      </span>
      <span className="event-row__source">
        {event.source.kind === "IMPORT" ? "파일" : "직접"}
      </span>
      <ChevronRight
        aria-hidden="true"
        className="event-row__chevron"
        size={18}
      />
    </button>
  );
}

const FILTERS: Array<{ key: EventCategory | "all"; label: string }> = [
  { key: "all", label: "전체" },
  { key: "leave", label: "휴가" },
  { key: "sick", label: "병가" },
  { key: "attendance", label: "근태" },
  { key: "duty", label: "교육·훈련" },
  { key: "note", label: "메모" },
];

function AgendaView({
  events,
  deletedEvents,
  today,
  onOpenEvent,
  onRestore,
}: {
  events: readonly ServiceEvent[];
  deletedEvents: readonly ServiceEvent[];
  today: DateOnly;
  onOpenEvent: (event: ServiceEvent) => void;
  onRestore: (event: ServiceEvent) => void;
}) {
  const [filter, setFilter] = useState<EventCategory | "all">("all");
  const filtered = events.filter(
    (event) => filter === "all" || EVENT_CATEGORY[event.eventType] === filter,
  );
  const upcoming = filtered.filter(
    (event) => compareDateOnly(event.endDate, today) >= 0,
  );
  const past = filtered
    .filter((event) => compareDateOnly(event.endDate, today) < 0)
    .reverse();

  return (
    <div className="agenda">
      <div className="filter-row" role="group" aria-label="종류 필터">
        {FILTERS.map((item) => (
          <button
            aria-pressed={filter === item.key}
            className={
              filter === item.key ? "filter-chip is-active" : "filter-chip"
            }
            key={item.key}
            onClick={() => setFilter(item.key)}
            type="button"
          >
            {item.key !== "all" ? <CategoryMark category={item.key} /> : null}
            {item.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="아직 기록이 없어요"
          description="기록 추가로 직접 입력하거나, 내 정보에서 기관 파일을 가져올 수 있어요."
        />
      ) : null}

      {upcoming.length || past.length ? (
        <div className="agenda__groups">
          {upcoming.length ? (
            <AgendaGroup
              events={upcoming}
              onOpenEvent={onOpenEvent}
              title="오늘 이후"
            />
          ) : null}
          {past.length ? (
            <AgendaGroup
              events={past}
              onOpenEvent={onOpenEvent}
              title="지난 기록"
            />
          ) : null}
        </div>
      ) : null}

      {deletedEvents.length ? (
        <details className="deleted-list">
          <summary>최근 삭제한 기록 {deletedEvents.length}건</summary>
          <ul>
            {deletedEvents.map((event) => (
              <li key={event.id}>
                <span className="num">
                  {event.startDate} · {eventLabel(event)} ·{" "}
                  {describeTiming(event)}
                </span>
                <button onClick={() => onRestore(event)} type="button">
                  되돌리기
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function AgendaGroup({
  title,
  events,
  onOpenEvent,
}: {
  title: string;
  events: readonly ServiceEvent[];
  onOpenEvent: (event: ServiceEvent) => void;
}) {
  return (
    <section className="agenda-group" aria-label={title}>
      <h2>{title}</h2>
      <ul className="event-list">
        {events.map((event) => (
          <li key={event.id}>
            <time className="num" dateTime={event.startDate}>
              {formatDayHeading(event.startDate, dayOfWeek(event.startDate))}
            </time>
            <EventRow event={event} onOpen={onOpenEvent} />
          </li>
        ))}
      </ul>
    </section>
  );
}
