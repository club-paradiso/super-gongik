import * as domain from "@super-gongik/domain";
import {
  createBackup,
  createId,
  createUserDataRepository,
  createUserDataStore,
  decodeUserDataText,
  parseBackup,
  planRestore,
  serializeBackup,
  type CommandContext,
  type CommandResult,
  type MergeOptions,
  type RestoreMode,
  type UserData,
  type UserDataStore,
} from "@super-gongik/domain";

import {
  COLLECTION_LABELS,
  CONFLICT_TYPE_COPY,
  PROFILE_COPY,
  describeCounts,
  describeVersion,
  parseErrorTitle,
  restoreErrorTitle,
  restoreGate,
} from "@/lib/restore-copy";

import {
  DAY_KIND_LABELS,
  attendanceEditorDays,
  attendanceMonthInput,
  evaluateMoneyMonth,
  type AttendanceDraft,
} from "@/lib/money-model";
import {
  buildImportPreview,
  createImportBatchDescriptor,
  parseDelimitedText,
  type ImportPreview,
} from "@super-gongik/importer";
import { findAttendanceMonth } from "@super-gongik/rules";
import {
  DECISION_LABELS,
  buildImportCommit,
  defaultAcceptedRows,
  defaultAcceptedSnapshots,
  describeImportSummary,
  rowStatuses,
  type EventOverride,
} from "@/lib/import-model";
import { buildLedgerForProfile } from "@/lib/projections";

import {
  AUTH_ERROR_COPY,
  HELD_REASON_COPY,
  conflictSides,
  describePreview,
  formatTime,
  syncLabel,
} from "@/lib/sync-copy";

import { createNativeCloud, type NativeCloud } from "./cloud";
import { createNativeStorage, host } from "./host";
import { buildNativeProjection } from "./projection";
import { applyCommand, callPure } from "./pure";

/**
 * Bumped whenever the facade's method names or JSON shapes change. The Swift
 * bridge refuses to run against a bundle with a different major version.
 */
export const FACADE_VERSION = "1.0.0";

type AnyCommand = (
  data: UserData,
  ...args: [...unknown[], CommandContext]
) => CommandResult<unknown>;

/**
 * Store commands the native client may run, by name. Each is the unchanged
 * domain function `(data, ...args, context)`; the facade only forwards
 * arguments. Anything not listed here cannot be invoked from Swift.
 */
const COMMANDS = {
  createProfile: domain.createProfile,
  editProfile: domain.editProfile,
  createServiceEvent: domain.createServiceEvent,
  updateServiceEvent: domain.updateServiceEvent,
  deleteServiceEvent: domain.deleteServiceEvent,
  restoreServiceEvent: domain.restoreServiceEvent,
  commitImport: domain.commitImport,
  rollbackImport: domain.rollbackImport,
  confirmLeaveCredit: domain.confirmLeaveCredit,
  addLeaveCorrection: domain.addLeaveCorrection,
  deleteLeaveAdjustment: domain.deleteLeaveAdjustment,
  saveAttendanceMonth: domain.saveAttendanceMonth,
  saveCompensationSnapshot: domain.saveCompensationSnapshot,
  deleteCompensationSnapshot: domain.deleteCompensationSnapshot,
} as unknown as Record<string, AnyCommand>;

export const COMMAND_NAMES = Object.keys(COMMANDS);

function json(value: unknown): string {
  return JSON.stringify(value === undefined ? null : value);
}

function parseArgs(argsJson: string): unknown[] {
  const args: unknown = JSON.parse(argsJson);
  if (!Array.isArray(args)) throw new TypeError("args must be a JSON array.");
  return args;
}

/**
 * The single stateful object living inside JavaScriptCore: the same
 * `createUserDataStore` + `createUserDataRepository` the web app uses, on
 * top of the native file storage. Every method takes and returns JSON text
 * so the Swift side decodes with `Codable` and never touches `JSValue`s.
 */
