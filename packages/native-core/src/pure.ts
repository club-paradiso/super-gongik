import * as domain from "@super-gongik/domain";
import * as importer from "@super-gongik/importer";
import * as rules from "@super-gongik/rules";

import { buildNativeProjection } from "./projection";

// Pure web presentation helpers the native client reuses (no React/DOM).
import { floorPercent, formatDdayNumber, relativeDays } from "@/lib/home-model";
import {
  calculateLiveServiceProgress,
  formatLiveCompletionPercentage,
  formatLiveCountdown,
} from "@/lib/live-service-progress";
import {
  CATEGORY_LABELS,
  EVENT_CATEGORY,
  EVENT_TYPE_GROUPS,
  describeTiming,
  eventLabel,
} from "@/lib/event-display";
import {
  applyFormPatch,
  buildDraft,
  initialState,
  timingFromForm,
  type FormState,
} from "@/lib/event-form";
import { evaluateMoneyMonth } from "@/lib/money-model";
import {
  RESIDENCE_REGIONS,
  regionalFareSuggestion,
} from "@/lib/regional-transit-fares";
import { buildLedgerForProfile } from "@/lib/projections";

/**
 * Pure functions reachable from Swift by name, used by screens for
 * projections that are not part of `project()` and by the conformance
 * fixtures. Nothing here writes storage. Arguments arrive as JSON; an object
 * of the exact shape `{ "$instant": "<ISO-8601>" }` becomes a `Date`, so
 * functions taking an instant can be called and fixtured too.
 */
type PureFunction = (...args: never[]) => unknown;

const PURE = {
  // service / dates
  parseDateOnly: domain.parseDateOnly,
  addDays: domain.addDays,
  addCalendarMonths: domain.addCalendarMonths,
  differenceInCalendarDays: domain.differenceInCalendarDays,
  dateOnlyInTimeZone: domain.dateOnlyInTimeZone,
  calculateServiceProgress: domain.calculateServiceProgress,
  calculateServiceMonthIndex: domain.calculateServiceMonthIndex,
  listServiceMilestones: domain.listServiceMilestones,
  nextServiceMilestone: domain.nextServiceMilestone,
  serviceMilestoneOn: domain.serviceMilestoneOn,
  continuousServiceCompletion: domain.continuousServiceCompletion,
  seoulStartOfDay: domain.seoulStartOfDay,
  daysSinceDischarge: domain.daysSinceDischarge,
  buildServiceProfile: domain.buildServiceProfile,
  // calendar
  buildMonthGrid: domain.buildMonthGrid,
  countWeekdays: domain.countWeekdays,
  endDateForChargedDays: domain.endDateForChargedDays,
  // events
  validateServiceEventDraft: domain.validateServiceEventDraft,
  findLeaveOverlaps: domain.findLeaveOverlaps,
  compareLeaveRecords: domain.compareLeaveRecords,
  classifyAnnualLeaveUsage: domain.classifyAnnualLeaveUsage,
  // leave
  eventLeaveQuantity: domain.eventLeaveQuantity,
  buildLeaveLedger: domain.buildLeaveLedger,
  formatLeaveQuantity: domain.formatLeaveQuantity,
  formatDurationMinutes: domain.formatDurationMinutes,
  // store / backup / merge
  decodeUserData: domain.decodeUserData,
  canonicalJson: domain.canonicalJson,
  sha256Hex: domain.sha256Hex,
  createBackup: domain.createBackup,
  serializeBackup: domain.serializeBackup,
  parseBackup: domain.parseBackup,
  summarizeUserData: domain.summarizeUserData,
  analyzeMerge: domain.analyzeMerge,
  mergeUserData: domain.mergeUserData,
  replaceUserData: domain.replaceUserData,
  planRestore: domain.planRestore,
  executeRestore: domain.executeRestore,
  planImportRows: domain.planImportRows,
  // sync
  planPush: domain.planPush,
  validateRemoteRows: domain.validateRemoteRows,
  // rules
  deriveAnnualLeaveCredits: rules.deriveAnnualLeaveCredits,
  evaluateMonthlyCompensation: rules.evaluateMonthlyCompensation,
  findAttendanceMonth: rules.findAttendanceMonth,
  derivePayBandSchedule: rules.derivePayBandSchedule,
  currentPayStepOrdinal: rules.currentPayStepOrdinal,
  deriveMonthServiceDays: rules.deriveMonthServiceDays,
  // native screen contract
  buildNativeProjection,
  // web presentation helpers
  buildLedgerForProfile,
  calculateLiveServiceProgress,
  liveCompletionText: (
    period: Parameters<typeof calculateLiveServiceProgress>[0],
    now: Date,
  ) => {
    const progress = calculateLiveServiceProgress(period, now);
    return {
      percent: formatLiveCompletionPercentage(progress),
      countdown: formatLiveCountdown(progress),
    };
  },
  /** Category, label and timing text for each event (web event-display). */
  describeEvents: (events: domain.ServiceEvent[]) =>
    events.map((event) => ({
      id: event.id,
      category: EVENT_CATEGORY[event.eventType],
      label: eventLabel(event),
      timing: describeTiming(event),
    })),
  /** Event taxonomy shared with the web calendar and editor. */
  eventTaxonomy: () => ({
    typeLabels: domain.SERVICE_EVENT_TYPE_LABELS,
    categoryOfType: EVENT_CATEGORY,
    categoryLabels: CATEGORY_LABELS,
    typeGroups: EVENT_TYPE_GROUPS,
  }),
  // event editor form model (web lib/event-form.ts)
  eventFormInitial: initialState,
  eventFormPatch: applyFormPatch,
  /** Everything the editor shows for a form: the draft it would save, the
   * shared validation and the automatic usage classification. */
  eventFormEvaluate: (
    form: FormState,
    profile: domain.ServiceProfile,
    events: domain.ServiceEvent[],
    editingId: string | null,
  ) => {
    const draft = buildDraft(form, profile);
    return {
      draft,
      validation: domain.validateServiceEventDraft(draft, {
        existingEvents: events,
        editingId,
        servicePeriod: {
          callUpDate: profile.callUpDate,
          expectedDischargeDate: profile.expectedDischargeDate,
        },
      }),
      classification: domain.classifyAnnualLeaveUsage({
        eventType: form.eventType,
        timing: timingFromForm(form) as domain.ServiceEvent["timing"],
        workdayStartTime: profile.workdayStartTime ?? null,
        workdayEndTime: profile.workdayEndTime ?? null,
      }),
      isLeave: domain.isLeaveEventType(form.eventType),
      isAnnualCharge:
        form.eventType === "ANNUAL_LEAVE" ||
        domain.isAnnualLeaveAttendanceType(form.eventType),
      isNonPayable: domain.isCompensationNonPayableEventType(form.eventType),
    };
  },
  calculateExpectedDischargeDate: domain.calculateExpectedDischargeDate,
  /** Choices and labels the profile form needs (web profile tab). */
  profileOptions: () => ({
    residenceRegions: RESIDENCE_REGIONS,
    priorServiceBases: domain.PRIOR_SERVICE_BASES.map((basis) => ({
      value: basis,
      label: domain.PRIOR_SERVICE_BASIS_LABELS[basis],
    })),
    standardServiceMonths: domain.STANDARD_SERVICE_MONTHS,
  }),
  /** Verified regional fare suggestion, or null (web lib). */
  regionalFareSuggestion,
  // money screen month evaluation (web lib/money-model.ts)
  evaluateMoneyMonth,
  floorPercent,
  formatDdayNumber,
  relativeDays,
  // importer (synchronous parts)
  parseDelimitedText: importer.parseDelimitedText,
  mapColumns: importer.mapColumns,
  assessTableHeaders: importer.assessTableHeaders,
  normalizeEventRow: importer.normalizeEventRow,
  classifyEventType: importer.classifyEventType,
} as unknown as Record<string, PureFunction>;

