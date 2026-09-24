"use client";

import { LockKeyhole } from "lucide-react";
import { type FormEvent, useState } from "react";

import {
  STANDARD_SERVICE_MONTHS,
  calculateExpectedDischargeDate,
  createProfile,
  isDateOnly,
  type DateOnly,
  type UserData,
  type UserDataStore,
} from "@super-gongik/domain";

import { BackupPanel } from "@/components/backup-panel";
import { Button } from "@/components/ui/button";

export function Onboarding({
  data,
  store,
}: {
  data: UserData;
  store: UserDataStore;
}) {
  const [callUpDate, setCallUpDate] = useState("");
  const [expectedDischargeDate, setExpectedDischargeDate] = useState("");
  const [serviceCategory, setServiceCategory] = useState("");
  const [error, setError] = useState("");
  const [showRestore, setShowRestore] = useState(false);

  function updateCallUpDate(value: string) {
    setCallUpDate(value);
    setExpectedDischargeDate(
      isDateOnly(value)
        ? calculateExpectedDischargeDate(value as DateOnly)
        : "",
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const result = await store.run((current, context) =>
      createProfile(
        current,
        {
          callUpDate,
          expectedDischargeDate,
          serviceCategory: serviceCategory || null,
          workplaceType: null,
          defaultCommuteCost: null,
          defaultMealAllowanceOverride: null,
          timezone: "Asia/Seoul",
        },
        context,
      ),
    );
    if (!result.ok) {
      setError(
        result.errors[0]?.message ??
          "소집일과 소집해제 예정일을 다시 확인해 주세요.",
      );
    }
  }

  return (
    <main className="onboarding-shell">
      <section className="onboarding-panel" aria-labelledby="onboarding-title">
        <p className="wordmark">슈퍼공익 · SUPER GONGIK</p>
        <h1 id="onboarding-title">복무 현황을 한눈에</h1>
        <p className="onboarding-intro">
          회원가입 없이 이 기기에서 바로 시작해요.
        </p>

        <form className="onboarding-form" onSubmit={handleSubmit}>
          <div className="service-date-fields">
            <span className="timeline-line" aria-hidden="true" />
            <label className="form-field service-date-field">
              <span>소집일</span>
              <input
                required
                type="date"
                value={callUpDate}
                onChange={(event) => updateCallUpDate(event.target.value)}
              />
            </label>
            <label className="form-field service-date-field service-date-field--end">
              <span>소집해제 예정일</span>
              <input
                required
                type="date"
                value={expectedDischargeDate}
                onChange={(event) =>
                  setExpectedDischargeDate(event.target.value)
                }
              />
              <small>{STANDARD_SERVICE_MONTHS}개월 기준으로 자동 계산</small>
            </label>
          </div>

          <label className="form-field">
            <span>복무 분야 (선택)</span>
            <select
              value={serviceCategory}
              onChange={(event) => setServiceCategory(event.target.value)}
            >
              <option value="">선택하지 않아도 돼요</option>
              <option value="사회복지">사회복지</option>
              <option value="보건의료">보건의료</option>
              <option value="교육">교육</option>
              <option value="행정">행정</option>
              <option value="기타">기타</option>
            </select>
          </label>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <Button className="onboarding-submit" type="submit">
            복무 현황 보기
          </Button>
        </form>

        <button
          aria-expanded={showRestore}
          className="text-button onboarding-restore-toggle"
          onClick={() => setShowRestore((value) => !value)}
          type="button"
        >
          기존 백업 파일이 있나요?
        </button>
        {showRestore ? (
          <BackupPanel compact data={data} ledger={null} store={store} />
        ) : null}

        <p className="privacy-note">
          <LockKeyhole aria-hidden="true" size={20} />
          입력한 정보는 이 기기에 먼저 저장됩니다.
        </p>
      </section>
    </main>
  );
}
