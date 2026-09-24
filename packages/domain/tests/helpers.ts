import {
  buildServiceProfile,
  createEmptyUserData,
  type CommandContext,
  type ServiceEventDraft,
  type UserData,
} from "../src";

export function sequentialIds(prefix = "id") {
  let counter = 0;
  return () => `${prefix}-${++counter}`;
}

export function context(now = "2026-09-24T01:00:00.000Z"): CommandContext {
  return { now, deviceId: "device-test", createId: sequentialIds() };
}

export function userDataWithProfile(
  overrides: Partial<Parameters<typeof buildServiceProfile>[0]> = {},
): UserData {
  const profile = buildServiceProfile(
    {
      callUpDate: "2026-05-04",
      expectedDischargeDate: "2028-02-03",
      serviceCategory: null,
      workplaceType: null,
      defaultCommuteCost: null,
      defaultMealAllowanceOverride: null,
      timezone: "Asia/Seoul",
      ...overrides,
    },
    {
      id: "profile-1",
      localProfileId: "profile-1",
      timestamp: "2026-05-04T00:00:00.000Z",
    },
  );
  return { ...createEmptyUserData("device-test"), profile };
}

export function allDay(
  eventType: ServiceEventDraft["eventType"],
  startDate: string,
  endDate = startDate,
  dayCount = 1,
): ServiceEventDraft {
  return {
    eventType,
    startDate: startDate as ServiceEventDraft["startDate"],
    endDate: endDate as ServiceEventDraft["endDate"],
    timing: { kind: "ALL_DAY", dayCount },
    title: null,
    note: null,
  };
}

export function partial(
  eventType: ServiceEventDraft["eventType"],
  date: string,
  durationMinutes: number | null,
): ServiceEventDraft {
  return {
    eventType,
    startDate: date as ServiceEventDraft["startDate"],
    endDate: date as ServiceEventDraft["endDate"],
    timing: {
      kind: "PARTIAL",
      durationMinutes,
      startTime: null,
      endTime: null,
    },
    title: null,
    note: null,
  };
}

export function halfDay(
  date: string,
  half: "AM" | "PM" | null,
): ServiceEventDraft {
  return {
    eventType: "ANNUAL_LEAVE",
    startDate: date as ServiceEventDraft["startDate"],
    endDate: date as ServiceEventDraft["endDate"],
    timing: { kind: "HALF_DAY", half },
    title: null,
    note: null,
  };
}
