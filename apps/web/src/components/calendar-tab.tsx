"use client";

import { ChevronLeft, ChevronRight, Plus, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";

import {
  addMonthsToYearMonth,
  buildMonthGrid,
  compareDateOnly,
  createServiceEvent,
  dayOfWeek,
  deleteServiceEvent,
  isLive,
  restoreServiceEvent,
  updateServiceEvent,
  yearMonthOf,
  type DateOnly,
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
  data,
  profile,
  projection,
  today,
  store,
  view,
  onViewChange,
}: {
  data: UserData;
  profile: ServiceProfile;
  projection: AppProjection;
  today: DateOnly;
  store: UserDataStore;
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
}) {
  const [editor, setEditor] = useState<EditorState>({ mode: "closed" });
  const [selectedDate, setSelectedDate] = useState<DateOnly>(today);
  const [month, setMonth] = useState<YearMonth>(yearMonthOf(today));
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

  return (
    <section className="calendar-page" aria-label="복무 캘린더">
      <div className="calendar-toolbar">
        <div
          className="segmented segmented--tabs"
          role="tablist"
          aria-label="보기 선택"
        >
          {(
            [
              ["month", "월간"],
              ["agenda", "목록"],
              ["ledger", "휴가 원장"],
            ] as const
          ).map(([key, label]) => (
            <button
              aria-selected={view === key}
              className={
                view === key ? "segmented__item is-active" : "segmented__item"
              }
              key={key}
              onClick={() => onViewChange(key)}
              role="tab"
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <Button
          onClick={() =>
            setEditor({
              mode: "create",
              date: view === "month" ? selectedDate : today,
            })
          }
          size="compact"
          type="button"
        >
          <Plus aria-hidden="true" size={18} />
          기록 추가
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

function EventChip({ event }: { event: ServiceEvent }) {
  const category = EVENT_CATEGORY[event.eventType];
  return (
    <span className={`event-chip event-chip--${category}`}>
      {eventLabel(event)}
    </span>
  );
}

function MonthView({
  events,
  month,
  selectedDate,
  today,
  onMonthChange,
  onSelectDate,
  onOpenEvent,
  onAdd,
}: {
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
    <>
      <div className="month-header">
        <button
          aria-label="이전 달"
          className="icon-button"
          onClick={() => onMonthChange(addMonthsToYearMonth(month, -1))}
          type="button"
        >
          <ChevronLeft aria-hidden="true" size={22} />
        </button>
        <h2 aria-live="polite">{formatKoreanMonth(month)}</h2>
        <button
          aria-label="다음 달"
          className="icon-button"
          onClick={() => onMonthChange(addMonthsToYearMonth(month, 1))}
          type="button"
        >
          <ChevronRight aria-hidden="true" size={22} />
        </button>
        <button
          className="text-button"
          onClick={() => {
            onMonthChange(yearMonthOf(today));
            onSelectDate(today);
          }}
          type="button"
        >
          오늘
        </button>
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
              const categories = [
                ...new Set(
                  dayEvents.map((event) => EVENT_CATEGORY[event.eventType]),
                ),
              ] as EventCategory[];
              const classes = ["month-cell"];
              if (!cell.inMonth) classes.push("is-outside");
              if (cell.date === today) classes.push("is-today");
              if (cell.date === selectedDate) classes.push("is-selected");
              const weekday = dayOfWeek(cell.date);
              if (weekday === 0) classes.push("is-sunday");
              if (weekday === 6) classes.push("is-saturday");
              return (
                <button
                  aria-label={`${formatDayHeading(cell.date, weekday)}${
                    dayEvents.length ? `, 기록 ${dayEvents.length}건` : ""
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
                  <span className="month-cell__dots" aria-hidden="true">
                    {categories.slice(0, 3).map((category) => (
                      <i className={`dot dot--${category}`} key={category} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <ul className="legend" aria-label="색상 안내">
        {(Object.keys(CATEGORY_LABELS) as EventCategory[]).map((category) => (
          <li key={category}>
            <i className={`dot dot--${category}`} aria-hidden="true" />
            {CATEGORY_LABELS[category]}
          </li>
        ))}
      </ul>

      <section className="day-panel" aria-label={`${selectedDate} 기록`}>
        <header>
          <h3>{formatDayHeading(selectedDate, dayOfWeek(selectedDate))}</h3>
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
          <p className="empty-line">기록이 없어요.</p>
        )}
      </section>
    </>
  );
}

function EventRow({
  event,
  onOpen,
}: {
  event: ServiceEvent;
  onOpen: (event: ServiceEvent) => void;
}) {
  return (
    <button className="event-row" onClick={() => onOpen(event)} type="button">
      <EventChip event={event} />
      <span className="event-row__body">
        <strong>{describeTiming(event)}</strong>
        {event.note ? <small>{event.note}</small> : null}
      </span>
      <span className="event-row__source">
        {event.source.kind === "IMPORT" ? "파일" : "직접"}
      </span>
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
    <>
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
            {item.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <section className="empty-state empty-state--compact">
          <h2>아직 기록이 없어요.</h2>
          <p>
            &lsquo;기록 추가&rsquo;로 직접 입력하거나, 내 정보에서 기관 파일을
            가져올 수 있어요.
          </p>
        </section>
      ) : null}

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

      {deletedEvents.length ? (
        <details className="deleted-list">
          <summary>최근 삭제한 기록 {deletedEvents.length}건</summary>
          <ul>
            {deletedEvents.map((event) => (
              <li key={event.id}>
                <span>
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
    </>
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
      <h3>{title}</h3>
      <ul className="event-list">
        {events.map((event) => (
          <li key={event.id}>
            <time dateTime={event.startDate}>
              {formatDayHeading(event.startDate, dayOfWeek(event.startDate))}
            </time>
            <EventRow event={event} onOpen={onOpenEvent} />
          </li>
        ))}
      </ul>
    </section>
  );
}
