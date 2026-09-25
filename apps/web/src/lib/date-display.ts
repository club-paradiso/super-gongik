import { isDateOnly } from "@super-gongik/domain";

const dateFormat = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});
const weekdayFormat = new Intl.DateTimeFormat("ko-KR", {
  weekday: "short",
  timeZone: "UTC",
});

/** "2026년 9월 25일 (금)" for a valid YYYY-MM-DD, otherwise "". */
export function formatDateInputDisplay(value: string) {
  if (!isDateOnly(value)) return "";
  const [year, month, day] = value.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  return `${dateFormat.format(date)} (${weekdayFormat.format(date)})`;
}
