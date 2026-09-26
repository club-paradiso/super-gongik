import {
  assessTableHeaders,
  classifyEventType,
  makeUniqueHeaders,
  parseDateCell,
  parseDelimitedText,
  parseDurationMinutes,
  type ImportSourceFormat,
  type TabularAdapterResult,
  type TabularCell,
  type TabularRow,
} from "@super-gongik/importer";
import type { Cell, Worksheet } from "exceljs";

export interface ParsedImportFile {
  tabular: TabularAdapterResult;
  fileSha256: string;
}

export interface PositionedPdfText {
  page: number;
  x: number;
  y: number;
  text: string;
}

export interface OcrProgress {
  page: number;
  totalPages: number;
  progress: number;
  status: string;
}

export interface ParseImportFileOptions {
  allowPdfOcr?: boolean;
  onOcrProgress?: (progress: OcrProgress) => void;
  xlsxWorksheetName?: string;
}

export interface XlsxWorksheetCandidate {
  worksheetName: string;
  headerRow: number;
  kind: "EVENTS" | "SNAPSHOT";
}

export class XlsxWorksheetSelectionRequiredError extends Error {
  readonly candidates: XlsxWorksheetCandidate[];

  constructor(candidates: XlsxWorksheetCandidate[]) {
    super(
      "가져올 수 있는 엑셀 시트가 여러 개라 자동으로 선택하지 않았습니다. 사용할 시트를 직접 골라 주세요.",
    );
    this.name = "XlsxWorksheetSelectionRequiredError";
    this.candidates = candidates;
  }
}

export class PdfOcrRequiredError extends Error {
  constructor() {
    super(
      "선택 가능한 텍스트가 없는 스캔 PDF입니다. 브라우저 OCR을 사용하려면 별도로 동의해 주세요.",
    );
    this.name = "PdfOcrRequiredError";
  }
}

function fileExtension(name: string) {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

export function formatFromFile(
  file: Pick<File, "name" | "type">,
): ImportSourceFormat {
  const extension = fileExtension(file.name);
  if (extension === "csv" || extension === "tsv") return "CSV";
  if (extension === "xlsx") return "XLSX";
  if (extension === "hwp") return "HWP";
  if (extension === "hwpx") return "HWPX";
  if (extension === "pdf" || file.type === "application/pdf") return "PDF_TEXT";
  return "UNKNOWN";
}

async function sha256File(file: Blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function cellText(value: TabularCell) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    // Spreadsheet dates are civil dates exposed at UTC midnight.
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value).trim();
}

function excelCellValue(cell: Cell): TabularCell {
  if (cell.value instanceof Date) return cell.value;
  if (typeof cell.value === "boolean") return cell.value;
  return cell.text.trim();
}

function worksheetRows(worksheet: Worksheet) {
  const rows: Array<{ rowNumber: number; values: TabularCell[] }> = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const width = Math.max(row.cellCount, row.actualCellCount);
    const values = Array.from({ length: width }, (_, index) =>
      excelCellValue(row.getCell(index + 1)),
    );
    if (values.some((value) => cellText(value))) {
      rows.push({ rowNumber, values });
    }
  });
  return rows;
}

type ExcelTableCandidate = {
  worksheet: Worksheet;
  rows: ReturnType<typeof worksheetRows>;
  headerIndex: number;
  headerRow: number;
  headers: string[];
  kind: "EVENTS" | "SNAPSHOT";
  score: number;
};

function findExcelTableCandidates(
  worksheets: Worksheet[],
): ExcelTableCandidate[] {
  const candidates: ExcelTableCandidate[] = [];

  for (const worksheet of worksheets) {
    if (worksheet.state && worksheet.state !== "visible") continue;
    const rows = worksheetRows(worksheet);
    let best: ExcelTableCandidate | null = null;

    rows.slice(0, 30).forEach((row, headerIndex) => {
      const headers = makeUniqueHeaders(row.values.map(cellText));
      const assessment = assessTableHeaders(headers);
      if (assessment.kind === "UNRECOGNIZED") return;

      const candidate: ExcelTableCandidate = {
        worksheet,
        rows,
        headerIndex,
        headerRow: row.rowNumber,
        headers,
        kind: assessment.kind,
        score: assessment.score,
      };
      if (
        !best ||
        candidate.score > best.score ||
        (candidate.score === best.score && candidate.headerRow < best.headerRow)
      ) {
        best = candidate;
      }
    });

    if (best) candidates.push(best);
  }

  return candidates.sort(
    (a, b) =>
      b.score - a.score ||
      a.worksheet.name.localeCompare(b.worksheet.name, "ko"),
  );
}

