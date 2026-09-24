import { type YearMonth } from "../calendar/month";
import {
  isLive,
  serviceEventContentKey,
  type ServiceEvent,
} from "../events/model";
import type { ServiceProfile } from "../service/profile";

/**
 * Deterministic description of everything a month's working-day count
 * depends on: the service period, the confirmed schedule and the live
 * records touching that month. A confirmation is valid only while this is
 * unchanged. Timestamps are deliberately not used: they can collide or be
 * skewed across devices, and unrelated edits (e.g. the meal rate) must not
 * invalidate a confirmation.
 */
export function attendanceBasisFingerprint(
  profile: Pick<
    ServiceProfile,
    "callUpDate" | "expectedDischargeDate" | "workPattern" | "workWeekdays"
  >,
  events: readonly ServiceEvent[],
  month: YearMonth,
): string {
  const first = `${month}-01`;
  const last = `${month}-31`;
  const records = events
    .filter(
      (event) =>
        isLive(event) &&
        event.eventType !== "USER_NOTE" &&
        event.startDate <= last &&
        event.endDate >= first,
    )
    .map((event) => [
      serviceEventContentKey(event),
      event.eventType === "SICK_LEAVE"
        ? (event.sickLeaveCategory ?? "UNKNOWN")
        : null,
    ])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify([
    profile.callUpDate,
    profile.expectedDischargeDate,
    profile.workPattern,
    profile.workWeekdays ?? null,
    records,
  ]);
}
