import { describe, expect, it } from "vitest";

import {
  createEmptyUserData,
  planImportRows,
  type UserData,
} from "@super-gongik/domain";

import {
  buildImportDrafts,
  buildImportPreview,
  candidateToImportDraft,
  classifyEventType,
  createImportBatchDescriptor,
  fingerprintEventCandidate,
  mapColumns,
  normalizeEventRow,
  parseDateCell,
  parseDayCount,
  parseDelimitedText,
  parseDurationMinutes,
  parseQuantity,
} from "../src";

const batchFor = (id: string) =>
  createImportBatchDescriptor({
    id,
    fileName: `${id}.csv`,
    sourceFormat: "CSV",
    createdAt: "2026-09-01T00:00:00.000Z",
  });

function profileData(): UserData {
  return {
    ...createEmptyUserData("device"),
    profile: {
      id: "p",
      ownerId: null,
      localProfileId: "p",
      callUpDate: "2026-05-04",
      expectedDischargeDate: "2028-02-03",
      serviceCategory: null,
      workplaceType: null,
      defaultCommuteCost: null,
      defaultMealAllowanceOverride: null,
      timezone: "Asia/Seoul",
      workdayMinutes: null,
      workdayStartTime: null,
      workdayEndTime: null,
      priorServiceCredit: null,
      priorServiceBasis: null,
      priorServiceCreditedMonths: null,
      priorServiceCreditHasPartialMonth: false,
      workPattern: null,
      workWeekdays: null,
      createdAt: "2026-05-04T00:00:00.000Z",
      updatedAt: "2026-05-04T00:00:00.000Z",
    },
  };
}