function isRepeatedExcelHeader(
  values: TabularCell[],
  headerValues: TabularCell[],
): boolean {
  const width = Math.max(values.length, headerValues.length);
  let meaningful = 0;
  for (let index = 0; index < width; index += 1) {
    const value = cellText(values[index] ?? "");
    const header = cellText(headerValues[index] ?? "");
    if (value || header) meaningful += 1;
    if (value !== header) return false;
  }
  return meaningful >= 2;
}

export async function parseXlsxFile(
  file: File,
  worksheetName?: string,
): Promise<TabularAdapterResult> {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  const buffer = (await file.arrayBuffer()) as unknown as Parameters<
    typeof workbook.xlsx.load
  >[0];
  await workbook.xlsx.load(buffer);

  const candidates = findExcelTableCandidates(workbook.worksheets);
  if (candidates.length === 0) {
    throw new Error(
      "엑셀에서 개인 복무기록 또는 휴가 잔액 표 머리글을 찾지 못했습니다.",
    );
  }

  let table: ExcelTableCandidate | undefined;
  if (worksheetName) {
    table = candidates.find(
      (candidate) => candidate.worksheet.name === worksheetName,
    );
    if (!table) {
      throw new Error(
        `선택한 엑셀 시트 '${worksheetName}'에서 가져올 수 있는 표를 찾지 못했습니다.`,
      );
    }
  } else if (candidates.length === 1) {
    table = candidates[0];
  } else {
    throw new XlsxWorksheetSelectionRequiredError(
      candidates.map((candidate) => ({
        worksheetName: candidate.worksheet.name,
        headerRow: candidate.headerRow,
        kind: candidate.kind,
      })),
    );
  }

  const headerValues = table.rows[table.headerIndex]?.values ?? [];
  const rows: TabularRow[] = [];
  const rowSourceIndexes: number[] = [];

  for (const source of table.rows.slice(table.headerIndex + 1)) {
    if (isRepeatedExcelHeader(source.values, headerValues)) continue;

    const row: TabularRow = {};
    let populated = false;
    table.headers.forEach((header, index) => {
      const value = source.values[index] ?? "";
      row[header] = value;
      if (cellText(value)) populated = true;
    });
    if (!populated) continue;
    rows.push(row);
    rowSourceIndexes.push(source.rowNumber);
  }

  return {
    format: "XLSX",
    headers: table.headers,
    rows,
    rowSourceIndexes,
    sourceLabel: `${table.worksheet.name} · 머리글 ${table.headerRow}행`,
  };
}

function markdownCells(line: string) {
  const source = line.trim();
  if (!source.includes("|")) return null;
  return source
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((value) => value.replace(/\\\|/g, "|").trim());
}

function isMarkdownSeparator(cells: string[]) {
  return (
    cells.length > 0 &&
    cells.every((value) => /^:?-{3,}:?$/.test(value.replace(/\s+/g, "")))
  );
}

