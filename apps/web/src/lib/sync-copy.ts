import {
  SERVICE_EVENT_TYPE_LABELS,
  type RejectReason,
  type EnablePreview,
  type SyncCollection,
  type SyncConflict,
  type SyncRecord,
  type UserData,
} from "@super-gongik/domain";

import type { AuthErrorKind, CloudState } from "@/lib/sync/cloud-controller";

export type SyncTone = "neutral" | "ok" | "busy" | "attention";

/** One short label for the header chip and the settings panel. */
export function syncLabel(state: CloudState): { text: string; tone: SyncTone } {
  switch (state.phase) {
    case "UNCONFIGURED":
    case "GUEST":
    case "CODE_SENT":
      return { text: "로컬 전용", tone: "neutral" };
    case "LOADING":
      return { text: "계정 확인 중", tone: "busy" };
    case "SIGNED_IN":
      break;
  }
  const sync = state.sync;
  if (!sync || sync.phase === "DISABLED") {
    return { text: "동기화 꺼짐", tone: "neutral" };
  }
  switch (sync.phase) {
    case "SYNCING":
      return { text: "동기화 중", tone: "busy" };
    case "OFFLINE":
      return { text: "오프라인 · 변경사항 저장됨", tone: "neutral" };
    case "ERROR":
      return { text: "동기화 대기 · 다시 시도 예정", tone: "neutral" };
    case "BLOCKED":
      return sync.block?.reason === "AUTH"
        ? { text: "다시 로그인 필요", tone: "attention" }
        : { text: "동기화 확인 필요", tone: "attention" };
    default:
      if (sync.conflicts.length > 0) {
        return { text: "충돌 확인 필요", tone: "attention" };
      }
      if (sync.held.length > 0) {
        return { text: "동기화 확인 필요", tone: "attention" };
      }
      if (sync.dirty) return { text: "동기화 대기", tone: "neutral" };
      return { text: "동기화됨", tone: "ok" };
  }
}

export const AUTH_ERROR_COPY: Record<AuthErrorKind, string> = {
  INVALID_EMAIL: "이메일 주소를 다시 확인해 주세요.",
  INVALID_CODE: "코드가 맞지 않거나 만료됐어요. 새 코드를 받아 주세요.",
  RATE_LIMITED: "요청이 너무 잦아요. 잠시 후 다시 시도해 주세요.",
  NETWORK: "인터넷에 연결되지 않았어요. 연결을 확인해 주세요.",
  UNKNOWN: "로그인하지 못했어요. 잠시 후 다시 시도해 주세요.",
};

export function formatTime(value: string | null): string {
  if (!value) return "아직 없음";
  const time = Date.parse(value);
  return Number.isNaN(time)
    ? "알 수 없음"
    : new Date(time).toLocaleString("ko-KR");
}

export function describePreview(
  preview: Extract<EnablePreview, { kind: "READY" }>,
): string {
  switch (preview.case) {
    case "NOTHING":
      return "이 기기와 클라우드 모두 아직 기록이 없어요.";
    case "UPLOAD":
      return `클라우드가 비어 있어요. 이 기기의 기록 ${preview.uploads}건을 올려요.`;
    case "DOWNLOAD":
      return `클라우드의 기록 ${preview.downloads}건을 이 기기로 가져와요.`;
    case "MERGE":
      return `양쪽 기록을 합쳐요. 가져올 기록 ${preview.downloads}건, 올릴 기록 ${preview.uploads}건${
        preview.conflicts ? `, 직접 골라야 할 충돌 ${preview.conflicts}건` : ""
      }. 어느 쪽도 통째로 덮어쓰지 않아요.`;
  }
}

/**
 * Human context for a record in a conflict: dates and kinds, never raw JSON.
 * Shown to the account owner only; never logged.
 */
export function describeRecord(
  collection: SyncCollection,
  record: SyncRecord | null,
): string {
  if (!record) return "기록 없음";
  const deleted =
    "deletedAt" in record && record.deletedAt !== null ? " · 삭제됨" : "";
  switch (collection) {
    case "events": {
      const event = record as UserData["events"][number];
      const range =
        event.endDate === event.startDate
          ? event.startDate
          : `${event.startDate}~${event.endDate}`;
      const note = event.note?.trim()
        ? ` · 메모 "${truncate(event.note.trim(), 30)}"`
        : "";
      return `${range} ${SERVICE_EVENT_TYPE_LABELS[event.eventType]}${note}${deleted}`;
    }
    case "leaveAdjustments": {
      const item = record as UserData["leaveAdjustments"][number];
      const kind =
        item.kind === "GRANT_CONFIRMATION" ? "연가 부여 확인" : "연가 보정";
      return `${item.effectiveDate} ${kind} · 반일 ${item.amountHalfDays} · ${item.amountMinutes}분${deleted}`;
    }
    case "attendanceMonths": {
      const item = record as UserData["attendanceMonths"][number];
      return `${item.month} 근무일 확인 · 비근무일 ${item.nonWorkingDates.length}일${deleted}`;
    }
    case "compensationSnapshots": {
      const item = record as UserData["compensationSnapshots"][number];
      return `${item.month} 보수 계산 기록${deleted}`;
    }
    case "leaveSnapshots": {
      const item = record as UserData["leaveSnapshots"][number];
      return `${item.asOfDate ?? "날짜 없음"} 기관 잔액 기록${deleted}`;
    }
    case "imports": {
      const item = record as UserData["imports"][number];
      return `가져오기 "${truncate(item.fileName, 30)}" · ${
        item.status === "ACTIVE" ? "적용 중" : "취소됨"
      }`;
    }
    case "profile": {
      const item = record as NonNullable<UserData["profile"]>;
      return `소집일 ${item.callUpDate} · 소집해제 예정 ${item.expectedDischargeDate}`;
    }
  }
}

function truncate(text: string, length: number) {
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

export function conflictSides(conflict: SyncConflict) {
  return {
    local: describeRecord(conflict.collection, conflict.localRecord),
    cloud: describeRecord(conflict.collection, conflict.cloudRecord),
  };
}

export const HELD_REASON_COPY: Record<RejectReason, string> = {
  LEAVE_OVERLAP: "이 기기의 다른 휴가와 날짜·시간이 겹쳐요.",
  CREDIT_ALREADY_CONFIRMED: "이 기기에 같은 연가 부여 확인값이 이미 있어요.",
  MONTH_ALREADY_CONFIRMED: "이 기기에 같은 달 근무일 확인이 이미 있어요.",
  BATCH_RECORDS_UNAVAILABLE: "함께 가져온 기록이 이 기기에 없어요.",
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
