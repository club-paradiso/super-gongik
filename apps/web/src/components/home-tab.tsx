"use client";

import {
  CalendarPlus,
  ChevronRight,
  ClipboardList,
  FileDown,
  FileUp,
  Flag,
  PartyPopper,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { memo } from "react";

import type { ServiceProfile } from "@super-gongik/domain";

import { useLiveCompletion } from "@/hooks/use-seoul-today";
import {
  EVENT_CATEGORY,
  describeTiming,
  eventLabel,
} from "@/lib/event-display";
import {
  formatShortDate,
  formatWon,
  relativeDays,
  type HomeAgendaItem,
  type HomeHero,
  type HomeModel,
} from "@/lib/home-model";

export function serviceStateLabel(
  state: "NOT_STARTED" | "IN_SERVICE" | "COMPLETED",
) {
  if (state === "NOT_STARTED") return "소집 전";
  if (state === "COMPLETED") return "복무 완료";
  return "복무 중";
}

export type HomeActions = {
  onOpenCalendar: () => void;
  onOpenLedger: () => void;
  onOpenMoney: () => void;
  onRecordLeave: () => void;
  onOpenRecords: () => void;
  onImportRecords: () => void;
};

export function HomeTab({
  profile,
  model,
  actions,
}: {
  profile: ServiceProfile;
  model: HomeModel;
  actions: HomeActions;
}) {
  return (
    <div className="home">
      <ServiceHero hero={model.hero} profile={profile} />
      <HomeStats actions={actions} model={model} />
      <HomeAgenda actions={actions} model={model} />
      <QuickActions actions={actions} completed={model.completed} />
    </div>
  );
}

/* Primary ─────────────────────────────────────────────────────────────── */

function ServiceHero({
  hero,
  profile,
}: {
  hero: HomeHero;
  profile: ServiceProfile;
}) {
  const showProgress = hero.phase !== "PRE_SERVICE";
  const progressText = `복무 ${hero.percentLabel} 완료, ${hero.elapsedDays}일 지남, ${hero.remainingDays}일 남음`;

  return (
    <section
      aria-labelledby="hero-headline"
      className="hero"
      data-phase={hero.phase}
    >
      <div className="hero__top">
        <p className="hero__eyebrow">{hero.eyebrow}</p>
        <span className="hero__state">
          {hero.phase === "COMPLETED" || hero.phase === "DISCHARGE_DAY" ? (
            <Flag aria-hidden="true" size={13} strokeWidth={2.4} />
          ) : null}
          {hero.stateLabel}
        </span>
      </div>

      <h2 className="hero__headline" id="hero-headline">
        <span aria-hidden="true">{hero.headline}</span>
        <span className="visually-hidden">{hero.headlineSpoken}</span>
      </h2>
      <p className="hero__date">{hero.dateLine}</p>

      {hero.reachedToday ? (
        <p className="hero__celebrate" role="status">
          {hero.phase === "DISCHARGE_DAY" ? (
            <PartyPopper aria-hidden="true" size={16} />
          ) : (
            <Sparkles aria-hidden="true" size={16} />
          )}
          {hero.reachedToday}
        </p>
      ) : null}

      {showProgress ? (
        <div className="hero__progress">
          <div
            aria-label="복무 진행률"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={hero.percent}
            aria-valuetext={progressText}
            className="hero-bar"
            role="progressbar"
          >
            <span
              className="hero-bar__fill"
              style={
                { "--progress": hero.percent / 100 } as React.CSSProperties
              }
            />
            <i className="hero-bar__tick" style={{ left: "25%" }} />
            <i className="hero-bar__tick" style={{ left: "50%" }} />
            <i className="hero-bar__tick" style={{ left: "75%" }} />
          </div>
          <div className="hero__meta" aria-hidden="true">
            {hero.live ? (
              <LivePercent profile={profile} />
            ) : (
              <strong className="hero__percent">{hero.percentLabel}</strong>
            )}
            {hero.phase === "COMPLETED" || hero.phase === "DISCHARGE_DAY" ? (
              <span>
                <b>{hero.totalServiceDays.toLocaleString("ko-KR")}일</b> 복무
              </span>
            ) : (
              <span>
                {hero.elapsedDays.toLocaleString("ko-KR")}일 지남 ·{" "}
                <b>{hero.remainingDays.toLocaleString("ko-KR")}일</b> 남음
              </span>
            )}
          </div>
        </div>
      ) : null}

      {hero.next ? (
        <div className="hero__next">
          <span className="hero__next-label">
            {hero.phase === "PRE_SERVICE" ? "이후" : "다음"}
          </span>
          <span className="hero__next-body">
            <strong>{hero.next.label}</strong>
            {hero.next.detail ? <small>{hero.next.detail}</small> : null}
          </span>
          <span className="hero__next-when">
            <b>{relativeDays(hero.next.daysUntil)}</b>
            <small>{formatShortDate(hero.next.date)}</small>
          </span>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The continuous percentage re-renders every second in isolation, so the
 * rest of the home screen is untouched by the tick.
 */
const LivePercent = memo(function LivePercent({
  profile,
}: {
  profile: ServiceProfile;
}) {
  const completion = useLiveCompletion(profile, true);
  // Truncate, never round: 99.99995 must not read as 100.0000.
  const value = Math.floor(completion * 1_000_000) / 10_000;
  return (
    <strong className="hero__percent hero__percent--live">
      {value.toFixed(4)}%
    </strong>
  );
});

/* Secondary ───────────────────────────────────────────────────────────── */

function HomeStats({
  model,
  actions,
}: {
  model: HomeModel;
  actions: HomeActions;
}) {
  const { leave, pay } = model;
  if (model.completed) return null;

  return (
    <section className="stat-pair" aria-label="연가와 급여">
      <button
        className="stat-card"
        onClick={actions.onOpenLedger}
        type="button"
      >
        <span className="stat-card__label">
          <ClipboardList aria-hidden="true" size={16} />
          남은 연가
        </span>
        {leave.kind === "READY" ? (
          <>
            <strong className="stat-card__value">{leave.remaining}</strong>
            <span className="stat-card__caption">{leave.caption}</span>
            {leave.attendance ? (
              <span className="stat-card__caption">{leave.attendance}</span>
            ) : null}
          </>
        ) : (
          <>
            <strong className="stat-card__value stat-card__value--muted">
              {leave.kind === "BEFORE_SERVICE" ? "소집 후" : "확인 필요"}
            </strong>
            <span
              className={
                leave.kind === "NEEDS_CONFIRMATION"
                  ? "stat-card__caption stat-card__caption--attention"
                  : "stat-card__caption"
              }
            >
              {leave.caption}
            </span>
          </>
        )}
      </button>

      <button className="stat-card" onClick={actions.onOpenMoney} type="button">
        <span className="stat-card__label">
          <WalletCards aria-hidden="true" size={16} />
          이번 달 급여
        </span>
        {pay.kind === "TOTAL" || pay.kind === "BASE_ONLY" ? (
          <strong className="stat-card__value">{formatWon(pay.amount)}</strong>
        ) : (
          <strong className="stat-card__value stat-card__value--muted">
            {pay.kind === "PENDING" ? "확인 필요" : "—"}
          </strong>
        )}
        <span
          className={
            pay.kind === "PENDING"
              ? "stat-card__caption stat-card__caption--attention"
              : "stat-card__caption"
          }
        >
          {pay.caption}
        </span>
        {pay.kind !== "NONE" && pay.band ? (
          <span className="stat-card__tag">{pay.band}</span>
        ) : null}
      </button>
    </section>
  );
}

/* Tertiary ────────────────────────────────────────────────────────────── */

function AgendaRow({ item }: { item: HomeAgendaItem }) {
  const category = EVENT_CATEGORY[item.event.eventType];
  return (
    <li className="agenda-row">
      <span className="agenda-row__when">
        <b>{item.isToday ? "오늘" : relativeDays(item.daysUntil)}</b>
        <small>{formatShortDate(item.event.startDate)}</small>
      </span>
      <span className={`agenda-row__bar agenda-row__bar--${category}`} />
      <span className="agenda-row__body">
        <strong>{eventLabel(item.event)}</strong>
        <small>{describeTiming(item.event)}</small>
      </span>
    </li>
  );
}

function HomeAgenda({
  model,
  actions,
}: {
  model: HomeModel;
  actions: HomeActions;
}) {
  if (model.completed) {
    return (
      <section className="home-card" aria-labelledby="records-title">
        <header className="home-card__head">
          <h2 id="records-title">복무 기록 보관</h2>
        </header>
        <p className="home-card__text">
          복무 중 남긴 기록은 이 기기에 그대로 있어요. 필요할 때를 위해 파일로
          내보내 두세요.
        </p>
        <button
          className="home-card__link"
          onClick={actions.onOpenRecords}
          type="button"
        >
          <FileDown aria-hidden="true" size={18} />
          기록 내보내기
          <ChevronRight aria-hidden="true" size={18} />
        </button>
      </section>
    );
  }

  const items = [...model.today, ...model.upcoming];
  return (
    <section className="home-card" aria-labelledby="agenda-title">
      <header className="home-card__head">
        <h2 id="agenda-title">다가오는 일정</h2>
        <button
          className="text-button"
          onClick={actions.onOpenCalendar}
          type="button"
        >
          캘린더
          <ChevronRight aria-hidden="true" size={16} />
        </button>
      </header>
      {items.length ? (
        <ul className="agenda-list">
          {items.map((item) => (
            <AgendaRow item={item} key={item.event.id} />
          ))}
        </ul>
      ) : (
        <p className="home-card__text">
          예정된 휴가나 일정이 없어요. 휴가를 정했다면 미리 기록해 두세요.
        </p>
      )}
    </section>
  );
}

function QuickActions({
  actions,
  completed,
}: {
  actions: HomeActions;
  completed: boolean;
}) {
  if (completed) return null;
  return (
    <nav aria-label="빠른 실행" className="quick-actions">
      <button onClick={actions.onRecordLeave} type="button">
        <CalendarPlus aria-hidden="true" size={20} />
        휴가·근태 기록
      </button>
      <button onClick={actions.onOpenLedger} type="button">
        <ClipboardList aria-hidden="true" size={20} />
        연가 원장
      </button>
      <button onClick={actions.onImportRecords} type="button">
        <FileUp aria-hidden="true" size={20} />
        기관 기록 가져오기
      </button>
    </nav>
  );
}
