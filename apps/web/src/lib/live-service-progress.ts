import type { ServiceProfile } from "@super-gongik/domain";

export type LiveServiceProgress = {
  remainingMilliseconds: number;
  completionPercentage: number;
  countdown: {
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
  };
};

const SEOUL_OFFSET = "+09:00";

function startOfSeoulDate(date: string) {
  return new Date(`${date}T00:00:00${SEOUL_OFFSET}`).getTime();
}

export function calculateLiveServiceProgress(
  profile: Pick<ServiceProfile, "callUpDate" | "expectedDischargeDate">,
  now: Date,
): LiveServiceProgress {
  const start = startOfSeoulDate(profile.callUpDate);
  const end = startOfSeoulDate(profile.expectedDischargeDate);
  const current = now.getTime();
  const total = Math.max(0, end - start);
  const elapsed = Math.min(total, Math.max(0, current - start));
  const remainingMilliseconds = Math.max(0, end - current);
  const totalSeconds = Math.floor(remainingMilliseconds / 1000);

  return {
    remainingMilliseconds,
    completionPercentage:
      total === 0 ? 100 : Math.min(100, Math.max(0, (elapsed / total) * 100)),
    countdown: {
      days: Math.floor(totalSeconds / 86_400),
      hours: Math.floor((totalSeconds % 86_400) / 3_600),
      minutes: Math.floor((totalSeconds % 3_600) / 60),
      seconds: totalSeconds % 60,
    },
  };
}

export function formatLiveCountdown(progress: LiveServiceProgress) {
  const { days, hours, minutes, seconds } = progress.countdown;
  return `D-${days} ${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0",
  )}:${String(seconds).padStart(2, "0")}`;
}