export function tabularFromMarkdownTables(
  markdown: string,
  format: "HWP" | "HWPX",
): TabularAdapterResult {
  const lines = markdown.split(/\r?\n/);
  let best:
    | {
        headers: string[];
        rows: TabularRow[];
        score: number;
      }
    | undefined;

  for (let index = 0; index < lines.length - 1; index += 1) {
    const headerCells = markdownCells(lines[index] ?? "");
    const separatorCells = markdownCells(lines[index + 1] ?? "");
    if (
      !headerCells ||
      !separatorCells ||
      !isMarkdownSeparator(separatorCells)
    ) {
      continue;
    }

    const headers = makeUniqueHeaders(headerCells);
    const assessment = assessTableHeaders(headers);
    if (assessment.kind === "UNRECOGNIZED") continue;
    const score = assessment.score;
    const rows: TabularRow[] = [];

    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const cells = markdownCells(lines[rowIndex] ?? "");
      if (!cells) break;
      if (isMarkdownSeparator(cells)) continue;
      const row: TabularRow = {};
      let populated = false;
      headers.forEach((header, cellIndex) => {
        const value = cells[cellIndex] ?? "";
        row[header] = value;
        if (value) populated = true;
      });
      if (populated) rows.push(row);
    }

    if (!best || score > best.score) {
      best = { headers, rows, score };
    }
  }

  if (!best) {
    throw new Error(
      "HWP/HWPX에서 개인 복무기록 또는 휴가 잔액 표를 찾지 못했습니다. 규정표나 안내문은 사용기록으로 임의 변환하지 않습니다.",
    );
  }

  return {
    format,
    headers: best.headers,
    rows: best.rows,
    sourceLabel: `${format} 문서 표`,
  };
}

export async function parseHwpFile(file: File): Promise<TabularAdapterResult> {
  const hwpxModule = await import("@ssabrojs/hwpxjs");
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const detected = hwpxModule.detectFormat(bytes);

  if (detected === "hwp") {
    const markdown = await hwpxModule.hwpToMarkdown(bytes);
    return tabularFromMarkdownTables(markdown, "HWP");
  }

  if (detected === "hwpx") {
    const reader = new hwpxModule.HwpxReader();
    await reader.loadFromArrayBuffer(buffer);
    const markdown = await reader.extractMarkdown();
    return tabularFromMarkdownTables(markdown, "HWPX");
  }

  throw new Error(
    "지원되는 HWP 5.x 또는 HWPX 문서가 아닙니다. 암호화·배포용 문서는 현재 가져올 수 없습니다.",
  );
}

interface PdfRow {
  page: number;
  y: number;
  cells: PositionedPdfText[];
}

function groupPdfRows(items: PositionedPdfText[]) {
  const rows: PdfRow[] = [];
  const sorted = [...items].sort(
    (a, b) => a.page - b.page || b.y - a.y || a.x - b.x,
  );

  for (const item of sorted) {
    const current = rows.find(
      (row) => row.page === item.page && Math.abs(row.y - item.y) <= 2.5,
    );
    if (current) {
      current.cells.push(item);
      current.y = (current.y + item.y) / 2;
    } else {
      rows.push({ page: item.page, y: item.y, cells: [item] });
    }
  }

  return rows
    .map((row) => ({
      ...row,
      cells: row.cells.sort((a, b) => a.x - b.x),
    }))
    .sort((a, b) => a.page - b.page || b.y - a.y);
}

function headerScore(row: PdfRow) {
  const headers = makeUniqueHeaders(row.cells.map((item) => item.text.trim()));
  return assessTableHeaders(headers).score;
}

function normalizePdfHeaderText(value: string) {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "");
}

function isRepeatedPdfHeader(row: PdfRow, headerCells: PositionedPdfText[]) {
  const headerLabels = new Set(
    headerCells.map((cell) => normalizePdfHeaderText(cell.text)),
  );
  const matches = row.cells.filter((cell) =>
    headerLabels.has(normalizePdfHeaderText(cell.text)),
  ).length;
  return matches >= Math.max(2, Math.ceil(headerCells.length * 0.6));
}

const PDF_WEEKDAY = /^\([월화수목금토일]\)$/;
const PDF_CONFIRMER = /^\[[^\]]+\]\.?$/;

/**
 * Daily service ledgers include calendar/status rows that are not personal
 * leave or attendance usage. They must not become unresolved import records
 * merely because they contain a date. Keep this deliberately conservative:
 * exact weekend/status labels and explicit public-holiday wording only.
 */
