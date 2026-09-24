"use client";

import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";

import {
  addMonthsToYearMonth,
  deleteCompensationSnapshot,
  isLive,
  saveAttendanceMonth,
  saveCompensationSnapshot,
  yearMonthOf,
  type AttendanceDayOverride,
  type DateOnly,
  type ServiceProfile,
  type UserData,
  type UserDataStore,
  type YearMonth,
} from "@super-gongik/domain";
import {
  evaluateMonthlyCompensation,
  findAttendanceMonth,
  type MonthlyCompensationEvaluation,
  type ServiceDay,
} from "@super-gongik/rules";

import { Button } from "@/components/ui/button";

const currency = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});

const savedAtFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  dateStyle: "medium",
  timeStyle: "short",
});

const STATUS_LABELS = {
  CALCULATED: "계산됨",
  NEEDS_INPUT: "입력 필요",
  GATED: "검증 대기",
  UNSUPPORTED: "미지원",
} as const;

const DAY_KIND_LABELS: Record<ServiceDay["kind"], string> = {
  OUTSIDE_SERVICE: "복무 기간 밖",
  NOT_SCHEDULED: "근무 요일 아님",
  DECLARED_NON_WORKING: "공휴일·휴무",
  FULL_DAY_LEAVE: "종일 휴가",
  NEEDS_DECISION: "직접 정해야 함",
  WORKED: "근무일",
};

function monthLabel(month: YearMonth) {
  const [year, value] = month.split("-");
  return `${year}년 ${Number(value)}월`;
}

