import {
  SERVICE_EVENT_TYPE_LABELS,
  isLive,
  type ServiceEvent,
} from "../events/model";
import type { LedgerEntry } from "../leave/ledger";

/**
 * Cells starting with these characters are interpreted as formulas by
 * spreadsheet apps (CSV injection). Prefix them with an apostrophe.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && FORMULA_PREFIX.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(
  rows: ReadonlyArray<ReadonlyArray<string | number | null>>,
) {
  // BOM so that Excel opens UTF-8 Korean text correctly.
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function timingColumns(event: ServiceEvent) {
  const timing = event.timing;
  if (timing.kind === "ALL_DAY") {
    return ["종일", timing.dayCount, "", "", "", ""] as const;
  }
  if (timing.kind === "HALF_DAY") {
    return [
      "반일",
      "",
      timing.half === "AM" ? "오전" : timing.half === "PM" ? "오후" : "미상",
      "",
      "",
      "",
    ] as const;
  }
  return [
    "시간",
    "",
    "",
    timing.durationMinutes ?? "확인 필요",
    timing.startTime ?? "",
    timing.endTime ?? "",
  ] as const;
}

export function serviceEventsToCsv(events: readonly ServiceEvent[]): string {
  const header = [
    "시작일",
    "종료일",
    "종류",
    "단위",
    "차감일수",
    "반일구분",
    "사용분",
    "시작시각",
    "종료시각",
    "제목",
    "메모",
    "출처",
    "원본파일",
    "기록ID",
    "수정시각",
  ];
  const rows = events
    .filter(isLive)
    .slice()
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((event) => [
      event.startDate,
      event.endDate,
      SERVICE_EVENT_TYPE_LABELS[event.eventType],
      ...timingColumns(event),
      event.title,
      event.note,
      event.source.kind === "IMPORT" ? "파일 가져오기" : "직접 입력",
      event.source.kind === "IMPORT" ? event.source.fileName : "",
      event.id,
      event.updatedAt,
    ]);
  return toCsv([header, ...rows]);
}

export function leaveLedgerToCsv(entries: readonly LedgerEntry[]): string {
  const header = [
    "날짜",
    "구분",
    "내용",
    "변동(일)",
    "변동(분)",
    "누적 잔여(일)",
    "누적 잔여(분)",
    "예정",
  ];
  const kindLabel = {
    CREDIT: "부여",
    USAGE: "사용",
    CORRECTION: "보정",
  } as const;
  const rows = entries.map((entry) => [
    entry.date,
    kindLabel[entry.kind],
    entry.label,
    entry.delta.halfDays / 2,
    entry.delta.minutes,
    entry.running.halfDays / 2,
    entry.running.minutes,
    entry.scheduled ? "예정" : "",
  ]);
  return toCsv([header, ...rows]);
}