function isNonUsageDailyStatus(value: string) {
  const normalized = value.normalize("NFKC").replace(/\s+/g, "").trim();
  if (!normalized) return true;

  return (
    /^(토요일|일요일|주말|휴무|휴무일|비번|정상근무|정상출근|근무)$/.test(
      normalized,
    ) ||
    /(공휴일|대체공휴일|임시공휴일|국경일)$/.test(normalized) ||
    /^(신정|설날|삼일절|어린이날|부처님오신날|현충일|광복절|개천절|한글날|추석|성탄절|크리스마스)$/.test(
      normalized,
    )
  );
}

function isDailyServiceStatusHeader(row: PdfRow) {
  const merged = normalizePdfHeaderText(
    row.cells.map((cell) => cell.text).join(""),
  );
  return (
    merged.includes("날짜") &&
    merged.includes("복무상황") &&
    merged.includes("비고")
  );
}

function durationWindow(cells: PositionedPdfText[]) {
  for (let size = Math.min(3, cells.length); size >= 1; size -= 1) {
    for (let start = 0; start + size <= cells.length; start += 1) {
      const text = cells
        .slice(start, start + size)
        .map((cell) => cell.text)
        .join(" ")
        .trim();
      if (parseDurationMinutes(text) !== null) {
        return { start, end: start + size, text };
      }
    }
  }
  return null;
}

/**
 * Some official daily-service PDFs center their column headings while the row
 * contents are left-aligned. A midpoint-of-heading algorithm then puts the
 * event label into the date column (for example, "2026-04-27 (월) 연가") and
 * can also split a centered "비고" heading into separate glyph runs.
 *
 * For the recognizable 날짜 / 복무상황 / 비고 layout, reconstruct rows from
 * semantic tokens instead of guessing table borders. This path works for both
 * positioned PDF text and OCR output and deliberately keeps unknown labels for
 * preview rather than coercing them.
 */
