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
  type CompensationRoundingPolicy,
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
        attendanceMonths: data.attendanceMonths,
      }),
    [profile, asOfDate, data.events, data.attendanceMonths, attendance],
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
            ? "기본 보수 + 중식비 + 교통비. 확인된 기본 보수 미지급일은 기본 보수에 반영돼요."
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
  // Partial decisions are kept locally; only days with both answers are saved.
  const [decisions, setDecisions] = useState<
    Map<DateOnly, Partial<AttendanceDayOverride>>
  >(new Map((existing?.dayOverrides ?? []).map((item) => [item.date, item])));
  const [hadAbsence, setHadAbsence] = useState(
    existing?.hadNonPayableAbsence ?? false,
  );
  const [nonPayableDates, setNonPayableDates] = useState<Set<DateOnly>>(
    new Set(existing?.nonPayableDates ?? []),
  );
  const [nonPayableDatesConfirmed, setNonPayableDatesConfirmed] = useState(
    existing?.nonPayableDatesConfirmed ?? false,
  );
  const [roundingPolicy, setRoundingPolicy] =
    useState<CompensationRoundingPolicy | null>(
      existing?.roundingPolicy ?? null,
    );
  const derivedNonPayableDates =
    evaluation.basePayAdjustment?.derivedNonPayableDates ?? [];
  const derivedNonPayableSet = new Set(derivedNonPayableDates);

  // Scheduled in-service weekdays can be marked as holidays; days the records
  // leave open need an explicit meal/transport decision.
  const scheduled = days.filter(
    (day) =>
      day.kind === "WORKED" ||
      day.kind === "DECLARED_NON_WORKING" ||
      (day.kind === "NEEDS_DECISION" && !nonWorking.has(day.date)) ||
      day.kind === "FULL_DAY_LEAVE",
  );
  const decisionDays = days.filter((day) => day.requiresDecision);

  function toggleNonWorking(date: DateOnly) {
    setNonWorking((current) => {
      const next = new Set(current);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  function toggleNonPayable(date: DateOnly) {
    setNonPayableDates((current) => {
      const next = new Set(current);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  function decide(
    date: DateOnly,
    field: "mealEligible" | "transportEligible",
    value: boolean | undefined,
  ) {
    setDecisions((current) => {
      const next = new Map(current);
      next.set(date, { ...next.get(date), date, [field]: value });
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
          dayOverrides: [...decisions.values()].flatMap((item) =>
            item.date &&
            liveDecisionDates.has(item.date) &&
            typeof item.mealEligible === "boolean" &&
            typeof item.transportEligible === "boolean"
              ? [
                  {
                    date: item.date,
                    mealEligible: item.mealEligible,
                    transportEligible: item.transportEligible,
                  },
                ]
              : [],
          ),
          hadNonPayableAbsence: hadAbsence,
          nonPayableDates: [
            ...new Set([...nonPayableDates, ...derivedNonPayableDates]),
          ],
          nonPayableDatesConfirmed,
          roundingPolicy,
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
          <legend>중식비·교통비 지급 여부를 정할 날</legend>
          {decisionDays
            .filter((day) => !nonWorking.has(day.date))
            .map((day) => (
              <div className="decision-row" key={day.date}>
                <span>
                  {dayLabel(day.date)}
                  <small>{DAY_KIND_LABELS[day.kind]}</small>
                </span>
                {(
                  [
                    ["mealEligible", "중식비"],
                    ["transportEligible", "교통비"],
                  ] as const
                ).map(([field, label]) => {
                  const value = decisions.get(day.date)?.[field];
                  return (
                    <label key={field}>
                      {label}
                      <select
                        aria-label={`${dayLabel(day.date)} ${label}`}
                        value={value === undefined ? "" : value ? "yes" : "no"}
                        onChange={(event) =>
                          decide(
                            day.date,
                            field,
                            event.target.value === ""
                              ? undefined
                              : event.target.value === "yes",
                          )
                        }
                      >
                        <option value="">미정</option>
                        <option value="yes">받음</option>
                        <option value="no">안 받음</option>
                      </select>
                    </label>
                  );
                })}
              </div>
            ))}
          <small>
            종일 휴가를 포함해 휴가·외출·지각·조퇴·교육·훈련 날의 중식비·교통비
            지급 여부는 법령과 병무청 지급 기준에 휴가 종류별로 정해져 있지
            않아요. 복무기관 기준대로 둘 다 골라야 그날이 계산에 들어가요.
            하나라도 미정이면 합계를 내지 않아요.
          </small>
        </fieldset>
      ) : null}

      <fieldset className="form-field choice-field">
        <legend>기본 보수 미지급 날짜</legend>
        <p className="field-hint">
          복무중단·복무이탈·연가 초과 결근·보수 미지급 병가처럼 기본 보수를 받지
          않는 날짜만 표시하세요. 중식비·교통비 판단과는 별개예요.
        </p>
        {derivedNonPayableDates.length ? (
          <p className="field-hint">
            복무 기록에서 {derivedNonPayableDates.length}일을 자동 도출했어요.
            자동 도출 날짜는 원본 복무 기록을 수정해야 바뀌어요.
          </p>
        ) : null}
        <div className="day-grid">
          {days
            .filter((day) => day.kind !== "OUTSIDE_SERVICE")
            .map((day) => (
              <label className="day-toggle" key={`nonpay-${day.date}`}>
                <input
                  checked={
                    nonPayableDates.has(day.date) ||
                    derivedNonPayableSet.has(day.date)
                  }
                  disabled={derivedNonPayableSet.has(day.date)}
                  onChange={() => toggleNonPayable(day.date)}
                  type="checkbox"
                />
                <span>{dayLabel(day.date)}</span>
                <small>
                  {derivedNonPayableSet.has(day.date)
                    ? "기록에서 자동 도출"
                    : nonPayableDates.has(day.date)
                      ? "미지급"
                      : "지급"}
                </small>
              </label>
            ))}
        </div>
        <label className="check-row">
          <input
            checked={nonPayableDatesConfirmed}
            onChange={(event) =>
              setNonPayableDatesConfirmed(event.target.checked)
            }
            type="checkbox"
          />
          이 달의 기본 보수 미지급 날짜를 전부 확인했어요
        </label>
        <label className="check-row">
          <input
            checked={hadAbsence}
            onChange={(event) => setHadAbsence(event.target.checked)}
            type="checkbox"
          />
          정확한 날짜를 아직 모르는 미지급 사유가 남아 있어요
        </label>
      </fieldset>

      <label className="form-field">
        <span>기본 보수 끝수 처리</span>
        <select
          value={roundingPolicy ?? ""}
          onChange={(event) =>
            setRoundingPolicy(
              (event.target.value || null) as CompensationRoundingPolicy | null,
            )
          }
        >
          <option value="">아직 확인하지 않음</option>
          <option value="NATIONAL_TREASURY_ARTICLE_47">
            국고금 관리법 제47조 적용 확인 (10원 미만 버림)
          </option>
          <option value="INSTITUTION_CONFIRMED_TRUNCATE_SUB_10">
            기관에서 10원 미만 절사 적용을 직접 확인
          </option>
          <option value="INSTITUTION_OTHER_OR_UNKNOWN">
            기관이 다른 방식 사용 / 정확한 방식 미확인
          </option>
        </select>
        <small>
          국가기관 이름만 보고 자동 선택하지 않아요. 지급 회계 기준을 실제로
          확인한 경우에만 선택하세요.
        </small>
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