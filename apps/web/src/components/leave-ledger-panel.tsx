"use client";

import { AlertTriangle, CheckCircle2, Download, Scale } from "lucide-react";
import { type FormEvent, useState } from "react";

import {
  addLeaveCorrection,
  confirmLeaveCredit,
  deleteLeaveAdjustment,
  editProfile,
  formatDurationMinutes,
  formatLeaveQuantity,
  formatKoreanDate,
  isLive,
  leaveLedgerToCsv,
  type DateOnly,
  type LeaveLedger,
  type ServiceProfile,
  type UserData,
  type UserDataStore,
} from "@super-gongik/domain";

import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { downloadTextFile } from "@/lib/download";

const CREDIT_STATE_LABELS = {
  COUNTED: "규칙 확인",
  CONFIRMED_BY_USER: "직접 확인",
  PENDING_CONFIRMATION: "확인 필요",
  UPCOMING: "부여 예정",
} as const;

export function LeaveLedgerPanel({
  data,
  ledger,
  profile,
  store,
  today,
}: {
  data: UserData;
  ledger: LeaveLedger;
  profile: ServiceProfile;
  store: UserDataStore;
  today: DateOnly;
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const workday = profile.workdayMinutes;
  const balance = ledger.balance;
  const format = (value: { halfDays: number; minutes: number }) =>
    formatLeaveQuantity(value, workday);

  async function run(
    action: Parameters<UserDataStore["run"]>[0],
    success: string,
  ) {
    setError("");
    const result = await store.run(action);
    if (result.ok) setMessage(success);
    else setError(result.errors[0]?.message ?? "저장하지 못했어요.");
    return result.ok;
  }

  const corrections = data.leaveAdjustments.filter(
    (item) => isLive(item) && item.kind === "CORRECTION",
  );
  const reconciliation = ledger.reconciliation;
  const otherTypes = ledger.byType.filter(
    (item) =>
      item.count > 0 &&
      [
        "SICK_LEAVE",
        "OFFICIAL_LEAVE",
        "SPECIAL_LEAVE",
        "COMPASSIONATE_LEAVE",
      ].includes(item.eventType),
  );
  const attendance = ledger.attendanceMinutes;

  return (
    <div className="ledger">
      <section className="ledger-summary" aria-labelledby="ledger-title">
        <p className="eyebrow" id="ledger-title">
          남은 연가
        </p>
        <strong className="ledger-summary__value">
          {balance.status === "NEEDS_CREDIT_CONFIRMATION"
            ? "부여 일수 확인 필요"
            : format(balance.remainingAfterScheduled)}
        </strong>
        {balance.scheduled.halfDays || balance.scheduled.minutes ? (
          <p>예정된 연가 {format(balance.scheduled)}을 뺀 값이에요.</p>
        ) : null}
        <dl className="ledger-summary__grid">
          <div>
            <dt>부여</dt>
            <dd>{format(balance.granted)}</dd>
          </div>
          <div>
            <dt>사용</dt>
            <dd>{format(balance.used)}</dd>
          </div>
          <div>
            <dt>예정</dt>
            <dd>{format(balance.scheduled)}</dd>
          </div>
          <div>
            <dt>보정</dt>
            <dd>{format(balance.corrections)}</dd>
          </div>
        </dl>
        {balance.upcomingCredits.halfDays ? (
          <p className="field-hint">
            앞으로 {format(balance.upcomingCredits)}이 더 부여될 예정이에요.
          </p>
        ) : null}
      </section>

      {message ? (
        <p className="save-message" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {ledger.warnings.length ? (
        <ul className="issue-list issue-list--warning">
          {ledger.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      {balance.status === "NEEDS_WORKDAY_MINUTES" ? (
        <WorkdayForm
          onSubmit={(minutes) =>
            run(
              (current, context) =>
                editProfile(
                  current,
                  { ...profile, workdayMinutes: minutes },
                  context,
                ),
              "1일 근무시간을 저장했어요.",
            )
          }
        />
      ) : null}

      <section className="ledger-card" aria-labelledby="credits-title">
        <h3 id="credits-title">연가 부여</h3>
        <ul className="credit-list">
          {ledger.credits.map((credit) => (
            <li key={credit.key}>
              <div>
                <strong>{credit.label}</strong>
                <span>
                  {formatKoreanDate(credit.grantDate)} ·{" "}
                  {credit.countedHalfDays !== null
                    ? formatLeaveQuantity(
                        { halfDays: credit.countedHalfDays, minutes: 0 },
                        null,
                      )
                    : "미확인"}
                </span>
                <small>{credit.explanation}</small>
              </div>
              <span className={`badge badge--${credit.state.toLowerCase()}`}>
                {CREDIT_STATE_LABELS[credit.state]}
              </span>
              {credit.state === "PENDING_CONFIRMATION" ||
              credit.state === "CONFIRMED_BY_USER" ? (
                <CreditConfirmForm
                  defaultDays={
                    credit.confirmation
                      ? credit.confirmation.amountHalfDays / 2
                      : credit.referenceDays
                  }
                  onSubmit={(days) =>
                    run(
                      (current, context) =>
                        confirmLeaveCredit(
                          current,
                          {
                            creditKey: credit.key,
                            grantDate: credit.grantDate,
                            days,
                            reason: "기관 부여 일수 직접 확인",
                          },
                          context,
                        ),
                      `${credit.label}를 ${days}일로 확인했어요.`,
                    )
                  }
                  referenceDays={credit.referenceDays}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="ledger-card" aria-labelledby="reconcile-title">
        <h3 id="reconcile-title">
          <Scale aria-hidden="true" size={18} />
          기관 기록과 비교
        </h3>
        {reconciliation.status === "NO_SNAPSHOT" ? (
          <p className="field-hint">
            기관에서 받은 잔여 연가 표를 가져오면 슈퍼공익 계산과 비교해 드려요.
          </p>
        ) : reconciliation.status === "NOT_COMPARABLE" ? (
          <p className="field-hint">{reconciliation.reason}</p>
        ) : (
          <div
            className={`reconcile reconcile--${reconciliation.status.toLowerCase()}`}
          >
            <p>
              {reconciliation.status === "MATCH" ? (
                <CheckCircle2 aria-hidden="true" size={18} />
              ) : (
                <AlertTriangle aria-hidden="true" size={18} />
              )}
              {formatKoreanDate(reconciliation.comparedAt)} 기준 기관{" "}
              {format(reconciliation.institutionRemaining)} · 슈퍼공익{" "}
              {format(reconciliation.appRemaining)}
            </p>
            {reconciliation.status === "DIFFERENT" ? (
              <>
                <p>
                  차이 {format(reconciliation.difference)}. 기록이 빠졌거나
                  중복됐는지 먼저 확인해 주세요. 기관 기록이 맞다면 보정으로
                  맞출 수 있어요.
                </p>
                <Button
                  onClick={() =>
                    void run(
                      (current, context) =>
                        addLeaveCorrection(
                          current,
                          {
                            effectiveDate: reconciliation.comparedAt,
                            halfDays: reconciliation.difference.halfDays,
                            minutes: reconciliation.difference.minutes,
                            reason: `기관 자료(${reconciliation.comparedAt} 기준)에 맞춤`,
                          },
                          context,
                        ),
                      "기관 기록에 맞춰 보정했어요.",
                    )
                  }
                  size="compact"
                  type="button"
                  variant="outline"
                >
                  기관 기록에 맞추기
                </Button>
              </>
            ) : null}
            {reconciliation.assumptions.map((item) => (
              <p className="field-hint" key={item}>
                {item}
              </p>
            ))}
          </div>
        )}
      </section>

      <section className="ledger-card" aria-labelledby="corrections-title">
        <h3 id="corrections-title">보정</h3>
        {corrections.length ? (
          <ul className="adjustment-list">
            {corrections.map((item) => (
              <li key={item.id}>
                <span>
                  {formatKoreanDate(item.effectiveDate)} ·{" "}
                  {format({
                    halfDays: item.amountHalfDays,
                    minutes: item.amountMinutes,
                  })}
                  <small>{item.reason}</small>
                </span>
                <button
                  onClick={() => {
                    if (window.confirm("이 보정을 삭제할까요?")) {
                      void run(
                        (current, context) =>
                          deleteLeaveAdjustment(current, item.id, context),
                        "보정을 삭제했어요.",
                      );
                    }
                  }}
                  type="button"
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <CorrectionForm
          today={today}
          onSubmit={(input) =>
            run(
              (current, context) => addLeaveCorrection(current, input, context),
              "보정을 저장했어요.",
            )
          }
        />
      </section>

      {otherTypes.length ||
      attendance.OUTING ||
      attendance.LATE_ARRIVAL ||
      attendance.EARLY_LEAVE ? (
        <section className="ledger-card" aria-labelledby="other-title">
          <h3 id="other-title">다른 휴가·근태 합계</h3>
          <dl className="usage-table">
            {otherTypes.map((item) => (
              <div key={item.eventType}>
                <dt>{item.label}</dt>
                <dd>
                  {item.count}건 · {formatLeaveQuantity(item.total, null)}
                  {item.unresolvedCount
                    ? ` · 시간 확인 필요 ${item.unresolvedCount}건`
                    : ""}
                </dd>
              </div>
            ))}
            {(
              [
                ["OUTING", "외출"],
                ["LATE_ARRIVAL", "지각"],
                ["EARLY_LEAVE", "조퇴"],
              ] as const
            )
              .filter(([key]) => attendance[key] > 0)
              .map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{formatDurationMinutes(attendance[key])}</dd>
                </div>
              ))}
          </dl>
          <p className="field-hint">
            공가·특별휴가·청원휴가는 사유별로 기관이 승인하는 휴가라 잔여량을
            계산하지 않아요.
          </p>
        </section>
      ) : null}

      <details className="ledger-card ledger-entries">
        <summary>연가 원장 내역 {ledger.entries.length}건</summary>
        {ledger.entries.length ? (
          <table>
            <thead>
              <tr>
                <th scope="col">날짜</th>
                <th scope="col">내용</th>
                <th scope="col">변동</th>
                <th scope="col">누적</th>
              </tr>
            </thead>
            <tbody>
              {ledger.entries.map((entry) => (
                <tr
                  className={entry.scheduled ? "is-scheduled" : undefined}
                  key={`${entry.kind}-${entry.referenceId}`}
                >
                  <td>{entry.date.slice(2).replaceAll("-", ".")}</td>
                  <td>
                    {entry.label}
                    {entry.scheduled ? " (예정)" : ""}
                  </td>
                  <td>{format(entry.delta)}</td>
                  <td>{format(entry.running)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="field-hint">아직 원장 내역이 없어요.</p>
        )}
        <Button
          onClick={() =>
            downloadTextFile(
              `super-gongik-leave-ledger-${today}.csv`,
              leaveLedgerToCsv(ledger.entries),
              "text/csv;charset=utf-8",
            )
          }
          size="compact"
          type="button"
          variant="ghost"
        >
          <Download aria-hidden="true" size={16} />
          원장 CSV 내려받기
        </Button>
      </details>

      <details className="ledger-card">
        <summary>계산 기준과 가정</summary>
        <ul className="plain-list">
          {ledger.assumptions.map((item) => (
            <li key={item}>{item}</li>
          ))}
          <li>
            1일 근무시간:{" "}
            {workday
              ? `${formatDurationMinutes(workday)} (내 정보에서 설정)`
              : "미설정"}
          </li>
        </ul>
      </details>
    </div>
  );
}

function WorkdayForm({
  onSubmit,
}: {
  onSubmit: (minutes: number) => Promise<boolean>;
}) {
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("0");
  const total = Number(hours || 0) * 60 + Number(minutes || 0);
  return (
    <form
      className="ledger-card inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (total >= 60 && total <= 1440) void onSubmit(total);
      }}
    >
      <h3>1일 근무시간을 알려 주세요</h3>
      <p className="field-hint">
        시간 단위 연가를 일수와 합치려면 기관의 1일 근무시간이 필요해요. 임의로
        8시간을 가정하지 않아요.
      </p>
      <div className="unit-row">
        <div className="unit-input">
          <input
            aria-label="근무 시간"
            inputMode="numeric"
            min="1"
            max="24"
            required
            type="number"
            value={hours}
            onChange={(event) => setHours(event.target.value)}
          />
          <span>시간</span>
        </div>
        <div className="unit-input">
          <input
            aria-label="근무 분"
            inputMode="numeric"
            min="0"
            max="59"
            type="number"
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
          <span>분</span>
        </div>
        <Button
          disabled={total < 60 || total > 1440}
          size="compact"
          type="submit"
        >
          저장
        </Button>
      </div>
    </form>
  );
}

function CreditConfirmForm({
  defaultDays,
  referenceDays,
  onSubmit,
}: {
  defaultDays: number | null;
  referenceDays: number | null;
  onSubmit: (days: number) => Promise<boolean>;
}) {
  const [days, setDays] = useState(
    defaultDays === null ? "" : String(defaultDays),
  );
  const parsed = Number(days);
  const valid =
    days !== "" && Number.isInteger(parsed * 2) && parsed >= 0 && parsed <= 60;
  return (
    <form
      className="credit-confirm"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (valid) void onSubmit(parsed);
      }}
    >
      <label>
        <span>기관에서 받은 일수</span>
        <div className="unit-input">
          <input
            inputMode="decimal"
            min="0"
            max="60"
            step="0.5"
            type="number"
            value={days}
            onChange={(event) => setDays(event.target.value)}
          />
          <span>일</span>
        </div>
      </label>
      {referenceDays !== null ? (
        <small>
          현행 규칙 참고값: {referenceDays}일 (소집일 당시 규칙은 기관에 확인)
        </small>
      ) : null}
      <Button disabled={!valid} size="compact" type="submit" variant="outline">
        확인
      </Button>
    </form>
  );
}

function CorrectionForm({
  today,
  onSubmit,
}: {
  today: DateOnly;
  onSubmit: (input: {
    effectiveDate: DateOnly;
    halfDays: number;
    minutes: number;
    reason: string;
  }) => Promise<boolean>;
}) {
  const [date, setDate] = useState<string>(today);
  const [direction, setDirection] = useState<"add" | "subtract">("subtract");
  const [days, setDays] = useState("");
  const [minutes, setMinutes] = useState("");
  const [reason, setReason] = useState("");
  const halfDays = Math.round(Number(days || 0) * 2);
  const sign = direction === "add" ? 1 : -1;
  const valid =
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isInteger(Number(days || 0) * 2) &&
    Number.isInteger(Number(minutes || 0)) &&
    (halfDays > 0 || Number(minutes || 0) > 0) &&
    reason.trim().length > 0;

  return (
    <details className="correction-form">
      <summary>직접 보정하기</summary>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!valid) return;
          const ok = await onSubmit({
            effectiveDate: date as DateOnly,
            halfDays: sign * halfDays,
            minutes: sign * Number(minutes || 0),
            reason: reason.trim(),
          });
          if (ok) {
            setDays("");
            setMinutes("");
            setReason("");
          }
        }}
      >
        <p className="field-hint">
          사용 기록은 캘린더에서 고치는 것이 가장 정확해요. 보정은 기관 기록과
          맞출 때만 쓰세요.
        </p>
        <label className="form-field">
          <span>기준일</span>
          <DateInput value={date} onValueChange={setDate} />
        </label>
        <fieldset className="segmented" aria-label="보정 방향">
          {(
            [
              ["subtract", "잔여 줄이기"],
              ["add", "잔여 늘리기"],
            ] as const
          ).map(([key, label]) => (
            <label
              className={
                direction === key
                  ? "segmented__item is-active"
                  : "segmented__item"
              }
              key={key}
            >
              <input
                checked={direction === key}
                name="direction"
                onChange={() => setDirection(key)}
                type="radio"
              />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="unit-row">
          <div className="unit-input">
            <input
              aria-label="보정 일수"
              inputMode="decimal"
              min="0"
              step="0.5"
              type="number"
              value={days}
              onChange={(event) => setDays(event.target.value)}
            />
            <span>일</span>
          </div>
          <div className="unit-input">
            <input
              aria-label="보정 분"
              inputMode="numeric"
              min="0"
              type="number"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
            />
            <span>분</span>
          </div>
        </div>
        <label className="form-field">
          <span>사유</span>
          <input
            maxLength={200}
            placeholder="예: 기관 복무기록부 잔여 반영"
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <Button
          disabled={!valid}
          size="compact"
          type="submit"
          variant="outline"
        >
          보정 저장
        </Button>
      </form>
    </details>
  );
}
