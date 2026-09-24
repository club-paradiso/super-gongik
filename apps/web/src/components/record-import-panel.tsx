"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  RotateCcw,
  ScanText,
  Upload,
} from "lucide-react";
import { type ChangeEvent, useEffect, useState } from "react";

import {
  SERVICE_EVENT_TYPES,
  SERVICE_EVENT_TYPE_LABELS,
  commitImport,
  planImportRows,
  rollbackImport,
  type ImportRowDecision,
  type UserData,
  type UserDataStore,
} from "@super-gongik/domain";
import {
  BLOCKING_WARNING_CODES,
  buildImportDrafts,
  buildImportPreview,
  createImportBatchDescriptor,
  fingerprintEventCandidate,
  type CanonicalColumn,
  type ColumnMapping,
  type ImportPreview,
  type ImportableServiceEventType,
  type ServiceEventCandidate,
  type TabularAdapterResult,
} from "@super-gongik/importer";

import { Button } from "@/components/ui/button";
import {
  parseImportFile,
  PdfOcrRequiredError,
  type OcrProgress,
  type ParseImportFileOptions,
} from "@/lib/file-import-adapters";
const EVENT_OPTIONS = SERVICE_EVENT_TYPES.map((value) => ({
  value,
  label: SERVICE_EVENT_TYPE_LABELS[value],
}));

const DECISION_LABELS: Record<ImportRowDecision["status"], string> = {
  NEW: "",
  DUPLICATE_IMPORT: "이미 가져온 기록",
  DUPLICATE_CONTENT: "같은 기록이 이미 있음",
  CONFLICT: "기존 휴가와 겹침",
};

const COLUMN_OPTIONS: Array<{ value: CanonicalColumn; label: string }> = [
  { value: "date", label: "날짜" },
  { value: "eventType", label: "휴가/복무 종류" },
  { value: "duration", label: "사용 시간/일수" },
  { value: "startTime", label: "시작 시간" },
  { value: "endTime", label: "종료 시간" },
  { value: "note", label: "비고/사유" },
  { value: "granted", label: "총 부여" },
  { value: "used", label: "누적 사용" },
  { value: "remaining", label: "잔여" },
  { value: "asOfDate", label: "기준일" },
];

interface EventOverride {
  date?: string;
  eventType?: ImportableServiceEventType | "";
  durationMinutes?: string;
}

type RowStatus = {
  decision: ImportRowDecision["status"] | "UNRESOLVED";
  message: string | null;
};

async function statusesFor(
  data: UserData,
  preview: ImportPreview,
): Promise<Map<number, RowStatus>> {
  const all = new Set(preview.events.map((event) => event.sourceRowIndex));
  const { drafts, rejected } = buildImportDrafts(preview, all);
  const statuses = new Map<number, RowStatus>();
  for (const item of rejected) {
    statuses.set(item.sourceRowIndex, {
      decision: "UNRESOLVED",
      message: item.reason,
    });
  }
  for (const decision of planImportRows(data, drafts)) {
    statuses.set(decision.draft.source.sourceRowIndex, {
      decision: decision.status,
      message:
        decision.status === "CONFLICT"
          ? (decision.errors[0]?.message ?? null)
          : DECISION_LABELS[decision.status] || null,
    });
  }
  return statuses;
}

