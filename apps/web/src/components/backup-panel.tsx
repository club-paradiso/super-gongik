"use client";

import { DatabaseBackup, Download, FileJson, Upload } from "lucide-react";
import { type ChangeEvent, useMemo, useState } from "react";

import {
  MAX_BACKUP_BYTES,
  SYNC_COLLECTIONS,
  createBackup,
  parseBackup,
  planRestore,
  serializeBackup,
  serviceEventsToCsv,
  summarizeUserData,
  type BackupInfo,
  type BackupSummary,
  type ConflictResolution,
  type LeaveLedger,
  type RestoreMode,
  type RestorePlan,
  type UserData,
  type UserDataStore,
  leaveLedgerToCsv,
} from "@super-gongik/domain";

import { Button } from "@/components/ui/button";
import { downloadTextFile } from "@/lib/download";
import {
  COLLECTION_LABELS,
  CONFLICT_TYPE_COPY,
  PROFILE_COPY,
  describeCounts,
  describeVersion,
  parseErrorTitle,
  restoreErrorTitle,
  restoreGate,
  totalOf,
} from "@/lib/restore-copy";

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

function formatTime(value: string) {
  const time = Date.parse(value);
  return Number.isNaN(time)
    ? "알 수 없음"
    : new Date(time).toLocaleString("ko-KR");
}

