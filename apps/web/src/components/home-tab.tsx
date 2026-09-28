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
import { memo, type CSSProperties } from "react";

import { EmptyState } from "@/components/ui/empty-state";

import type { ServiceProfile } from "@super-gongik/domain";

import { useLiveServiceProgress } from "@/hooks/use-seoul-today";
import {
  formatLiveCompletionPercentage,
  formatLiveCountdown,
} from "@/lib/live-service-progress";
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
    <div className={model.completed ? "home home--completed" : "home"}>
      <ServiceHero
        hero={model.hero}
        profile={profile}
        payBand={model.pay.kind !== "NONE" ? model.pay.band : null}
      />
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
  payBand,
}: {
  hero: HomeHero;
  profile: ServiceProfile;
  payBand: string | null;
}) {
  return (
    <section
      aria-labelledby="hero-headline"
      className="hero"
      data-phase={hero.phase}
    >
      <div className="hero__top">
        <p className="hero__eyebrow">
          {hero.eyebrow}
          {/* The eyebrow and headline already carry the state on every width
              ("소집까지" before call-up, "소집해제까지" in service, "복무 완료"
              after), so only the time-sensitive states earn a marker here. */}
          {hero.phase === "FINAL_STRETCH" || hero.phase === "DISCHARGE_DAY" ? (
            <span className="hero__state">
              {hero.phase === "DISCHARGE_DAY" ? (
                <Flag aria-hidden="true" size={13} />
              ) : (
                <span aria-hidden="true" className="hero__state-dot" />
              )}
              {hero.stateLabel}
            </span>
          ) : null}
        </p>
        {payBand ? (
          <p className="hero__pay">
            <WalletCards aria-hidden="true" size={15} />
            {payBand}
          </p>
        ) : null}
      </div>
      {hero.live && profile.liveProgressEnabled ? (
        <LiveReadout hero={hero} profile={profile} />
      ) : (
        <ServiceReadout hero={hero} />
      )}
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

/** One clock owns the readout and bar. The shell, cards and rules never tick. */
const LiveReadout = memo(function LiveReadout({
  hero,
  profile,
}: {
  hero: HomeHero;
  profile: ServiceProfile;
}) {
  const progress = useLiveServiceProgress(profile, true);
  return <ServiceReadout hero={hero} live={progress} />;
});

function ServiceReadout({
  hero,
  live,
}: {
  hero: HomeHero;
  live?: ReturnType<typeof useLiveServiceProgress>;
}) {
  const percent = live ? live.completionPercentage : hero.percent;
  const percentLabel = live
    ? formatLiveCompletionPercentage(live)
    : hero.percentLabel;
  const countdown = live ? formatLiveCountdown(live) : null;
  const progressText = live
    ? `복무 ${percentLabel} 완료, 남은 시간 ${countdown}`
    : `복무 ${hero.percentLabel} 완료, ${hero.elapsedDays}일 지남, ${hero.remainingDays}일 남음`;
  return (
    <div
      className="hero__readout"
      data-live={live ? "true" : "false"}
      aria-live="off"
    >
      <h2 className="hero__headline" id="hero-headline">
        {live ? (
          <>
            <span aria-hidden="true" className="hero__days">
              {live.countdown.days.toLocaleString("ko-KR")}
              <small>일</small>
            </span>
            <span className="hero__countdown" aria-hidden="true">
              {countdown?.split(" ")[1]}
            </span>
            <span className="visually-hidden">소집해제까지 {countdown}</span>
          </>
        ) : (
          <>
            <span aria-hidden="true" className="hero__days">
              {hero.headline}
            </span>
            <span className="visually-hidden">{hero.headlineSpoken}</span>
          </>
        )}
      </h2>
      <p className="hero__date">{hero.dateLine}</p>
      {hero.phase !== "PRE_SERVICE" ? (
        <div className="hero__progress">
          <div className="hero__meta" aria-hidden="true">
            <span>복무 진행률</span>
            <strong
              className={
                live ? "hero__percent hero__percent--live" : "hero__percent"
              }
            >
              {percentLabel}
            </strong>
          </div>
          <div
            aria-label="복무 진행률"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={percent}
            aria-valuetext={progressText}
            className="hero-bar"
            role="progressbar"
          >
            <span
              className="hero-bar__fill"
              style={{ "--progress": percent / 100 } as CSSProperties}
            />
          </div>
          <div className="hero__endpoints" aria-hidden="true">
            <span>{hero.elapsedDays.toLocaleString("ko-KR")}일 지남</span>
            <span>
              {hero.phase === "COMPLETED" || hero.phase === "DISCHARGE_DAY"
                ? `총 ${hero.totalServiceDays.toLocaleString("ko-KR")}일 복무`
                : `${hero.remainingDays.toLocaleString("ko-KR")}일 남음`}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

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
          <ChevronRight
            aria-hidden="true"
            className="stat-card__chevron"
            size={16}
          />
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
          <ChevronRight
            aria-hidden="true"
            className="stat-card__chevron"
            size={16}
          />
        </span>
        {pay.kind === "TOTAL" || pay.kind === "BASE_ONLY" ? (
          <strong className="stat-card__value">{formatWon(pay.amount)}</strong>
        ) : (
          <strong className="stat-card__value stat-card__value--muted">
            {pay.kind === "PENDING"
              ? "확인 필요"
              : model.hero.phase === "PRE_SERVICE"
                ? "소집 후"
                : "—"}
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
        <EmptyState
          title="예정된 일정이 없어요"
          description="휴가를 정했다면 미리 기록해 두세요."
          compact
        />
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
      <h2 className="quick-actions__title">빠른 실행</h2>
      <button onClick={actions.onRecordLeave} type="button">
        <span aria-hidden="true" className="quick-actions__icon">
          <CalendarPlus size={20} />
        </span>
        <span className="quick-actions__label">휴가·근태 기록</span>
      </button>
      <button onClick={actions.onOpenLedger} type="button">
        <span aria-hidden="true" className="quick-actions__icon">
          <ClipboardList size={20} />
        </span>
        <span className="quick-actions__label">연가 내역</span>
      </button>
      <button onClick={actions.onImportRecords} type="button">
        <span aria-hidden="true" className="quick-actions__icon">
          <FileUp size={20} />
        </span>
        <span className="quick-actions__label">기관 기록 가져오기</span>
      </button>
    </nav>
  );
}