function dailyServiceStatusTable(
  rows: PdfRow[],
  headerIndex: number,
): TabularAdapterResult | null {
  const header = rows[headerIndex];
  if (!header || !isDailyServiceStatusHeader(header)) return null;

  const tableRows: TabularRow[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    if (isDailyServiceStatusHeader(row)) continue;

    const dateIndex = row.cells.findIndex(
      (cell) => parseDateCell(cell.text) !== null,
    );
    if (dateIndex < 0) continue;

    const date = parseDateCell(row.cells[dateIndex]?.text ?? "");
    if (!date) continue;

    const remainder = row.cells.slice(dateIndex + 1);
    while (remainder[0] && PDF_WEEKDAY.test(remainder[0].text.trim())) {
      remainder.shift();
    }

    const duration = durationWindow(remainder);
    const withoutDuration = remainder.filter(
      (_cell, index) =>
        !duration || index < duration.start || index >= duration.end,
    );
    const confirmerIndex = withoutDuration.findIndex((cell) =>
      PDF_CONFIRMER.test(cell.text.trim()),
    );
    const eventCells =
      confirmerIndex >= 0
        ? withoutDuration.slice(0, confirmerIndex)
        : withoutDuration;
    const noteCells =
      confirmerIndex >= 0 ? withoutDuration.slice(confirmerIndex + 1) : [];

    const eventText = eventCells
      .map((cell) => cell.text.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    let noteText = noteCells
      .map((cell) => cell.text.trim())
      .filter(Boolean)
      .join(" ")
      .trim();

    const classification = classifyEventType(eventText);
    if (!noteText && eventText && !classification.eventType) {
      noteText = eventText;
    }

    // Public holidays, weekends and plain work/status rows are calendar facts,
    // not leave usage. Do not force the user to classify them by hand.
    if (!classification.eventType && isNonUsageDailyStatus(eventText)) {
      continue;
    }

    tableRows.push({
      날짜: date,
      복무상황: eventText,
      사용시간: duration?.text ?? "",
      비고: noteText,
    });
  }

  if (tableRows.length === 0) return null;
  return {
    format: "PDF_TEXT",
    headers: ["날짜", "복무상황", "사용시간", "비고"],
    rows: tableRows,
    sourceLabel: `PDF ${Math.max(...rows.map((row) => row.page), 1)}페이지 · 날짜/복무상황 표`,
  };
}

export function tabularFromPositionedPdfText(
  items: PositionedPdfText[],
): TabularAdapterResult {
  const rows = groupPdfRows(items);
  const dailyHeaderIndex = rows.findIndex(isDailyServiceStatusHeader);
  if (dailyHeaderIndex >= 0) {
    const daily = dailyServiceStatusTable(rows, dailyHeaderIndex);
    if (daily) return daily;
  }

  const header = rows
    .map((row, index) => ({ row, index, score: headerScore(row) }))
    .sort((a, b) => b.score - a.score)[0];

  if (!header || header.score <= 0) {
    throw new Error(
      "PDF에서 복무기록 표 구조를 찾지 못했습니다. 열 인식이 어려운 문서는 원본 형식을 확인해 주세요.",
    );
  }

  const headerCells = header.row.cells;
  const headers = makeUniqueHeaders(headerCells.map((cell) => cell.text));
  const anchors = headerCells.map((cell) => cell.x);
  const boundaries = anchors.slice(0, -1).map((x, index) => {
    const next = anchors[index + 1] ?? x;
    return (x + next) / 2;
  });

  const tableRows: TabularRow[] = [];
  for (const row of rows.slice(header.index + 1)) {
    if (isRepeatedPdfHeader(row, headerCells)) continue;
    const buckets = headers.map(() => [] as string[]);

    for (const item of row.cells) {
      let column = boundaries.findIndex((boundary) => item.x < boundary);
      if (column < 0) column = headers.length - 1;
      buckets[column]?.push(item.text.trim());
    }

    const result: TabularRow = {};
    let populated = false;
    headers.forEach((name, index) => {
      const value = (buckets[index] ?? []).filter(Boolean).join(" ").trim();
      result[name] = value;
      if (value) populated = true;
    });
    if (populated) tableRows.push(result);
  }

  return {
    format: "PDF_TEXT",
    headers,
    rows: tableRows,
    sourceLabel: `PDF ${Math.max(...items.map((item) => item.page), 1)}페이지`,
  };
}

async function loadPdf(file: File) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  if (!pdfjs.GlobalWorkerOptions.workerPort && typeof Worker !== "undefined") {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(
      new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url),
      { type: "module" },
    );
  }

  return pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  }).promise;
}

type PdfTextItemLike = {
  str?: string;
  transform?: ArrayLike<number>;
};

type PdfTextChunkLike = {
  items?: readonly PdfTextItemLike[];
};

type PdfTextReaderLike = {
  read(): Promise<{ done: boolean; value?: PdfTextChunkLike }>;
  releaseLock?: () => void;
};

type PdfTextStreamLike = {
  getReader(): PdfTextReaderLike;
};

type PdfTextPageLike = {
  streamTextContent(): PdfTextStreamLike;
};

/**
 * Safari 26.x does not expose ReadableStream's async iterator consistently.
 * pdf.js 6 implements getTextContent() with `for await...of`, which throws
 * "undefined is not a function (near '...t of e...')" on affected Safari
 * builds. Consume the exact same pdf.js stream through getReader(), which
 * Safari supports, and keep this browser quirk isolated from table parsing.
 */
export async function positionedFromPdfTextStream(
  page: PdfTextPageLike,
  pageNumber: number,
): Promise<PositionedPdfText[]> {
  const reader = page.streamTextContent().getReader();
  const positioned: PositionedPdfText[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      for (const item of value?.items ?? []) {
        if (typeof item.str !== "string" || !item.transform) continue;
        const text = item.str.trim();
        if (!text) continue;
        positioned.push({
          page: pageNumber,
          x: Number(item.transform[4] ?? 0),
          y: Number(item.transform[5] ?? 0),
          text,
        });
      }
    }
  } finally {
    reader.releaseLock?.();
  }

  return positioned;
}

