import { Workbook } from "exceljs";
import { describe, expect, it } from "vitest";

import {
  formatFromFile,
  parseXlsxFile,
  positionedFromPdfTextStream,
  tabularFromMarkdownTables,
  tabularFromPositionedPdfText,
  XlsxWorksheetSelectionRequiredError,
} from "../src/lib/file-import-adapters";

async function workbookFile(
  name: string,
  configure: (workbook: Workbook) => void,
): Promise<File> {
  const workbook = new Workbook();
  configure(workbook);
  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(buffer);
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  return {
    name,
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    arrayBuffer: async () => arrayBuffer,
  } as File;
}

describe("file format detection", () => {
  it("recognizes HWP and HWPX sources", () => {
    expect(
      formatFromFile({ name: "근태대장.hwp", type: "application/x-hwp" }),
    ).toBe("HWP");
    expect(formatFromFile({ name: "휴가현황.hwpx", type: "" })).toBe("HWPX");
  });
});

describe("XLSX table selection and provenance", () => {
  it("skips hidden helper sheets and preserves the actual Excel row number", async () => {
    const file = await workbookFile("복무상황.xlsx", (workbook) => {
      const hidden = workbook.addWorksheet("숨김기준표");
      hidden.state = "hidden";
      hidden.addRow(["사용일자", "복무상황", "사용시간"]);
      hidden.addRow(["2026-01-01", "연가", "4시간"]);

      const sheet = workbook.addWorksheet("개인복무기록");
      sheet.mergeCells("A1:D1");
      sheet.getCell("A1").value = "사회복무요원 개인별 복무상황";
      sheet.addRow([]);
      sheet.addRow(["출력일", "2026-09-25"]);
      sheet.addRow(["사용일자", "복무상황", "사용시간", "비고"]);
      sheet.addRow([]);
      sheet.addRow(["2026-09-01", "연가", "4시간", "병원"]);
    });

    const tabular = await parseXlsxFile(file);
    expect(tabular.sourceLabel).toContain("개인복무기록");
    expect(tabular.sourceLabel).toContain("머리글 4행");
    expect(tabular.rowSourceIndexes).toEqual([6]);
    expect(tabular.rows[0]).toMatchObject({
      사용일자: "2026-09-01",
      복무상황: "연가",
    });
  });

  it("requires an explicit choice when multiple visible sheets contain importable tables", async () => {
    const file = await workbookFile("복수시트.xlsx", (workbook) => {
      const usage = workbook.addWorksheet("복무기록");
      usage.addRow(["날짜", "구분", "사용시간"]);
      usage.addRow(["2026-09-01", "연가", "4시간"]);

      const balance = workbook.addWorksheet("휴가잔액");
      balance.addRow(["휴가종류", "총부여일수", "사용일수", "잔여일수"]);
      balance.addRow(["연가", 15, 3, 12]);
    });

    let error: unknown;
    try {
      await parseXlsxFile(file);
    } catch (reason) {
      error = reason;
    }
    expect(error).toBeInstanceOf(XlsxWorksheetSelectionRequiredError);
    expect(
      (error as XlsxWorksheetSelectionRequiredError).candidates.map(
        (candidate) => candidate.worksheetName,
      ),
    ).toEqual(expect.arrayContaining(["복무기록", "휴가잔액"]));

    const selected = await parseXlsxFile(file, "휴가잔액");
    expect(selected.sourceLabel).toContain("휴가잔액");
    expect(selected.headers).toEqual([
      "휴가종류",
      "총부여일수",
      "사용일수",
      "잔여일수",
    ]);
  });

  it("keeps duplicate workbook headers distinct", async () => {
    const file = await workbookFile("중복헤더.xlsx", (workbook) => {
      const sheet = workbook.addWorksheet("기록");
      sheet.addRow(["날짜", "구분", "비고", "비고"]);
      sheet.addRow(["2026-09-01", "연가", "1차", "2차"]);
    });

    const tabular = await parseXlsxFile(file);
    expect(tabular.headers).toEqual(["날짜", "구분", "비고", "비고 (2)"]);
    expect(tabular.rows[0]).toMatchObject({
      비고: "1차",
      "비고 (2)": "2차",
    });
  });
});

describe("HWP/HWPX table reconstruction", () => {
  it("reconstructs a personal leave table from extracted Markdown", () => {
    const tabular = tabularFromMarkdownTables(
      `| 사용일자 | 복무상황 | 사용시간 | 비고 |
| --- | --- | --- | --- |
| 2026-06-12 | 연가 | 4시간 | 병원 |`,
      "HWP",
    );

    expect(tabular.format).toBe("HWP");
    expect(tabular.rows).toEqual([
      {
        사용일자: "2026-06-12",
        복무상황: "연가",
        사용시간: "4시간",
        비고: "병원",
      },
    ]);
  });

  it("does not turn a policy allocation table into personal usage records", () => {
    expect(() =>
      tabularFromMarkdownTables(
        `| 의무복무기간 | 복무기간에 따른 연가일수 |
| --- | --- |
| 21개월 | 소집된 날부터 1년 이내 15일 / 1년 초과 13일 |`,
        "HWP",
      ),
    ).toThrow(/규정표|사용기록/);
  });
});

