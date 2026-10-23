"use client";

import { LockKeyhole, MapPin, TriangleAlert } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

import {
  PRIOR_SERVICE_BASES,
  PRIOR_SERVICE_BASIS_LABELS,
  calculateExpectedDischargeDate,
  editProfile,
  isDateOnly,
  type PriorServiceBasis,
  type DateOnly,
  type LeaveLedger,
  type ServiceProfile,
  type UserData,
  type UserDataStore,
} from "@super-gongik/domain";
import {
  type InstitutionAmountSuggestion,
  suggestInstitutionRates,
} from "@super-gongik/rules";

import { BackupPanel, downloadFullBackup } from "@/components/backup-panel";
import { CloudSyncPanel } from "@/components/cloud-sync-panel";
import { RecordImportPanel } from "@/components/record-import-panel";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { useCloud } from "@/hooks/use-cloud";
import { useTheme } from "@/hooks/use-theme";
import {
  RESIDENCE_REGIONS,
  regionalFareSuggestion,
} from "@/lib/regional-transit-fares";
import { APP_THEMES } from "@/lib/theme";

type PriorAnswer = "" | "NONE" | "HAS_PRIOR_SERVICE";
type WorkPatternAnswer = "" | NonNullable<ServiceProfile["workPattern"]>;

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
/** Proposed only after the user picks daytime commuting (국가공무원 복무규정 제9조①). */
const PROPOSED_WEEKDAYS = [1, 2, 3, 4, 5];

