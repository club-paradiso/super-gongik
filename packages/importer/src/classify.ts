import type { ImportWarning, ImportableServiceEventType } from "./types";

const EVENT_TYPE_SYNONYMS: Array<{
  type: ImportableServiceEventType;
  labels: string[];
}> = [
  {
    type: "ANNUAL_LEAVE",
    labels: ["연가", "연차", "반가", "오전반가", "오후반가", "annualleave"],
  },
  { type: "SICK_LEAVE", labels: ["병가", "질병휴가", "sickleave"] },
  { type: "OFFICIAL_LEAVE", labels: ["공가", "officialleave"] },
  {
    type: "SPECIAL_LEAVE",
    labels: ["특별휴가", "특휴", "포상휴가", "specialleave"],
  },
  {
    type: "COMPASSIONATE_LEAVE",
    labels: ["청원휴가", "경조휴가", "가족돌봄휴가", "compassionateleave"],
  },
  { type: "OUTING", labels: ["외출", "개인외출", "outing"] },
  { type: "LATE_ARRIVAL", labels: ["지각", "late", "latearrival"] },
  { type: "EARLY_LEAVE", labels: ["조퇴", "earlyleave"] },
  {
    type: "EDUCATION",
    labels: ["교육", "복무기본교육", "직무교육", "education"],
  },
  {
    type: "TRAINING",
    labels: ["훈련", "훈련소", "군사교육", "군사교육소집", "training"],
  },
  {
    type: "SERVICE_SUSPENSION",
    labels: ["복무중단", "분할복무", "servicesuspension"],
  },
  {
    type: "SERVICE_ABSENCE",
    labels: ["복무이탈", "무단결근", "serviceabsence"],
  },
  {
    type: "EXCESS_ANNUAL_ABSENCE",
    labels: ["연가초과결근", "연가초과", "excessannualabsence"],
  },
];

function normalizeLabel(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./()[\]{}:]+/g, "");
}

export function classifyEventType(value: unknown): {
  eventType: ImportableServiceEventType | null;
  confidence: number;
  warnings: ImportWarning[];
  halfDayHint: boolean;
  halfDayPart: "AM" | "PM" | null;
} {
  const source = typeof value === "string" ? normalizeLabel(value) : "";
  if (!source) {
    return {
      eventType: null,
      confidence: 0,
      warnings: [
        {
          code: "MISSING_EVENT_TYPE",
          message: "복무/휴가 종류가 비어 있습니다.",
        },
      ],
      halfDayHint: false,
      halfDayPart: null,
    };
  }

  const halfDayPart = source.includes("오전")
    ? ("AM" as const)
    : source.includes("오후")
      ? ("PM" as const)
      : null;

  const labels = EVENT_TYPE_SYNONYMS.flatMap((candidate) =>
    candidate.labels.map((label) => ({
      type: candidate.type,
      normalized: normalizeLabel(label),
    })),
  );

  const exact = labels.find((label) => source === label.normalized);
  if (exact) {
    return {
      eventType: exact.type,
      confidence: 1,
      warnings: [],
      halfDayHint: source.includes("반가"),
      halfDayPart,
    };
  }

  const partial = labels
    .filter(
      (label) =>
        label.normalized.length >= 2 &&
        (source.includes(label.normalized) ||
          label.normalized.includes(source)),
    )
    .sort(
      (a, b) =>
        b.normalized.length - a.normalized.length ||
        a.type.localeCompare(b.type),
    )[0];

  if (partial) {
    return {
      eventType: partial.type,
      confidence: 0.86,
      warnings: [],
      halfDayHint: source.includes("반가"),
      halfDayPart,
    };
  }

  return {
    eventType: null,
    confidence: 0.35,
    warnings: [
      {
        code: "UNRECOGNIZED_EVENT_TYPE",
        message: `복무/휴가 종류 '${String(value)}'를 자동 분류하지 못했습니다.`,
      },
    ],
    halfDayHint: false,
    halfDayPart: null,
  };
}