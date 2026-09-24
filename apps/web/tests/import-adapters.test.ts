import { Workbook } from "exceljs";
import { describe, expect, it } from "vitest";

import {
  formatFromFile,
  parseXlsxFile,
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

  it("refuses a PDF fixture without a recognizable table header", () => {
    expect(() =>
      tabularFromPositionedPdfText([
        { page: 1, x: 10, y: 700, text: "복무 확인서" },
        { page: 1, x: 10, y: 680, text: "아무 표도 없음" },
      ]),
    ).toThrow(/표 구조/);
  });
});
