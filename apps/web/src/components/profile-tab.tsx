"use client";

import { LockKeyhole, MapPin } from "lucide-react";
import { type FormEvent, useState } from "react";

import {
  calculateExpectedDischargeDate,
  editProfile,
  isDateOnly,
  type DateOnly,
  type LeaveLedger,
  type ServiceProfile,
  type UserData,
  type UserDataStore,
} from "@super-gongik/domain";

import { BackupPanel, downloadFullBackup } from "@/components/backup-panel";
import { RecordImportPanel } from "@/components/record-import-panel";
import { Button } from "@/components/ui/button";

type PriorAnswer = "" | "NONE" | "HAS_PRIOR_SERVICE";

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

      <BackupPanel data={data} ledger={ledger} store={store} />

      <section className="profile-security">
        <LockKeyhole aria-hidden="true" size={24} />
        <div>
          <h2>이 기기에만 저장돼요</h2>
          <p>
            서버로 보내지 않아요. 클라우드 백업은 아직 없으니 백업 파일을 직접
            보관해 주세요.
          </p>
        </div>
      </section>

      {confirmWipe ? (
        <div className="confirm-box" role="alert">
          <p>
            이 기기의 복무 프로필과 모든 기록({data.events.length}건)을 지워요.
            되돌릴 수 없어요.
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
              onClick={() => void store.wipeAll()}
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
  const [workHours, setWorkHours] = useState(
    profile.workdayMinutes === null
      ? ""
      : String(Math.floor(profile.workdayMinutes / 60)),
  );
  const [workMinutes, setWorkMinutes] = useState(
    profile.workdayMinutes === null ? "" : String(profile.workdayMinutes % 60),
  );
  const [prior, setPrior] = useState<PriorAnswer>(
    profile.priorServiceCredit ?? "",
  );
  const [error, setError] = useState("");

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
          defaultCommuteCost: commuteCost === "" ? null : Number(commuteCost),
          workdayMinutes,
          priorServiceCredit: prior || null,
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
      <label className="form-field">
        <span>소집일</span>
        <input
          required
          type="date"
          value={callUpDate}
          onChange={(event) => handleCallUpDate(event.target.value)}
        />
      </label>
      <label className="form-field">
        <span>소집해제 예정일</span>
        <input
          required
          type="date"
          value={expectedDischargeDate}
          onChange={(event) => setExpectedDischargeDate(event.target.value)}
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
          &lsquo;없어요&rsquo;일 때만 기본 보수를 계산해요. 경력 인정 계산은
          아직 검증 중이에요.
        </small>
      </fieldset>

      <label className="form-field">
        <span>
          <MapPin aria-hidden="true" size={17} />
          1일 통근비 (선택)
        </span>
        <input
          inputMode="numeric"
          min="0"
          placeholder="기관 승인 금액 또는 실제 운임"
          type="number"
          value={commuteCost}
          onChange={(event) => setCommuteCost(event.target.value)}
        />
      </label>

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
      <Button type="submit">변경 사항 저장</Button>
    </form>
  );
}
