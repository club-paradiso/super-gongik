"use client";

import {
  ChevronDown,
  Cloud,
  FileUp,
  LockKeyhole,
  type LucideIcon,
} from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";

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
import { CloudSyncPanel } from "@/components/cloud-sync-panel";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { useCloud } from "@/hooks/use-cloud";

type RestorePath = "file" | "cloud" | null;

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
  const [submitting, setSubmitting] = useState(false);
  const [restorePath, setRestorePath] = useState<RestorePath>(null);
  const { state: cloud } = useCloud();
  const cloudAvailable = cloud.phase !== "UNCONFIGURED";
  // Keep the account panel open while a sign-in is in progress so the code
  // form or the signed-in choices never disappear behind a closed toggle.
  const cloudInProgress =
    cloud.phase === "CODE_SENT" || cloud.phase === "SIGNED_IN";
  const openPath: RestorePath = cloudInProgress ? "cloud" : restorePath;
  const ready = isDateOnly(callUpDate) && isDateOnly(expectedDischargeDate);

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
    if (submitting) return;
    setError("");
    setSubmitting(true);
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
    setSubmitting(false);
    if (!result.ok) {
      setError(
        result.errors[0]?.message ??
          "소집일과 소집해제 예정일을 다시 확인해 주세요.",
      );
    }
  }

  return (
    <main className="onboarding">
      <div className="onboarding__inner">
        <header className="onboarding__brand">
          <BrandMark />
          <span>슈퍼공익</span>
        </header>

        <section
          className="onboarding__hero"
          aria-labelledby="onboarding-title"
        >
          <h1 id="onboarding-title">
            복무 현황,
            <br />
            한눈에 챙겨요
          </h1>
          <p>소집일만 입력하면 D-Day와 진행률을 바로 보여드려요.</p>
        </section>

        <form className="onboarding__form" onSubmit={handleSubmit}>
          <fieldset className="setup-card">
            <legend className="setup-card__title">복무 기간</legend>
            <label className="setup-row">
              <span className="setup-row__label">소집일</span>
              <DateInput
                onValueChange={updateCallUpDate}
                placeholder="날짜를 선택하세요"
                required
                value={callUpDate}
              />
            </label>
            <label className="setup-row">
              <span className="setup-row__label">소집해제 예정일</span>
              <DateInput
                onValueChange={setExpectedDischargeDate}
                placeholder="소집일을 먼저 선택하세요"
                required
                value={expectedDischargeDate}
              />
              <small className="setup-row__hint">
                {STANDARD_SERVICE_MONTHS}개월 기준으로 자동 계산해요. 연장된
                경우 직접 고칠 수 있어요.
              </small>
            </label>
          </fieldset>

          <fieldset className="setup-card">
            <legend className="setup-card__title">
              복무 분야 <span className="optional">선택</span>
            </legend>
            <label className="setup-row">
              <span className="visually-hidden">복무 분야</span>
              <span className="select">
                <select
                  value={serviceCategory}
                  onChange={(event) => setServiceCategory(event.target.value)}
                >
                  <option value="">나중에 정할게요</option>
                  <option value="사회복지">사회복지</option>
                  <option value="보건의료">보건의료</option>
                  <option value="교육">교육</option>
                  <option value="행정">행정</option>
                  <option value="기타">기타</option>
                </select>
              </span>
            </label>
          </fieldset>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="onboarding__submit">
            <Button
              aria-busy={submitting || undefined}
              disabled={!ready || submitting}
              size="large"
              type="submit"
            >
              {submitting ? "저장하는 중…" : "복무 현황 보기"}
            </Button>
            <p className="onboarding__privacy">
              <LockKeyhole aria-hidden="true" size={14} />
              회원가입 없이 이 기기에만 저장돼요.
            </p>
          </div>
        </form>

        <section
          className="restore-card"
          aria-labelledby="onboarding-restore-title"
        >
          <h2 id="onboarding-restore-title">이미 쓰던 기록이 있나요?</h2>
          <RestoreOption
            description="내려받아 둔 JSON 백업으로 이어서 써요."
            icon={FileUp}
            label="백업 파일로 복원"
            onToggle={() =>
              setRestorePath((current) => (current === "file" ? null : "file"))
            }
            open={openPath === "file"}
          >
            <BackupPanel compact data={data} ledger={null} store={store} />
          </RestoreOption>
          {cloudAvailable ? (
            <RestoreOption
              description="다른 기기에서 동기화한 기록을 가져와요."
              icon={Cloud}
              label="계정으로 로그인"
              onToggle={() =>
                setRestorePath((current) =>
                  current === "cloud" ? null : "cloud",
                )
              }
              open={openPath === "cloud"}
            >
              <CloudSyncPanel onboarding />
            </RestoreOption>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function RestoreOption({
  label,
  description,
  icon: Icon,
  open,
  onToggle,
  children,
}: {
  label: string;
  description: string;
  icon: LucideIcon;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panelId = useId();
  return (
    <div className={open ? "restore-option is-open" : "restore-option"}>
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        className="restore-option__toggle"
        onClick={onToggle}
        type="button"
      >
        <span className="restore-option__icon">
          <Icon aria-hidden="true" size={18} />
        </span>
        <span className="restore-option__text">
          <strong>{label}</strong>
          <small>{description}</small>
        </span>
        <ChevronDown
          aria-hidden="true"
          className="restore-option__chevron"
          size={18}
        />
      </button>
      {open ? (
        <div className="restore-option__panel" id={panelId}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