describe("PDF table reconstruction", () => {
  it("reads pdf.js text streams through getReader for Safari compatibility", async () => {
    let reads = 0;
    let released = false;
    const chunks = [
      {
        items: [
          { str: " 사용일자 ", transform: [1, 0, 0, 1, 10, 700] },
          { str: "", transform: [1, 0, 0, 1, 20, 700] },
        ],
      },
      {
        items: [
          { str: "연가", transform: [1, 0, 0, 1, 110, 680] },
          { str: undefined, transform: [1, 0, 0, 1, 210, 680] },
        ],
      },
    ];

    const page = {
      streamTextContent() {
        return {
          getReader() {
            return {
              async read() {
                const value = chunks[reads];
                reads += 1;
                return value
                  ? { done: false, value }
                  : { done: true, value: undefined };
              },
              releaseLock() {
                released = true;
              },
            };
          },
        };
      },
    };

    await expect(positionedFromPdfTextStream(page, 2)).resolves.toEqual([
      { page: 2, x: 10, y: 700, text: "사용일자" },
      { page: 2, x: 110, y: 680, text: "연가" },
    ]);
    expect(released).toBe(true);
  });

  it("reconstructs a positioned text table fixture", () => {
    const tabular = tabularFromPositionedPdfText([
      { page: 1, x: 10, y: 700, text: "사용일자" },
      { page: 1, x: 110, y: 700, text: "복무상황" },
      { page: 1, x: 210, y: 700, text: "사용시간" },
      { page: 1, x: 310, y: 700, text: "비고" },
      { page: 1, x: 10, y: 680, text: "2026-06-12" },
      { page: 1, x: 110, y: 680, text: "연가" },
      { page: 1, x: 210, y: 680, text: "4시간" },
      { page: 1, x: 310, y: 680, text: "병원" },
    ]);

    expect(tabular.headers).toEqual([
      "사용일자",
      "복무상황",
      "사용시간",
      "비고",
    ]);
    expect(tabular.rows).toEqual([
      {
        사용일자: "2026-06-12",
        복무상황: "연가",
        사용시간: "4시간",
        비고: "병원",
      },
    ]);
  });

  it("reconstructs centered daily-service PDF rows", () => {
    const tabular = tabularFromPositionedPdfText([
      { page: 1, x: 92.5, y: 700, text: "날짜" },
      { page: 1, x: 249.5, y: 700, text: "복무상황" },
      { page: 1, x: 297.2, y: 700, text: "(확인자)" },
      { page: 1, x: 473.8, y: 700, text: "비" },
      { page: 1, x: 492.2, y: 700, text: "고" },

      { page: 1, x: 63.9, y: 680, text: "2026-04-27" },
      { page: 1, x: 125.6, y: 680, text: "(월)" },
      { page: 1, x: 155, y: 680, text: "연가" },
      { page: 1, x: 198.3, y: 680, text: "[담당자]." },
      { page: 1, x: 440, y: 680, text: "가사" },

      { page: 1, x: 63.9, y: 660, text: "2026-04-30" },
      { page: 1, x: 125.6, y: 660, text: "(목)" },
      { page: 1, x: 155, y: 660, text: "병가조퇴" },
      { page: 1, x: 198.3, y: 660, text: "[담당자]." },
      { page: 1, x: 440, y: 660, text: "5시간" },
      { page: 1, x: 469.2, y: 660, text: "0분" },

      { page: 2, x: 92.5, y: 700, text: "날짜" },
      { page: 2, x: 249.5, y: 700, text: "복무상황" },
      { page: 2, x: 297.2, y: 700, text: "(확인자)" },
      { page: 2, x: 473.8, y: 700, text: "비" },
      { page: 2, x: 492.2, y: 700, text: "고" },
      { page: 2, x: 63.9, y: 680, text: "2026-05-28" },
      { page: 2, x: 125.6, y: 680, text: "(목)" },
      { page: 2, x: 155, y: 680, text: "연가" },
      { page: 2, x: 198.3, y: 680, text: "[담당자]." },
      { page: 2, x: 440, y: 680, text: "개인" },
      { page: 2, x: 466, y: 680, text: "용무" },
    ]);

    expect(tabular.headers).toEqual(["날짜", "복무상황", "사용시간", "비고"]);
    expect(tabular.rows).toEqual([
      {
        날짜: "2026-04-27",
        복무상황: "연가",
        사용시간: "",
        비고: "가사",
      },
      {
        날짜: "2026-04-30",
        복무상황: "병가조퇴",
        사용시간: "5시간 0분",
        비고: "",
      },
      {
        날짜: "2026-05-28",
        복무상황: "연가",
        사용시간: "",
        비고: "개인 용무",
      },
    ]);
  });

  it("auto-skips holidays and normal calendar rows in daily-service PDFs", () => {
    const tabular = tabularFromPositionedPdfText([
      { page: 1, x: 92.5, y: 700, text: "날짜" },
      { page: 1, x: 249.5, y: 700, text: "복무상황" },
      { page: 1, x: 473.8, y: 700, text: "비고" },

      { page: 1, x: 63.9, y: 680, text: "2026-03-01" },
      { page: 1, x: 125.6, y: 680, text: "(일)" },
      { page: 1, x: 155, y: 680, text: "삼일절" },

      { page: 1, x: 63.9, y: 660, text: "2026-03-02" },
      { page: 1, x: 125.6, y: 660, text: "(월)" },
      { page: 1, x: 155, y: 660, text: "대체공휴일" },

      { page: 1, x: 63.9, y: 640, text: "2026-03-03" },
      { page: 1, x: 125.6, y: 640, text: "(화)" },
      { page: 1, x: 155, y: 640, text: "정상근무" },

      { page: 1, x: 63.9, y: 620, text: "2026-03-04" },
      { page: 1, x: 125.6, y: 620, text: "(수)" },
      { page: 1, x: 155, y: 620, text: "연가" },
      { page: 1, x: 198.3, y: 620, text: "[담당자]." },
      { page: 1, x: 440, y: 620, text: "개인 용무" },

      { page: 1, x: 63.9, y: 600, text: "2026-03-05" },
      { page: 1, x: 125.6, y: 600, text: "(목)" },
      { page: 1, x: 155, y: 600, text: "알수없는상태" },
    ]);

    expect(tabular.rows).toEqual([
      {
        날짜: "2026-03-04",
        복무상황: "연가",
        사용시간: "",
        비고: "개인 용무",
      },
      {
        날짜: "2026-03-05",
        복무상황: "알수없는상태",
        사용시간: "",
        비고: "알수없는상태",
      },
    ]);
  });

  it("filters real-ledger non-usage statuses while preserving timed attendance", () => {
    const tabular = tabularFromPositionedPdfText([
      { page: 6, x: 92.5, y: 700, text: "날짜" },
      { page: 6, x: 249.5, y: 700, text: "복무상황" },
      { page: 6, x: 473.8, y: 700, text: "비고" },

      { page: 6, x: 63.9, y: 680, text: "2026-08-24" },
      { page: 6, x: 125.6, y: 680, text: "(월)" },
      { page: 6, x: 155, y: 680, text: "병가지각" },
      { page: 6, x: 230, y: 680, text: "[복무자]." },
      { page: 6, x: 440, y: 680, text: "3시간 30분" },

      { page: 6, x: 63.9, y: 660, text: "2026-08-24" },
      { page: 6, x: 125.6, y: 660, text: "(월)" },
      { page: 6, x: 155, y: 660, text: "정상출근" },
      { page: 6, x: 230, y: 660, text: "[복무자]." },

      { page: 6, x: 63.9, y: 640, text: "2026-09-01" },
      { page: 6, x: 125.6, y: 640, text: "(화)" },
      { page: 6, x: 155, y: 640, text: "근무편성" },
      { page: 6, x: 230, y: 640, text: "[복무자]." },

      { page: 7, x: 63.9, y: 620, text: "2026-09-24" },
      { page: 7, x: 125.6, y: 620, text: "(목)" },
      { page: 7, x: 440, y: 620, text: "추석연휴" },

      { page: 5, x: 63.9, y: 600, text: "2026-07-17" },
      { page: 5, x: 125.6, y: 600, text: "(금)" },
      { page: 5, x: 440, y: 600, text: "제헌절" },
    ]);

    expect(tabular.rows).toEqual([
      {
        날짜: "2026-08-24",
        복무상황: "병가지각",
        사용시간: "3시간 30분",
        비고: "",
      },
    ]);
  });

  it("refuses a PDF fixture without a recognizable table header", () => {
    expect(() =>
      tabularFromPositionedPdfText([
        { page: 1, x: 10, y: 700, text: "복무 확인서" },
        { page: 1, x: 10, y: 680, text: "아무 표도 없음" },
      ]),
    ).toThrow(/표 구조/);
  });
});
