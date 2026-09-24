# SUPER GONGIK Service Record Import Engine

## Goal

Allow users to import institution-provided service/attendance records and reconstruct leave usage without manually re-entering every event.

The importer is not allowed to silently convert uncertain administrative data into canonical service records. The workflow is:

```text
file -> parse -> map columns -> normalize -> classify -> validate
     -> preview -> user confirmation -> service_event commit
```

## Principles

1. Local-first parsing where browser capabilities allow it.
2. Deterministic parsing before AI.
3. AI, if added later, is a fallback classifier only for unresolved labels or structures.
4. No guessed policy values. A `반가` label (or `0.5일` of annual leave) becomes the rule-backed HALF_DAY unit — two halves equal one day — and is never converted to 240 minutes. Bare numbers such as `4` are only read when the header states the unit (`(분)`, `(시간)`, `일수`). Mixed rows such as `1일 4시간` are refused and must be split.
5. Imported events use the canonical `ServiceEvent` model. `candidateToImportDraft` produces the draft; the domain command `commitImport` writes it, using the same `planImportRows` decision (new / duplicate import / duplicate content / conflict) that the preview shows.
6. Every imported event carries batch and source metadata for audit and rollback.
7. Duplicate imports are detected with deterministic event fingerprints and, when available, the source file SHA-256.
8. Aggregate leave balances without dated event history are stored as snapshots/reconciliation evidence, never expanded into fake events.

## Package

`packages/importer`

The package is intentionally dependency-light and independent of React/UI code.

### Current core

- delimited-text/CSV parser
- Korean/English header synonym mapping
- date parsing
- explicit hour/minute parsing
- common service-event label classification
- confidence and warning model
- SHA-256 event fingerprint
- import preview model
- duplicate-safe commit plan
- import-batch rollback selection
- generic `ImportFileAdapter` contract

### Adapters

Adapters return the same normalized table contract:

```ts
interface TabularAdapterResult {
  format: "CSV" | "XLSX" | "PDF_TEXT" | "PDF_OCR" | "UNKNOWN";
  headers: string[];
  rows: Record<string, unknown>[];
}
```

Planned adapters:

- CSV / TSV: local browser parse
- XLSX / XLS: workbook parser in the browser when feasible
- text PDF: local text/table extraction when feasible
- scanned PDF: explicit OCR path, with a privacy notice before any server-assisted processing

## Column mapping

Examples of supported source labels:

- `사용일자`, `날짜`, `복무일` -> `date`
- `복무상황`, `근태`, `휴가종류` -> `eventType`
- `사용시간`, `차감시간`, `휴가시간` -> `duration`
- `비고`, `사유`, `메모` -> `note`
- `총부여`, `사용일수`, `잔여일수` -> leave snapshot fields

Mappings are confidence-scored and must be shown in import preview UI when uncertain.

## Classification

Initial deterministic mappings include:

- 연가 / 연차 / 반가 -> `ANNUAL_LEAVE`
- 병가 -> `SICK_LEAVE`
- 공가 -> `OFFICIAL_LEAVE`
- 특별휴가 / 특휴 -> `SPECIAL_LEAVE`
- 청원휴가 / 경조휴가 -> `COMPASSIONATE_LEAVE`
- 외출 -> `OUTING`
- 지각 -> `LATE_ARRIVAL`
- 조퇴 -> `EARLY_LEAVE`
- 복무기본교육 / 직무교육 -> `EDUCATION`
- 훈련소 / 군사교육소집 -> `TRAINING`

Unknown labels remain unresolved. They are not coerced to a nearby category.

## Import metadata

Confirmed events should copy the commit-plan metadata into `service_event.metadata`:

```json
{
  "importBatchId": "...",
  "importSourceFormat": "CSV",
  "importSourceFileName": "복무기록.csv",
  "importFingerprint": "sha256...",
  "importConfidence": 1,
  "importSourceRowIndex": 12
}
```

This makes duplicate detection, audit display, and batch rollback possible without adding import-only columns to the canonical event table.

## Aggregate snapshots and reconciliation

A document may contain only:

```text
연가 총 28일 / 사용 8일 / 잔여 20일
```

That is evidence of a balance at a point in time, not evidence for eight specific dated leave events.

SUPER GONGIK must preserve it as a leave snapshot/reconciliation record and compare it against the event-derived ledger. If the two disagree, the UI should show the difference and request user reconciliation rather than silently rewriting history.

Day-based snapshot quantities must not be converted to minutes until the applicable unit/workday policy is known.

## Duplicate policy

Two safeguards are planned:

1. source-file SHA-256: detects the same file being imported again;
2. normalized event SHA-256: detects the same event arriving from another export/file.

The user should see how many rows are new, duplicated, and unresolved before committing.

## Rollback

A confirmed import is one batch. Undoing it soft-deletes only live `service_event` records whose metadata matches that `importBatchId`. It must not delete manually created events or events from other imports.

## Privacy

Source files can contain institution names, attendance data, names, medical references, and other personal information.

- Do not upload raw files by default.
- Parse locally whenever feasible.
- Do not persist raw source files unless a future opt-in feature explicitly requires it.
- OCR/server-assisted analysis requires a clear disclosure before transmission.
- Do not collect resident-registration numbers or detailed diagnoses.

## Status

Implemented: file picker and preview, column-mapping override, per-row type/date/minute corrections, CSV/TSV/XLSX/HWP/HWPX/text-PDF adapters, opt-in in-browser OCR, fingerprint and content duplicate protection (including against manual records), same-file warning, batch rollback, snapshot persistence and reconciliation.

A row that states only a start date and `N일` keeps `dayCount = N`; its end date is derived by skipping weekends and the preview says so.

Remaining:

1. Collect anonymized real institution exports as adapter fixtures.
2. Multi-sheet selection UI for workbooks with several candidate tables.
3. Optional fallback AI classification for unresolved rows only.