export async function parsePdfFile(file: File): Promise<TabularAdapterResult> {
  const document = await loadPdf(file);
  const items: PositionedPdfText[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    items.push(...(await positionedFromPdfTextStream(page, pageNumber)));
  }

  if (items.length === 0) {
    throw new PdfOcrRequiredError();
  }

  return tabularFromPositionedPdfText(items);
}

type OcrBox = { x0: number; y0: number; x1: number; y1: number };
type OcrWord = { text?: string; bbox?: OcrBox };
type OcrLine = { words?: OcrWord[]; bbox?: OcrBox };
type OcrParagraph = { lines?: OcrLine[] };
type OcrBlock = { paragraphs?: OcrParagraph[] };

function positionedFromOcrBlocks(
  blocks: unknown,
  pageNumber: number,
  canvasHeight: number,
): PositionedPdfText[] {
  if (!Array.isArray(blocks)) return [];
  const positioned: PositionedPdfText[] = [];

  for (const block of blocks as OcrBlock[]) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const lineBox = line.bbox;
        const lineY = lineBox
          ? canvasHeight - (lineBox.y0 + lineBox.y1) / 2
          : null;
        for (const word of line.words ?? []) {
          const text = word.text?.trim();
          const box = word.bbox;
          if (!text || !box) continue;
          positioned.push({
            page: pageNumber,
            x: box.x0,
            y: lineY ?? canvasHeight - (box.y0 + box.y1) / 2,
            text,
          });
        }
      }
    }
  }

  return positioned;
}

export async function parsePdfOcrFile(
  file: File,
  onProgress?: (progress: OcrProgress) => void,
): Promise<TabularAdapterResult> {
  if (typeof document === "undefined") {
    throw new Error("OCR은 브라우저에서만 실행할 수 있습니다.");
  }

  const pdf = await loadPdf(file);
  const { createWorker } = await import("tesseract.js");
  let currentPage = 1;
  const worker = await createWorker(["kor", "eng"], 1, {
    logger: (message) => {
      onProgress?.({
        page: currentPage,
        totalPages: pdf.numPages,
        progress: message.progress ?? 0,
        status: message.status,
      });
    },
  });
  const positioned: PositionedPdfText[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      currentPage = pageNumber;
      onProgress?.({
        page: pageNumber,
        totalPages: pdf.numPages,
        progress: 0,
        status: "rendering page",
      });

      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("PDF OCR용 캔버스를 만들지 못했습니다.");

      await page.render({ canvas, viewport }).promise;
      const result = await worker.recognize(canvas, {}, { blocks: true });
      positioned.push(
        ...positionedFromOcrBlocks(
          result.data.blocks,
          pageNumber,
          canvas.height,
        ),
      );
    }
  } finally {
    await worker.terminate();
  }

  if (positioned.length === 0) {
    throw new Error("OCR에서 읽을 수 있는 텍스트를 찾지 못했습니다.");
  }

  const tabular = tabularFromPositionedPdfText(positioned);
  return {
    ...tabular,
    format: "PDF_OCR",
    sourceLabel: `OCR PDF ${pdf.numPages}페이지`,
  };
}

export async function parseImportFile(
  file: File,
  options: ParseImportFileOptions = {},
): Promise<ParsedImportFile> {
  const format = formatFromFile(file);
  let tabular: TabularAdapterResult;

  if (format === "CSV") {
    tabular = parseDelimitedText(await file.text());
  } else if (format === "XLSX") {
    tabular = await parseXlsxFile(file, options.xlsxWorksheetName);
  } else if (format === "HWP" || format === "HWPX") {
    tabular = await parseHwpFile(file);
  } else if (format === "PDF_TEXT") {
    try {
      tabular = await parsePdfFile(file);
    } catch (reason) {
      if (reason instanceof PdfOcrRequiredError && options.allowPdfOcr) {
        tabular = await parsePdfOcrFile(file, options.onOcrProgress);
      } else {
        throw reason;
      }
    }
  } else {
    throw new Error("CSV, TSV, XLSX, HWP, HWPX 또는 PDF 파일을 선택해 주세요.");
  }

  return {
    tabular,
    fileSha256: await sha256File(file),
  };
}
