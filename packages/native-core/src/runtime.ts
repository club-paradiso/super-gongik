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