function SummaryList({
  summary,
  info,
  profile,
}: {
  summary: BackupSummary;
  info: BackupInfo;
  profile: RestorePlan["profile"];
}) {
  const rows: Array<[string, string]> = [
    ["백업 시각", info.exportedAt ? formatTime(info.exportedAt) : "알 수 없음"],
    [
      "데이터 형식",
      info.migratedFrom === null
        ? `버전 ${info.schemaVersion}`
        : `버전 ${info.schemaVersion} → 현재 형식으로 변환`,
    ],
    [
      "파일",
      `슈퍼공익 백업 v${info.formatVersion} · ${
        info.integrity === "VERIFIED" ? "체크섬 일치" : "체크섬 없음(이전 형식)"
      }`,
    ],
    ["프로필", PROFILE_COPY[profile]],
    ["소집일", summary.callUpDate ?? "프로필 없음"],
    [
      "복무 기록",
      `${summary.events}건${summary.deletedEvents ? ` (삭제 ${summary.deletedEvents}건 별도)` : ""}`,
    ],
    ["연가 보정·확인", `${summary.adjustments}건`],
    ["기관 잔액 기록", `${summary.snapshots}건`],
    ["월 근무일 확인", `${summary.attendanceMonths}건`],
    ["보수 계산 기록", `${summary.compensationSnapshots}건`],
  ];
  return (
    <dl className="backup-summary">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PlanTable({ plan }: { plan: RestorePlan }) {
  return (
    <dl className="restore-plan">
      {SYNC_COLLECTIONS.map((collection) => (
        <div key={collection}>
          <dt>{COLLECTION_LABELS[collection]}</dt>
          <dd>{describeCounts(plan.counts[collection])}</dd>
        </div>
      ))}
    </dl>
  );
}

type Pending = {
  fileName: string;
  data: UserData;
  summary: BackupSummary;
  info: BackupInfo;
};

/**
 * Export and restore. A backup is fully validated and previewed as a
 * per-collection plan before anything is written; applying re-checks the plan
 * in the store and writes the whole document in one save.
 */
export function BackupPanel({
  data,
  ledger,
  store,
  compact = false,
  incoming = null,
  syncEnabled = false,
  onRestored,
}: {
  data: UserData;
  ledger: LeaveLedger | null;
  store: UserDataStore;
  compact?: boolean;
  /**
   * Backup text from elsewhere (a cloud backup). It goes through exactly the
   * same parse → preview → confirm path as a file.
   */
  incoming?: { text: string; label: string; nonce: number } | null;
  /** Cloud sync is on for this device (changes REPLACE's explanation). */
  syncEnabled?: boolean;
  onRestored?: (mode: RestoreMode) => void;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<{ title: string; body: string } | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<RestoreMode>("MERGE");
  const [restoreDeleted, setRestoreDeleted] = useState(false);
  const [resolutions, setResolutions] = useState<
    Record<string, ConflictResolution>
  >({});
  const [confirmed, setConfirmed] = useState<{ revision: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const current = summarizeUserData(data, "");
  const hasCurrentData = Boolean(data.profile) || current.events > 0;
  const effectiveMode: RestoreMode = hasCurrentData ? mode : "REPLACE";

  // Plans are pure; recomputing them on every change of the live document
  // (another tab, a refresh) keeps the preview honest.
  const plans = useMemo(() => {
    if (!pending) return null;
    const request = { now: new Date().toISOString(), deviceId: data.deviceId };
    return {
      conflicts: planRestore(data, pending.data, {
        ...request,
        mode: "MERGE",
        options: { restoreLocallyDeleted: restoreDeleted },
      }).conflicts,
      merge: planRestore(data, pending.data, {
        ...request,
        mode: "MERGE",
        options: { restoreLocallyDeleted: restoreDeleted, resolutions },
      }),
      replace: planRestore(data, pending.data, { ...request, mode: "REPLACE" }),
    };
  }, [data, pending, restoreDeleted, resolutions]);

  const plan = plans
    ? effectiveMode === "MERGE"
      ? plans.merge
      : plans.replace
    : null;
  // A destructive confirmation only counts for the document it was given on.
  const destructiveConfirmed =
    confirmed !== null && confirmed.revision === data.documentRevision;
  const gate = plan
    ? restoreGate(plan, { resolutions, destructiveConfirmed })
    : null;
  const mergeUnavailable =
    plans?.merge.blocked?.reason === "PROFILE_MISMATCH" ||
    plans?.merge.blocked?.reason === "NO_INCOMING_PROFILE";

  function reset() {
    setPending(null);
    setMode("MERGE");
    setRestoreDeleted(false);
    setResolutions({});
    setConfirmed(null);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    // Cancelling the picker changes nothing, including an open preview.
    if (!file) return;
    setError(null);
    setMessage("");
    reset();
    // Bytes, not characters: a 10M-character file is at most ~30MB of UTF-8.
    if (file.size > MAX_BACKUP_BYTES * 3) {
      setError({
        title: "복원할 수 없는 파일이에요.",
        body: "백업 파일이 너무 커요. 이 기기의 데이터는 바뀌지 않았어요.",
      });
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setError({
        title: "파일을 읽지 못했어요.",
        body: "다시 선택해 주세요. 이 기기의 데이터는 바뀌지 않았어요.",
      });
      return;
    }
    openText(text, file.name);
  }

  function openText(text: string, fileName: string) {
    const parsed = parseBackup(text);
    if (!parsed.ok) {
      setError({
        title: parseErrorTitle(parsed.kind),
        body: `${parsed.error} 이 기기의 데이터는 바뀌지 않았어요.`,
      });
      return;
    }
    setPending({
      fileName,
      data: parsed.data,
      summary: parsed.summary,
      info: parsed.info,
    });
    const sameProfile =
      !parsed.data.profile ||
      !data.profile ||
      parsed.data.profile.id === data.profile.id;
    setMode(sameProfile ? "MERGE" : "REPLACE");
  }

  // A cloud backup handed over by the sync panel goes through the same
  // validation, preview and confirmation as a file. Each hand-over (nonce)
  // opens the preview once; adjusting state during render avoids an effect.
  const [seenNonce, setSeenNonce] = useState<number | null>(null);
  if (incoming && incoming.nonce !== seenNonce) {
    setSeenNonce(incoming.nonce);
    setError(null);
    setMessage("");
    reset();
    openText(incoming.text, incoming.label);
  }

  async function apply() {
    if (!pending || !plan || !gate?.enabled || busy) return;
    setBusy(true);
    setError(null);
    const result = await store.restore(pending.data, {
      mode: effectiveMode,
      options:
        effectiveMode === "MERGE"
          ? { restoreLocallyDeleted: restoreDeleted, resolutions }
          : undefined,
      expectedDocumentRevision: plan.baseDocumentRevision,
      confirmDestructive: effectiveMode === "REPLACE" && destructiveConfirmed,
    });
    setBusy(false);
    if (!result.ok) {
      setError({
        title: restoreErrorTitle(result.code),
        body: result.message,
      });
      if (result.code === "STALE_PREVIEW") void store.refresh();
      return;
    }
    onRestored?.(effectiveMode);
    const applied = result.plan;
    const changed = totalOf(applied, [
      "ADDED",
      "UPDATED",
      "RESTORED",
      "RESOLVED_INCOMING",
      "REPLACED",
      "DELETED",
      "REMOVED",
    ]);
    setMessage(
      effectiveMode === "MERGE"
        ? changed === 0
          ? "합칠 내용이 없었어요. 이 기기의 기록이 백업과 같아요."
          : `합치기 완료: 기록 ${changed}건이 바뀌었어요. 이 기기의 기록은 지우지 않았어요.`
        : hasCurrentData
          ? "백업으로 덮어썼어요. 복원 직전 데이터는 이 기기에 한 벌 보관했어요."
          : "백업으로 시작했어요.",
    );
    reset();
  }

  const localDeletionsKept = plans
    ? totalOf(plans.merge, ["LOCAL_DELETION_KEPT"])
    : 0;
  const incomingDeletionsSkipped = plans
    ? totalOf(plans.merge, ["INCOMING_DELETION_NOT_APPLIED"])
    : 0;
  const replaceLosses = plans
    ? totalOf(plans.replace, ["REMOVED", "REPLACED", "DELETED"])
    : 0;

  return (
    <section className="backup-panel" aria-labelledby="backup-title">
      <div className="panel-head">
        <div>
          <h2 id="backup-title">백업과 복원</h2>
          <p>
            {syncEnabled
              ? "동기화와 별개로, 백업 파일을 내려받아 두면 원하는 시점으로 되돌릴 수 있어요."
              : "기록은 이 기기에만 있어요. 기기를 바꾸거나 브라우저 데이터를 지우기 전에 백업 파일을 내려받아 두세요."}
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
        <div className="form-error" role="alert">
          <strong>{error.title}</strong> {error.body}
        </div>
      ) : null}
      {message ? (
        <p className="save-message" role="status">
          {message}
        </p>
      ) : null}

      {pending && plans && plan ? (
        <div className="backup-preview" role="group" aria-label="복원 미리보기">
          <strong className="backup-preview__file">{pending.fileName}</strong>
          <SummaryList
            info={pending.info}
            profile={plan.profile}
            summary={pending.summary}
          />
          {pending.info.migrationIssues.length ? (
            <ul className="field-hint">
              {pending.info.migrationIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}

          {hasCurrentData ? (
            <fieldset className="segmented" aria-label="복원 방식">
              {(
                [
                  ["MERGE", "합치기"],
                  ["REPLACE", "덮어쓰기"],
                ] as const
              ).map(([key, label]) => (
                <label
                  className={
                    effectiveMode === key
                      ? "segmented__item is-active"
                      : "segmented__item"
                  }
                  key={key}
                >
                  <input
                    checked={effectiveMode === key}
                    disabled={key === "MERGE" && mergeUnavailable}
                    name="restore-mode"
                    onChange={() => setMode(key)}
                    type="radio"
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          ) : null}

          {effectiveMode === "MERGE" ? (
            <div className="restore-mode-note">
              <p>
                <strong>합치기</strong>는 이 기기의 기록을 지우지 않아요. 나중에
                고친 것이 확인되는 기록만 가져오고, 같은 내용은 두 번 넣지
                않아요. 양쪽에서 따로 고친 기록은 직접 골라요.
              </p>
              {incomingDeletionsSkipped ? (
                <p>
                  백업에서 지워진 기록 {incomingDeletionsSkipped}건은 이
                  기기에서 지우지 않아요.
                </p>
              ) : null}
              {localDeletionsKept || restoreDeleted ? (
                <label className="restore-check">
                  <input
                    checked={restoreDeleted}
                    onChange={(event) =>
                      setRestoreDeleted(event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span>
                    이 기기에서 지운 기록도 백업에서 되살리기 (
                    {restoreDeleted
                      ? `${totalOf(plans.merge, ["RESTORED"])}건 되살림`
                      : `${localDeletionsKept}건`}
                    )
                  </span>
                </label>
              ) : null}
            </div>
          ) : (
            <div className="restore-mode-note restore-mode-note--danger">
              <p>
                <strong>덮어쓰기</strong>는 이 기기의 기록을 백업 내용으로
                통째로 바꿔요.
                {hasCurrentData
                  ? ` 이 기기 기록 중 ${replaceLosses}건이 사라지거나 바뀌어요. 복원 직전 데이터는 이 기기에 한 벌 보관해요.`
                  : " 이 기기에는 아직 기록이 없어요."}
                {syncEnabled
                  ? " 동기화가 켜져 있어서, 클라우드에 이 백업보다 나중에 고친 기록이 있으면 다음 동기화 때 그 기록이 다시 합쳐져요."
                  : ""}
              </p>
            </div>
          )}

          <PlanTable plan={plan} />

          {effectiveMode === "MERGE" && plans.conflicts.length ? (
            <div className="restore-conflicts" role="group" aria-label="충돌">
              <p>
                <strong>
                  직접 골라야 하는 충돌 {plans.conflicts.length}건
                </strong>
                <br />
                어느 쪽이 나중에 고친 것인지 증명할 수 없어서, 앱이 대신 고르지
                않아요.
              </p>
              <div className="backup-actions">
                {(
                  [
                    ["LOCAL", "모두 이 기기 값 유지"],
                    ["INCOMING", "모두 백업 값 사용"],
                  ] as const
                ).map(([choice, label]) => (
                  <Button
                    key={choice}
                    onClick={() =>
                      setResolutions(
                        Object.fromEntries(
                          plans.conflicts.map((conflict) => [
                            conflict.key,
                            choice,
                          ]),
                        ),
                      )
                    }
                    type="button"
                    variant="outline"
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <ul>
                {plans.conflicts.map((conflict) => (
                  <li key={conflict.key}>
                    <strong>{COLLECTION_LABELS[conflict.collection]}</strong>
                    <span>{CONFLICT_TYPE_COPY[conflict.type]}</span>
                    <span className="restore-conflicts__id">
                      {conflict.recordId}
                    </span>
                    <span>이 기기: {describeVersion(conflict.local)}</span>
                    <span>백업: {describeVersion(conflict.incoming)}</span>
                    <fieldset
                      aria-label={`${COLLECTION_LABELS[conflict.collection]} 충돌 선택`}
                      className="segmented"
                    >
                      {(
                        [
                          ["LOCAL", "이 기기 값 유지"],
                          ["INCOMING", "백업 값 사용"],
                        ] as const
                      ).map(([choice, label]) => (
                        <label
                          className={
                            resolutions[conflict.key] === choice
                              ? "segmented__item is-active"
                              : "segmented__item"
                          }
                          key={choice}
                        >
                          <input
                            checked={resolutions[conflict.key] === choice}
                            name={`conflict-${conflict.key}`}
                            onChange={() =>
                              setResolutions((previous) => ({
                                ...previous,
                                [conflict.key]: choice,
                              }))
                            }
                            type="radio"
                          />
                          {label}
                        </label>
                      ))}
                    </fieldset>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {effectiveMode === "REPLACE" &&
          plan.requiresDestructiveConfirmation ? (
            <div
              className="confirm-box"
              role="group"
              aria-label="덮어쓰기 확인"
            >
              <p>
                덮어쓰면 되돌리기 어려워요. 먼저 현재 데이터를 내려받아 두는
                것을 권해요.
              </p>
              <Button
                onClick={() => downloadFullBackup(data)}
                type="button"
                variant="outline"
              >
                현재 데이터 내려받기
              </Button>
              <label className="restore-check">
                <input
                  checked={destructiveConfirmed}
                  onChange={(event) =>
                    setConfirmed(
                      event.target.checked
                        ? { revision: data.documentRevision }
                        : null,
                    )
                  }
                  type="checkbox"
                />
                <span>
                  이 기기의 기록 {replaceLosses}건이 사라지거나 바뀌는 것을
                  확인했어요.
                </span>
              </label>
            </div>
          ) : null}

          {gate && !gate.enabled ? (
            <p className="field-hint" role="status">
              {gate.reason}
            </p>
          ) : null}

          <div className="backup-actions">
            <Button
              disabled={!gate?.enabled || busy}
              onClick={() => void apply()}
              type="button"
              variant={
                effectiveMode === "REPLACE" && hasCurrentData
                  ? "danger"
                  : "primary"
              }
            >
              {effectiveMode === "MERGE"
                ? "합치기"
                : hasCurrentData
                  ? "덮어쓰기"
                  : "이 백업으로 시작하기"}
            </Button>
            <Button onClick={reset} type="button" variant="ghost">
              취소
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
