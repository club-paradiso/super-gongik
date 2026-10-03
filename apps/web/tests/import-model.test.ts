import { buildServiceProfile, createEmptyUserData } from "@super-gongik/domain";
import {
  buildImportPreview,
  createImportBatchDescriptor,
  parseDelimitedText,
} from "@super-gongik/importer";
import { describe, expect, it } from "vitest";

import {
  buildImportCommit,
  defaultAcceptedRows,
  describeImportSummary,
  rowStatuses,
} from "@/lib/import-model";

// The import panel's rules moved out of the component so the native client
// imports the same way. These pin the behaviour that moved.

const profile = buildServiceProfile(
  {
    callUpDate: "2026-05-04",
    expectedDischargeDate: "2028-02-03",
    serviceCategory: null,
    workplaceType: null,
    defaultCommuteCost: null,
    defaultMealAllowanceOverride: null,
    timezone: "Asia/Seoul",
  },
  { id: "p", localProfileId: "p", timestamp: "2026-05-04T00:00:00.000Z" },
);

async function preview(text: string) {
  const tabular = parseDelimitedText(text);
  const batch = createImportBatchDescriptor({
    fileName: "records.csv",
    sourceFormat: tabular.format,
    id: "batch-1",
    createdAt: "2026-10-04T00:00:00.000Z",
  });
  return buildImportPreview(tabular, batch);
}

describe("import model", () => {
  it("pre-selects only new, understood rows and commits them", async () => {
    const data = { ...createEmptyUserData("d"), profile };
    const result = await preview(
      "사용일자,복무상황,사용시간,비고\n2026-07-01,연가,8시간,여름\n2026-07-02,알수없음,8시간,",
    );
    const statuses = rowStatuses(data, result);
    const accepted = defaultAcceptedRows(result, statuses);
    expect(accepted.size).toBe(1);
    const { input, rejected } = await buildImportCommit(
      result,
      {},
      accepted,
      new Set(),
    );
    expect(input.drafts).toHaveLength(1);
    expect(input.drafts[0]!.draft.eventType).toBe("ANNUAL_LEAVE");
    expect(rejected).toEqual([]);
  });

  it("describes a commit summary", () => {
    expect(
      describeImportSummary(
        { added: 3, skippedDuplicates: 1, rejected: 0, snapshots: 1 },
        2,
      ),
    ).toBe(
      "복무기록 3건, 기관 잔액 1건을 저장했어요. 중복 1건은 건너뛰었어요. 확인이 필요한 2건은 저장하지 않았어요.",
    );
  });
});
