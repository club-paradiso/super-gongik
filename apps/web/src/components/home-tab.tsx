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

  return (
    <>
      <section className="progress-hero" aria-labelledby="progress-title">
        <div className="progress-copy">
          <p className="eyebrow" id="progress-title">
            소집해제까지
          </p>
          <strong>{formatDday(progress.dDay)}</strong>
          <p>{formatKoreanDate(profile.expectedDischargeDate)} 소집해제</p>
          <span className="progress-percentage">
            {progress.completionPercentage}%
          </span>
        </div>
        <ProgressRing percentage={progress.completionPercentage} />
        <div className="progress-guidance">
          <strong>차근차근, 잘하고 있어요.</strong>
          <p>남은 기간도 건강하고 안전하게 복무를 마쳐요.</p>
        </div>
        <div className="progress-labels">
          <span>{progress.elapsedDays.toLocaleString("ko-KR")}일 복무</span>
          <span>{progress.remainingDays.toLocaleString("ko-KR")}일 남음</span>
        </div>
      </section>

      <section className="summary-grid" aria-label="오늘의 복무 요약">
        <button className="summary-card" onClick={onOpenCalendar} type="button">
          <CalendarDays aria-hidden="true" size={28} />
          <h2>오늘 · {todayLabel}</h2>
          <strong>
            {todayEvents.length
              ? todayEvents.map((event) => eventLabel(event)).join(", ")
              : serviceStateLabel(progress.state)}
          </strong>
          <p>
            {todayEvents.length
              ? describeTiming(todayEvents[0]!)
              : "오늘 등록된 기록이 없어요."}
          </p>
        </button>
        <button className="summary-card" onClick={onOpenLedger} type="button">
          <ClipboardList aria-hidden="true" size={28} />
          <h2>남은 연가</h2>
          <strong>{remainingLeaveLabel(projection, profile)}</strong>
          <p>
            {balance.status === "NEEDS_CREDIT_CONFIRMATION"
              ? "부여 일수를 한 번 확인해 주세요."
              : balance.status === "NEEDS_WORKDAY_MINUTES"
                ? "1일 근무시간을 설정하면 합쳐 보여드려요."
                : `사용 ${formatLeaveQuantity(balance.used, profile.workdayMinutes)}`}
          </p>
        </button>
      </section>

      <button className="next-event" onClick={onOpenCalendar} type="button">
        <CalendarDays aria-hidden="true" size={29} />
        <div>
          <h2>다음 일정</h2>
          <p>
            {nextEvent
              ? `${formatKoreanDate(nextEvent.startDate)} · ${eventLabel(nextEvent)} · ${describeTiming(nextEvent)}`
              : "예정된 기록이 없어요."}
          </p>
        </div>
        <Plus aria-hidden="true" className="row-arrow" size={22} />
      </button>

      <button className="dashboard-row" onClick={onOpenMoney} type="button">
        <CircleDollarSign aria-hidden="true" size={29} />
        <div>
          <h2>이번 달 보수</h2>
          <p>{compensation.headline}</p>
        </div>
        <ChevronRight aria-hidden="true" className="row-arrow" size={22} />
      </button>
    </>
  );
}

function ProgressRing({ percentage }: { percentage: number }) {
  const radius = 108;
  const circumference = 2 * Math.PI * radius;
  const offset =
    circumference -
    (Math.min(100, Math.max(0, percentage)) / 100) * circumference;

  return (
    <svg aria-hidden="true" className="progress-ring" viewBox="0 0 260 260">
      <circle
        className="progress-ring__track"
        cx="130"
        cy="130"
        fill="none"
        r={radius}
        strokeWidth="12"
      />
      <circle
        className="progress-ring__value"
        cx="130"
        cy="130"
        fill="none"
        r={radius}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        strokeWidth="12"
      />
      <path
        className="progress-ring__flag"
        d="M130 56v35m0-31h22l-7 10 7 10h-22"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
      />
    </svg>
  );
}
