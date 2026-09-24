import type { LeaveQuantity } from "./ledger";

function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes}분`;
  if (!minutes) return `${hours}시간`;
  return `${hours}시간 ${minutes}분`;
}

function formatHalfDays(halfDays: number): string {
  const whole = Math.floor(halfDays / 2);
  return halfDays % 2 ? `${whole}.5일` : `${whole}일`;
}

/**
 * Human-readable leave amount. Without a known workday the day and minute
 * parts are shown separately rather than combined through an assumption.
 */
export function formatLeaveQuantity(
  value: LeaveQuantity,
  workdayMinutes: number | null,
): string {
  if (workdayMinutes !== null) {
    // Work in half-minutes so an odd workday length stays exact.
    const doubled = value.halfDays * workdayMinutes + value.minutes * 2;
    const sign = doubled < 0 ? "-" : "";
    const absolute = Math.abs(doubled);
    const days = Math.floor(absolute / (2 * workdayMinutes));
    const remainder = Math.floor((absolute - days * 2 * workdayMinutes) / 2);
    const parts = [`${days}일`];
    if (remainder) parts.push(formatMinutes(remainder));
    return sign + parts.join(" ");
  }

  const dayPart = `${value.halfDays < 0 ? "-" : ""}${formatHalfDays(Math.abs(value.halfDays))}`;
  if (value.minutes === 0) return dayPart;
  const minutePart = formatMinutes(Math.abs(value.minutes));
  if (value.halfDays === 0)
    return `${value.minutes < 0 ? "-" : ""}${minutePart}`;
  return `${dayPart} ${value.minutes < 0 ? "−" : "+"} ${minutePart}`;
}

export function formatDurationMinutes(total: number): string {
  return formatMinutes(total);
}
