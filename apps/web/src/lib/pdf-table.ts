import {
  assessTableHeaders,
  classifyEventType,
  makeUniqueHeaders,
  parseDateCell,
  parseDurationMinutes,
  type TabularAdapterResult,
  type TabularRow,
} from "@super-gongik/importer";

/**
 * Positioned PDF text → a records table. Pure (no pdf.js, no DOM) so the web
 * app and the native iOS core share it: the web feeds it pdf.js text items,
 * iOS feeds it PDFKit lines.
 */
export interface PositionedPdfText {
  page: number;
  x: number;
  y: number;
  text: string;
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
    /^(토요일|일요일|주말|휴무|휴무일|비번|정상근무|정상출근|근무|근무편성)$/.test(
      normalized,
    ) ||
    /(공휴일|대체공휴일|임시공휴일|국경일)$/.test(normalized) ||
    /^(신정|설날|삼일절|어린이날|부처님오신날|현충일|광복절|개천절|한글날|추석|추석연휴|설날연휴|성탄절|크리스마스|노동절|근로자의날|지방선거|선거일|제헌절)$/.test(
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
