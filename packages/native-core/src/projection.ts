import { isDateOnly, type DateOnly, type UserData } from "@super-gongik/domain";
import {
  currentPayStepOrdinal,
  deriveAnnualLeaveCredits,
  derivePayBandSchedule,
} from "@super-gongik/rules";

// The web home model and projection glue are pure modules with no React or
// DOM imports. The native client runs them unchanged instead of
// re-implementing their phase, milestone and pay-card decisions in Swift, so
// both clients show the same hero, leave card and pay card for the same data.
import { buildHomeModel } from "@/lib/home-model";
import { buildAppProjection } from "@/lib/projections";

/**
 * What every native screen renders for one Seoul civil date: the web's
 * `buildAppProjection` and `buildHomeModel`, plus the credit list and pay
 * band schedule the money and leave screens read directly.
 */
export function buildNativeProjection(data: UserData, today: string) {
  if (!isDateOnly(today)) throw new RangeError(`Invalid date: ${today}`);
  const date = today as DateOnly;
  const profile = data.profile;
  if (!profile) return { today: date, profile: null } as const;

  const projection = buildAppProjection(data, profile, date);
  const payBands = derivePayBandSchedule(profile, date);
  return {
    today: date,
    profile,
    ...projection,
    home: buildHomeModel(profile, projection, date),
    credits: deriveAnnualLeaveCredits({
      callUpDate: profile.callUpDate,
      referenceDate: date,
    }),
    payBands,
    // Same inputs as the web money tab and home model.
    payStepOrdinal: currentPayStepOrdinal(
      payBands,
      projection.compensation.serviceMonthOrdinal,
    ),
  };
}

export type NativeProjection = ReturnType<typeof buildNativeProjection>;
