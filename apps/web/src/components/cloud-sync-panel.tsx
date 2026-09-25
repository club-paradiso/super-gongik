"use client";

import { Cloud, CloudOff, RefreshCw } from "lucide-react";
import { type FormEvent, useState } from "react";

import type {
  CloudBackupInfo,
  ConflictResolution,
  EnablePreview,
  SyncBlock,
  SyncConflict,
} from "@super-gongik/domain";

import { Button } from "@/components/ui/button";
import { useCloud } from "@/hooks/use-cloud";
import { isAccountChanged } from "@/lib/sync/cloud-controller";
import {
  COLLECTION_LABELS,
  CONFLICT_TYPE_COPY,
  describeVersion,
} from "@/lib/restore-copy";
import {
  AUTH_ERROR_COPY,
  HELD_REASON_COPY,
  conflictSides,
  describeRecord,
  describePreview,
  formatBytes,
  formatTime,
  syncLabel,
} from "@/lib/sync-copy";

export function SyncStatusChip({
  onOpen,
  className = "",
}: {
  onOpen?: () => void;
  className?: string;
}) {
  const { state } = useCloud();
  if (state.phase === "UNCONFIGURED") return null;
  const label = syncLabel(state);
  const Icon =
    label.tone === "neutral" && state.phase !== "SIGNED_IN" ? CloudOff : Cloud;
  return (
    <button
      aria-label={`동기화 상태: ${label.text}`}
      className={`sync-chip sync-chip--${label.tone} ${className}`}
      onClick={onOpen}
      type="button"
    >
      <Icon aria-hidden="true" size={15} />
      <span>{label.text}</span>
    </button>
  );
}

/** Where data lives, stated for the current mode. */
export function PrivacyLine() {
  const { state } = useCloud();
  const syncing =
    state.phase === "SIGNED_IN" &&
    state.sync !== null &&
    state.sync.phase !== "DISABLED";
  return syncing
    ? "이 기기에 먼저 저장하고 계정과 동기화해요."
    : "정보는 이 기기에만 저장해요.";
}

/**
 * Optional account and cloud sync. Hidden entirely in builds without cloud
 * configuration. Nothing here is needed to use the app.
 */
export function CloudSyncPanel({
  onRestoreBackup,
  onboarding = false,
}: {
  /** Open a downloaded cloud backup in the normal restore preview. */
  onRestoreBackup?: (text: string, label: string) => void;
  onboarding?: boolean;
}) {
  const { state } = useCloud();
  if (state.phase === "UNCONFIGURED") return null;
  const label = syncLabel(state);

  return (
    <section
      aria-labelledby="cloud-sync-title"
      className="backup-panel cloud-panel"
      id="cloud-sync"
    >
      <div className="panel-head">
        <div>
          <h2 id="cloud-sync-title">계정과 클라우드 동기화</h2>
          <p>
            {onboarding
              ? "다른 기기에서 쓰던 기록이 있다면 로그인해 가져올 수 있어요."
              : "로그인 없이도 모든 기능을 쓸 수 있어요. 여러 기기에서 같은 기록을 쓰려면 로그인해 동기화를 켜세요."}
          </p>
        </div>
        <Cloud aria-hidden="true" size={24} />
      </div>
      <p className={`sync-line sync-line--${label.tone}`} role="status">
        {label.text}
      </p>
      {state.phase === "SIGNED_IN" ? (
        // Keyed by sign-in session: a sign-out or an account switch (e.g. in
        // another tab) drops every open confirmation, preview and pending
        // choice made in the previous session.
        <SignedIn
          key={state.accountSession}
          onRestoreBackup={onboarding ? undefined : onRestoreBackup}
          session={state.accountSession!}
        />
      ) : (
        <SignIn />
      )}
    </section>
  );
}

