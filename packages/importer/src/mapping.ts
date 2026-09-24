import type {
  CanonicalColumn,
  ColumnMapping,
  TableShapeAssessment,
} from "./types";

const HEADER_SYNONYMS: Record<CanonicalColumn, string[]> = {
  date: [
    "일자",
    "날짜",
    "사용일",
    "사용일자",
    "복무일",
    "복무일자",
    "근태일",
    "근무일",
    "date",
  ],
  eventType: [
    "구분",
    "종류",
    "유형",
    "휴가",
    "휴가종류",
    "휴가구분",
    "복무상황",
    "복무상태",
    "근태",
    "근태구분",
    "event",
    "eventtype",
    "type",
  ],
  duration: [
    "시간",
    "사용시간",
    "사용량",
    "차감",
    "차감시간",
    "휴가시간",
    "duration",
    "hours",
    "minutes",
  ],
  startTime: ["시작", "시작시간", "시각부터", "from", "start", "starttime"],
  endTime: ["종료", "종료시간", "시각까지", "to", "end", "endtime"],
  note: ["비고", "사유", "메모", "내용", "remark", "remarks", "note", "memo"],
  granted: [
    "부여",
    "부여량",
    "부여일수",
    "총부여",
    "총일수",
    "granted",
    "entitled",
  ],
  used: ["사용", "사용량", "사용일수", "누적사용", "used", "consumed"],
  remaining: [
    "잔여",
    "잔여량",
    "잔여일수",
    "남은휴가",
    "남은연가",
    "remaining",
    "balance",
  ],
  asOfDate: ["기준일", "기준일자", "현재일", "산정일", "asof", "asofdate"],
};

function normalizeHeader(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./()[\]{}:]+/g, "");
}

function scoreHeader(header: string, synonym: string) {
  const normalizedHeader = normalizeHeader(header);
  const normalizedSynonym = normalizeHeader(synonym);

  if (!normalizedHeader || !normalizedSynonym) return 0;
  if (normalizedHeader === normalizedSynonym) return 1;
  if (
    normalizedHeader.includes(normalizedSynonym) ||
    normalizedSynonym.includes(normalizedHeader)
  ) {
    return 0.86;
  }
  return 0;
}

/** Preserve duplicate columns instead of letting object assignment overwrite them. */
export function makeUniqueHeaders(values: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return values.map((value, index) => {
    const base = value.normalize("NFKC").trim() || `열 ${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

export function mapColumns(headers: string[]): ColumnMapping[] {
  const candidates: ColumnMapping[] = [];

  for (const header of headers) {
    for (const [target, synonyms] of Object.entries(HEADER_SYNONYMS) as Array<
      [CanonicalColumn, string[]]
    >) {
      const confidence = Math.max(
        ...synonyms.map((item) => scoreHeader(header, item)),
      );
      if (confidence >= 0.8) {
        candidates.push({ sourceHeader: header, target, confidence });
      }
    }
  }

  const selectedTargets = new Set<CanonicalColumn>();
  const selectedHeaders = new Set<string>();

  const selected = candidates
    .sort((a, b) => b.confidence - a.confidence)
    .filter((candidate) => {
      if (
        selectedTargets.has(candidate.target) ||
        selectedHeaders.has(candidate.sourceHeader)
      ) {
        return false;
      }
      selectedTargets.add(candidate.target);
      selectedHeaders.add(candidate.sourceHeader);
      return true;
    })
    .sort(
      (a, b) =>
        headers.indexOf(a.sourceHeader) - headers.indexOf(b.sourceHeader),
    );

  return reinterpretUsageColumnInEventTables(selected);
}

/**
 * In a dated per-event table, a lone `사용일수`/used column is the amount
 * used on that row, not a cumulative balance. Only reinterpret it when the
 * table has a date, no explicit duration and no other balance columns.
 */
function reinterpretUsageColumnInEventTables(
  mappings: ColumnMapping[],
): ColumnMapping[] {
  const targets = new Set(mappings.map((mapping) => mapping.target));
  if (
    !targets.has("date") ||
    targets.has("duration") ||
    !targets.has("used") ||
    targets.has("granted") ||
    targets.has("remaining")
  ) {
    return mappings;
  }
  return mappings.map((mapping) =>
    mapping.target === "used" ? { ...mapping, target: "duration" } : mapping,
  );
}

/**
 * Recognize only structures that can safely become personal records.
 *
 * Snapshot columns win over event interpretation when there is aggregate
 * balance evidence and no per-event time columns. This prevents a dated
 * balance table from being expanded into fake dated leave events.
 */
export function assessColumnMappings(
  mappings: ColumnMapping[],
): Omit<TableShapeAssessment, "mappings"> {
  const targets = new Set(mappings.map((mapping) => mapping.target));
  const balanceCount = ["granted", "used", "remaining"].filter((target) =>
    targets.has(target as CanonicalColumn),
  ).length;
  const eventTimeCount = ["duration", "startTime", "endTime"].filter((target) =>
    targets.has(target as CanonicalColumn),
  ).length;
  const hasEventType = targets.has("eventType");
  const hasDate = targets.has("date");
  const hasAsOfDate = targets.has("asOfDate");

  if (hasEventType && balanceCount > 0 && eventTimeCount === 0) {
    return {
      kind: "SNAPSHOT",
      score:
        6 +
        balanceCount * 2 +
        (hasAsOfDate ? 2 : 0) +
        (hasDate ? 1 : 0) +
        (targets.has("note") ? 1 : 0),
    };
  }

  if (hasEventType && hasDate) {
    return {
      kind: "EVENTS",
      score:
        8 +
        eventTimeCount * 2 +
        (targets.has("note") ? 1 : 0) +
        mappings.length * 0.1,
    };
  }

  return { kind: "UNRECOGNIZED", score: 0 };
}

export function assessTableHeaders(headers: string[]): TableShapeAssessment {
  const mappings = mapColumns(headers);
  return { ...assessColumnMappings(mappings), mappings };
}

export function findMappedHeader(
  mappings: ColumnMapping[],
  target: CanonicalColumn,
): string | null {
  return (
    mappings.find((mapping) => mapping.target === target)?.sourceHeader ?? null
  );
}
