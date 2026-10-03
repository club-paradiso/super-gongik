"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  LockKeyhole,
  RotateCcw,
  ScanText,
  Upload,
} from "lucide-react";
import { type ChangeEvent, useEffect, useState } from "react";

import {
  SERVICE_EVENT_TYPES,
  SERVICE_EVENT_TYPE_LABELS,
  commitImport,
  rollbackImport,
  type UserData,
  type UserDataStore,
} from "@super-gongik/domain";
import {
  BLOCKING_WARNING_CODES,
  buildImportPreview,
  createImportBatchDescriptor,
  type CanonicalColumn,
  type ColumnMapping,
  type ImportPreview,
  type ImportableServiceEventType,
  type TabularAdapterResult,
} from "@super-gongik/importer";

import { Button } from "@/components/ui/button";
import {
  parseImportFile,
  PdfOcrRequiredError,
  XlsxWorksheetSelectionRequiredError,
  type OcrProgress,
  type ParseImportFileOptions,
  type XlsxWorksheetCandidate,
} from "@/lib/file-import-adapters";
import {
  buildImportCommit,
  defaultAcceptedRows,
  defaultAcceptedSnapshots,
  describeImportSummary,
  rowStatuses as computeRowStatuses,
  type EventOverride,
  type RowStatus,
} from "@/lib/import-model";
const EVENT_OPTIONS = SERVICE_EVENT_TYPES.map((value) => ({
  value,
  label: SERVICE_EVENT_TYPE_LABELS[value],
}));

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
  const [pendingXlsxFile, setPendingXlsxFile] = useState<File | null>(null);
  const [xlsxCandidates, setXlsxCandidates] = useState<
    XlsxWorksheetCandidate[]
  >([]);
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);
  const [rowStatuses, setRowStatuses] = useState<Map<number, RowStatus>>(
    new Map(),
  );

  useEffect(() => {
    let cancelled = false;
    if (!preview) return;
    void Promise.resolve(computeRowStatuses(data, preview)).then((statuses) => {
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
    setPendingXlsxFile(null);
    setXlsxCandidates([]);
    setOcrProgress(null);
  }

  async function applyPreview(
    nextTabular: TabularAdapterResult,
    nextPreview: ImportPreview,
  ) {
    const statuses = computeRowStatuses(data, nextPreview);
    setRowStatuses(statuses);
    setTabular(nextTabular);
    setPreview(nextPreview);
    setOverrides({});
    setPendingOcrFile(null);
    setPendingXlsxFile(null);
    setXlsxCandidates([]);
    setOcrProgress(null);
    setAcceptedRows(defaultAcceptedRows(nextPreview, statuses));
    setAcceptedSnapshots(defaultAcceptedSnapshots(nextPreview));
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
      if (reason instanceof XlsxWorksheetSelectionRequiredError) {
        setPendingXlsxFile(file);
        setXlsxCandidates(reason.candidates);
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

  async function runXlsxSelection(worksheetName: string) {
    if (!pendingXlsxFile) return;
    const file = pendingXlsxFile;
    setStatus("PARSING");
    setError("");
    setMessage("");

    try {
      await parseAndPreview(file, { xlsxWorksheetName: worksheetName });
    } catch (reason) {
      setStatus("IDLE");
      setError(
        reason instanceof Error
          ? reason.message
          : "선택한 엑셀 시트를 분석하지 못했습니다.",
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

  async function commit() {
    if (!preview) return;
    setError("");

    const { input, rejected } = await buildImportCommit(
      preview,
      overrides,
      acceptedRows,
      acceptedSnapshots,
    );

    const result = await store.run((current, context) =>
      commitImport(current, input, context),
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

    const text = describeImportSummary(result.value, rejected.length);
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
      <div className="panel-head">
        <div>
          <h3 id="record-import-title">복무기록 가져오기</h3>
          <p>
            기관에서 받은 파일을 기기 안에서 분석해 휴가 기록으로 복원합니다.
          </p>
        </div>
        <span className="panel-head__icon" aria-hidden="true">
          <Upload size={20} />
        </span>
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

      <p className="record-import__privacy">
        <LockKeyhole aria-hidden="true" size={15} />
        <span>
          CSV, XLSX, HWP, HWPX, 텍스트 PDF는 브라우저 안에서 처리합니다. 스캔
          PDF도 동의 후 브라우저 OCR을 사용하며 원본 파일이나 페이지 이미지는
          서버에 업로드하지 않습니다.
        </span>
      </p>

      {pendingXlsxFile && xlsxCandidates.length ? (
        <div className="ocr-consent" role="group" aria-label="엑셀 시트 선택">
          <FileSpreadsheet aria-hidden="true" size={24} />
          <div>
            <strong>가져올 엑셀 시트를 선택하세요.</strong>
            <p>
              개인 복무기록 또는 휴가 잔액 표로 보이는 시트가 여러 개라 앱이
              임의로 하나를 고르지 않았어요.
            </p>
            <div className="ocr-consent__actions">
              <Button
                variant="outline"
                disabled={status === "PARSING"}
                onClick={resetPreview}
              >
                취소
              </Button>
              {xlsxCandidates.map((candidate) => (
                <Button
                  key={candidate.worksheetName}
                  disabled={status === "PARSING"}
                  onClick={() => void runXlsxSelection(candidate.worksheetName)}
                >
                  {candidate.worksheetName} ·{" "}
                  {candidate.kind === "EVENTS" ? "복무기록" : "휴가 잔액"} ·
                  머리글 {candidate.headerRow}행
                </Button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

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
              {tabular.sourceLabel ? (
                <small className="field-hint">{tabular.sourceLabel}</small>
              ) : null}
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
                      (status && (status.decision !== "NEW" || status.message))
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
              <h4>기관이 기록한 휴가 잔액</h4>
              {preview.snapshots.map((snapshot) => {
                const blocked =
                  !snapshot.leaveType ||
                  snapshot.warnings.some((warning) =>
                    BLOCKING_WARNING_CODES.includes(warning.code),
                  );
                return (
                  <label key={snapshot.sourceRowIndex}>
                    <input
                      checked={acceptedSnapshots.has(snapshot.sourceRowIndex)}
                      disabled={blocked}
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
                    {snapshot.warnings[0] ? (
                      <small className="field-hint">
                        {snapshot.warnings[0].message}
                      </small>
                    ) : null}
                  </label>
                );
              })}
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
          <h4>가져오기 기록</h4>
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
