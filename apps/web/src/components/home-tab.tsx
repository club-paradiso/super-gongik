import {
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Plus,
} from "lucide-react";

import {
  formatKoreanDate,
  formatLeaveQuantity,
  type ServiceProfile,
} from "@super-gongik/domain";

import { describeTiming, eventLabel } from "@/lib/event-display";
import type { AppProjection } from "@/lib/projections";

function formatDday(days: number) {
  return days === 0 ? "D-Day" : `D-${days.toLocaleString("ko-KR")}`;
}

export function serviceStateLabel(
  state: "NOT_STARTED" | "IN_SERVICE" | "COMPLETED",
) {
  if (state === "NOT_STARTED") return "소집 전";
  if (state === "COMPLETED") return "복무 완료";
  return "복무 중";
}

export function remainingLeaveLabel(
  projection: AppProjection,
  profile: ServiceProfile,
) {
  const balance = projection.ledger.balance;
  if (balance.status === "NEEDS_CREDIT_CONFIRMATION") return "확인 필요";
  return formatLeaveQuantity(
    balance.remainingAfterScheduled,
    profile.workdayMinutes,
  );
}

export function HomeTab({
  profile,
  projection,
  onOpenCalendar,
  onOpenLedger,
  onOpenMoney,
}: {
  profile: ServiceProfile;
  projection: AppProjection;
  onOpenCalendar: () => void;
  onOpenLedger: () => void;
  onOpenMoney: () => void;
}) {
  const { progress, compensation, nextEvent, todayEvents } = projection;
  const todayLabel = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date());
  const balance = projection.ledger.balance;

  const percentage = Math.min(100, Math.max(0, progress.completionPercentage));

  return (
    <>
      <section className="progress-hero" aria-labelledby="progress-title">
        <div className="progress-hero__top">
          <p className="progress-hero__eyebrow" id="progress-title">
            소집해제까지
          </p>
          <span className="progress-hero__state">
            {serviceStateLabel(progress.state)}
          </span>
        </div>
        <strong className="progress-hero__dday">
          {formatDday(progress.dDay)}
        </strong>
        <p className="progress-hero__date">
          {formatKoreanDate(profile.expectedDischargeDate)} 소집해제
        </p>
        <div
          aria-label={`복무 진행률 ${progress.completionPercentage}%`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={percentage}
          className="progress-bar"
          role="progressbar"
        >
          <span style={{ width: `${percentage}%` }} />
        </div>
        <div className="progress-hero__meta">
          <span>
            <b>{progress.completionPercentage}%</b> 완료
          </span>
          <span>
            {progress.elapsedDays.toLocaleString("ko-KR")}일 복무 ·{" "}
            {progress.remainingDays.toLocaleString("ko-KR")}일 남음
          </span>
        </div>
      </section>

      <section className="stat-grid" aria-label="오늘의 복무 요약">
        <button className="stat-tile" onClick={onOpenCalendar} type="button">
          <span className="stat-tile__label">오늘 · {todayLabel}</span>
          <strong className="stat-tile__value">
            {todayEvents.length
              ? todayEvents.map((event) => eventLabel(event)).join(", ")
              : serviceStateLabel(progress.state)}
          </strong>
          <span className="stat-tile__caption">
            {todayEvents.length
              ? describeTiming(todayEvents[0]!)
              : "등록된 기록 없음"}
          </span>
        </button>
        <button className="stat-tile" onClick={onOpenLedger} type="button">
          <span className="stat-tile__label">남은 연가</span>
          <strong
            className={
              balance.status === "NEEDS_CREDIT_CONFIRMATION"
                ? "stat-tile__value stat-tile__value--attention"
                : "stat-tile__value"
            }
          >
            {remainingLeaveLabel(projection, profile)}
          </strong>
          <span className="stat-tile__caption">
            {balance.status === "NEEDS_CREDIT_CONFIRMATION"
              ? "부여 일수를 확인해 주세요"
              : balance.status === "NEEDS_WORKDAY_MINUTES"
                ? "1일 근무시간을 설정하면 합쳐 보여요"
                : `사용 ${formatLeaveQuantity(balance.used, profile.workdayMinutes)}`}
          </span>
        </button>
      </section>

      <section className="list-group" aria-label="바로가기">
        <button className="list-row" onClick={onOpenCalendar} type="button">
          <span className="list-row__icon">
            <CalendarDays aria-hidden="true" size={20} />
          </span>
          <span className="list-row__body">
            <strong>다음 일정</strong>
            <span>
              {nextEvent
                ? `${formatKoreanDate(nextEvent.startDate)} · ${eventLabel(nextEvent)} · ${describeTiming(nextEvent)}`
                : "예정된 기록이 없어요. 휴가나 일정을 추가해 보세요."}
            </span>
          </span>
          {nextEvent ? (
            <ChevronRight
              aria-hidden="true"
              className="list-row__end"
              size={20}
            />
          ) : (
            <Plus aria-hidden="true" className="list-row__end" size={20} />
          )}
        </button>
        <button className="list-row" onClick={onOpenMoney} type="button">
          <span className="list-row__icon list-row__icon--money">
            <CircleDollarSign aria-hidden="true" size={20} />
          </span>
          <span className="list-row__body">
            <strong>이번 달 보수</strong>
            <span>{compensation.headline}</span>
          </span>
          <ChevronRight
            aria-hidden="true"
            className="list-row__end"
            size={20}
          />
        </button>
        <button className="list-row" onClick={onOpenLedger} type="button">
          <span className="list-row__icon list-row__icon--ledger">
            <ClipboardList aria-hidden="true" size={20} />
          </span>
          <span className="list-row__body">
            <strong>휴가 원장</strong>
            <span>부여·사용·예정 연가를 한 번에 확인해요.</span>
          </span>
          <ChevronRight
            aria-hidden="true"
            className="list-row__end"
            size={20}
          />
        </button>
      </section>
    </>
  );
}