function SignIn() {
  const { state, cloud } = useCloud();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    await cloud.sendCode(email.trim());
    setBusy(false);
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    await cloud.verifyCode(code.trim());
    setBusy(false);
  }

  const error = state.authError ? (
    <p className="form-error" role="alert">
      {AUTH_ERROR_COPY[state.authError]}
    </p>
  ) : null;

  if (state.phase === "CODE_SENT") {
    return (
      <form className="cloud-form" onSubmit={verify}>
        <p className="field-hint">
          {state.email}로 로그인 메일을 보냈어요. 메일의 인증 코드를 입력하거나
          메일의 링크를 이 브라우저에서 열어 주세요.
        </p>
        <label className="form-field">
          <span>인증 코드</span>
          <input
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={10}
            onChange={(event) => setCode(event.target.value)}
            required
            value={code}
          />
        </label>
        {error}
        <div className="backup-actions">
          <Button disabled={busy || code.trim().length < 6} type="submit">
            로그인
          </Button>
          <Button
            onClick={() => cloud.cancelCode()}
            type="button"
            variant="ghost"
          >
            다른 이메일 쓰기
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form className="cloud-form" onSubmit={send}>
      <label className="form-field">
        <span>이메일</span>
        <input
          autoComplete="email"
          disabled={state.phase === "LOADING"}
          inputMode="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      {error}
      <Button disabled={busy || state.phase === "LOADING"} type="submit">
        로그인 코드 받기
      </Button>
      <p className="field-hint">
        로그인하면 동기화를 켤지 먼저 물어봐요. 로그인만으로는 아무것도 올리지
        않아요.
      </p>
    </form>
  );
}

const ACCOUNT_CHANGED_MESSAGE =
  "로그인한 계정이 바뀌어 아무것도 하지 않았어요. 현재 계정 기준으로 다시 확인해 주세요.";