export function createNativeRuntime() {
  let store: UserDataStore | null = null;
  let cloud: NativeCloud | null = null;

  function requireCloud(): NativeCloud {
    if (!cloud)
      cloud = createNativeCloud(requireStore(), createNativeStorage());
    return cloud;
  }

  function requireStore(): UserDataStore {
    if (!store) throw new Error("open() must be called first.");
    return store;
  }

  function readyData(): UserData {
    const snapshot = requireStore().getSnapshot();
    if (snapshot.phase !== "READY") throw new Error("Store is not ready.");
    return snapshot.data;
  }

  return {
    version: FACADE_VERSION,
    commandNames: () => json(COMMAND_NAMES),

    /** Load (migrate, recover or quarantine) the stored document. */
    async open(): Promise<string> {
      if (!store) {
        store = createUserDataStore({
          repository: createUserDataRepository(createNativeStorage(), {
            now: () => new Date().toISOString(),
            createId,
          }),
          createId,
          // One process, one store instance: the store's own queue plus the
          // storage compare-and-set serialize every write.
        });
      }
      await store.load();
      return json(store.getSnapshot());
    },

    snapshot: (): string => json(requireStore().getSnapshot()),

    async refresh(): Promise<string> {
      await requireStore().refresh();
      return json(requireStore().getSnapshot());
    },

    dismissNotice(): string {
      requireStore().dismissNotice();
      return json(requireStore().getSnapshot());
    },

    /** Run a whitelisted store command; returns RunResult JSON. */
    async run(name: string, argsJson: string): Promise<string> {
      const command = COMMANDS[name];
      if (!command) throw new Error(`Unknown command: ${name}`);
      const args = parseArgs(argsJson);
      const result = await requireStore().run((data, context) =>
        command(data, ...args, context),
      );
      return json(result);
    },

    /**
     * Edit the profile by patching the stored one, the way the web profile
     * form submits `{ ...profile, ...fields }`. Merging here means fields the
     * native client does not model are kept, never reset.
     */
    async editProfile(patchJson: string): Promise<string> {
      const patch: unknown = JSON.parse(patchJson);
      if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
        throw new TypeError("patch must be an object.");
      }
      const result = await requireStore().run((data, context) => {
        if (!data.profile)
          return domain.editProfile(data, patch as never, context);
        return domain.editProfile(
          data,
          { ...data.profile, ...(patch as object) } as never,
          context,
        );
      });
      return json(result);
    },

    /** "이 기기의 모든 데이터 지우기": records and every recovery copy. */
    async wipeAll(): Promise<string> {
      return json(await requireStore().wipeAll());
    },

    /** Everything the screens render for `today` (a Seoul civil date). */
    project(today: string): string {
      return json(buildNativeProjection(readyData(), today));
    },

    /** Money screen month evaluation over the stored document. */
    moneyMonth(month: string, today: string): string {
      const data = readyData();
      if (!data.profile) throw new Error("No profile.");
      return json(
        callPure("evaluateMoneyMonth", [data, data.profile, month, today]),
      );
    },

    /**
     * The money screen's month attendance editor (web money-tab
     * AttendanceEditor): offered days, saved answers, records-derived
     * non-payable dates and day-kind labels for `month`.
     */
    attendanceEditor(
      month: string,
      nonWorkingJson: string,
      today: string,
    ): string {
      const data = readyData();
      if (!data.profile) throw new Error("No profile.");
      const { compensation } = evaluateMoneyMonth(
        data,
        data.profile,
        month as never,
        today as never,
      );
      const days = compensation.serviceDays?.days ?? [];
      const nonWorking = new Set(JSON.parse(nonWorkingJson) as string[]);
      return json({
        existing: findAttendanceMonth(data.attendanceMonths, month as never),
        days,
        ...attendanceEditorDays(days, nonWorking as never),
        derivedNonPayableDates:
          compensation.basePayAdjustment?.derivedNonPayableDates ?? [],
        mealEligibleDays: compensation.serviceDays?.mealEligibleDays ?? null,
        transportEligibleDays:
          compensation.serviceDays?.transportEligibleDays ?? null,
        needsReconfirmation:
          compensation.serviceDays?.missing.includes("MONTH_RECONFIRMATION") ??
          false,
        dayKindLabels: DAY_KIND_LABELS,
      });
    },

    /** Save the editor state exactly as the web editor does. */
    async saveAttendance(draftJson: string, today: string): Promise<string> {
      const draft = JSON.parse(draftJson) as AttendanceDraft;
      const result = await requireStore().run((data, context) => {
        if (!data.profile) {
          return {
            ok: false as const,
            errors: [
              {
                code: "INVALID_FIELD" as const,
                message: "복무 프로필이 없어요.",
              },
            ],
          };
        }
        const { compensation } = evaluateMoneyMonth(
          data,
          data.profile,
          draft.month,
          today as never,
        );
        return domain.saveAttendanceMonth(
          data,
          attendanceMonthInput(draft, compensation),
          context,
        );
      });
      return json(result);
    },

    // ── Optional cloud sync (web cloud controller, unchanged) ───────────────

    /** Start once after `open()`. Guests: no network, nothing happens. */
    async cloudStart(): Promise<string> {
      const { controller } = requireCloud();
      await controller.start();
      return json(controller.getState());
    },
    cloudState: (): string => json(requireCloud().controller.getState()),

    /** State plus the web sync panel's wording for it (sync-copy.ts). */
    cloudView(): string {
      const state = requireCloud().controller.getState();
      const sync = state.sync;
      return json({
        state,
        label: syncLabel(state),
        authError: state.authError ? AUTH_ERROR_COPY[state.authError] : null,
        lastSynced: formatTime(sync?.lastSyncedAt ?? null),
        resetAt:
          sync?.block?.reason === "GENERATION_MISMATCH"
            ? formatTime(sync.block.account.resetAt)
            : null,
        conflicts: (sync?.conflicts ?? []).map((conflict) => ({
          key: conflict.key,
          collection: conflict.collection,
          ...conflictSides(conflict),
        })),
        held: (sync?.held ?? []).map((item) => ({
          key: item.key,
          reason: item.reason ? HELD_REASON_COPY[item.reason] : null,
        })),
      });
    },

    /** The web's sentence for an enable preview. */
    cloudDescribePreview(previewJson: string): string {
      const preview = JSON.parse(previewJson);
      return json(preview.kind === "READY" ? describePreview(preview) : null);
    },
    async cloudSendCode(email: string): Promise<string> {
      return json(await requireCloud().controller.sendCode(email));
    },
    async cloudVerifyCode(code: string): Promise<string> {
      return json(await requireCloud().controller.verifyCode(code));
    },
    cloudCancelCode(): string {
      requireCloud().controller.cancelCode();
      return json(null);
    },
    async cloudSignOut(): Promise<string> {
      await requireCloud().controller.signOut();
      return json(null);
    },
    cloudSessionChanged(sessionJson: string | null): string {
      requireCloud().sessionChanged(sessionJson);
      return json(null);
    },
    async cloudPreview(): Promise<string> {
      return json(await requireCloud().preview());
    },
    async cloudEnable(previewJson: string): Promise<string> {
      return json(await requireCloud().enable(JSON.parse(previewJson)));
    },
    async cloudSyncNow(): Promise<string> {
      return json(await requireCloud().controller.syncNow());
    },
    async cloudResolve(
      session: string,
      resolutionsJson: string,
    ): Promise<string> {
      return json(
        await requireCloud().resolve(session, JSON.parse(resolutionsJson)),
      );
    },
    async cloudDisable(session: string): Promise<string> {
      return json(await requireCloud().controller.disableSync(session));
    },
    async cloudDeleteData(session: string): Promise<string> {
      return json(await requireCloud().controller.deleteCloudData(session));
    },
    async cloudListBackups(): Promise<string> {
      return json(await requireCloud().controller.listBackups());
    },
    async cloudUploadBackup(session: string): Promise<string> {
      return json(await requireCloud().controller.uploadBackup(session));
    },
    async cloudDownloadBackup(id: string): Promise<string> {
      return json(await requireCloud().controller.downloadBackup(id));
    },
    async cloudDeleteBackup(session: string, id: string): Promise<string> {
      return json(await requireCloud().controller.deleteBackup(session, id));
    },
    cloudNotifyForeground(): string {
      requireCloud().controller.notifyForeground();
      return json(null);
    },
    cloudNotifyOnline(): string {
      requireCloud().controller.notifyOnline();
      return json(null);
    },
    async cloudAfterRestore(mode: "MERGE" | "REPLACE"): Promise<string> {
      await requireCloud().controller.afterRestore(mode);
      return json(null);
    },
    async cloudAfterLocalWipe(): Promise<string> {
      await requireCloud().controller.afterLocalWipe();
      return json(null);
    },

    // ── Institution record import (CSV/TSV text) ───────────────────────────

    /**
     * Parse delimited text and preview it exactly as the web import panel:
     * candidate rows, statuses against stored records and default selection.
     * Nothing is written.
     */
    async importPreview(
      text: string,
      fileName: string,
      fileSha256: string | null,
    ): Promise<string> {
      const tabular = parseDelimitedText(text);
      const batch = createImportBatchDescriptor({
        fileName,
        sourceFormat: tabular.format,
        fileSha256,
      });
      const preview = await buildImportPreview(tabular, batch);
      const statuses = rowStatuses(readyData(), preview);
      return json({
        preview,
        statuses: Object.fromEntries(statuses),
        acceptedRows: [...defaultAcceptedRows(preview, statuses)],
        acceptedSnapshots: [...defaultAcceptedSnapshots(preview)],
        decisionLabels: DECISION_LABELS,
        alreadyImported: readyData().imports.some(
          (record) =>
            record.status === "ACTIVE" &&
            fileSha256 !== null &&
            record.fileSha256 === fileSha256,
        ),
      });
    },

    /** Commit accepted rows and snapshots of a preview (web import panel). */
    async importCommit(
      previewJson: string,
      overridesJson: string,
      acceptedRowsJson: string,
      acceptedSnapshotsJson: string,
    ): Promise<string> {
      const preview = JSON.parse(previewJson) as ImportPreview;
      const { input, rejected } = await buildImportCommit(
        preview,
        JSON.parse(overridesJson) as Record<number, EventOverride>,
        new Set(JSON.parse(acceptedRowsJson) as number[]),
        new Set(JSON.parse(acceptedSnapshotsJson) as number[]),
      );
      const result = await requireStore().run((data, context) =>
        domain.commitImport(data, input, context),
      );
      return json(
        result.ok
          ? {
              ok: true,
              message: describeImportSummary(result.value, rejected.length),
            }
          : {
              ok: false,
              errors: result.errors,
              rejected,
            },
      );
    },

    /** CSV exports offered by the web backup panel. */
    exportCsv(kind: "events" | "leave", today: string): string {
      const data = readyData();
      if (kind === "events")
        return json(domain.serviceEventsToCsv(data.events));
      if (!data.profile) throw new Error("No profile.");
      return json(
        domain.leaveLedgerToCsv(
          buildLedgerForProfile(data, data.profile, today as never).entries,
        ),
      );
    },

    /** Editor initial state for a stored event (or a new one on `date`). */
    eventFormInitial(eventId: string | null, date: string): string {
      const event =
        eventId === null
          ? null
          : (readyData().events.find((item) => item.id === eventId) ?? null);
      return json(callPure("eventFormInitial", [event, date]));
    },

    /** Editor evaluation against the stored profile and events. */
    eventFormEvaluate(formJson: string, editingId: string | null): string {
      const data = readyData();
      if (!data.profile) throw new Error("No profile.");
      return json(
        callPure("eventFormEvaluate", [
          JSON.parse(formJson),
          data.profile,
          data.events,
          editingId,
        ]),
      );
    },

    /** Pure domain/rules/importer functions by whitelisted name. */
    call(name: string, argsJson: string): string {
      return json(callPure(name, parseArgs(argsJson)));
    },

    /** A store command as a pure function with a fixed context (fixtures). */
    applyCommand(
      name: string,
      dataJson: string,
      argsJson: string,
      contextJson: string,
    ): string {
      return json(
        applyCommand(
          COMMANDS as unknown as Record<string, (...args: never[]) => unknown>,
          name,
          JSON.parse(dataJson),
          parseArgs(argsJson),
          JSON.parse(contextJson),
        ),
      );
    },

    // ── Backup / restore (same contract as the web backup panel) ──────────

    exportBackup(exportedAt: string): string {
      const backup = createBackup(readyData(), exportedAt);
      return json({ text: serializeBackup(backup), backup });
    },

    /**
     * Parse and preview; never writes. Returns the plan plus the web backup
     * panel's wording for it (restore-copy.ts), and whether the confirm
     * button may be enabled for the given choices.
     */
    previewRestore(
      text: string,
      mode: RestoreMode,
      optionsJson: string,
    ): string {
      const parsed = parseBackup(text);
      if (!parsed.ok) {
        return json({ ok: false, parsed, title: parseErrorTitle(parsed.kind) });
      }
      const current = readyData();
      const options = (JSON.parse(optionsJson) ?? {}) as MergeOptions & {
        destructiveConfirmed?: boolean;
      };
      const plan = planRestore(current, parsed.data, {
        mode,
        options,
        now: new Date().toISOString(),
        deviceId: current.deviceId,
      });
      return json({
        ok: true,
        summary: parsed.summary,
        info: parsed.info,
        plan: { ...plan, result: null },
        presentation: {
          profile: PROFILE_COPY[plan.profile],
          collections: Object.entries(plan.counts).map(([key, counts]) => ({
            key,
            label: COLLECTION_LABELS[key as keyof typeof COLLECTION_LABELS],
            text: describeCounts(counts),
          })),
          conflicts: plan.conflicts.map((conflict) => ({
            key: conflict.key,
            collection: COLLECTION_LABELS[conflict.collection],
            explanation: CONFLICT_TYPE_COPY[conflict.type],
            local: describeVersion(conflict.local),
            incoming: describeVersion(conflict.incoming),
          })),
          gate: restoreGate(plan, {
            resolutions: options.resolutions ?? {},
            destructiveConfirmed: options.destructiveConfirmed ?? false,
          }),
        },
      });
    },

    /** Apply a previewed restore; the store re-plans and refuses stale previews. */
    async restore(text: string, requestJson: string): Promise<string> {
      const parsed = parseBackup(text);
      if (!parsed.ok) return json({ ok: false, code: "INVALID", parsed });
      const request = JSON.parse(requestJson);
      const execution = await requireStore().restore(parsed.data, request);
      return json(
        execution.ok
          ? { ok: true, plan: { ...execution.plan, result: null } }
          : { ...execution, title: restoreErrorTitle(execution.code) },
      );
    },

    /** Raw stored text for a key (quarantine export); null when absent. */
    async readRaw(key: string): Promise<string> {
      return json(await requireStore().readRaw(key));
    },

    /** Validate a document without storing it (used by conformance tests). */
    decode(text: string): string {
      return json(decodeUserDataText(text));
    },

    log(message: string) {
      host().log("debug", message);
    },
  };
}

export type NativeRuntime = ReturnType<typeof createNativeRuntime>;