function dayLabel(date: DateOnly) {
  const [, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)}`;
}

export function MoneyTab({
  data,
  profile,
  store,
  today,
  onOpenProfile,
}: {
  data: UserData;
  profile: ServiceProfile;
  store: UserDataStore;
  today: DateOnly;
  onOpenProfile: () => void;
}) {
  const [month, setMonth] = useState<YearMonth>(yearMonthOf(today));
  // Evaluate the selected month on its current day for this month, else on
  // the 15th (any in-month date selects the same month-wide bundle).
  const asOfDate =
    month === yearMonthOf(today) ? today : (`${month}-15` as DateOnly);
  const attendance = findAttendanceMonth(data.attendanceMonths, month);
  const compensation = useMemo(
    () =>
      evaluateMonthlyCompensation(profile, asOfDate, {
        events: data.events,
        attendance,
      }),
    [profile, asOfDate, data.events, attendance],
  );
  const snapshots = data.compensationSnapshots
    .filter((item) => isLive(item) && item.month === month)
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  const [message, setMessage] = useState("");
  // Lives here: saving re-keys the editor (new revision) and would drop it.
  const [attendanceMessage, setAttendanceMessage] = useState("");

  function changeMonth(amount: number) {
    setMonth(addMonthsToYearMonth(month, amount));
    setMessage("");
    setAttendanceMessage("");
  }

  async function saveSnapshot() {
    setMessage("");
    const result = await store.run((current, context) =>
      saveCompensationSnapshot(
        current,
        {
          month,
          ruleId: compensation.rule?.id ?? "",
          ruleVersion: compensation.rule?.version ?? "",
          total: compensation.total,
          evaluation: JSON.parse(JSON.stringify(compensation)) as Record<
            string,
            unknown
          >,
        },
        context,
      ),
    );
    setMessage(result.ok ? "이 계산을 저장했어요." : "저장하지 못했어요.");
  }

  return (
    <section className="money-page" aria-label="월별 보수 기준">
      <div className="month-switch">
        <button
          aria-label="이전 달"
          onClick={() => changeMonth(-1)}
          type="button"
        >
          <ChevronLeft aria-hidden="true" size={20} />
        </button>
        <h2>{monthLabel(month)}</h2>
        <button
          aria-label="다음 달"
          onClick={() => changeMonth(1)}
          type="button"
        >
          <ChevronRight aria-hidden="true" size={20} />
        </button>
      </div>

      <p className="money-headline">{compensation.headline}</p>

      <div className="money-total" aria-live="polite">
        <span>지급 기준 합계</span>
        <strong>
          {compensation.total !== null
            ? currency.format(compensation.total)
            : "아직 합계 없음"}
        </strong>
        <small>
          {compensation.total !== null
            ? "기본 보수 + 중식비 + 교통비. 출장 여비와 공제는 빠져 있어요."
            : "모든 항목이 계산될 때만 합계를 보여요. 일부만 더한 금액은 보여주지 않아요."}
        </small>
      </div>

      {compensation.components.length ? (
        <div className="money-list">
          {compensation.components.map((component) => (
            <article key={component.key}>
              <div className="money-list__title">
                <span>{component.label}</span>
                <span
                  className={`badge badge--${component.status.toLowerCase()}`}
                >
                  {STATUS_LABELS[component.status]}
                </span>
              </div>
              <strong>
                {component.monthlyAmount !== null
                  ? currency.format(component.monthlyAmount)
                  : "—"}
              </strong>
              {component.dailyRate !== null ||
              component.eligibleDays !== null ? (
                <p className="money-formula">
                  1일{" "}
                  {component.dailyRate !== null
                    ? currency.format(component.dailyRate)
                    : "금액 미입력"}{" "}
                  × {component.eligibleDays ?? "?"}일
                </p>
              ) : null}
              <p>{component.explanation}</p>
              {component.rateSource ? (
                <p className="money-reference">
                  {component.rateSource === "OFFICIAL_MINIMUM"
                    ? "1일 금액 출처: 병무청 2026년 지급 기준(최소기준)"
                    : "1일 금액 출처: 내가 입력한 값 (공식 금액 아님)"}
                </p>
              ) : null}
              <small className="money-basis">근거: {component.basis}</small>
            </article>
          ))}
        </div>
      ) : null}

      {compensation.unresolved.length ? (
        <section className="money-unresolved">
          <h2>아직 계산하지 못하는 것</h2>
          <ul className="plain-list">
            {compensation.unresolved.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <Button onClick={onOpenProfile} type="button" variant="outline">
            내 정보에서 입력하기
          </Button>
        </section>
      ) : null}

      {compensation.serviceDays &&
      compensation.serviceDays.status !== "UNSUPPORTED" &&
      profile.workWeekdays ? (
        <AttendanceEditor
          key={`${month}-${attendance?.revision ?? 0}`}
          evaluation={compensation}
          existing={attendance}
          message={attendanceMessage}
          month={month}
          onMessage={setAttendanceMessage}
          store={store}
        />
      ) : null}

      <aside className="rule-note">
        <h2>계산 기준</h2>
        {compensation.rule ? (
          <dl>
            <div>
              <dt>적용 규칙</dt>
              <dd>
                {compensation.rule.id} v{compensation.rule.version}
              </dd>
            </div>
            <div>
              <dt>적용 기간</dt>
              <dd>
                {compensation.rule.effectiveFrom} ~{" "}
                {compensation.rule.effectiveUntil ?? "현재"}
              </dd>
            </div>
            <div>
              <dt>원문 확인일</dt>
              <dd>{compensation.rule.verifiedAt}</dd>
            </div>
            <div>
              <dt>기준일</dt>
              <dd>{compensation.asOfDate}</dd>
            </div>
          </dl>
        ) : (
          <p>적용할 수 있는 검증된 규칙이 없어요.</p>
        )}
        {compensation.assumptions.length ? (
          <ul className="plain-list">
            {compensation.assumptions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        {compensation.rule ? (
          <details>
            <summary>출처 {compensation.rule.sources.length}건</summary>
            <ul className="source-list">
              {compensation.rule.sources.map((source) => (
                <li key={`${source.title}-${source.url}`}>
                  <a href={source.url} rel="noreferrer" target="_blank">
                    {source.title}
                    <ExternalLink aria-hidden="true" size={13} />
                  </a>
                  <small>{source.authority}</small>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </aside>

      {compensation.rule ? (
        <section className="money-history">
          <h2>저장한 계산</h2>
          <p className="field-hint">
            저장하면 그때의 규칙 버전·입력·결과가 그대로 남아요. 규칙이 바뀌어도
            다시 계산되지 않아요.
          </p>
          <Button onClick={() => void saveSnapshot()} type="button">
            이 달 계산 저장
          </Button>
          {message ? (
            <p className="save-message" role="status">
              {message}
            </p>
          ) : null}
          {snapshots.length ? (
            <ul className="snapshot-list">
              {snapshots.map((snapshot) => (
                <li key={snapshot.id}>
                  <div>
                    <strong>
                      {snapshot.total !== null
                        ? currency.format(snapshot.total)
                        : "합계 없음"}
                    </strong>
                    <small>
                      {savedAtFormat.format(new Date(snapshot.generatedAt))} ·
                      규칙 v{snapshot.ruleVersion}
                    </small>
                  </div>
                  <Button
                    onClick={() =>
                      void store.run((current, context) =>
                        deleteCompensationSnapshot(
                          current,
                          snapshot.id,
                          context,
                        ),
                      )
                    }
                    type="button"
                    variant="ghost"
                  >
                    삭제
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

function AttendanceEditor({
  evaluation,
  existing,
  message,
  month,
  onMessage,
  store,
}: {
  evaluation: MonthlyCompensationEvaluation;
  existing: ReturnType<typeof findAttendanceMonth>;
  message: string;
  month: YearMonth;
  onMessage: (message: string) => void;
  store: UserDataStore;
}) {
  const days = evaluation.serviceDays?.days ?? [];
  const [nonWorking, setNonWorking] = useState<Set<DateOnly>>(
    new Set(existing?.nonWorkingDates ?? []),
  );
  const [overrides, setOverrides] = useState<
    Map<DateOnly, AttendanceDayOverride>
  >(new Map((existing?.dayOverrides ?? []).map((item) => [item.date, item])));
  const [hadAbsence, setHadAbsence] = useState(
    existing?.hadNonPayableAbsence ?? false,
  );

  // Scheduled in-service weekdays can be marked as holidays; days the records
  // leave open need an explicit meal/transport decision.
  const scheduled = days.filter(
    (day) =>
      day.kind === "WORKED" ||
      day.kind === "DECLARED_NON_WORKING" ||
      (day.kind === "NEEDS_DECISION" && !nonWorking.has(day.date)) ||
      day.kind === "FULL_DAY_LEAVE",
  );
  const decisionDays = days.filter((day) => day.kind === "NEEDS_DECISION");

  function toggleNonWorking(date: DateOnly) {
    setNonWorking((current) => {
      const next = new Set(current);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  function decide(
    date: DateOnly,
    field: "mealEligible" | "transportEligible",
    value: boolean,
  ) {
    setOverrides((current) => {
      const next = new Map(current);
      const base = next.get(date) ?? {
        date,
        mealEligible: false,
        transportEligible: false,
      };
      next.set(date, { ...base, [field]: value });
      return next;
    });
  }

  async function save() {
    onMessage("");
    const liveDecisionDates = new Set(
      decisionDays
        .filter((day) => !nonWorking.has(day.date))
        .map((day) => day.date),
    );
    const result = await store.run((current, context) =>
      saveAttendanceMonth(
        current,
        {
          month,
          nonWorkingDates: [...nonWorking],
          dayOverrides: [...overrides.values()].filter((item) =>
            liveDecisionDates.has(item.date),
          ),
          hadNonPayableAbsence: hadAbsence,
        },
        context,
      ),
    );
    onMessage(
      result.ok
        ? "이 달 근무일 확인을 저장했어요."
        : (result.errors[0]?.message ?? "저장하지 못했어요."),
    );
  }

  const status = evaluation.serviceDays;
  return (
    <section className="attendance-editor">
      <h2>이 달 근무일 확인</h2>
      <p className="field-hint">
        공휴일 달력은 앱에 넣지 않았어요. 쉬는 날을 직접 표시하고 저장해야
        중식비·교통비 일수를 세요.
        {status?.missing.includes("MONTH_RECONFIRMATION")
          ? " 확인한 뒤 기록이 바뀌어 다시 저장해야 해요."
          : ""}
      </p>
      {status ? (
        <p className="attendance-summary">
          중식비 대상 {status.mealEligibleDays ?? "?"}일 · 교통비 대상{" "}
          {status.transportEligibleDays ?? "?"}일
        </p>
      ) : null}

      <fieldset className="form-field choice-field">
        <legend>근무 요일 중 쉬는 날 (공휴일·기관 휴무)</legend>
        <div className="day-grid">
          {scheduled.map((day) => (
            <label className="day-toggle" key={day.date}>
              <input
                checked={nonWorking.has(day.date)}
                onChange={() => toggleNonWorking(day.date)}
                type="checkbox"
              />
              <span>{dayLabel(day.date)}</span>
              <small>{DAY_KIND_LABELS[day.kind]}</small>
            </label>
          ))}
        </div>
      </fieldset>

      {decisionDays.filter((day) => !nonWorking.has(day.date)).length ? (
        <fieldset className="form-field choice-field">
          <legend>기록만으로 알 수 없는 날</legend>
          {decisionDays
            .filter((day) => !nonWorking.has(day.date))
            .map((day) => (
              <div className="decision-row" key={day.date}>
                <span>{dayLabel(day.date)}</span>
                <label>
                  <input
                    checked={overrides.get(day.date)?.mealEligible ?? false}
                    onChange={(event) =>
                      decide(day.date, "mealEligible", event.target.checked)
                    }
                    type="checkbox"
                  />
                  중식비 받음
                </label>
                <label>
                  <input
                    checked={
                      overrides.get(day.date)?.transportEligible ?? false
                    }
                    onChange={(event) =>
                      decide(
                        day.date,
                        "transportEligible",
                        event.target.checked,
                      )
                    }
                    type="checkbox"
                  />
                  교통비 받음
                </label>
              </div>
            ))}
          <small>
            반일 연가·외출·지각·조퇴·교육·훈련 날은 기관마다 처리가 달라 앱이
            정하지 않아요. 저장하면 표시한 대로 셉니다.
          </small>
        </fieldset>
      ) : null}

      <label className="check-row">
        <input
          checked={hadAbsence}
          onChange={(event) => setHadAbsence(event.target.checked)}
          type="checkbox"
        />
        이 달에 복무중단·복무이탈·연가를 넘긴 결근이 있었어요
      </label>

      <Button onClick={() => void save()} type="button">
        이 달 확인 저장
      </Button>
      {message ? (
        <p className="save-message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
