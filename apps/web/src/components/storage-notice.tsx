"use client";

import { AlertTriangle, X } from "lucide-react";

import type { LoadNotice, UserDataStore } from "@super-gongik/domain";

import { downloadTextFile } from "@/lib/download";

/**
 * Surfaces every non-trivial load outcome. Nothing about storage recovery is
 * allowed to happen silently.
 */
export function StorageNotice({
  notice,
  lastError,
  store,
}: {
  notice: LoadNotice | null;
  lastError: string | null;
  store: UserDataStore;
}) {
  if (!notice && !lastError) return null;

  async function downloadQuarantine(key: string, fileName: string) {
    const raw = await store.readRaw(key).catch(() => null);
    if (raw) downloadTextFile(fileName, raw, "application/json");
  }

  let title = "";
  let body: string[] = [];
  let quarantineKey: string | null = null;
  let previousQuarantineKey: string | null = null;

  if (notice?.kind === "MIGRATED") {
    title = "새 저장 형식으로 옮겼어요.";
    body = notice.issues.length
      ? notice.issues
      : [
          "이전 버전의 기록을 모두 옮겼어요. 이전 저장본은 기기에 그대로 남겨 두었어요.",
        ];
  } else if (notice?.kind === "RECOVERED") {
    title = "최근 저장본을 읽지 못해 직전 저장본으로 복구했어요.";
    body = [
      "마지막 몇 개의 변경이 빠졌을 수 있어요. 읽지 못한 원본은 지우지 않았고, 내려받아 보관할 수 있어요.",
    ];
    quarantineKey = notice.quarantineKey;
  } else if (notice?.kind === "CORRUPT") {
    title = "저장된 데이터를 읽지 못했어요.";
    body = [
      notice.quarantineInPlace
        ? "원본은 지우지 않고 원래 자리에 그대로 두었어요. 덮어쓰지 않도록 수정을 막았어요."
        : "원본은 지우지 않고 기기에 따로 보관했어요.",
      "백업 파일이 있다면 복원하고, 없다면 원본을 내려받아 보관해 주세요.",
    ];
    quarantineKey = notice.quarantineKey;
    previousQuarantineKey = notice.previousQuarantineKey;
  } else if (notice?.kind === "NEWER_VERSION") {
    title = "더 새로운 버전의 앱에서 저장한 데이터예요.";
    body = [
      "데이터를 보호하려고 이 화면에서는 수정하지 않아요. 페이지를 새로고침해 최신 버전을 받아 주세요.",
    ];
  }

  return (
    <div className="storage-notice" role="alert">
      <AlertTriangle aria-hidden="true" size={20} />
      <div>
        {title ? <strong>{title}</strong> : null}
        {body.map((line) => (
          <p key={line}>{line}</p>
        ))}
        {lastError ? <p>{lastError}</p> : null}
        {quarantineKey ? (
          <button
            className="text-button"
            onClick={() =>
              void downloadQuarantine(
                quarantineKey,
                "super-gongik-unreadable-data.json",
              )
            }
            type="button"
          >
            읽지 못한 원본 내려받기
          </button>
        ) : null}
        {previousQuarantineKey ? (
          <button
            className="text-button"
            onClick={() =>
              void downloadQuarantine(
                previousQuarantineKey,
                "super-gongik-unreadable-previous.json",
              )
            }
            type="button"
          >
            읽지 못한 직전 저장본 내려받기
          </button>
        ) : null}
      </div>
      {notice && notice.kind !== "NEWER_VERSION" ? (
        <button
          aria-label="알림 닫기"
          className="icon-button"
          onClick={() => store.dismissNotice()}
          type="button"
        >
          <X aria-hidden="true" size={18} />
        </button>
      ) : null}
    </div>
  );
}
