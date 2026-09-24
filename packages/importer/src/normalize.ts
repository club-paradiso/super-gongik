import { classifyEventType } from "./classify";
import { findMappedHeader } from "./mapping";
import type {
  ColumnMapping,
  ImportWarning,
  ServiceEventCandidate,
  TabularCell,
  TabularRow,
} from "./types";

function cellToString(value: TabularCell): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

export function parseDateCell(value: TabularCell): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Spreadsheet serial dates are civil dates that parsers expose at UTC
    // midnight. Reading local getters would shift them a day west of UTC.
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  const source = cellToString(value).normalize("NFKC").trim();
  if (!source) return null;

  const compact = source.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    return validateDateParts(
      Number(compact[1]),
      Number(compact[2]),
      Number(compact[3]),
    );
  }

  const delimited = source.match(
    /^(\d{4})\s*(?:년|[-./])\s*(\d{1,2})\s*(?:월|[-./])\s*(\d{1,2})\s*일?$/,
  );
  if (delimited) {
    return validateDateParts(
      Number(delimited[1]),
      Number(delimited[2]),
      Number(delimited[3]),
    );
  }

  return null;
}

function validateDateParts(
  year: number,
  month: number,
  day: number,
): string | null {
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseClockTime(value: TabularCell): string | null {
  const source = cellToString(value).normalize("NFKC").trim();
  if (!source) return null;

  const match = source.match(/^(\d{1,2})(?::|시\s*)(\d{1,2})?\s*분?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function parseDayCount(value: TabularCell): number | null {
  const source = cellToString(value).normalize("NFKC").replace(/\s+/g, "");
  if (!source) return null;

  const dayMatch = source.match(/^(\d+(?:\.\d+)?)일(?:\d.*)?$/);
  if (!dayMatch) return null;
  const days = Number(dayMatch[1]);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

export type HeaderUnit = "DAY" | "HOUR" | "MINUTE" | null;

/**
 * Unit stated by a column header, e.g. `사용일수`, `사용시간(분)`, `hours`.
 * A plain `사용시간` is ambiguous (it means "time used") and yields null.
 */
export function unitFromHeader(header: string | null): HeaderUnit {
  if (!header) return null;
  const source = header.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  if (/\(분\)|\[분\]|분$|minutes?$|\(min\)/.test(source)) return "MINUTE";
  if (/\(시간\)|\[시간\]|hours?$|\(h\)/.test(source)) return "HOUR";
  if (/일수|\(일\)|\[일\]|days?$/.test(source)) return "DAY";
  return null;
}

function bareNumber(value: TabularCell): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const source = cellToString(value).normalize("NFKC").replace(/\s+/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(source)) return null;
  return Number(source);
}

/** Bare numbers are only interpreted when the header states the unit. */
export function parseQuantity(
  value: TabularCell,
  header: string | null,
): { days: number | null; minutes: number | null; ambiguousNumber: boolean } {
  const number = bareNumber(value);
  if (number !== null && number >= 0) {
    const unit = unitFromHeader(header);
    if (unit === "DAY")
      return { days: number, minutes: null, ambiguousNumber: false };
    if (unit === "HOUR") {
      const minutes = number * 60;
      return Number.isInteger(minutes)
        ? { days: null, minutes, ambiguousNumber: false }
        : { days: null, minutes: null, ambiguousNumber: true };
    }
    if (unit === "MINUTE" && Number.isInteger(number)) {
      return { days: null, minutes: number, ambiguousNumber: false };
    }
    return { days: null, minutes: null, ambiguousNumber: true };
  }
  return {
    days: parseDayCount(value),
    minutes: parseDurationMinutes(value),
    ambiguousNumber: false,
  };
}

/**
 * Parse text with an explicit unit (`4시간`, `90분`, `1:30`). Bare numbers are
 * rejected here because their unit is unknown; see `parseQuantity`.
 */
export function parseDurationMinutes(value: TabularCell): number | null {
  if (typeof value === "number") return null;

  const source = cellToString(value).normalize("NFKC").replace(/\s+/g, "");
  if (!source) return null;

  const minuteOnly = source.match(/^(\d+)분$/);
  if (minuteOnly) return Number(minuteOnly[1]);

  const hourOnly = source.match(/^(\d+(?:\.\d+)?)시간$/);
  if (hourOnly) return Math.round(Number(hourOnly[1]) * 60);

  const hourMinute = source.match(/^(\d+)시간(\d+)분$/);
  if (hourMinute) return Number(hourMinute[1]) * 60 + Number(hourMinute[2]);

  const dayHourMinute = source.match(
    /^\d+(?:\.\d+)?일(?:(\d+(?:\.\d+)?)시간)?(?:(\d+)분)?$/,
  );
  if (dayHourMinute && (dayHourMinute[1] || dayHourMinute[2])) {
    return (
      Math.round(Number(dayHourMinute[1] ?? 0) * 60) +
      Number(dayHourMinute[2] ?? 0)
    );
  }

  const clock = source.match(/^(\d{1,2}):(\d{2})$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);

  return null;
}

function mappedValue(
  row: TabularRow,
  mappings: ColumnMapping[],
  target: Parameters<typeof findMappedHeader>[1],
): TabularCell {
  const header = findMappedHeader(mappings, target);
  return header ? row[header] : null;
}

export function normalizeEventRow(
  row: TabularRow,
  sourceRowIndex: number,
  mappings: ColumnMapping[],
): ServiceEventCandidate {
  const warnings: ImportWarning[] = [];
  const rawDate = mappedValue(row, mappings, "date");
  const date = parseDateCell(rawDate);
  if (!date) {
    warnings.push({
      code: rawDate ? "UNRECOGNIZED_DATE" : "MISSING_DATE",
      message: rawDate
        ? `날짜 '${cellToString(rawDate)}'를 해석하지 못했습니다.`
        : "날짜가 없습니다.",
    });
  }

  const classification = classifyEventType(
    mappedValue(row, mappings, "eventType"),
  );
  warnings.push(...classification.warnings);

  const durationHeader = findMappedHeader(mappings, "duration");
  const rawDuration = mappedValue(row, mappings, "duration");
  const quantity = parseQuantity(rawDuration, durationHeader);
  const durationMinutes = quantity.minutes;
  const durationDays = quantity.days;
  const startTime = parseClockTime(mappedValue(row, mappings, "startTime"));
  const endTime = parseClockTime(mappedValue(row, mappings, "endTime"));
  const noteText = cellToString(mappedValue(row, mappings, "note"));

  if (quantity.ambiguousNumber) {
    warnings.push({
      code: "AMBIGUOUS_NUMERIC_DURATION",
      message: `사용량 '${cellToString(rawDuration)}'에 단위(일·시간·분)가 없어 해석하지 않았습니다. 사용 분을 직접 확인해 주세요.`,
    });
  } else if (rawDuration && durationMinutes === null && durationDays === null) {
    warnings.push({
      code: "UNRECOGNIZED_DURATION",
      message: `사용시간 '${cellToString(rawDuration)}'을 해석하지 못했습니다.`,
    });
  }

  if (durationDays !== null && durationMinutes !== null) {
    warnings.push({
      code: "MIXED_DAY_AND_TIME",
      message: `'${cellToString(rawDuration)}'처럼 일과 시간이 섞인 기록은 한 건으로 옮기지 않습니다. 일 단위와 시간 단위 기록으로 나눠 입력해 주세요.`,
    });
  }

  const halfDayByFraction =
    durationDays === 0.5 &&
    durationMinutes === null &&
    classification.eventType === "ANNUAL_LEAVE";

  if (
    durationDays !== null &&
    !Number.isInteger(durationDays) &&
    !halfDayByFraction
  ) {
    warnings.push({
      code: "AMBIGUOUS_DAY_FRACTION",
      message: `${durationDays}일은 1일 근무시간 확인 없이 분 단위로 자동 변환하지 않습니다. 사용 분을 직접 확인해 주세요.`,
    });
  }

  const halfDay =
    halfDayByFraction ||
    (classification.halfDayHint &&
      durationMinutes === null &&
      durationDays === null &&
      !(startTime && endTime));

  if (halfDay) {
    warnings.push({
      code: "HALF_DAY_UNIT",
      message:
        "반가는 반일(0.5일)로 기록하며, 기관별 근무시간을 가정해 분으로 바꾸지 않았습니다.",
    });
  } else if (
    classification.halfDayHint &&
    durationMinutes === null &&
    durationDays === null &&
    !(startTime && endTime) &&
    classification.eventType !== "ANNUAL_LEAVE"
  ) {
    warnings.push({
      code: "AMBIGUOUS_HALF_DAY",
      message:
        "반일 표시는 확인했지만 기관별 근무시간을 가정하지 않기 위해 시간으로 자동 변환하지 않았습니다.",
    });
  }

  const confidenceParts = [classification.confidence, date ? 1 : 0.25];
  if (
    durationMinutes !== null ||
    durationDays !== null ||
    halfDay ||
    (startTime && endTime)
  ) {
    confidenceParts.push(1);
  }
  const confidence =
    confidenceParts.reduce((sum, value) => sum + value, 0) /
    confidenceParts.length;

  if (confidence < 0.7) {
    warnings.push({
      code: "LOW_CONFIDENCE",
      message: "자동 해석 신뢰도가 낮아 사용자 확인이 필요합니다.",
    });
  }

  return {
    sourceRowIndex,
    eventType: classification.eventType,
    date,
    allDay:
      !halfDay &&
      ((durationDays !== null && Number.isInteger(durationDays)) ||
        (durationMinutes === null &&
          !startTime &&
          !endTime &&
          !quantity.ambiguousNumber)),
    durationDays,
    durationMinutes,
    startTime,
    endTime,
    halfDay,
    halfDayPart: halfDay ? classification.halfDayPart : null,
    note: noteText || null,
    confidence,
    warnings,
    fingerprint: null,
    raw: row,
  };
}
