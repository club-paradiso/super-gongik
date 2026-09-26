/**
 * Realistic local user documents for home-screen states. Every document is
 * produced through the real domain commands (never hand-written JSON), so a
 * fixture cannot encode a record the app itself would reject.
 *
 * `now` is the instant the browser clock is pinned to when the fixture is
 * rendered (Asia/Seoul, 09:00 on a Wednesday).
 */
import {
  confirmLeaveCredit,
  createEmptyUserData,
  createProfile,
  createServiceEvent,
  editProfile,
  type CommandContext,
  type CommandResult,
  type DateOnly,
  type ServiceEventDraft,
  type ServiceProfileInput,
  type UserData,
} from "@super-gongik/domain";
import { deriveAnnualLeaveCredits } from "@super-gongik/rules";

export const SCENARIO_NOW = "2026-10-14T00:00:00.000Z";
export const SCENARIO_TODAY = "2026-10-14" as DateOnly;

export type ScenarioKey =
  | "new-recruit"
  | "pre-call-up"
  | "mid-service"
  | "near-discharge"
  | "completed"
  | "incomplete-profile";

export type Scenario = {
  key: ScenarioKey;
  label: string;
  now: string;
  data: UserData;
};

function contextFactory(): CommandContext {
  let counter = 0;
  return {
    now: SCENARIO_NOW,
    deviceId: "device-fixture",
    createId: () => `fixture-${String(++counter).padStart(3, "0")}`,
  };
}

function unwrap<T>(result: CommandResult<T>, step: string) {
  if (!result.ok) {
    throw new Error(
      `${step}: ${result.errors.map((error) => error.message).join(", ")}`,
    );
  }
  return result.data;
}

const BASE_PROFILE: Omit<
  ServiceProfileInput,
  "callUpDate" | "expectedDischargeDate"
> = {
  serviceCategory: null,
  workplaceType: null,
  defaultCommuteCost: null,
  defaultMealAllowanceOverride: null,
  timezone: "Asia/Seoul",
};

/** Profile a user has completed in 내 정보 (work schedule, pay questions). */
const COMPLETE_PROFILE: Partial<ServiceProfileInput> = {
  serviceCategory: "사회복지시설",
  workplaceType: "노인복지관",
  defaultCommuteCost: 2_900,
  workdayMinutes: 480,
  workdayStartTime: "09:00",
  workdayEndTime: "18:00",
  priorServiceCredit: "NONE",
  workPattern: "WEEKDAY_DAYTIME",
  workWeekdays: [1, 2, 3, 4, 5],
};

function build(
  dates: { callUpDate: string; expectedDischargeDate: string },
  options: {
    complete?: boolean;
    confirmCredits?: boolean;
    events?: ServiceEventDraft[];
  } = {},
): UserData {
  const context = contextFactory();
  let data = createEmptyUserData(context.deviceId);
  const input = {
    ...BASE_PROFILE,
    ...dates,
  } as ServiceProfileInput;
  data = unwrap(createProfile(data, input, context), "createProfile");
  if (options.complete) {
    data = unwrap(
      editProfile(data, { ...input, ...COMPLETE_PROFILE }, context),
      "editProfile",
    );
  }
  if (options.confirmCredits) {
    const credits = deriveAnnualLeaveCredits({
      callUpDate: dates.callUpDate as DateOnly,
      referenceDate: SCENARIO_TODAY,
    });
    for (const credit of credits) {
      if (credit.status !== "PENDING_CONFIRMATION") continue;
      data = unwrap(
        confirmLeaveCredit(
          data,
          {
            creditKey: credit.key,
            grantDate: credit.grantDate,
            days: credit.key === "YEAR_1" ? 15 : 13,
            reason: "복무기관 연가 부여 확인",
          },
          context,
        ),
        `confirmLeaveCredit ${credit.key}`,
      );
    }
  }
  for (const draft of options.events ?? []) {
    data = unwrap(
      createServiceEvent(data, draft, context),
      `createServiceEvent ${draft.eventType} ${draft.startDate}`,
    );
  }
  return data;
}