describe("tabular import", () => {
  it("parses quoted CSV and maps Korean headers", () => {
    const parsed = parseDelimitedText(
      '사용일자,복무상황,사용시간,비고\n2026-06-12,오후반가,4시간,"병원, 진료"',
    );
    expect(parsed.headers).toEqual([
      "사용일자",
      "복무상황",
      "사용시간",
      "비고",
    ]);
    expect(parsed.rows[0]?.비고).toBe("병원, 진료");

    const mappings = mapColumns(parsed.headers);
    expect(mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceHeader: "사용일자", target: "date" }),
        expect.objectContaining({
          sourceHeader: "복무상황",
          target: "eventType",
        }),
        expect.objectContaining({
          sourceHeader: "사용시간",
          target: "duration",
        }),
      ]),
    );
  });

  it("finds a CSV header after administrative preamble rows and preserves source rows", async () => {
    const parsed = parseDelimitedText(
      "사회복무요원 복무상황부\n출력일,2026-09-25\n\n사용일자,복무상황,사용시간,비고\n2026-09-01,연가,4시간,병원\n\n2026-09-03,병가,8시간,진료",
    );
    expect(parsed.headers).toEqual([
      "사용일자",
      "복무상황",
      "사용시간",
      "비고",
    ]);
    expect(parsed.rowSourceIndexes).toEqual([5, 7]);

    const preview = await buildImportPreview(parsed, batchFor("preamble"));
    expect(preview.events.map((event) => event.sourceRowIndex)).toEqual([5, 7]);
    const { drafts } = buildImportDrafts(preview, new Set([5]));
    expect(drafts[0]?.source.sourceRowIndex).toBe(5);
  });

  it("keeps duplicate CSV headers distinct instead of overwriting a column", () => {
    const parsed = parseDelimitedText(
      "날짜,구분,비고,비고\n2026-09-01,연가,1차결재,2차결재",
    );
    expect(parsed.headers).toEqual(["날짜", "구분", "비고", "비고 (2)"]);
    expect(parsed.rows[0]).toMatchObject({
      비고: "1차결재",
      "비고 (2)": "2차결재",
    });
  });

  it("rejects delimited files without a recognizable personal record table", () => {
    expect(() =>
      parseDelimitedText(
        "문서명,사회복무요원 안내\n시행일,2026-01-01\n내용,연가 사용 안내",
      ),
    ).toThrow(/개인 복무기록|휴가 잔액/);
  });

  it("normalizes common civil date formats", () => {
    expect(parseDateCell("2026.09.01")).toBe("2026-09-01");
    expect(parseDateCell("2026년 9월 1일")).toBe("2026-09-01");
    expect(parseDateCell("2026-09-01 (화)")).toBe("2026-09-01");
    expect(parseDateCell("20260901")).toBe("2026-09-01");
    expect(parseDateCell("2026-02-30")).toBeNull();
  });

  it("parses explicit durations without inventing day length", () => {
    expect(parseDurationMinutes("4시간")).toBe(240);
    expect(parseDurationMinutes("2시간 30분")).toBe(150);
    expect(parseDurationMinutes("30분")).toBe(30);
    expect(parseDurationMinutes("1일")).toBeNull();
    expect(parseDayCount("1일")).toBe(1);
    expect(parseDayCount("20일 4시간")).toBe(20);
    expect(parseDurationMinutes("20일 4시간")).toBe(240);
  });

  it("classifies common leave and attendance labels", () => {
    expect(classifyEventType("연가").eventType).toBe("ANNUAL_LEAVE");
    expect(classifyEventType("특휴").eventType).toBe("SPECIAL_LEAVE");
    expect(classifyEventType("복무기본교육").eventType).toBe("EDUCATION");
    expect(classifyEventType("병가조퇴").eventType).toBe("SICK_LEAVE");
    expect(classifyEventType("병가지각").eventType).toBe("SICK_LEAVE");
    expect(classifyEventType("허가외출").eventType).toBe("OUTING");
    expect(classifyEventType("공가(시간)").eventType).toBe("OFFICIAL_LEAVE");
    expect(classifyEventType("복무이탈").eventType).toBe("SERVICE_ABSENCE");
    expect(classifyEventType("분할복무").eventType).toBe("SERVICE_SUSPENSION");
    expect(classifyEventType("연가초과 결근").eventType).toBe(
      "EXCESS_ANNUAL_ABSENCE",
    );
    expect(classifyEventType("정체불명휴가").eventType).toBeNull();
  });

  it("records 반가 as the half-day unit and never as 240 minutes", async () => {
    const row = {
      날짜: "2026-09-01",
      구분: "오후반가",
    };
    const candidate = normalizeEventRow(row, 2, mapColumns(Object.keys(row)));
    expect(candidate.eventType).toBe("ANNUAL_LEAVE");
    expect(candidate.durationMinutes).toBeNull();
    expect(candidate.halfDay).toBe(true);
    expect(candidate.halfDayPart).toBe("PM");
    expect(candidate.warnings.map((warning) => warning.code)).toContain(
      "HALF_DAY_UNIT",
    );
    candidate.fingerprint = await fingerprintEventCandidate(candidate);
    const conversion = candidateToImportDraft(candidate, batchFor("b"));
    expect(conversion.ok && conversion.draft.draft.timing).toEqual({
      kind: "HALF_DAY",
      half: "PM",
    });
  });

  it("treats 0.5일 annual leave as a half day but other fractions as ambiguous", () => {
    const half = normalizeEventRow(
      { 날짜: "2026-09-01", 구분: "연가", 사용일수: "0.5일" },
      2,
      mapColumns(["날짜", "구분", "사용일수"]),
    );
    expect(half.halfDay).toBe(true);
    const sick = normalizeEventRow(
      { 날짜: "2026-09-01", 구분: "병가", 사용일수: "0.5일" },
      2,
      mapColumns(["날짜", "구분", "사용일수"]),
    );
    expect(sick.halfDay).toBe(false);
    expect(sick.warnings.map((warning) => warning.code)).toContain(
      "AMBIGUOUS_DAY_FRACTION",
    );
  });

  it("only reads bare numbers when the header states the unit", () => {
    expect(parseQuantity("4", "사용시간")).toMatchObject({
      ambiguousNumber: true,
    });
    expect(parseQuantity("4", "사용시간(시간)")).toMatchObject({
      minutes: 240,
    });
    expect(parseQuantity("90", "사용시간(분)")).toMatchObject({ minutes: 90 });
    expect(parseQuantity("20", "잔여일수")).toMatchObject({ days: 20 });
    expect(parseDurationMinutes(4)).toBeNull();
  });

  it("refuses to fold mixed day-and-time rows into one event", async () => {
    const candidate = normalizeEventRow(
      { 날짜: "2026-09-01", 구분: "연가", 사용시간: "1일 4시간" },
      2,
      mapColumns(["날짜", "구분", "사용시간"]),
    );
    candidate.fingerprint = await fingerprintEventCandidate(candidate);
    expect(candidateToImportDraft(candidate, batchFor("b")).ok).toBe(false);
  });

  it("keeps a multi-day charged count and flags the derived end date", async () => {
    const candidate = normalizeEventRow(
      { 날짜: "2026-06-12", 구분: "연가", 사용일수: "3일" },
      2,
      mapColumns(["날짜", "구분", "사용일수"]),
    );
    candidate.fingerprint = await fingerprintEventCandidate(candidate);
    const conversion = candidateToImportDraft(candidate, batchFor("b"));
    expect(conversion.ok).toBe(true);
    if (!conversion.ok) return;
    expect(conversion.draft.draft).toMatchObject({
      startDate: "2026-06-12",
      endDate: "2026-06-16",
      timing: { kind: "ALL_DAY", dayCount: 3 },
    });
    expect(conversion.notes[0]).toContain("추정");
  });

  it("reads spreadsheet date cells as civil dates in any time zone", () => {
    expect(parseDateCell(new Date(Date.UTC(2026, 8, 1)))).toBe("2026-09-01");
  });

  it("treats a dated aggregate balance as a snapshot, not a fake event", async () => {
    const parsed = parseDelimitedText(
      "날짜,휴가종류,총부여일수,사용일수,잔여일수\n2026-09-01,연가,15,3.5,11.5",
    );
    const preview = await buildImportPreview(
      parsed,
      batchFor("dated-snapshot"),
    );
    expect(preview.events).toEqual([]);
    expect(preview.snapshots).toHaveLength(1);
    expect(preview.snapshots[0]).toMatchObject({
      asOfDate: "2026-09-01",
      grantedDays: 15,
      usedDays: 3.5,
      remainingDays: 11.5,
    });
  });

  it("blocks aggregate balances whose bare values have no unit-bearing headers", async () => {
    const parsed = parseDelimitedText(
      "휴가종류,총부여,누적사용,잔여\n연가,15,3,12",
    );
    const preview = await buildImportPreview(
      parsed,
      batchFor("ambiguous-snapshot"),
    );
    expect(preview.snapshots).toHaveLength(1);
    expect(preview.unresolvedRowIndexes).toEqual([2]);
    expect(
      preview.snapshots[0]?.warnings.map((warning) => warning.code),
    ).toContain("AMBIGUOUS_SNAPSHOT_QUANTITY");
  });

  it("preserves aggregate institution leave balances as snapshots", async () => {
    const parsed = parseDelimitedText(
      "휴가종류,총부여,누적사용,잔여\n연가,28일,7일 4시간,20일 4시간",
    );
    const batch = createImportBatchDescriptor({
      id: "snapshot-batch",
      fileName: "잔여연가.csv",
      sourceFormat: "CSV",
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    const preview = await buildImportPreview(parsed, batch);
    expect(preview.events).toHaveLength(0);
    expect(preview.snapshots).toHaveLength(1);
    expect(preview.snapshots[0]).toEqual(
      expect.objectContaining({
        leaveType: "ANNUAL_LEAVE",
        grantedDays: 28,
        usedDays: 7,
        usedMinutes: 240,
        remainingDays: 20,
        remainingMinutes: 240,
      }),
    );
  });
});

