import type {
  BackupErrorKind,
  ConflictResolution,
  MergeConflict,
  OutcomeCounts,
  ProfileCompatibility,
  RecordOutcome,
  RestoreFailureCode,
  RestorePlan,
  SyncCollection,
} from "@super-gongik/domain";

export const COLLECTION_LABELS: Record<SyncCollection, string> = {
  profile: "복무 프로필",
  events: "복무 기록",
  leaveAdjustments: "연가 보정·확인",
  leaveSnapshots: "기관 잔액 기록",
  imports: "가져오기 이력",
  attendanceMonths: "월 근무일 확인",
  compensationSnapshots: "보수 계산 기록",
};

/** Display order and wording; outcomes not listed are not shown. */
const OUTCOME_COPY: Array<[RecordOutcome, string]> = [
  ["ADDED", "추가"],
  ["UPDATED", "갱신"],
  ["RESTORED", "되살림"],
  ["RESOLVED_INCOMING", "백업 값 사용"],
  ["RESOLVED_LOCAL", "이 기기 값 유지"],
  ["REPLACED", "백업 내용으로 바뀜"],
  ["DELETED", "삭제됨"],
  ["REMOVED", "사라짐"],
  ["CONFLICT", "충돌"],
  ["DUPLICATE", "중복이라 건너뜀"],
  ["REJECTED", "겹쳐서 건너뜀"],
  ["LOCAL_DELETION_KEPT", "이 기기에서 지운 상태 유지"],
  ["INCOMING_DELETION_NOT_APPLIED", "백업의 삭제는 적용 안 함"],
  ["ADDED_HISTORY", "삭제 이력 추가"],
  ["HISTORY_UPDATED", "삭제 이력 갱신"],
  ["UNCHANGED", "같음"],
  ["RETAINED_LOCAL", "이 기기 기록 유지"],
];

export function describeCounts(counts: OutcomeCounts): string {
  const parts = OUTCOME_COPY.filter(
    ([outcome]) => (counts[outcome] ?? 0) > 0,
  ).map(([outcome, label]) => `${label} ${counts[outcome]}`);
  return parts.length ? parts.join(" · ") : "변화 없음";
}

export function totalOf(plan: RestorePlan, outcomes: RecordOutcome[]): number {
  return Object.values(plan.counts).reduce(
    (sum, counts) =>
      sum +
      outcomes.reduce((inner, outcome) => inner + (counts[outcome] ?? 0), 0),
    0,
  );
}

export const PROFILE_COPY: Record<ProfileCompatibility, string> = {
  SAME_PROFILE: "이 기기와 같은 복무 프로필",
  NO_LOCAL_PROFILE: "이 기기에는 아직 프로필이 없음",
  DIFFERENT_PROFILE: "다른 복무 프로필 (합치기 불가, 덮어쓰기만 가능)",
  NO_BACKUP_PROFILE: "백업에 프로필 없음 (합치기 불가)",
};

export function parseErrorTitle(kind: BackupErrorKind): string {
  switch (kind) {
    case "TRUNCATED":
    case "INTEGRITY_MISMATCH":
      return "백업 파일이 손상됐어요.";
    case "NEWER_SCHEMA":
    case "UNSUPPORTED_FORMAT_VERSION":
      return "앱 업데이트가 필요한 백업이에요.";
    default:
      return "복원할 수 없는 파일이에요.";
  }
}

export function restoreErrorTitle(code: RestoreFailureCode): string {
  switch (code) {
    case "STORAGE_WRITE_FAILED":
      return "기기에 저장하지 못했어요.";
    case "PRESERVE_FAILED":
      return "안전 사본을 만들지 못해 멈췄어요.";
    case "STALE_PREVIEW":
      return "다시 확인이 필요해요.";
    default:
      return "복원하지 않았어요.";
  }
}

export const CONFLICT_TYPE_COPY: Record<MergeConflict["type"], string> = {
  EQUAL_VERSION_DIVERGENT: "같은 버전인데 내용이 달라요.",
  CROSS_DEVICE_DIVERGENT:
    "양쪽에서 따로 고쳐졌어요. 어느 쪽이 다른 쪽을 보고 고쳤는지 증명할 기록이 없어요.",
  IMMUTABLE_RECORD_DIVERGENT:
    "한 번 저장되면 바뀌지 않는 기록인데 내용이 달라요.",
  UNVERSIONED_DIVERGENT:
    "버전 정보가 없는 기록이라 어느 쪽이 나중인지 알 수 없어요.",
};

export function describeVersion(side: MergeConflict["local"]): string {
  const parts = [
    side.revision === null ? "버전 정보 없음" : `버전 ${side.revision}`,
    side.updatedAt
      ? `${new Date(side.updatedAt).toLocaleString("ko-KR")} 수정`
      : null,
    side.deleted ? "삭제됨" : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

export type RestoreGate =
  { enabled: true } | { enabled: false; reason: string };

/**
 * Whether the confirm button may be pressed. The domain enforces the same
 * rules again in `executeRestore`; this only keeps the UI honest.
 */
export function restoreGate(
  plan: RestorePlan,
  input: {
    resolutions: Readonly<Record<string, ConflictResolution>>;
    destructiveConfirmed: boolean;
  },
): RestoreGate {
  if (plan.mode === "MERGE") {
    if (plan.blocked && plan.blocked.reason !== "UNRESOLVED_CONFLICTS") {
      return { enabled: false, reason: plan.blocked.message };
    }
    // A plan computed with resolutions lists only the conflicts still open.
    const open = plan.conflicts.filter(
      (conflict) => !input.resolutions[conflict.key],
    );
    if (open.length > 0) {
      return {
        enabled: false,
        reason: `어느 쪽을 남길지 아직 고르지 않은 충돌이 ${open.length}건 있어요.`,
      };
    }
    return { enabled: true };
  }
  if (plan.requiresDestructiveConfirmation && !input.destructiveConfirmed) {
    return {
      enabled: false,
      reason: "덮어쓰기 전에 아래 확인란을 직접 체크해 주세요.",
    };
  }
  return { enabled: true };
}
