"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import {
  addDays,
  continuousServiceCompletion,
  dateOnlyInTimeZone,
  seoulStartOfDay,
  type DateOnly,
  type ServiceProfile,
} from "@super-gongik/domain";

/** Milliseconds from `now` until the next 00:00 in Asia/Seoul. */
export function msUntilNextSeoulMidnight(now: number): number {
  const today = dateOnlyInTimeZone(new Date(now));
  return seoulStartOfDay(addDays(today, 1)) - now;
}

function subscribeToSeoulDate(onChange: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    // A little past midnight so the new date is certainly observable.
    timer = setTimeout(
      () => {
        onChange();
        schedule();
      },
      msUntilNextSeoulMidnight(Date.now()) + 500,
    );
  };
  // Timers are suspended in background tabs and installed iOS web apps, so
  // re-check whenever the page becomes visible again.
  const resume = () => {
    if (document.visibilityState === "visible") {
      onChange();
      schedule();
    }
  };
  schedule();
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("pageshow", resume);
  window.addEventListener("focus", resume);
  return () => {
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("pageshow", resume);
    window.removeEventListener("focus", resume);
  };
}

const readSeoulDate = () => dateOnlyInTimeZone(new Date());

/**
 * Today's calendar date in Asia/Seoul that re-renders exactly when it
 * changes: at Seoul midnight while open, and on return from background.
 * The snapshot is a string, so unrelated wake-ups cause no re-render.
 */
export function useSeoulToday(): DateOnly {
  return useSyncExternalStore(
    subscribeToSeoulDate,
    readSeoulDate,
    readSeoulDate,
  );
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/**
 * Continuous completion (0–1) for the live percentage. Ticks once a second
 * while visible (once a minute with reduced motion) and stops entirely
 * when `enabled` is false or the page is hidden, so it costs nothing in the
 * background. Only the component that calls this re-renders.
 */
export function useLiveCompletion(
  period: Pick<ServiceProfile, "callUpDate" | "expectedDischargeDate">,
  enabled: boolean,
): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      clearInterval(timer);
      setNow(Date.now());
      timer = setInterval(
        () => setNow(Date.now()),
        prefersReducedMotion() ? 60_000 : 1_000,
      );
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else clearInterval(timer);
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);

  return continuousServiceCompletion(period, new Date(now));
}
