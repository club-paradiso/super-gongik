"use client";

import { DatabaseBackup, Download, FileJson, Upload } from "lucide-react";
import { type ChangeEvent, useState } from "react";

import {
  createBackup,
  mergeUserData,
  parseBackup,
  replaceUserData,
  serializeBackup,
  serviceEventsToCsv,
  summarizeUserData,
  type BackupSummary,
  type LeaveLedger,
  type UserData,
  type UserDataStore,
  leaveLedgerToCsv,
} from "@super-gongik/domain";

import { Button } from "@/components/ui/button";
import { downloadTextFile } from "@/lib/download";

function stamp(date: Date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

export function downloadFullBackup(data: UserData) {
  const now = new Date();
  downloadTextFile(
    `super-gongik-backup-${stamp(now)}.json`,
    serializeBackup(createBackup(data, now.toISOString())),
    "application/json",
  );
}

function SummaryList({ summary }: { summary: BackupSummary }) {
  return (
    <dl className="backup-summary">
      <div>
        <dt>백업 시각</dt>
        <dd>
          {summary.exportedAt
            ? new Date(summary.exportedAt).toLocaleString("ko-KR")
            : "알 수 없음"}
        </dd>
      </div>
      <div>
        <dt>소집일</dt>
        <dd>{summary.callUpDate ?? "프로필 없음"}</dd>
      </div>
      <div>
        <dt>복무 기록</dt>
        <dd>
          {summary.events}건
          {summary.deletedEvents
            ? ` (삭제 ${summary.deletedEvents}건 별도)`
            : ""}
        </dd>
      </div>
      <div>
        <dt>연가 보정·확인</dt>
        <dd>{summary.adjustments}건</dd>
      </div>
      <div>
        <dt>기관 잔액 기록</dt>
        <dd>{summary.snapshots}건</dd>
      </div>
    </dl>
  );
}

/**
 * Export and restore. Restoring never writes before the whole file has been
 * validated, and replacing keeps a pre-restore copy on the device.
 */
export function BackupPanel({
  data,
  ledger,
  store,
  compact = false,
}: {
  data: UserData;
  ledger: LeaveLedger | null;
  store: UserDataStore;
  compact?: boolean;
}) {
  const [pending, setPending] = useState<{
    fileName: string;
    data: UserData;
    summary: BackupSummary;
  } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);

  const current = summarizeUserData(data, "");
  const hasCurrentData = Boolean(data.profile) || current.events > 0;
  const canMerge =
    pending?.data.profile &&
    (!data.profile || data.profile.id === pending.data.profile.id);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setError("");
    setMessage("");
    setPending(null);
    setConfirmReplace(false);
    if (!file) return;
    const parsed = parseBackup(await file.text());
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setPending({
      fileName: file.name,
      data: parsed.data,
      summary: parsed.summary,
    });
  }

  async function merge() {
    if (!pending) return;
    const incoming = pending.data;
    const result = await store.run((currentData) => {
      const merged = mergeUserData(currentData, incoming);
      if (!merged.ok) {
        return {
          ok: false,
          errors: [{ code: "INVALID_FIELD", message: merged.error }],
        };
      }
      return { ok: true, data: merged.data, value: merged.stats };
    });
    if (!result.ok) {
      setError(result.errors[0]?.message ?? "합치지 못했어요.");
      return;
    }
    const stats = result.value;
    const changed =
      stats.addedEvents +
      stats.updatedEvents +
      stats.addedAdjustments +
      stats.addedSnapshots +
      stats.addedImports;
    setMessage(
      changed === 0 && stats.skippedDuplicateEvents === 0
        ? "합칠 내용이 없어요. 이 기기의 기록이 백업과 같거나 더 최신이에요. 삭제한 기록을 되살리려면 덮어쓰기를 쓰세요."
        : `합치기 완료: 새 기록 ${stats.addedEvents}건, 갱신 ${stats.updatedEvents}건, 중복이라 건너뜀 ${stats.skippedDuplicateEvents}건.`,
    );
    setPending(null);
  }

  async function replace() {
    if (!pending) return;
    const incoming = pending.data;
    try {
      await store.preserveBeforeRestore();
    } catch {
      setError("복원 전 현재 데이터를 기기에 보관하지 못해 복원을 멈췄어요.");
      return;
    }
    const result = await store.run((currentData) => ({
      ok: true,
      data: replaceUserData(currentData, incoming),
      value: undefined,
    }));
    if (!result.ok) {
      setError(result.errors[0]?.message ?? "복원하지 못했어요.");
      return;
    }
    setMessage(
      "백업으로 복원했어요. 이전 데이터는 이 기기에 한 벌 보관했어요.",
    );
    setPending(null);
    setConfirmReplace(false);
  }

  return (
    <section className="backup-panel" aria-labelledby="backup-title">
      <div className="record-import__heading">
        <div>
          <h2 id="backup-title">백업과 복원</h2>
          <p>
            기록은 이 기기에만 있어요. 기기를 바꾸거나 브라우저 데이터를 지우기
            전에 백업 파일을 내려받아 두세요.
          </p>
        </div>
        <DatabaseBackup aria-hidden="true" size={24} />
      </div>

      {!compact ? (
        <div className="backup-actions">
          <Button
            disabled={!hasCurrentData}
            onClick={() => downloadFullBackup(data)}
            type="button"
          >
            <FileJson aria-hidden="true" size={18} />
            전체 백업 (JSON)
          </Button>
          <Button
            disabled={current.events === 0}
            onClick={() =>
              downloadTextFile(
                `super-gongik-events-${stamp(new Date())}.csv`,
                serviceEventsToCsv(data.events),
                "text/csv;charset=utf-8",
              )
            }
            type="button"
            variant="outline"
          >
            <Download aria-hidden="true" size={18} />
            복무기록 CSV
          </Button>
          <Button
            disabled={!ledger || ledger.entries.length === 0}
            onClick={() =>
              ledger &&
              downloadTextFile(
                `super-gongik-leave-ledger-${stamp(new Date())}.csv`,
                leaveLedgerToCsv(ledger.entries),
                "text/csv;charset=utf-8",
              )
            }
            type="button"
            variant="outline"
          >
            <Download aria-hidden="true" size={18} />
            연가 원장 CSV
          </Button>
        </div>
      ) : null}

      <label className="backup-restore">
        <input
          accept=".json,application/json"
          onChange={handleFile}
          type="file"
        />
        <Upload aria-hidden="true" size={20} />
        <span>백업 파일(JSON)로 복원하기</span>
      </label>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="save-message" role="status">
          {message}
        </p>
      ) : null}

      {pending ? (
        <div className="backup-preview" role="group" aria-label="복원 미리보기">
          <strong>{pending.fileName}</strong>
          <SummaryList summary={pending.summary} />
          {hasCurrentData ? (
            <p className="field-hint">
              지금 이 기기에는 기록 {current.events}건이 있어요.
              {canMerge
                ? " 합치기는 아무것도 지우지 않고 없는 기록만 더해요. 이 기기에서 더 최근에 고치거나 지운 기록은 그대로 둬요."
                : " 다른 복무 프로필의 백업이라 덮어쓰기만 할 수 있어요."}
            </p>
          ) : null}
          <div className="backup-actions">
            {canMerge && hasCurrentData ? (
              <Button onClick={() => void merge()} type="button">
                합치기
              </Button>
            ) : null}
            {!hasCurrentData ? (
              <Button onClick={() => void replace()} type="button">
                이 백업으로 시작하기
              </Button>
            ) : confirmReplace ? (
              <div className="confirm-box" role="alert">
                <p>
                  현재 기록이 백업 내용으로 바뀌어요. 복원 직전 데이터는 이
                  기기에 한 벌 보관하지만, 안전하게 먼저 내려받아 두세요.
                </p>
                <div className="backup-actions">
                  <Button
                    onClick={() => downloadFullBackup(data)}
                    type="button"
                    variant="outline"
                  >
                    현재 데이터 내려받기
                  </Button>
                  <Button
                    onClick={() => void replace()}
                    type="button"
                    variant="danger"
                  >
                    덮어쓰기
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                onClick={() => setConfirmReplace(true)}
                type="button"
                variant="danger"
              >
                덮어쓰기…
              </Button>
            )}
            <Button
              onClick={() => setPending(null)}
              type="button"
              variant="ghost"
            >
              취소
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