export const PURE_FUNCTION_NAMES = Object.keys(PURE);

function revive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(revive);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1 && keys[0] === "$instant") {
      const instant = new Date(String(record.$instant));
      if (Number.isNaN(instant.getTime())) {
        throw new RangeError(`Invalid instant: ${String(record.$instant)}`);
      }
      return instant;
    }
    return Object.fromEntries(keys.map((key) => [key, revive(record[key])]));
  }
  return value;
}

/**
 * Run one store command as a pure function with a deterministic context
 * (fixed clock, device id and id sequence), so command behaviour itself can
 * be fixtured and replayed on another engine.
 */
export function applyCommand(
  commands: Record<string, (...args: never[]) => unknown>,
  name: string,
  data: unknown,
  args: unknown[],
  context: { now: string; deviceId: string; ids: string[] },
): PureOutcome {
  const command = commands[name];
  if (!command) {
    return {
      ok: false,
      error: { name: "UnknownCommand", message: `Unknown command: ${name}` },
    };
  }
  const ids = [...context.ids];
  const commandContext = {
    now: context.now,
    deviceId: context.deviceId,
    createId: () => {
      const id = ids.shift();
      if (!id) throw new Error("Fixture context ran out of ids.");
      return id;
    },
  };
  try {
    const value = command(
      ...([revive(data), ...args.map(revive), commandContext] as never[]),
    );
    return { ok: true, value };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    return {
      ok: false,
      error: { name: failure.name, message: failure.message },
    };
  }
}

export type PureOutcome =
  | { ok: true; value: unknown }
  | { ok: false; error: { name: string; message: string } };

/**
 * Calls never throw across the bridge: a thrown `RangeError` from the domain
 * (an invalid date, for example) is part of the observable contract and is
 * fixtured as `{ ok: false, error }`.
 */
export function callPure(name: string, args: unknown[]): PureOutcome {
  const fn = PURE[name];
  if (!fn) {
    return {
      ok: false,
      error: { name: "UnknownFunction", message: `Unknown function: ${name}` },
    };
  }
  try {
    const value = fn(...(args.map(revive) as never[]));
    return { ok: true, value: value === undefined ? null : value };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    return {
      ok: false,
      error: { name: failure.name, message: failure.message },
    };
  }
}