export function ProfileTab({
  data,
  profile,
  ledger,
  store,
}: {
  data: UserData;
  profile: ServiceProfile;
  ledger: LeaveLedger;
  store: UserDataStore;
}) {
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [saved, setSaved] = useState(false);
  const [cloudBackup, setCloudBackup] = useState<{
    text: string;
    label: string;
    nonce: number;
  } | null>(null);
  const { state: cloud, cloud: cloudController } = useCloud();
  const signedIn = cloud.phase === "SIGNED_IN";
  const syncing =
    signedIn && cloud.sync !== null && cloud.sync.phase !== "DISABLED";

  return (
    <section className="profile-page" aria-label="내 복무 정보">
      <div className="profile-page__settings">
        <SectionHead
          eyebrow="복무 설정"
          id="profile-settings-title"
          title="복무 정보와 계산 기준"
        />
        {/* Re-mount the form when the profile changes; the status lives here. */}
        <ProfileForm
          key={profile.updatedAt}
          onSaved={setSaved}
          profile={profile}
          saved={saved}
          store={store}
        />
      </div>

      <div className="profile-page__data">
        <SectionHead
          eyebrow="데이터"
          id="profile-data-title"
          title="백업과 기록 관리"
        />

        <section className="profile-security" aria-label="저장 위치">
          <span className="profile-security__icon" aria-hidden="true">
            <LockKeyhole size={20} />
          </span>
          <div>
            {syncing ? (
              <>
                <h3>이 기기에 먼저 저장하고 동기화해요</h3>
                <p>
                  기록은 이 기기에 바로 저장되고, 로그인한 계정의 클라우드와
                  동기화돼요. 클라우드 데이터는 본인 계정만 읽고 쓸 수 있어요.
                  종단간 암호화는 아니에요.
                </p>
              </>
            ) : (
              <>
                <h3>이 기기에만 저장돼요</h3>
                <p>
                  동기화를 켜지 않으면 서버로 보내지 않아요. 백업 파일을 직접
                  보관해 주세요.
                </p>
              </>
            )}
          </div>
        </section>

        <BackupPanel
          data={data}
          incoming={cloudBackup}
          ledger={ledger}
          onRestored={(mode) => void cloudController.afterRestore(mode)}
          store={store}
          syncEnabled={syncing}
        />

        <CloudSyncPanel
          onRestoreBackup={(text, label) => {
            setCloudBackup({ text, label, nonce: Date.now() });
            document
              .getElementById("backup-title")
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />

        <RecordImportPanel data={data} store={store} />

        <section
          className="profile-danger"
          aria-labelledby="profile-danger-title"
        >
          <div className="profile-danger__head">
            <TriangleAlert aria-hidden="true" size={18} />
            <h3 id="profile-danger-title">기기 데이터 초기화</h3>
          </div>
          {confirmWipe ? (
            <div className="confirm-box" role="alert">
              <p>
                이 기기의 복무 프로필과 모든 기록({data.events.length}건)을
                지워요. 되돌릴 수 없어요.
                {signedIn
                  ? " 클라우드의 데이터는 지우지 않고, 로그인도 유지돼요. 이 기기의 동기화는 꺼져요."
                  : ""}
              </p>
              <div className="backup-actions">
                <Button
                  onClick={() => downloadFullBackup(data)}
                  type="button"
                  variant="outline"
                >
                  먼저 백업 내려받기
                </Button>
                <Button
                  onClick={() =>
                    void store
                      .wipeAll()
                      .then(() => cloudController.afterLocalWipe())
                  }
                  type="button"
                  variant="danger"
                >
                  모두 지우기
                </Button>
                <Button
                  onClick={() => setConfirmWipe(false)}
                  type="button"
                  variant="ghost"
                >
                  취소
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p>
                복무 프로필과 모든 기록을 이 기기에서 지워요. 지우기 전에 백업
                파일을 내려받아 두세요.
              </p>
              <Button
                className="reset-button"
                onClick={() => setConfirmWipe(true)}
                type="button"
                variant="danger"
              >
                이 기기의 모든 데이터 지우기
              </Button>
            </>
          )}
        </section>
      </div>
    </section>
  );
}

function SectionHead({
  eyebrow,
  id,
  title,
}: {
  eyebrow: string;
  id: string;
  title: string;
}) {
  return (
    <header className="profile-section-head">
      <p className="profile-section-head__eyebrow">{eyebrow}</p>
      <h2 id={id}>{title}</h2>
    </header>
  );
}

function ProfileForm({
  profile,
  store,
  saved,
  onSaved,
}: {
  profile: ServiceProfile;
  store: UserDataStore;
  saved: boolean;
  onSaved: (saved: boolean) => void;
}) {
  const [callUpDate, setCallUpDate] = useState<string>(profile.callUpDate);
  const [expectedDischargeDate, setExpectedDischargeDate] = useState<string>(
    profile.expectedDischargeDate,
  );
  const [serviceCategory, setServiceCategory] = useState(
    profile.serviceCategory ?? "",
  );
  const [commuteCost, setCommuteCost] = useState(
    profile.defaultCommuteCost?.toString() ?? "",
  );
  const [institutionName, setInstitutionName] = useState(
    profile.institutionName ?? "",
  );
  const [institutionFilled, setInstitutionFilled] = useState(false);
  const [lastFareApplied, setLastFareApplied] = useState<string | null>(null);
  const [residenceRegion, setResidenceRegion] = useState(
    profile.residenceRegion ?? "",
  );
  const fareSuggestion = regionalFareSuggestion(residenceRegion || null);
  const [workHours, setWorkHours] = useState(
    profile.workdayMinutes === null
      ? ""
      : String(Math.floor(profile.workdayMinutes / 60)),
  );
  const [workMinutes, setWorkMinutes] = useState(
    profile.workdayMinutes === null ? "" : String(profile.workdayMinutes % 60),
  );
  const [workdayStartTime, setWorkdayStartTime] = useState(
    profile.workdayStartTime ?? "",
  );
  const [workdayEndTime, setWorkdayEndTime] = useState(
    profile.workdayEndTime ?? "",
  );
  const [prior, setPrior] = useState<PriorAnswer>(
    profile.priorServiceCredit ?? "",
  );
  const [priorBasis, setPriorBasis] = useState<PriorServiceBasis | "">(
    profile.priorServiceBasis ?? "",
  );
  const [creditedMonths, setCreditedMonths] = useState(
    profile.priorServiceCreditedMonths?.toString() ?? "",
  );
  const [creditPartialMonth, setCreditPartialMonth] = useState(
    profile.priorServiceCreditHasPartialMonth,
  );
  const [workPattern, setWorkPattern] = useState<WorkPatternAnswer>(
    profile.workPattern ?? "",
  );
  const [weekdays, setWeekdays] = useState<number[]>(
    profile.workWeekdays ?? PROPOSED_WEEKDAYS,
  );
  const [mealRate, setMealRate] = useState(
    profile.defaultMealAllowanceOverride?.toString() ?? "",
  );
  const [customMeal, setCustomMeal] = useState(
    profile.defaultMealAllowanceOverride !== null,
  );
  const institutionRates = useMemo(
    () =>
      institutionName.trim() === ""
        ? null
        : suggestInstitutionRates(institutionName, {
            year: new Date().getFullYear(),
          }),
    [institutionName],
  );

  /**
   * Typing a registered institution fills only the amounts still empty, and
   * only ones the rules allow: never below the 2026 meal minimum, and a meal
   * amount equal to the minimum is already the default.
   */
  function changeInstitution(value: string) {
    setInstitutionName(value);
    setInstitutionFilled(false);
    if (value.trim() === "") return;
    const found = suggestInstitutionRates(value, {
      year: new Date().getFullYear(),
    });
    if (found.status !== "MATCHED") return;
    let filled = false;
    if (mealRate === "" && found.meal?.applicable && found.meal.amount > 9000) {
      setMealRate(String(found.meal.amount));
      setCustomMeal(true);
      filled = true;
    }
    if (commuteCost === "" && found.transport?.applicable) {
      setCommuteCost(String(found.transport.amount));
      filled = true;
    }
    setInstitutionFilled(filled);
  }

  function reportInstitutionUrl() {
    const name = institutionName.trim();
    const body = [
      `기관명: ${name}`,
      `1일 중식비: ${mealRate === "" ? "(모름)" : `${mealRate}원`}`,
      `1일 교통비: ${commuteCost === "" ? "(모름)" : `${commuteCost}원`}`,
      "휴가·결근일 식비/교통비 지급 여부:",
      "단수처리(예: 10원 미만 절사):",
      "급여 지급일:",
      "근거 자료(공문·지침 링크나 문서명, 게시일):",
      "",
      "※ 개인정보(이름, 계좌, 소집일 등)는 적지 마세요. 이 글은 공개돼요.",
    ].join("\n");
    const params = new URLSearchParams({
      title: `기관 규칙 제보: ${name}`,
      body,
      labels: "institution-rules",
    });
    return `https://github.com/club-paradiso/super-gongik/issues/new?${params.toString()}`;
  }

  const [liveProgressEnabled, setLiveProgressEnabled] = useState(
    profile.liveProgressEnabled ?? false,
  );
  const [error, setError] = useState("");

  function toggleWeekday(day: number) {
    setWeekdays((current) =>
      current.includes(day)
        ? current.filter((item) => item !== day)
        : [...current, day].sort(),
    );
  }

  function handleCallUpDate(value: string) {
    setCallUpDate(value);
    if (isDateOnly(value)) {
      setExpectedDischargeDate(
        calculateExpectedDischargeDate(value as DateOnly),
      );
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSaved(false);
    setError("");
    const workdayMinutes =
      workHours === "" && workMinutes === ""
        ? null
        : Number(workHours || 0) * 60 + Number(workMinutes || 0);
    const result = await store.run((current, context) =>
      editProfile(
        current,
        {
          ...profile,
          callUpDate,
          expectedDischargeDate,
          serviceCategory: serviceCategory.trim() || null,
          institutionName: institutionName.trim() || null,
          residenceRegion: residenceRegion || null,
          defaultCommuteCost: commuteCost === "" ? null : Number(commuteCost),
          defaultMealAllowanceOverride:
            mealRate === "" ? null : Number(mealRate),
          workdayMinutes,
          workdayStartTime: workdayStartTime || null,
          workdayEndTime: workdayEndTime || null,
          priorServiceCredit: prior || null,
          priorServiceBasis:
            prior === "HAS_PRIOR_SERVICE" && priorBasis ? priorBasis : null,
          priorServiceCreditedMonths:
            prior === "HAS_PRIOR_SERVICE" &&
            !creditPartialMonth &&
            creditedMonths !== ""
              ? Number(creditedMonths)
              : null,
          priorServiceCreditHasPartialMonth:
            prior === "HAS_PRIOR_SERVICE" && creditPartialMonth,
          workPattern: workPattern || null,
          // Weekdays are stored only for daytime commuting, which the user
          // selected explicitly; otherwise nothing is assumed.
          workWeekdays:
            workPattern === "WEEKDAY_DAYTIME" && weekdays.length
              ? weekdays
              : null,
          liveProgressEnabled,
        },
        context,
      ),
    );
    if (result.ok) onSaved(true);
    else
      setError(
        result.errors[0]?.message ??
          "입력한 날짜·근무시간(1~24시간)·통근비를 다시 확인해 주세요.",
      );
  }

  return (
    <form className="profile-form" onSubmit={handleSubmit}>
      {/* Two columns side by side on wide desktop; one stack elsewhere. */}
      <div className="profile-form__column">
        <SettingsGroup title="복무 기간">
          <div className="field-row profile-dates">
            <label className="form-field">
              <span>소집일</span>
              <DateInput
                aria-describedby="profile-dates-hint"
                required
                value={callUpDate}
                onValueChange={handleCallUpDate}
              />
            </label>
            <label className="form-field">
              <span>소집해제 예정일</span>
              <DateInput
                aria-describedby="profile-dates-hint"
                required
                value={expectedDischargeDate}
                onValueChange={setExpectedDischargeDate}
              />
            </label>
            <p className="field-hint field-row__full" id="profile-dates-hint">
              소집일을 바꾸면 21개월 기준으로 다시 계산해요. 연장 등은 직접
              고치세요.
            </p>
          </div>
          <label className="form-field">
            <span>복무 분야</span>
            <input
              maxLength={80}
              placeholder="선택 사항"
              value={serviceCategory}
              onChange={(event) => setServiceCategory(event.target.value)}
            />
          </label>
        </SettingsGroup>

        <SettingsGroup title="근무 조건">
          <div className="form-field">
            <span>1일 근무시간</span>
            <div className="unit-row">
              <div className="unit-input">
                <input
                  aria-label="근무 시간"
                  inputMode="numeric"
                  max="24"
                  min="0"
                  type="number"
                  value={workHours}
                  onChange={(event) => setWorkHours(event.target.value)}
                />
                <span>시간</span>
              </div>
              <div className="unit-input">
                <input
                  aria-label="근무 분"
                  inputMode="numeric"
                  max="59"
                  min="0"
                  type="number"
                  value={workMinutes}
                  onChange={(event) => setWorkMinutes(event.target.value)}
                />
                <span>분</span>
              </div>
            </div>
            <small>
              시간 단위 휴가를 일수와 합칠 때만 써요. 기관마다 달라서 비워 두면
              가정하지 않아요.
            </small>
          </div>

          <div className="field-row">
            <label className="form-field">
              <span>평소 근무 시작</span>
              <input
                aria-describedby="profile-workday-time-hint"
                type="time"
                value={workdayStartTime}
                onChange={(event) => setWorkdayStartTime(event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>평소 근무 종료</span>
              <input
                aria-describedby="profile-workday-time-hint"
                type="time"
                value={workdayEndTime}
                onChange={(event) => setWorkdayEndTime(event.target.value)}
              />
            </label>
            <p
              className="field-hint field-row__full"
              id="profile-workday-time-hint"
            >
              시간 연가를 허가지각·허가조퇴·허가외출로 자동 구분할 때 쓰는
              기준이에요. 기관별 유연근무가 있을 수 있어 직접 확인한 시각만
              저장해요.
            </p>
          </div>

          <fieldset className="form-field choice-field choice-field--tiles">
            <legend>복무형태</legend>
            {(
              [
                ["WEEKDAY_DAYTIME", "주간 출퇴근"],
                ["NIGHT_SHIFT_ROTATION", "주·야간 교대(24시간 근무지)"],
                ["RESIDENTIAL", "합숙 근무"],
                ["OTHER", "그 밖의 형태"],
                ["", "아직 모르겠어요"],
              ] as const
            ).map(([value, label]) => (
              <label key={value || "unknown"}>
                <input
                  checked={workPattern === value}
                  name="work-pattern"
                  onChange={() => setWorkPattern(value)}
                  type="radio"
                />
                {label}
              </label>
            ))}
            <small>
              중식비·교통비 근무일 계산은 주간 출퇴근만 지원해요. 야간 교대는
              근무일수를 2일로 보는 별도 규정이 있어 계산하지 않아요.
            </small>
          </fieldset>

          {workPattern === "WEEKDAY_DAYTIME" ? (
            <fieldset className="form-field choice-field weekday-field">
              <legend>정해진 근무 요일</legend>
              <div className="weekday-row">
                {WEEKDAY_LABELS.map((label, day) => (
                  <label className="weekday-chip" key={label}>
                    <input
                      checked={weekdays.includes(day)}
                      onChange={() => toggleWeekday(day)}
                      type="checkbox"
                    />
                    {label}
                  </label>
                ))}
              </div>
              <small>
                {profile.workWeekdays
                  ? "저장한 근무 요일이에요."
                  : "토요일 휴무 원칙(국가공무원 복무규정 제9조)에 따라 월~금으로 채워 두었어요. 맞으면 저장해 주세요."}
              </small>
            </fieldset>
          ) : null}
        </SettingsGroup>
      </div>

      <div className="profile-form__column">
        <SettingsGroup title="화면 설정">
          <ThemeChoice />
          <div className="setting-toggle">
            <label className="check-row setting-toggle__row">
              <input
                aria-describedby="live-progress-hint"
                checked={liveProgressEnabled}
                className="switch"
                onChange={(event) =>
                  setLiveProgressEnabled(event.target.checked)
                }
                type="checkbox"
              />
              D-day와 복무율을 초 단위로 실시간 표시
            </label>
            <small className="field-hint" id="live-progress-hint">
              켜면 홈 화면이 열려 있는 동안 1초마다 남은 시간과 복무율을
              갱신해요. 끄면 기존처럼 일 단위로 표시해요.
            </small>
          </div>
        </SettingsGroup>

        <SettingsGroup title="보수 계산 기준">
          <fieldset className="form-field choice-field choice-field--tiles choice-field--inline">
            <legend>이전 복무 경력(현역 등)이 보수 등급에 인정되나요?</legend>
            {(
              [
                ["NONE", "없어요"],
                ["HAS_PRIOR_SERVICE", "있어요"],
                ["", "잘 모르겠어요"],
              ] as const
            ).map(([value, label]) => (
              <label key={value || "unknown"}>
                <input
                  checked={prior === value}
                  name="prior-service"
                  onChange={() => setPrior(value)}
                  type="radio"
                />
                {label}
              </label>
            ))}
            <small>
              병역법 시행령 제62조제2항의 7가지 경우에만 기간이 합산돼요.
              &lsquo;잘 모르겠어요&rsquo;면 기본 보수를 계산하지 않아요.
            </small>
          </fieldset>

          {prior === "HAS_PRIOR_SERVICE" ? (
            <div className="prior-detail">
              <label className="form-field">
                <span>해당하는 경우 (제62조제2항)</span>
                <select
                  value={priorBasis}
                  onChange={(event) =>
                    setPriorBasis(event.target.value as PriorServiceBasis | "")
                  }
                >
                  <option value="">선택해 주세요</option>
                  {PRIOR_SERVICE_BASES.map((basis) => (
                    <option key={basis} value={basis}>
                      {PRIOR_SERVICE_BASIS_LABELS[basis]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>복무기관이 확인한 인정 기간 (개월)</span>
                <input
                  disabled={creditPartialMonth}
                  inputMode="numeric"
                  max="36"
                  min="1"
                  type="number"
                  value={creditedMonths}
                  onChange={(event) => setCreditedMonths(event.target.value)}
                />
                <small>
                  기간은 호마다 계산법이 달라 앱이 추정하지 않아요. 기관에
                  확인한 값을 넣어 주세요.
                </small>
              </label>
              <label className="check-row">
                <input
                  checked={creditPartialMonth}
                  onChange={(event) =>
                    setCreditPartialMonth(event.target.checked)
                  }
                  type="checkbox"
                />
                인정 기간이 개월 단위로 딱 떨어지지 않아요
              </label>
            </div>
          ) : null}

          <div className="form-field">
            <label htmlFor="institution-name">
              <span>복무기관</span>
            </label>
            <input
              id="institution-name"
              autoComplete="off"
              maxLength={80}
              placeholder="예: 경기도교육청, 서울특별시 성북구"
              type="text"
              value={institutionName}
              onChange={(event) => changeInstitution(event.target.value)}
            />
            <small>
              기관명을 입력하면 등록된 공식 자료에서 중식비·교통비 기준을 찾아
              보여드려요. 값은 확인 후 저장해야 반영돼요.
            </small>
            {institutionRates?.status === "MATCHED" ? (
              <div className="institution-rates" role="status">
                <strong>{institutionRates.institution.name}</strong>
                <small>{institutionRates.institution.scopeNote}</small>
                {(
                  [
                    ["중식비", institutionRates.meal, setMealRate, mealRate],
                    [
                      "교통비",
                      institutionRates.transport,
                      setCommuteCost,
                      commuteCost,
                    ],
                  ] as Array<
                    [
                      string,
                      InstitutionAmountSuggestion | null,
                      (value: string) => void,
                      string,
                    ]
                  >
                ).map(([label, amount, apply, current]) =>
                  amount ? (
                    <p key={label}>
                      {label} {amount.amount.toLocaleString("ko-KR")}원 ·{" "}
                      {amount.effectiveYear}년 · {amount.sourceTitle}
                      {amount.applicable &&
                      current !== String(amount.amount) ? (
                        <>
                          {" "}
                          <button
                            type="button"
                            onClick={() => {
                              apply(String(amount.amount));
                              if (label === "중식비") setCustomMeal(true);
                            }}
                          >
                            적용
                          </button>
                        </>
                      ) : null}
                      {amount.caution ? <small> {amount.caution}</small> : null}
                    </p>
                  ) : null,
                )}
                {institutionRates.meal === null &&
                institutionRates.transport === null ? (
                  <small>
                    이 기관의 중식비·교통비 금액 근거는 아직 없어요. 직접 입력해
                    주세요.
                  </small>
                ) : null}
                {institutionFilled ? (
                  <small>
                    비어 있던 칸을 기관 기준으로 채웠어요. 저장하기 전에 확인해
                    주세요.
                  </small>
                ) : null}
                {institutionRates.common ? (
                  <CommonRulesCard
                    common={institutionRates.common}
                    reason="이 기관의 중식비 근거는 아직 없어요."
                  />
                ) : null}
                {institutionRates.notes.length > 0 ? (
                  <details>
                    <summary>
                      이 기관의 확인된 규칙 {institutionRates.notes.length}건
                    </summary>
                    <ul>
                      {institutionRates.notes.map((note) => (
                        <li
                          key={`${note.field}|${note.text}|${note.sourceTitle}`}
                        >
                          {INSTITUTION_FIELD_LABELS[note.field] ??
                            "그 밖의 규칙"}
                          : {note.text}{" "}
                          <small>
                            ({note.effectiveYear}년 · {note.sourceTitle})
                          </small>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            ) : institutionRates?.status === "UNKNOWN_INSTITUTION" ? (
              <div className="institution-rates" role="status">
                {institutionRates.suggestions.length > 0 ? (
                  <>
                    <small>혹시 이 기관인가요?</small>
                    {institutionRates.suggestions.slice(0, 5).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => changeInstitution(item.name)}
                      >
                        {item.name}
                      </button>
                    ))}
                  </>
                ) : (
                  <>
                    {institutionRates.common ? (
                      <CommonRulesCard
                        common={institutionRates.common}
                        reason="등록된 기관 근거가 없어요."
                      />
                    ) : (
                      <small>
                        등록된 기관 근거가 없어요. 중식비·교통비는 직접 입력해
                        주세요.
                      </small>
                    )}
                  </>
                )}
                <a
                  href={reportInstitutionUrl()}
                  rel="noreferrer"
                  target="_blank"
                >
                  우리 기관 기준 제보하기
                </a>
              </div>
            ) : null}
          </div>

          <fieldset className="form-field">
            <legend>중식비</legend>
            <label>
              <input
                checked={!customMeal}
                name="meal-mode"
                type="radio"
                onChange={() => {
                  setCustomMeal(false);
                  setMealRate("");
                }}
              />
              기본 9,000원
            </label>
            <label>
              <input
                checked={customMeal}
                name="meal-mode"
                type="radio"
                onChange={() => setCustomMeal(true)}
              />
              기관이 더 줘요
            </label>
            {customMeal ? (
              <input
                aria-label="기관 1일 중식비"
                inputMode="numeric"
                min="9000"
                placeholder="기관 1일 중식비(원)"
                type="number"
                value={mealRate}
                onChange={(event) => setMealRate(event.target.value)}
              />
            ) : null}
            <small>
              {customMeal
                ? "기관이 주는 1일 중식비를 넣어 주세요. 9,000원보다 낮은 금액은 쓸 수 없어요."
                : "병무청 기준 1일 9,000원으로 매달 자동 계산해요. 기관이 더 주는 경우에만 바꾸세요."}
            </small>
          </fieldset>

          <label className="form-field">
            <span>
              <MapPin aria-hidden="true" size={17} />
              거주 지역
            </span>
            <select
              value={residenceRegion}
              onChange={(event) => {
                const region = event.target.value;
                setResidenceRegion(region);
                const suggestion = regionalFareSuggestion(region || null);
                if (
                  suggestion &&
                  (commuteCost === "" || commuteCost === lastFareApplied)
                ) {
                  const applied = String(suggestion.dailyRoundTripFare);
                  setCommuteCost(applied);
                  setLastFareApplied(applied);
                }
              }}
            >
              <option value="">지역 선택</option>
              {RESIDENCE_REGIONS.map((region) => (
                <option key={region} value={region}>
                  {region}
                </option>
              ))}
            </select>
            <small>
              지역 기본 시내버스 운임이 검증된 경우 1일 교통비를 자동으로
              채워요. 직접 입력한 금액은 바꾸지 않아요. 한 번만 정해 두면 매달
              자동으로 계산해요.
            </small>
          </label>

          <label className="form-field">
            <span>1일 교통비</span>
            <input
              inputMode="numeric"
              min="0"
              placeholder={
                fareSuggestion
                  ? `지역 기준 ${fareSuggestion.dailyRoundTripFare.toLocaleString("ko-KR")}원`
                  : "기관 승인 금액 또는 실제 운임"
              }
              type="number"
              value={commuteCost}
              onChange={(event) => setCommuteCost(event.target.value)}
            />
            <small>
              {fareSuggestion
                ? `${fareSuggestion.basis} 왕복 기준 ${fareSuggestion.dailyRoundTripFare.toLocaleString("ko-KR")}원을 제안했어요. `
                : residenceRegion
                  ? "이 지역은 현재 검증된 기본운임 자동값이 없어 직접 입력해야 해요. "
                  : ""}
              병무청 기준은 시내버스 왕복 현금요금이며, 환승·지하철·장거리 등
              추가비용은 교통카드 금액 기준 실비예요.
            </small>
          </label>
        </SettingsGroup>
      </div>

      {saved ? (
        <p className="save-message" role="status">
          이 기기에 저장했어요.
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="profile-form__submit">
        <Button size="large" type="submit">
          변경 사항 저장
        </Button>
      </div>
    </form>
  );
}

const INSTITUTION_FIELD_LABELS: Record<string, string> = {
  TRANSPORT_METHOD: "교통비 지급 방식",
  MEAL_ON_LEAVE: "휴가 시 중식비",
  TRANSPORT_ON_LEAVE: "휴가 시 교통비",
  MEAL_ON_ABSENCE: "결근 시 중식비",
  TRANSPORT_ON_ABSENCE: "결근 시 교통비",
  MEAL_ON_PARTIAL_DAY: "반일·시간 단위 중식비",
  ROUNDING: "단수처리",
  PAY_DAY: "급여 지급일",
  WORK_DAYS_RULE: "근무일수 규칙",
};

function CommonRulesCard({
  common,
  reason,
}: {
  common: NonNullable<
    Extract<
      ReturnType<typeof suggestInstitutionRates>,
      { status: "UNKNOWN_INSTITUTION" }
    >["common"]
  >;
  reason: string;
}) {
  return (
    <div className="institution-rates">
      <strong>{common.label}을 적용해요</strong>
      <small>
        {reason} 기관이 더 주는 경우가 아니면 중식비는 병무청 {common.year}년
        기준 1일 {common.meal.amount.toLocaleString("ko-KR")}원으로 계산해요.
      </small>
      {common.transportNote ? (
        <small>교통비: {common.transportNote}</small>
      ) : null}
      <small>우리 기관에 다른 규정이 있다면 아래 제보하기로 알려 주세요.</small>
      {common.notes.length > 0 ? (
        <details>
          <summary>병무청 공통 규칙 {common.notes.length}건</summary>
          <ul>
            {common.notes.map((note) => (
              <li key={`${note.field}|${note.text}|${note.sourceTitle}`}>
                {INSTITUTION_FIELD_LABELS[note.field] ?? "그 밖의 규칙"}:{" "}
                {note.text}{" "}
                <small>
                  ({note.effectiveYear}년 · {note.sourceTitle})
                </small>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/**
 * Theme picker. Applies at once and is stored in this browser only, outside
 * the profile form: saving or discarding the form never touches it.
 */
function ThemeChoice() {
  const [theme, setTheme] = useTheme();
  return (
    <fieldset className="form-field choice-field choice-field--tiles theme-choice">
      <legend>화면 테마</legend>
      {APP_THEMES.map((option) => (
        <label key={option.value}>
          <input
            checked={theme === option.value}
            name="app-theme"
            onChange={() => setTheme(option.value)}
            type="radio"
          />
          <span className="theme-choice__text">
            <span>{option.title}</span>
            <small>{option.summary}</small>
          </span>
        </label>
      ))}
      <small>
        테마는 색과 분위기만 바꿔요. 숫자와 계산, 기록은 그대로예요. 이
        브라우저에만 저장돼요.
      </small>
    </fieldset>
  );
}

function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-group">
      <h3 className="settings-group__title">{title}</h3>
      <div className="settings-card">{children}</div>
    </section>
  );
}
