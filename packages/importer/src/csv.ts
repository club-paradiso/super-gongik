import { assessTableHeaders, makeUniqueHeaders } from "./mapping";
import type { TabularAdapterResult, TabularRow } from "./types";

type ParsedRow = { sourceRowIndex: number; cells: string[] };

function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).slice(0, 30);
  const candidates = [",", "\t", ";"];

  return (
    candidates
      .map((delimiter) => {
        const counts = lines.map((line) => line.split(delimiter).length - 1);
        return {
          delimiter,
          max: Math.max(...counts, 0),
          lines: counts.filter((count) => count > 0).length,
          total: counts.reduce((sum, count) => sum + count, 0),
        };
      })
      .sort(
        (a, b) => b.max - a.max || b.lines - a.lines || b.total - a.total,
      )[0]?.delimiter ?? ","
  );
}

function parseRows(text: string, delimiter: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  let lineNumber = 1;
  let rowStartLine = 1;

  const finishRow = () => {
    row.push(value.trim());
    if (row.some((cell) => cell.length > 0)) {
      rows.push({ sourceRowIndex: rowStartLine, cells: row });
    }
    row = [];
    value = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && char === delimiter) {
      row.push(value.trim());
      value = "";
      continue;
    }

    if (char === "\n" || char === "\r") {
      const crlf = char === "\r" && next === "\n";
      if (quoted) {
        value += "\n";
      } else {
        finishRow();
      }
      if (crlf) index += 1;
      lineNumber += 1;
      if (!quoted) rowStartLine = lineNumber;
      continue;
    }

    value += char;
  }

  finishRow();
  return rows;
}

export function parseDelimitedText(text: string): TabularAdapterResult {
  const normalized = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(normalized);
  const matrix = parseRows(normalized, delimiter);

  const candidates = matrix.slice(0, 30).flatMap((row, index) => {
    const headers = makeUniqueHeaders(row.cells);
    const assessment = assessTableHeaders(headers);
    return assessment.kind === "UNRECOGNIZED"
      ? []
      : [{ row, index, headers, assessment }];
  });

  const header = candidates.sort(
    (a, b) =>
      b.assessment.score - a.assessment.score ||
      a.row.sourceRowIndex - b.row.sourceRowIndex,
  )[0];

  if (!header) {
    throw new Error(
      "CSV/TSV에서 개인 복무기록 또는 휴가 잔액 표 머리글을 찾지 못했습니다.",
    );
  }

  const rows: TabularRow[] = [];
  const rowSourceIndexes: number[] = [];
  for (const source of matrix.slice(header.index + 1)) {
    const record: TabularRow = {};
    let populated = false;
    header.headers.forEach((name, index) => {
      const value = source.cells[index] ?? "";
      record[name] = value;
      if (value.trim()) populated = true;
    });
    if (!populated) continue;
    rows.push(record);
    rowSourceIndexes.push(source.sourceRowIndex);
  }

  return {
    format: "CSV",
    headers: header.headers,
    rows,
    rowSourceIndexes,
    sourceLabel: `CSV/TSV · 머리글 ${header.row.sourceRowIndex}행`,
  };
}
