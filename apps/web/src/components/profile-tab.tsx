"use client";

import { LockKeyhole, MapPin } from "lucide-react";
import { type FormEvent, useState } from "react";

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

import { BackupPanel, downloadFullBackup } from "@/components/backup-panel";
import { CloudSyncPanel } from "@/components/cloud-sync-panel";
import { RecordImportPanel } from "@/components/record-import-panel";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { useCloud } from "@/hooks/use-cloud";
import {
  RESIDENCE_REGIONS,
  regionalFareSuggestion,
} from "@/lib/regional-transit-fares";

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
      {/* Re-mount the form when the profile changes; the status lives here. */}
      <ProfileForm
        key={profile.updatedAt}
        onSaved={setSaved}
        profile={profile}
        saved={saved}
        store={store}
      />

      <RecordImportPanel data={data} store={store} />

      <CloudSyncPanel
        onRestoreBackup={(text, label) => {
          setCloudBackup({ text, label, nonce: Date.now() });
          document
            .getElementById("backup-title")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />

      <BackupPanel
        data={data}
        incoming={cloudBackup}
        ledger={ledger}
        onRestored={(mode) => void cloudController.afterRestore(mode)}
        store={store}
        syncEnabled={syncing}
      />

      <section className="profile-security">
        <LockKeyhole aria-hidden="true" size={24} />
        <div>
          {syncing ? (
            <>
              <h2>이 기기에 먼저 저장하고 동기화해요</h2>
              <p>
                기록은 이 기기에 바로 저장되고, 로그인한 계정의 클라우드와
                동기화돼요. 클라우드 데이터는 본인 계정만 읽고 쓸 수 있어요.
                종단간 암호화는 아니에요.
              </p>
            </>
          ) : (
            <>
              <h2>이 기기에만 저장돼요</h2>
              <p>
                동기화를 켜지 않으면 서버로 보내지 않아요. 백업 파일을 직접
                보관해 주세요.
              </p>
            </>
          )}
        </div>
      </section>

      {confirmWipe ? (
        <div className="confirm-box" role="alert">
          <p>
            이 기기의 복무 프로필과 모든 기록({data.events.length}건)을 지워요.
            되돌릴 수 없어요.
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
        <Button
          className="reset-button"
          onClick={() => setConfirmWipe(true)}
          type="button"
          variant="danger"
        >
          이 기기의 모든 데이터 지우기
        </Button>
      )}
    </section>
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
      <SettingsGroup title="복무 기간">
        <label className="form-field">
          <span>소집일</span>
          <DateInput
            required
            value={callUpDate}
            onValueChange={handleCallUpDate}
          />
        </label>
        <label className="form-field">
          <span>소집해제 예정일</span>
          <DateInput
            required
            value={expectedDischargeDate}
            onValueChange={setExpectedDischargeDate}
          />
          <small>
            소집일을 바꾸면 21개월 기준으로 다시 계산해요. 연장 등은 직접
            고치세요.
          </small>
        </label>
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
              type="time"
              value={workdayStartTime}
              onChange={(event) => setWorkdayStartTime(event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>평소 근무 종료</span>
            <input
              type="time"
              value={workdayEndTime}
              onChange={(event) => setWorkdayEndTime(event.target.value)}
            />
          </label>
          <p className="field-hint field-row__full">
            시간 연가를 허가지각·허가조퇴·허가외출로 자동 구분할 때 쓰는
            기준이에요. 기관별 유연근무가 있을 수 있어 직접 확인한 시각만
            저장해요.
          </p>
        </div>

        <fieldset className="form-field choice-field">
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
          <fieldset className="form-field choice-field">
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

      <SettingsGroup title="화면 설정">
        <label className="check-row">
          <input
            checked={liveProgressEnabled}
            onChange={(event) => setLiveProgressEnabled(event.target.checked)}
            type="checkbox"
          />
          D-day와 복무율을 초 단위로 실시간 표시
        </label>
        <small className="field-hint">
          켜면 홈 화면이 열려 있는 동안 1초마다 남은 시간과 복무율을 갱신해요.
          끄면 기존처럼 일 단위로 표시해요.
        </small>
      </SettingsGroup>

      <SettingsGroup title="보수 계산 기준">
        <fieldset className="form-field choice-field">
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
                기간은 호마다 계산법이 달라 앱이 추정하지 않아요. 기관에 확인한
                값을 넣어 주세요.
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

        <label className="form-field">
          <span>1일 중식비 (기관이 더 줄 때만)</span>
          <input
            inputMode="numeric"
            min="0"
            placeholder="비워 두면 9,000원(2026 최소기준)"
            type="number"
            value={mealRate}
            onChange={(event) => setMealRate(event.target.value)}
          />
          <small>
            병무청 2026년 지급 기준은 1일 9,000원이 최소이고, 기관이 예산
            범위에서 더 줄 수 있어요. 더 받는 경우에만 그 금액을 넣으세요.
          </small>
        </label>

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
              if (suggestion) {
                setCommuteCost(String(suggestion.dailyRoundTripFare));
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
            제안해요. 실제 통근 경로가 다르면 아래 금액을 직접 고치세요.
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
        <Button type="submit">변경 사항 저장</Button>
      </div>
    </form>
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
      <h2 className="settings-group__title">{title}</h2>
      <div className="settings-card">{children}</div>
    </section>
  );
}
