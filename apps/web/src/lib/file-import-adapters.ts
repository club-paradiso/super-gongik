import {
  mapColumns,
  parseDelimitedText,
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

function uniqueHeaders(values: TabularCell[]) {
  const seen = new Map<string, number>();
  return values.map((value, index) => {
    const base = cellText(value) || `열 ${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
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

function chooseExcelTable(worksheets: Worksheet[]) {
  let best:
    | {
        worksheet: Worksheet;
        rows: ReturnType<typeof worksheetRows>;
        headerIndex: number;
        score: number;
      }
    | undefined;

  for (const worksheet of worksheets) {
    const rows = worksheetRows(worksheet);
    rows.slice(0, 30).forEach((row, headerIndex) => {
      const score = mapColumns(row.values.map(cellText)).length;
      if (!best || score > best.score) {
        best = { worksheet, rows, headerIndex, score };
      }
    });
  }

  return best;
}

export async function parseXlsxFile(file: File): Promise<TabularAdapterResult> {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  const buffer = (await file.arrayBuffer()) as unknown as Parameters<
    typeof workbook.xlsx.load
  >[0];
  await workbook.xlsx.load(buffer);

  const table = chooseExcelTable(workbook.worksheets);
  if (!table || table.score < 2) {
    throw new Error(
      "엑셀에서 날짜/휴가종류 등으로 보이는 표 머리글을 찾지 못했습니다.",
    );
  }

  const headerValues = table.rows[table.headerIndex]?.values ?? [];
  const headers = uniqueHeaders(headerValues);
  const rows: TabularRow[] = [];

  for (const source of table.rows.slice(table.headerIndex + 1)) {
    const row: TabularRow = {};
    let populated = false;
    headers.forEach((header, index) => {
      const value = source.values[index] ?? "";
      row[header] = value;
      if (cellText(value)) populated = true;
    });
    if (populated) rows.push(row);
  }

  return {
    format: "XLSX",
    headers,
    rows,
    sourceLabel: table.worksheet.name,
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

    const headers = uniqueHeaders(headerCells);
    const score = mapColumns(headers).length;
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

  if (!best || best.score < 2) {
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
  return mapColumns(row.cells.map((item) => item.text.trim())).length;
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

export function tabularFromPositionedPdfText(
  items: PositionedPdfText[],
): TabularAdapterResult {
  const rows = groupPdfRows(items);
  const header = rows
    .map((row, index) => ({ row, index, score: headerScore(row) }))
    .sort((a, b) => b.score - a.score)[0];

  if (!header || header.score < 2) {
    throw new Error(
      "PDF에서 복무기록 표 구조를 찾지 못했습니다. 열 인식이 어려운 문서는 원본 형식을 확인해 주세요.",
    );
  }

  const headerCells = header.row.cells;
  const headers = uniqueHeaders(headerCells.map((cell) => cell.text));
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

export async function parsePdfFile(file: File): Promise<TabularAdapterResult> {
  const document = await loadPdf(file);
  const items: PositionedPdfText[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!("str" in item) || !("transform" in item)) continue;
      const text = item.str.trim();
      if (!text) continue;
      items.push({
        page: pageNumber,
        x: item.transform[4] ?? 0,
        y: item.transform[5] ?? 0,
        text,
      });
    }
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
    tabular = await parseXlsxFile(file);
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
