import { describe, expect, it } from "vitest";

import {
  buildServiceProfile,
  type ServiceProfileInput,
  type SyncConflict,
} from "@super-gongik/domain";

import { conflictSides } from "../src/lib/sync-copy";

const base: ServiceProfileInput = {
  callUpDate: "2025-12-17",
  expectedDischargeDate: "2027-09-16",
  serviceCategory: null,
  workplaceType: null,
  defaultCommuteCost: null,
  defaultMealAllowanceOverride: null,
  timezone: "Asia/Seoul",
};

function profile(changes: Partial<ServiceProfileInput>) {
  return buildServiceProfile(
    { ...base, ...changes },
    { id: "p", localProfileId: "p", timestamp: "2026-10-14T00:00:00.000Z" },
  );
}

function profileConflict(
  local: ReturnType<typeof profile>,
  cloud: ReturnType<typeof profile>,
) {
  return {
    collection: "profile",
    localRecord: local,
    cloudRecord: cloud,
  } as unknown as SyncConflict;
}

describe("profile conflict sides", () => {
  // Seen on 2026-10-14 with two browsers on one account: both sides read
  // "소집일 2025-12-17 · 소집해제 예정 2027-09-16", so the choice was blind.
  it("names the field that differs and both values", () => {
    const sides = conflictSides(
      profileConflict(
        profile({ serviceCategory: "교육" }),
        profile({ serviceCategory: "행정" }),
      ),
    );
    expect(sides.local).toBe(
      "소집일 2025-12-17 · 소집해제 예정 2027-09-16 · 복무 분야 교육",
    );
    expect(sides.cloud).toBe(
      "소집일 2025-12-17 · 소집해제 예정 2027-09-16 · 복무 분야 행정",
    );
  });

  it("formats money and work hours, and says 없음 for an empty side", () => {
    const sides = conflictSides(
      profileConflict(
        profile({ defaultCommuteCost: 3000, workdayMinutes: 480 }),
        profile({}),
      ),
    );
    expect(sides.local).toContain("1일 근무시간 8시간 0분");
    expect(sides.local).toContain("1일 교통비 3,000원");
    expect(sides.cloud).toContain("1일 근무시간 없음");
    expect(sides.cloud).toContain("1일 교통비 없음");
  });

  it("counts other differing settings without showing raw values", () => {
    const sides = conflictSides(
      profileConflict(
        profile({ liveProgressEnabled: true }),
        profile({ liveProgressEnabled: false }),
      ),
    );
    expect(sides.local).toContain("그 밖의 설정 1개 다름");
    expect(sides.cloud).toContain("그 밖의 설정 1개 다름");
  });

  it("adds nothing when only bookkeeping differs", () => {
    const sides = conflictSides(
      profileConflict(profile({}), {
        ...profile({}),
        updatedAt: "2026-10-14T01:00:00.000Z",
      }),
    );
    expect(sides.local).toBe("소집일 2025-12-17 · 소집해제 예정 2027-09-16");
    expect(sides.cloud).toBe(sides.local);
  });
});