function allDay(
  eventType: ServiceEventDraft["eventType"],
  startDate: string,
  endDate = startDate,
  dayCount = 1,
  title: string | null = null,
): ServiceEventDraft {
  return {
    eventType,
    startDate: startDate as DateOnly,
    endDate: endDate as DateOnly,
    timing: { kind: "ALL_DAY", dayCount },
    title,
    note: null,
    ...(eventType === "SICK_LEAVE" ? { sickLeaveCategory: "ORDINARY" } : {}),
  };
}

function partial(
  eventType: ServiceEventDraft["eventType"],
  date: string,
  startTime: string,
  endTime: string,
  durationMinutes: number,
): ServiceEventDraft {
  return {
    eventType,
    startDate: date as DateOnly,
    endDate: date as DateOnly,
    timing: { kind: "PARTIAL", durationMinutes, startTime, endTime },
    title: null,
    note: null,
  };
}

function halfDay(date: string, half: "AM" | "PM"): ServiceEventDraft {
  return {
    eventType: "ANNUAL_LEAVE",
    startDate: date as DateOnly,
    endDate: date as DateOnly,
    timing: { kind: "HALF_DAY", half },
    title: null,
    note: null,
  };
}

export function buildScenarios(): Scenario[] {
  return [
    {
      key: "new-recruit",
      label: "A. 소집 9일 차",
      now: SCENARIO_NOW,
      data: build({
        callUpDate: "2026-10-05",
        expectedDischargeDate: "2028-07-04",
      }),
    },
    {
      key: "pre-call-up",
      label: "A′. 소집 전",
      now: SCENARIO_NOW,
      data: build({
        callUpDate: "2026-11-02",
        expectedDischargeDate: "2028-08-01",
      }),
    },
    {
      key: "mid-service",
      label: "B. 복무 중반",
      now: SCENARIO_NOW,
      data: build(
        { callUpDate: "2025-11-17", expectedDischargeDate: "2027-08-16" },
        {
          complete: true,
          confirmCredits: true,
          events: [
            allDay("ANNUAL_LEAVE", "2026-03-09", "2026-03-11", 3),
            halfDay("2026-06-19", "PM"),
            allDay("SICK_LEAVE", "2026-07-02"),
            partial("LATE_ARRIVAL", "2026-08-12", "09:00", "10:30", 90),
            partial("OUTING", "2026-09-15", "14:00", "16:00", 120),
            partial("EARLY_LEAVE", "2026-10-14", "16:00", "18:00", 120),
            allDay("ANNUAL_LEAVE", "2026-10-23", "2026-10-26", 2),
            allDay("EDUCATION", "2026-11-05", "2026-11-05", 1, "직무교육"),
          ],
        },
      ),
    },
    {
      key: "near-discharge",
      label: "C. 소집해제 D-22",
      now: SCENARIO_NOW,
      data: build(
        { callUpDate: "2025-02-06", expectedDischargeDate: "2026-11-05" },
        {
          complete: true,
          confirmCredits: true,
          events: [
            allDay("ANNUAL_LEAVE", "2025-05-02"),
            allDay("ANNUAL_LEAVE", "2025-08-11", "2025-08-15", 5),
            allDay("ANNUAL_LEAVE", "2025-12-29", "2025-12-31", 3),
            allDay("SICK_LEAVE", "2026-02-10"),
            allDay("ANNUAL_LEAVE", "2026-05-04", "2026-05-08", 5),
            partial("OUTING", "2026-09-03", "13:00", "17:00", 240),
            allDay(
              "ANNUAL_LEAVE",
              "2026-10-28",
              "2026-11-04",
              6,
              "마지막 연가",
            ),
          ],
        },
      ),
    },
    {
      key: "completed",
      label: "D. 소집해제 완료",
      now: SCENARIO_NOW,
      data: build(
        { callUpDate: "2024-08-05", expectedDischargeDate: "2026-05-04" },
        {
          complete: true,
          confirmCredits: true,
          events: [allDay("ANNUAL_LEAVE", "2026-04-20", "2026-04-24", 5)],
        },
      ),
    },
    {
      key: "incomplete-profile",
      label: "E. 날짜만 입력",
      now: SCENARIO_NOW,
      data: build({
        callUpDate: "2026-02-02",
        expectedDischargeDate: "2027-11-01",
      }),
    },
  ];
}