function SignedIn({
  onRestoreBackup,
  session,
}: {
  onRestoreBackup?: (text: string, label: string) => void;
  /**
   * The sign-in session (`CloudState.accountSession`) every choice made in
   * this subtree is for. Passed as-is to every account-scoped action.
   */
  session: string;
}) {
  const { state, cloud } = useCloud();
  const sync = state.sync;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteChecked, setDeleteChecked] = useState(false);

  async function syncNow() {
    setBusy(true);
    setMessage("");
    await cloud.syncNow();
    setBusy(false);
  }

  async function deleteCloud() {
    setBusy(true);
    setMessage("");
    try {
      const result = await cloud.deleteCloudData(session);
      setMessage(
        isAccountChanged(result)
          ? ACCOUNT_CHANGED_MESSAGE
          : result.ok
            ? "클라우드의 동기화 기록과 백업을 지웠어요. 이 기기와 다른 기기의 기록은 그대로예요. 이 기기의 동기화는 꺼졌고, 다른 기기는 다시 동기화하기 전에 확인을 받아요."
            : "다른 기기에서 먼저 클라우드 데이터를 지웠어요. 아무것도 바꾸지 않았어요. 다시 확인해 주세요.",
      );
    } catch {
      setMessage(
        "클라우드에 연결하지 못해 지우지 않았어요. 연결을 확인해 주세요.",
      );
    }
    setConfirmDelete(false);
    setDeleteChecked(false);
    setBusy(false);
  }

  const enabled = sync !== null && sync.phase !== "DISABLED";

  return (
    <div className="cloud-body">
      <p className="field-hint">
        {state.email ?? "이메일 없음"} 계정으로 로그인됨
      </p>

      {!enabled ? (
        <EnableFlow session={session} />
      ) : (
        <>
          <dl className="backup-summary">
            <div>
              <dt>마지막 동기화</dt>
              <dd>{formatTime(sync.lastSyncedAt)}</dd>
            </div>
          </dl>
          {sync.block ? (
            <BlockNotice block={sync.block} session={session} />
          ) : null}
          {sync.conflicts.length ? (
            <ConflictList conflicts={sync.conflicts} session={session} />
          ) : null}
          {sync.held.length ? (
            <div
              className="restore-conflicts"
              role="group"
              aria-label="적용하지 못한 클라우드 기록"
            >
              <p>
                <strong>
                  적용하지 못한 클라우드 기록 {sync.held.length}건
                </strong>
                <br />이 기기의 기록과 함께 둘 수 없어 적용하지 않았어요.
                아무것도 지우지 않았어요. 겹치는 기록을 이 기기에서 고치거나
                지우면 다음 동기화 때 적용돼요.
              </p>
              <ul>
                {sync.held.map((item) => (
                  <li key={item.key}>
                    <strong>{COLLECTION_LABELS[item.collection]}</strong>
                    <span>
                      클라우드:{" "}
                      {describeRecord(item.collection, item.cloudRecord)}
                    </span>
                    {item.reason ? (
                      <span>{HELD_REASON_COPY[item.reason]}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="backup-actions">
            <Button
              disabled={busy || sync.phase === "SYNCING"}
              onClick={() => void syncNow()}
              type="button"
              variant="outline"
            >
              <RefreshCw aria-hidden="true" size={16} />
              지금 동기화
            </Button>
          </div>
        </>
      )}

      {onRestoreBackup ? (
        <CloudBackups onRestore={onRestoreBackup} session={session} />
      ) : null}

      {message ? (
        <p className="save-message" role="status">
          {message}
        </p>
      ) : null}

      <div className="cloud-account">
        <Button
          onClick={() => void cloud.signOut()}
          type="button"
          variant="ghost"
        >
          로그아웃
        </Button>
        <p className="field-hint">
          로그아웃하면 이 기기의 동기화만 멈춰요. 이 기기의 기록은 지우지
          않아요.
        </p>
        {confirmDelete ? (
          <div
            className="confirm-box"
            role="group"
            aria-label="클라우드 데이터 삭제 확인"
          >
            <p>
              <strong>클라우드 데이터 삭제</strong>는 이 계정의 동기화 기록과
              클라우드 백업을 모두 지워요. 되돌릴 수 없어요. 이 기기와 다른
              기기에 저장된 기록은 지우지 않아요. 다른 기기는 다음 동기화 때
              자동으로 다시 올리지 않고 먼저 확인을 받아요.
            </p>
            <label className="restore-check">
              <input
                checked={deleteChecked}
                onChange={(event) => setDeleteChecked(event.target.checked)}
                type="checkbox"
              />
              <span>
                클라우드의 기록과 백업이 모두 지워지는 것을 확인했어요.
              </span>
            </label>
            <div className="backup-actions">
              <Button
                disabled={!deleteChecked || busy}
                onClick={() => void deleteCloud()}
                type="button"
                variant="danger"
              >
                클라우드 데이터 삭제
              </Button>
              <Button
                onClick={() => {
                  setConfirmDelete(false);
                  setDeleteChecked(false);
                }}
                type="button"
                variant="ghost"
              >
                취소
              </Button>
            </div>
          </div>
        ) : (
          <Button
            onClick={() => setConfirmDelete(true)}
            type="button"
            variant="danger"
          >
            클라우드 데이터 삭제…
          </Button>
        )}
      </div>

      {state.diagnostics.length ? (
        <details className="cloud-diagnostics">
          <summary>동기화 진단 정보 (기록 내용 없음)</summary>
          <ul>
            {state.diagnostics.map((item, index) => (
              <li key={index}>
                {item.kind} · {item.outcome} · 받음 {item.pulled} · 보냄{" "}
                {item.pushed} · 충돌 {item.conflicts} · {item.durationMs}ms
                {item.errorCategory ? ` · ${item.errorCategory}` : ""}
                {item.block ? ` · ${item.block}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** Preview what turning sync on does, then ask. Never uploads by itself. */
function EnableFlow({
  restart = false,
  session,
}: {
  restart?: boolean;
  session: string;
}) {
  const { cloud } = useCloud();
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<EnablePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setBusy(true);
    setError("");
    try {
      setPreview(await cloud.previewEnable());
    } catch {
      setError(
        "클라우드에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.",
      );
    }
    setBusy(false);
  }

  async function confirm() {
    if (!preview || preview.kind !== "READY") return;
    if (preview.evidence.sessionId !== session) {
      setNotice(ACCOUNT_CHANGED_MESSAGE);
      setPreview(null);
      return;
    }
    setBusy(true);
    setNotice("");
    let result;
    try {
      result = await cloud.enable(preview);
    } catch {
      setError(
        "클라우드에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.",
      );
      setBusy(false);
      return;
    }
    if (result.kind === "STALE_PREVIEW") {
      // Never run a different plan under this confirmation: show a new
      // preview and ask again.
      setNotice(
        result.reason === "ACCOUNT"
          ? ACCOUNT_CHANGED_MESSAGE
          : "미리보기 이후 이 기기나 클라우드의 기록이 바뀌었어요. 아무것도 올리거나 받지 않았어요. 새 미리보기를 확인해 주세요.",
      );
      setPreview(null);
      setBusy(false);
      if (result.reason !== "ACCOUNT") await load();
      return;
    }
    setBusy(false);
    setPreview(null);
  }

  if (!preview) {
    return (
      <div className="cloud-enable">
        {!restart ? (
          <p className="field-hint">
            이 기기에서는 동기화가 꺼져 있어요. 켜기 전에 무엇이 오가는지 먼저
            보여드려요.
          </p>
        ) : null}
        {notice ? (
          <p className="field-hint" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <Button disabled={busy} onClick={() => void load()} type="button">
          {restart ? "이 기기 데이터로 동기화 다시 시작…" : "동기화 켜기…"}
        </Button>
      </div>
    );
  }

  if (preview.kind === "PROFILE_MISMATCH") {
    return (
      <div className="confirm-box" role="alert">
        <p>
          이 계정의 클라우드에는 <strong>다른 복무 프로필</strong>의 기록{" "}
          {preview.remoteRecords}건이 있어요. 서로 다른 사람의 기록일 수 있어
          합치지 않았어요. 아무것도 바뀌지 않았어요.
        </p>
        <p>
          이 기기 기록을 이 계정에 올리려면 먼저 아래의 &lsquo;클라우드 데이터
          삭제&rsquo;를 하거나, 다른 계정으로 로그인하세요.
        </p>
        <Button onClick={() => setPreview(null)} type="button" variant="ghost">
          닫기
        </Button>
      </div>
    );
  }

  if (preview.kind === "REMOTE_INVALID") {
    return (
      <div className="confirm-box" role="alert">
        <p>
          {preview.newerSchema
            ? "클라우드의 기록이 더 새로운 앱 버전에서 저장됐어요. 앱을 새로고침해 업데이트한 뒤 다시 시도해 주세요."
            : `클라우드의 기록 ${preview.issues.length}건을 읽을 수 없어 동기화를 켜지 않았어요. 이 기기의 기록은 바뀌지 않았어요.`}
        </p>
        <Button onClick={() => setPreview(null)} type="button" variant="ghost">
          닫기
        </Button>
      </div>
    );
  }

  return (
    <div
      className="backup-preview"
      role="group"
      aria-label="동기화 켜기 미리보기"
    >
      {notice ? (
        <p className="field-hint" role="status">
          {notice}
        </p>
      ) : null}
      <p>{describePreview(preview)}</p>
      <dl className="backup-summary">
        <div>
          <dt>이 기기 기록</dt>
          <dd>{preview.localRecords}건</dd>
        </div>
        <div>
          <dt>클라우드 기록</dt>
          <dd>{preview.remoteRecords}건</dd>
        </div>
        {preview.account.resetAt ? (
          <div>
            <dt>클라우드 데이터 삭제 이력</dt>
            <dd>{formatTime(preview.account.resetAt)}</dd>
          </div>
        ) : null}
      </dl>
      {preview.conflicts ? (
        <p className="field-hint">
          양쪽에서 따로 고친 기록은 앱이 고르지 않아요. 켠 뒤에 하나씩 골라
          주세요.
        </p>
      ) : null}
      <div className="backup-actions">
        <Button disabled={busy} onClick={() => void confirm()} type="button">
          동기화 켜기
        </Button>
        <Button onClick={() => setPreview(null)} type="button" variant="ghost">
          취소
        </Button>
      </div>
    </div>
  );
}

function BlockNotice({
  block,
  session,
}: {
  block: SyncBlock;
  session: string;
}) {
  const { cloud } = useCloud();
  const disable = () => void cloud.disableSync(session).catch(() => undefined);
  switch (block.reason) {
    case "GENERATION_MISMATCH":
      return (
        <div className="confirm-box" role="alert">
          <p>
            {block.account.resetAt
              ? `${formatTime(block.account.resetAt)}에 `
              : ""}
            이 계정의 클라우드 데이터가 삭제됐어요. 이 기기의 기록은 그대로
            있고, 자동으로 다시 올리지 않았어요.
          </p>
          <EnableFlow restart session={session} />
          <Button onClick={disable} type="button" variant="ghost">
            이 기기에서 동기화 끄기
          </Button>
        </div>
      );
    case "PROFILE_MISMATCH":
      return (
        <div className="confirm-box" role="alert">
          <p>
            클라우드에 다른 복무 프로필의 기록이 있어 동기화를 멈췄어요. 이
            기기의 기록은 바뀌지 않았어요.
          </p>
          <Button onClick={disable} type="button" variant="ghost">
            이 기기에서 동기화 끄기
          </Button>
        </div>
      );
    case "AUTH":
      return (
        <div className="confirm-box" role="alert">
          <p>로그인이 만료됐어요. 다시 로그인하면 이어서 동기화해요.</p>
          <Button onClick={() => void cloud.signOut()} type="button">
            다시 로그인
          </Button>
        </div>
      );
    case "REMOTE_INVALID":
      return (
        <div className="confirm-box" role="alert">
          <p>
            클라우드의 기록 일부를 읽을 수 없어 동기화를 멈췄어요. 이 기기의
            기록은 바뀌지 않았어요.
          </p>
          <ul className="field-hint">
            {block.issues.map((issue) => (
              <li key={`${issue.key}-${issue.path}`}>
                {issue.key} · {issue.code}
                {issue.path ? ` · ${issue.path}` : ""}
              </li>
            ))}
          </ul>
        </div>
      );
    case "REMOTE_NEWER_SCHEMA":
      return (
        <div className="confirm-box" role="alert">
          <p>
            다른 기기가 더 새로운 앱 버전으로 동기화했어요. 새로고침해 앱을
            업데이트해 주세요.
          </p>
        </div>
      );
    case "LOCAL_READ_ONLY":
      return (
        <div className="confirm-box" role="alert">
          <p>{block.message}</p>
        </div>
      );
  }
}

function ConflictList({
  conflicts,
  session,
}: {
  conflicts: SyncConflict[];
  session: string;
}) {
  const { cloud } = useCloud();
  const [error, setError] = useState("");
  const [choices, setChoices] = useState<Record<string, ConflictResolution>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const chosen = conflicts.filter((conflict) => choices[conflict.key]);

  async function apply() {
    setBusy(true);
    setError("");
    try {
      const result = await cloud.resolveConflicts(
        session,
        Object.fromEntries(
          chosen.map((conflict) => [conflict.key, choices[conflict.key]!]),
        ),
      );
      if (isAccountChanged(result)) setError(ACCOUNT_CHANGED_MESSAGE);
    } catch {
      setError("적용하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
    setChoices({});
    setBusy(false);
  }

  return (
    <div className="restore-conflicts" role="group" aria-label="동기화 충돌">
      <p>
        <strong>직접 골라야 하는 충돌 {conflicts.length}건</strong>
        <br />이 기기와 클라우드에서 따로 고쳐져, 어느 쪽이 나중인지 증명할 수
        없어요. 고르기 전까지 이 기기의 값을 그대로 두고, 클라우드 값도 덮어쓰지
        않아요.
      </p>
      <div className="backup-actions">
        {(
          [
            ["LOCAL", "모두 이 기기 값 유지"],
            ["INCOMING", "모두 클라우드 값 사용"],
          ] as const
        ).map(([choice, label]) => (
          <Button
            key={choice}
            onClick={() =>
              setChoices(
                Object.fromEntries(
                  conflicts.map((conflict) => [conflict.key, choice]),
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
        {conflicts.map((conflict) => {
          const sides = conflictSides(conflict);
          return (
            <li key={conflict.key}>
              <strong>{COLLECTION_LABELS[conflict.collection]}</strong>
              <span>{CONFLICT_TYPE_COPY[conflict.type]}</span>
              <span>
                이 기기: {sides.local} ({describeVersion(conflict.local)})
              </span>
              <span>
                클라우드: {sides.cloud} ({describeVersion(conflict.incoming)})
              </span>
              <fieldset
                aria-label={`${COLLECTION_LABELS[conflict.collection]} 충돌 선택`}
                className="segmented"
              >
                {(
                  [
                    ["LOCAL", "이 기기 값 유지"],
                    ["INCOMING", "클라우드 값 사용"],
                  ] as const
                ).map(([choice, label]) => (
                  <label
                    className={
                      choices[conflict.key] === choice
                        ? "segmented__item is-active"
                        : "segmented__item"
                    }
                    key={choice}
                  >
                    <input
                      checked={choices[conflict.key] === choice}
                      name={`sync-conflict-${conflict.key}`}
                      onChange={() =>
                        setChoices((previous) => ({
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
          );
        })}
      </ul>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        disabled={busy || chosen.length === 0}
        onClick={() => void apply()}
        type="button"
      >
        고른 {chosen.length}건 적용하고 동기화
      </Button>
    </div>
  );
}

function CloudBackups({
  onRestore,
  session,
}: {
  onRestore: (text: string, label: string) => void;
  session: string;
}) {
  const { cloud } = useCloud();
  const [backups, setBackups] = useState<CloudBackupInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  async function task(run: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await run();
    } catch {
      setMessage(
        "클라우드에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.",
      );
    }
    setBusy(false);
  }

  const refresh = () =>
    task(async () => {
      setBackups(await cloud.listBackups());
    });

  return (
    <div className="cloud-backups">
      <h3>클라우드 백업</h3>
      <p className="field-hint">
        동기화와 별개인 시점 사본이에요. 올린 백업은 바뀌지 않고, 최근 10개를
        보관해요. 복원은 파일 복원과 같은 미리보기를 거쳐요.
      </p>
      <div className="backup-actions">
        <Button
          disabled={busy}
          onClick={() =>
            void task(async () => {
              const result = await cloud.uploadBackup(session);
              if (isAccountChanged(result)) {
                setMessage(ACCOUNT_CHANGED_MESSAGE);
              } else if (result.kind === "OK") {
                setMessage("클라우드에 백업을 올렸어요.");
                setBackups(await cloud.listBackups());
              } else {
                setMessage(
                  "클라우드 데이터가 삭제된 뒤라 올리지 않았어요. 동기화 상태를 먼저 확인해 주세요.",
                );
              }
            })
          }
          type="button"
          variant="outline"
        >
          지금 클라우드에 백업
        </Button>
        <Button
          disabled={busy}
          onClick={() => void refresh()}
          type="button"
          variant="ghost"
        >
          {backups ? "목록 새로고침" : "백업 목록 보기"}
        </Button>
      </div>
      {message ? (
        <p className="save-message" role="status">
          {message}
        </p>
      ) : null}
      {backups ? (
        backups.length === 0 ? (
          <p className="field-hint">클라우드 백업이 아직 없어요.</p>
        ) : (
          <ul className="cloud-backup-list">
            {backups.map((backup) => (
              <li key={backup.id}>
                <span>
                  {formatTime(backup.createdAt)} ·{" "}
                  {formatBytes(backup.byteSize)}
                </span>
                <div className="backup-actions">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void task(async () => {
                        const text = await cloud.downloadBackup(backup.id);
                        onRestore(
                          text,
                          `클라우드 백업 ${formatTime(backup.createdAt)}`,
                        );
                      })
                    }
                    size="compact"
                    type="button"
                    variant="outline"
                  >
                    미리보기로 복원
                  </Button>
                  {pendingDelete === backup.id ? (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void task(async () => {
                          const result = await cloud.deleteBackup(
                            session,
                            backup.id,
                          );
                          setPendingDelete(null);
                          if (isAccountChanged(result)) {
                            setMessage(ACCOUNT_CHANGED_MESSAGE);
                            return;
                          }
                          setBackups(await cloud.listBackups());
                        })
                      }
                      size="compact"
                      type="button"
                      variant="danger"
                    >
                      이 백업 삭제 확인
                    </Button>
                  ) : (
                    <Button
                      onClick={() => setPendingDelete(backup.id)}
                      size="compact"
                      type="button"
                      variant="ghost"
                    >
                      삭제…
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