export function RecordImportPanel({
  data,
  store,
}: {
  data: UserData;
  store: UserDataStore;
}) {
  const imports = data.imports;
  const [status, setStatus] = useState<"IDLE" | "PARSING" | "PREVIEW">("IDLE");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [tabular, setTabular] = useState<TabularAdapterResult | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [acceptedRows, setAcceptedRows] = useState<Set<number>>(new Set());
  const [acceptedSnapshots, setAcceptedSnapshots] = useState<Set<number>>(
    new Set(),
  );
  const [overrides, setOverrides] = useState<Record<number, EventOverride>>({});
  const [pendingOcrFile, setPendingOcrFile] = useState<File | null>(null);
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);
  const [rowStatuses, setRowStatuses] = useState<Map<number, RowStatus>>(
    new Map(),
  );

  useEffect(() => {
    let cancelled = false;
    if (!preview) return;
    void statusesFor(data, preview).then((statuses) => {
      if (!cancelled) setRowStatuses(statuses);
    });
    return () => {
      cancelled = true;
    };
  }, [data, preview]);

  const duplicateCount = [...rowStatuses.values()].filter(
    (status) =>
      status.decision === "DUPLICATE_IMPORT" ||
      status.decision === "DUPLICATE_CONTENT",
  ).length;
  const previousImportOfFile = preview?.batch.fileSha256
    ? imports.find(
        (record) =>
          record.status === "ACTIVE" &&
          record.fileSha256 === preview.batch.fileSha256,
      )
    : undefined;

  function resetPreview() {
    setStatus("IDLE");
    setPreview(null);
    setTabular(null);
    setAcceptedRows(new Set());
    setAcceptedSnapshots(new Set());
    setOverrides({});
    setPendingOcrFile(null);
    setOcrProgress(null);
  }

  async function applyPreview(
    nextTabular: TabularAdapterResult,
    nextPreview: ImportPreview,
  ) {
    const statuses = await statusesFor(data, nextPreview);
    setRowStatuses(statuses);
    setTabular(nextTabular);
    setPreview(nextPreview);
    setOverrides({});
    setPendingOcrFile(null);
    setOcrProgress(null);
    setAcceptedRows(
      new Set(
        nextPreview.events
          .filter(
            (event) =>
              event.date &&
              event.eventType &&
              statuses.get(event.sourceRowIndex)?.decision === "NEW" &&
              !event.warnings.some((warning) =>
                BLOCKING_WARNING_CODES.includes(warning.code),
              ),
          )
          .map((event) => event.sourceRowIndex),
      ),
    );
    setAcceptedSnapshots(
      new Set(
        nextPreview.snapshots
          .filter(
            (snapshot) => snapshot.leaveType && snapshot.confidence >= 0.7,
          )
          .map((snapshot) => snapshot.sourceRowIndex),
      ),
    );
    setStatus("PREVIEW");
  }

  async function parseAndPreview(
    file: File,
    options: ParseImportFileOptions = {},
  ) {
    const parsed = await parseImportFile(file, options);
    const batch = createImportBatchDescriptor({
      fileName: file.name,
      sourceFormat: parsed.tabular.format,
      fileSha256: parsed.fileSha256,
    });
    await applyPreview(
      parsed.tabular,
      await buildImportPreview(parsed.tabular, batch),
    );
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    resetPreview();
    setStatus("PARSING");
    setError("");
    setMessage("");

    try {
      await parseAndPreview(file);
    } catch (reason) {
      setStatus("IDLE");
      setPreview(null);
      setTabular(null);
      if (reason instanceof PdfOcrRequiredError) {
        setPendingOcrFile(file);
        setError("");
        return;
      }
      setError(
        reason instanceof Error
          ? reason.message
          : "파일을 분석하지 못했습니다.",
      );
    }
  }

  async function runOcr() {
    if (!pendingOcrFile) return;
    const file = pendingOcrFile;
    setStatus("PARSING");
    setError("");
    setMessage("");
    setOcrProgress({ page: 1, totalPages: 1, progress: 0, status: "starting" });

    try {
      await parseAndPreview(file, {
        allowPdfOcr: true,
        onOcrProgress: setOcrProgress,
      });
    } catch (reason) {
      setStatus("IDLE");
      setOcrProgress(null);
      setError(
        reason instanceof Error ? reason.message : "OCR 분석에 실패했습니다.",
      );
    }
  }

  async function updateMapping(header: string, target: CanonicalColumn | "") {
    if (!tabular || !preview) return;
    const nextMappings: ColumnMapping[] = preview.mappings
      .filter((mapping) => mapping.sourceHeader !== header)
      .filter((mapping) => !target || mapping.target !== target);

    if (target) {
      nextMappings.push({ sourceHeader: header, target, confidence: 1 });
    }

    const rebuilt = await buildImportPreview(
      tabular,
      preview.batch,
      nextMappings,
    );
    await applyPreview(tabular, rebuilt);
  }

  function updateOverride(row: number, patch: EventOverride) {
    setOverrides((current) => ({
      ...current,
      [row]: { ...current[row], ...patch },
    }));
  }

  function toggleRow(row: number) {
    setAcceptedRows((current) => {
      const next = new Set(current);
      if (next.has(row)) next.delete(row);
      else next.add(row);
      return next;
    });
  }

  function toggleSnapshot(row: number) {
    setAcceptedSnapshots((current) => {
      const next = new Set(current);
      if (next.has(row)) next.delete(row);
      else next.add(row);
      return next;
    });
  }

  async function adjustedCandidate(
    candidate: ServiceEventCandidate,
  ): Promise<ServiceEventCandidate> {
    const override = overrides[candidate.sourceRowIndex];
    const durationInput = override?.durationMinutes?.trim();
    const hasDurationOverride = Boolean(durationInput);
    const durationMinutes = hasDurationOverride
      ? Number(durationInput)
      : candidate.durationMinutes;
    const validDurationMinutes =
      durationMinutes !== null &&
      durationMinutes !== undefined &&
      Number.isFinite(durationMinutes) &&
      durationMinutes >= 0
        ? durationMinutes
        : null;
    const adjusted: ServiceEventCandidate = {
      ...candidate,
      date: override?.date ?? candidate.date,
      eventType:
        override?.eventType === ""
          ? null
          : (override?.eventType ?? candidate.eventType),
      durationDays: hasDurationOverride ? null : candidate.durationDays,
      durationMinutes: validDurationMinutes,
      halfDay: hasDurationOverride ? false : candidate.halfDay,
      warnings: hasDurationOverride
        ? candidate.warnings.filter(
            (warning) => !BLOCKING_WARNING_CODES.includes(warning.code),
          )
        : candidate.warnings,
    };
    if (adjusted.eventType !== "ANNUAL_LEAVE") adjusted.halfDay = false;
    adjusted.allDay =
      !adjusted.halfDay &&
      ((adjusted.durationDays !== null &&
        Number.isInteger(adjusted.durationDays)) ||
        (adjusted.durationMinutes === null &&
          !adjusted.startTime &&
          !adjusted.endTime));
    adjusted.fingerprint =
      adjusted.date && adjusted.eventType
        ? await fingerprintEventCandidate(adjusted)
        : null;
    return adjusted;
  }

  async function commit() {
    if (!preview) return;
    setError("");

    const events = await Promise.all(
      preview.events.map((candidate) => adjustedCandidate(candidate)),
    );
    const adjustedPreview: ImportPreview = { ...preview, events };
    const { drafts, rejected } = buildImportDrafts(
      adjustedPreview,
      acceptedRows,
    );
    const snapshots = adjustedPreview.snapshots
      .filter((snapshot) => acceptedSnapshots.has(snapshot.sourceRowIndex))
      .map((snapshot) => ({
        leaveType: snapshot.leaveType,
        asOfDate: snapshot.asOfDate as `${number}-${number}-${number}` | null,
        grantedDays: snapshot.grantedDays,
        grantedMinutes: snapshot.grantedMinutes,
        usedDays: snapshot.usedDays,
        usedMinutes: snapshot.usedMinutes,
        remainingDays: snapshot.remainingDays,
        remainingMinutes: snapshot.remainingMinutes,
        confidence: snapshot.confidence,
        sourceRowIndex: snapshot.sourceRowIndex,
      }));

    const result = await store.run((current, context) =>
      commitImport(
        current,
        { batch: preview.batch, drafts, snapshots },
        context,
      ),
    );
    if (!result.ok) {
      setError(
        [
          result.errors[0]?.message ?? "가져오지 못했어요.",
          ...rejected.map(
            (item) => `행 ${item.sourceRowIndex}: ${item.reason}`,
          ),
        ].join(" "),
      );
      return;
    }

    const summary = result.value;
    const pieces = [`복무기록 ${summary.added}건`];
    if (summary.snapshots) pieces.push(`기관 잔액 ${summary.snapshots}건`);
    let text = `${pieces.join(", ")}을 저장했어요.`;
    if (summary.skippedDuplicates)
      text += ` 중복 ${summary.skippedDuplicates}건은 건너뛰었어요.`;
    if (summary.rejected || rejected.length) {
      text += ` 확인이 필요한 ${summary.rejected + rejected.length}건은 저장하지 않았어요.`;
    }
    setMessage(text);
    resetPreview();
  }

  async function rollback(batchId: string) {
    const result = await store.run((current, context) =>
      rollbackImport(current, batchId, context),
    );
    setMessage(
      result.ok
        ? `가져온 기록 ${result.value.removedEvents}건을 취소했어요. 직접 입력한 기록은 그대로예요.`
        : (result.errors[0]?.message ?? "취소하지 못했어요."),
    );
  }

  const parsingLabel = ocrProgress
    ? `OCR ${ocrProgress.page}/${ocrProgress.totalPages} · ${Math.round(ocrProgress.progress * 100)}%`
    : "파일 분석 중…";

  return (
    <section className="record-import" aria-labelledby="record-import-title">
      <div className="record-import__heading">
        <div>
          <h2 id="record-import-title">복무기록 가져오기</h2>
          <p>
            기관에서 받은 파일을 기기 안에서 분석해 휴가 기록으로 복원합니다.
          </p>
        </div>
        <Upload aria-hidden="true" size={24} />
      </div>

      <div className="record-import__privacy">
        CSV, XLSX, HWP, HWPX, 텍스트 PDF는 브라우저 안에서 처리합니다. 스캔
        PDF도 동의 후 브라우저 OCR을 사용하며 원본 파일이나 페이지 이미지는
        서버에 업로드하지 않습니다.
      </div>

      <label className="record-import__dropzone">
        <input
          accept=".csv,.tsv,.xlsx,.hwp,.hwpx,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/x-hwp,application/haansofthwp"
          disabled={status === "PARSING"}
          onChange={handleFile}
          type="file"
        />
        <span className="record-import__icons" aria-hidden="true">
          <FileSpreadsheet size={26} />
          <FileText size={26} />
        </span>
        <strong>
          {status === "PARSING"
            ? parsingLabel
            : "CSV · XLSX · HWP · HWPX · PDF 선택"}
        </strong>
        <small>
          개인 사용기록/잔액 표만 가져오며 규정표나 안내문은 임의로 휴가
          사용내역으로 만들지 않습니다.
        </small>
      </label>

      {pendingOcrFile ? (
        <div
          className="ocr-consent"
          role="group"
          aria-label="스캔 PDF OCR 동의"
        >
          <ScanText aria-hidden="true" size={24} />
          <div>
            <strong>스캔 PDF라서 OCR이 필요합니다.</strong>
            <p>
              한국어·영어 OCR 엔진과 언어 데이터는 네트워크에서 내려받을 수
              있지만, 선택한 PDF 원본과 렌더링된 페이지 이미지는 브라우저 밖으로
              보내지 않습니다.
            </p>
            {ocrProgress ? (
              <div className="ocr-consent__progress" role="status">
                <progress max={1} value={ocrProgress.progress} />
                <span>
                  {ocrProgress.page}/{ocrProgress.totalPages}페이지 ·{" "}
                  {Math.round(ocrProgress.progress * 100)}%
                </span>
              </div>
            ) : null}
            <div className="ocr-consent__actions">
              <Button
                variant="outline"
                disabled={status === "PARSING"}
                onClick={resetPreview}
              >
                취소
              </Button>
              <Button
                disabled={status === "PARSING"}
                onClick={() => void runOcr()}
              >
                브라우저 OCR로 분석
              </Button>
            </div>
          </div>
        </div>
      ) : null}

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

      {preview && tabular ? (
        <div className="import-preview">
          <div className="import-preview__summary">
            <CheckCircle2 aria-hidden="true" size={21} />
            <div>
              <strong>{preview.batch.fileName}</strong>
              <p>
                복무기록 {preview.events.length}건 · 기관 잔액{" "}
                {preview.snapshots.length}건
                {duplicateCount ? ` · 기존 중복 ${duplicateCount}건` : ""}
                {preview.unresolvedRowIndexes.length
                  ? ` · 확인 필요 ${preview.unresolvedRowIndexes.length}건`
                  : ""}
              </p>
            </div>
          </div>
          {previousImportOfFile ? (
            <p className="field-hint" role="note">
              이 파일은{" "}
              {new Date(previousImportOfFile.createdAt).toLocaleString("ko-KR")}
              에 이미 가져왔어요. 이미 있는 행은 자동으로 건너뛰어요.
            </p>
          ) : null}

          <details className="mapping-editor">
            <summary>열 인식 결과 확인</summary>
            <div className="mapping-editor__rows">
              {tabular.headers.map((header) => {
                const mapping = preview.mappings.find(
                  (item) => item.sourceHeader === header,
                );
                return (
                  <label key={header}>
                    <span>{header}</span>
                    <select
                      value={mapping?.target ?? ""}
                      onChange={(event) =>
                        void updateMapping(
                          header,
                          event.target.value as CanonicalColumn | "",
                        )
                      }
                    >
                      <option value="">무시</option>
                      {COLUMN_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          </details>

          {preview.events.length ? (
            <div className="import-event-list">
              {preview.events.map((candidate) => {
                const override = overrides[candidate.sourceRowIndex];
                const status = rowStatuses.get(candidate.sourceRowIndex);
                const duplicate =
                  status?.decision === "DUPLICATE_IMPORT" ||
                  status?.decision === "DUPLICATE_CONTENT";
                return (
                  <article
                    className={
                      candidate.warnings.length ||
                      (status && status.decision !== "NEW")
                        ? "import-event import-event--warning"
                        : "import-event"
                    }
                    key={candidate.sourceRowIndex}
                  >
                    <label className="import-event__check">
                      <input
                        checked={acceptedRows.has(candidate.sourceRowIndex)}
                        disabled={duplicate}
                        onChange={() => toggleRow(candidate.sourceRowIndex)}
                        type="checkbox"
                      />
                      <span>행 {candidate.sourceRowIndex}</span>
                    </label>
                    <input
                      aria-label={`행 ${candidate.sourceRowIndex} 날짜`}
                      type="date"
                      value={override?.date ?? candidate.date ?? ""}
                      onChange={(event) =>
                        updateOverride(candidate.sourceRowIndex, {
                          date: event.target.value,
                        })
                      }
                    />
                    <select
                      aria-label={`행 ${candidate.sourceRowIndex} 종류`}
                      value={override?.eventType ?? candidate.eventType ?? ""}
                      onChange={(event) =>
                        updateOverride(candidate.sourceRowIndex, {
                          eventType: event.target.value as
                            ImportableServiceEventType | "",
                        })
                      }
                    >
                      <option value="">종류 확인 필요</option>
                      {EVENT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`행 ${candidate.sourceRowIndex} 사용 분`}
                      inputMode="numeric"
                      min="0"
                      placeholder={
                        candidate.halfDay
                          ? "반일"
                          : candidate.durationDays !== null
                            ? `${candidate.durationDays}일`
                            : candidate.allDay
                              ? "종일"
                              : "사용 분"
                      }
                      type="number"
                      value={
                        override?.durationMinutes ??
                        candidate.durationMinutes?.toString() ??
                        ""
                      }
                      onChange={(event) =>
                        updateOverride(candidate.sourceRowIndex, {
                          durationMinutes: event.target.value,
                        })
                      }
                    />
                    <div className="import-event__meta">
                      {status?.message ? <span>{status.message}</span> : null}
                      {!status?.message && candidate.warnings.length ? (
                        <span>
                          <AlertTriangle aria-hidden="true" size={14} />
                          {candidate.warnings[0]?.message}
                        </span>
                      ) : null}
                      {candidate.durationDays !== null ? (
                        <small>원문 일수: {candidate.durationDays}일</small>
                      ) : null}
                      {candidate.note ? <small>{candidate.note}</small> : null}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}

          {preview.snapshots.length ? (
            <div className="snapshot-list">
              <h3>기관이 기록한 휴가 잔액</h3>
              {preview.snapshots.map((snapshot) => (
                <label key={snapshot.sourceRowIndex}>
                  <input
                    checked={acceptedSnapshots.has(snapshot.sourceRowIndex)}
                    onChange={() => toggleSnapshot(snapshot.sourceRowIndex)}
                    type="checkbox"
                  />
                  <span>행 {snapshot.sourceRowIndex}</span>
                  <strong>
                    잔여 {snapshot.remainingDays ?? "—"}일
                    {snapshot.remainingMinutes
                      ? ` ${Math.floor(snapshot.remainingMinutes / 60)}시간 ${snapshot.remainingMinutes % 60}분`
                      : ""}
                  </strong>
                </label>
              ))}
            </div>
          ) : null}

          <div className="import-preview__actions">
            <Button variant="outline" onClick={resetPreview}>
              취소
            </Button>
            <Button onClick={() => void commit()}>선택 기록 가져오기</Button>
          </div>
        </div>
      ) : null}

      {imports.length ? (
        <div className="import-history">
          <h3>가져오기 기록</h3>
          {imports.slice(0, 8).map((record) => (
            <article key={record.id}>
              <div>
                <strong>{record.fileName}</strong>
                <p>
                  {new Date(record.createdAt).toLocaleString("ko-KR")} · 기록{" "}
                  {record.eventCount}건
                  {record.snapshotCount
                    ? ` · 잔액 ${record.snapshotCount}건`
                    : ""}
                  {record.skippedDuplicateCount
                    ? ` · 중복 ${record.skippedDuplicateCount}건 제외`
                    : ""}
                </p>
              </div>
              {record.status === "ACTIVE" ? (
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        `${record.fileName}에서 가져온 기록만 취소할까요?`,
                      )
                    ) {
                      void rollback(record.id);
                    }
                  }}
                  type="button"
                >
                  <RotateCcw aria-hidden="true" size={15} />
                  취소
                </button>
              ) : (
                <span>취소됨</span>
              )}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