describe("preview and duplicate safety", () => {
  it("converts accepted rows to canonical drafts and skips existing imports", async () => {
    const parsed = parseDelimitedText(
      "사용일자,복무상황,사용시간,비고\n2026-06-12,연가,4시간,병원\n2026-07-03,병가,8시간,진료",
    );
    const preview = await buildImportPreview(parsed, batchFor("batch-1"));
    expect(preview.events).toHaveLength(2);
    const { drafts, rejected } = buildImportDrafts(preview, new Set([2, 3]));
    expect(rejected).toEqual([]);
    expect(drafts[0]?.draft.timing).toEqual({
      kind: "PARTIAL",
      durationMinutes: 240,
      startTime: null,
      endTime: null,
    });
    expect(drafts[0]?.source).toMatchObject({
      batchId: "batch-1",
      sourceRowIndex: 2,
    });

    // Pretend the first row was already imported by an earlier batch.
    const data = profileData();
    const existing: UserData = {
      ...data,
      events: [
        {
          ...drafts[0]!.draft,
          id: "existing",
          serviceProfileId: "p",
          status: "CONFIRMED",
          source: { ...drafts[0]!.source, batchId: "older" },
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
          deletedAt: null,
          revision: 1,
          deviceId: "device",
        },
      ],
    };
    expect(planImportRows(existing, drafts).map((row) => row.status)).toEqual([
      "DUPLICATE_IMPORT",
      "NEW",
    ]);
  });

  it("generates stable event fingerprints", async () => {
    const candidate = normalizeEventRow(
      { 날짜: "2026-09-01", 구분: "연가", 시간: "2시간" },
      2,
      mapColumns(["날짜", "구분", "시간"]),
    );
    expect(await fingerprintEventCandidate(candidate)).toBe(
      await fingerprintEventCandidate(candidate),
    );
  });

  it("never pre-selects rows whose duration is ambiguous", async () => {
    const parsed = parseDelimitedText("날짜,구분,사용시간\n2026-09-01,외출,2");
    const preview = await buildImportPreview(parsed, batchFor("b"));
    expect(preview.unresolvedRowIndexes).toEqual([2]);
  });

  it("does not turn an aggregate balance into dated events", async () => {
    const parsed = parseDelimitedText(
      "휴가종류,총부여일수,사용일수,잔여일수\n연가,15,3.5,11.5",
    );
    const preview = await buildImportPreview(parsed, batchFor("b"));
    expect(preview.events).toEqual([]);
    expect(preview.snapshots[0]).toMatchObject({
      grantedDays: 15,
      usedDays: 3.5,
      remainingDays: 11.5,
    });
  });
});
