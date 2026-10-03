# Native iOS client — Phase 0 audit

- Date: 2026-10-03
- Base: `main` at `fb5662d` (PR #50 merged 2026-10-01)
- Branch: `feat/native-ios-v1`
- Scope: everything a native SwiftUI client depends on. Claims below were
  checked against code, not only against docs; where the docs and the code
  disagree, the code wins and the difference is listed.

## 1. Baseline on `main`

| Check                                    | Result                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm lint`, `format:check`, `typecheck` | pass                                                                                                                                       |
| `pnpm test` (parallel, `-r`)             | 1 failure: `sync-engine.test.ts › scale (indicative timings, not an SLA)` timed out at 5 s while four packages ran at once on this machine |
| `pnpm -r --workspace-concurrency=1 test` | pass — domain 233, importer 20, rules 119, web 71 (+7 skipped)                                                                             |
| CI on `main` (GitHub Actions)            | green for the last three merges                                                                                                            |
| `pnpm build`                             | not run locally (98 % full disk); CI builds it on every push                                                                               |
| Open PRs                                 | none                                                                                                                                       |
| Open issues                              | #29 provision hosted Supabase and live cloud/iPhone verification (P1), #19 independently verify 2026 MMA HWPX bytes (P2)                   |

The timing-only failure is environmental, not a regression. It is recorded
here because a native CI job running next to it will make the machine busier.

## 2. Architecture map (as built)

```text
apps/web (Next.js 16 PWA)
  components/   React screens — no policy, but see §6 for UI-resident logic
  lib/          pure presentation models (home-model, projections,
                live-service-progress, event-display, restore-copy, sync-copy)
                + browser adapters (browser-storage, file-import-adapters,
                download, sync/*)
packages/domain   dates, profile, events + validation, leave ledger,
                  UserData schema v3 + migrations, repository (generations,
                  quarantine, pre-restore), store controller, backup/merge,
                  CSV, sync engine + scheduler + reference server
packages/rules    effective-dated bundles, leave credits, monthly
                  compensation with safety gates, pay bands, service days
packages/importer CSV/TSV parsing, column mapping, normalization, preview,
                  fingerprints, import drafts
supabase          3 migrations: sync_accounts / sync_records / cloud_backups,
                  forced RLS, invoker-rights RPCs, direct-write guard
```

Dependencies: `domain` → zod; `rules` → domain, zod; `importer` → domain.
None import React, DOM or Node APIs. `apps/web/src/lib/{home-model,
projections, live-service-progress, event-display}` are also pure.

## 3. Web feature inventory (what a native client must cover)

| Area         | Web surface                                                                                                       | Domain entry points                                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Onboarding   | call-up date → discharge auto-fill, optional category, restore from backup, sign in                               | `createProfile`, `calculateExpectedDischargeDate`                                                                                         |
| Home         | night-sky hero (D-day, %, optional 1 Hz live readout), next milestone, leave and pay cards, agenda, quick actions | `buildAppProjection`, `buildHomeModel`, `calculateLiveServiceProgress`                                                                    |
| Calendar     | month grid with multi-day bars, agenda with filters and recently deleted, ledger view, undo                       | `create/update/delete/restoreServiceEvent`, `buildMonthGrid`                                                                              |
| Event editor | type groups, ALL_DAY / HALF_DAY / PARTIAL, auto-classification, warnings to acknowledge                           | `validateServiceEventDraft`, `classifyAnnualLeaveUsage`                                                                                   |
| Leave        | balance, credits + confirmation, institution reconciliation, corrections, other leave, attendance minutes, CSV    | `buildLeaveLedger`, `confirmLeaveCredit`, `addLeaveCorrection`, `deleteLeaveAdjustment`, `leaveLedgerToCsv`                               |
| Money        | month switcher, total only when every component resolves, components with sources, attendance editor, snapshots   | `evaluateMonthlyCompensation`, `derivePayBandSchedule`, `currentPayStepOrdinal`, `saveAttendanceMonth`, `save/deleteCompensationSnapshot` |
| Profile      | schedule, work pattern, prior-service credit, meal/commute, region fare suggestion, live-progress toggle          | `editProfile`, `regionalFareSuggestion` (web lib)                                                                                         |
| Backup       | JSON export, events/leave CSV, import → preview → MERGE/REPLACE, conflicts, destructive confirmation              | `createBackup`, `parseBackup`, `planRestore`, `store.restore`                                                                             |
| Import       | CSV/TSV/XLSX/HWP/HWPX/text PDF/OCR, column mapping, per-row status, accept/reject, rollback                       | `buildImportPreview`, `buildImportDrafts`, `planImportRows`, `commitImport`, `rollbackImport`                                             |
| Cloud        | email OTP, Google, Kakao, NAVER; enable preview; sync; conflicts; cloud backups; cloud reset                      | `createSyncEngine`, `createSyncScheduler`, Supabase transport                                                                             |
| Storage      | load notices (MIGRATED / RECOVERED / CORRUPT / NEWER_VERSION), quarantine download, wipe                          | `createUserDataStore`, `createUserDataRepository`                                                                                         |

## 4. Domain dependency map for native

| Concern                      | Where it lives                                          | Native strategy (ADR 0003)                                     |
| ---------------------------- | ------------------------------------------------------- | -------------------------------------------------------------- |
| civil dates, Seoul today     | `domain/service/date-only.ts`                           | Swift port **and** JSC; fixtures `dates`                       |
| progress / D-day             | `domain/service/progress.ts`                            | Swift port (widgets) **and** JSC; fixtures `service-progress`  |
| live seconds progress        | `web/lib/live-service-progress.ts`                      | Swift port (1 Hz hero) **and** JSC; fixtures `live-progress`   |
| milestones, home model       | `domain/service/milestones.ts`, `web/lib/home-model.ts` | JSC only; fixtures `milestones`, `projection`                  |
| events, validation, overlaps | `domain/events/*`                                       | JSC only; fixtures `events`, `commands`                        |
| leave credits, ledger        | `rules/leave-credits.ts`, `domain/leave/*`              | JSC only; fixtures `leave`                                     |
| compensation, pay bands      | `rules/*`                                               | JSC only; fixtures `compensation`                              |
| UserData schema, migrations  | `domain/store/schema.ts`, `legacy.ts`                   | JSC only; fixtures `backup`                                    |
| repository, store controller | `domain/store/repository.ts`, `controller.ts`           | JSC over a native file `KeyValueStorage` (ADR 0004)            |
| backup, merge, restore       | `domain/store/{backup,merge,restore}.ts`                | JSC only; fixtures `backup`                                    |
| sync engine, scheduler       | `domain/sync/*`                                         | JSC, Swift transport + timers + Keychain session (Phase 5)     |
| importer normalization       | `packages/importer`                                     | JSC; native readers produce `TabularAdapterResult` (Phase 6/7) |

## 5. Supabase dependency map

No schema, RLS or function change is needed for a native client. Every
policy is `user_id = auth.uid()` for `authenticated`; `anon` has no grants;
all RPCs are `SECURITY INVOKER` with `search_path = ''`.

| Call             | Wire                                                                                                                  | Native                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `ensureAccount`  | `POST /rest/v1/rpc/sync_ensure_account {}`                                                                            | URLSession, typed response       |
| `pull`           | `rpc/sync_pull {p_generation, p_after_seq, p_limit}`                                                                  | same                             |
| `push`           | `rpc/sync_push {p_generation, p_device_id, p_items[{collection, record_id, base_seq, schema_version, payload}]}`      | same (`base_seq` sent as `null`) |
| `resetCloud`     | `rpc/sync_reset {p_expected_generation}`                                                                              | same                             |
| `listBackups`    | `GET /rest/v1/cloud_backups?select=…&order=created_at.desc`                                                           | same                             |
| `uploadBackup`   | `rpc/backup_create {…}`                                                                                               | same                             |
| `downloadBackup` | `GET cloud_backups?select=content&id=eq.<id>` + `Accept: application/vnd.pgrst.object+json`                           | same                             |
| `deleteBackup`   | `rpc/backup_delete {p_id}`                                                                                            | same                             |
| error categories | status 0 → NETWORK; 401/403, 28000, 42501, PGRST301/302 → AUTH; 429 → RATE_LIMITED; PGRST116 → NOT_FOUND; else SERVER | identical table in Swift         |

Dashboard (not SQL) work: add the iOS OAuth redirect (custom scheme or
universal link) to Auth → URL configuration → Redirect URLs. Hosted Supabase
is not provisioned yet (issue #29), so live auth cannot be verified in this
branch.

## 6. Findings that affect the port

1. **Policy-relevant logic inside React components.** The event editor
   (`event-editor.tsx` `buildDraft` / `update`) rewrites a PARTIAL draft to
   ALL_DAY/HALF_DAY when the usage classification is automatic, forces
   non-payable types to ALL_DAY and derives day counts. The import panel
   decides default row selection (NEW, no overlap, no blocking warning,
   snapshot confidence ≥ 0.7). The money tab picks `asOfDate` (`today` for
   the current month, otherwise `YYYY-MM-15`) and contains the soldier
   savings constants. These cannot be imported by a native client. Plan:
   move each into a pure module under `apps/web/src/lib` (no behaviour
   change, web tests unchanged), then bundle it like `home-model.ts`.
   Until then the native editor submits drafts that the shared
   `validateServiceEventDraft` checks, so an inconsistent draft is
   rejected, never silently stored.
2. **Home pay card vs money tab.** `lib/projections.ts` calls
   `evaluateMonthlyCompensation` without `attendanceMonths`; the money tab
   passes them. The rules fall back to `[attendance]`, so results match for
   the current month. Logged, not changed (web behaviour).
3. **Web-only presentation logic reused natively.** `home-model.ts` says "No
   policy lives here" but holds phase thresholds (D-30), milestone choice and
   pay-card states. The native client runs it unchanged through the bundle
   rather than re-deriving it.
4. **Regional fare suggestions** live in `apps/web/src/lib` (Seoul and Jeju
   only, verified 2026-09-26). Native must reuse, not copy, them.
5. **Runtime gaps in JavaScriptCore**: no `crypto`, `TextEncoder`, `URL`,
   timers. Covered by `packages/native-core/shims/jsc-shims.js` plus native
   host functions; `Intl` with `timeZone` and `ko-KR` is available on Apple
   platforms (verified by fixtures).
6. **`parseDateOnly` rejects years 0–99** (`Date.UTC` maps them to 1900+).
   Found by the first fixture run; the Swift port now matches.
7. **Docs drift**: ADR 0001 lists only `crypto.getRandomValues` and
   `crypto.subtle` as JSC needs (`TextEncoder` is also needed);
   `ARCHITECTURE.md` §8 says only email OTP exists (Google, Kakao and NAVER
   shipped in #50); `apps-in-toss-ux-guidelines.md` describes a floating tab
   bar while the CSS has a fixed full-width bar.
8. **App icon**: production icons in `apps/web/public` are the logo #51
   artwork; `docs/design/app-icon/SUPER_GONGIK_APP_ICON_V3.svg` is a
   candidate that the README says has not replaced production. The iOS
   AppIcon uses the production artwork until the product owner adopts V3.

## 7. Native feasibility

| Capability                  | Feasible | Notes                                                                                                       |
| --------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| Run the TS core in JSC      | yes      | spike: full bundle (≈440 KB) loads in ≈50 ms on an M-series Mac; all 364 fixtures identical to Node         |
| Offline, guest, local-first | yes      | file storage + shared repository; no network until sign-in                                                  |
| Widgets                     | yes      | Swift-native progress from an App Group snapshot; timeline at Seoul midnight; no per-second claims          |
| Notifications               | yes      | local `UNCalendarNotificationTrigger`s computed from projections; no push server needed                     |
| Face ID lock                | yes      | `LAContext` `.deviceOwnerAuthentication` (passcode fallback), privacy cover on inactive                     |
| File import                 | partial  | CSV/TSV via shared importer now; XLSX/HWP/HWPX/PDF need native readers or moving web parsers into a package |
| OCR                         | later    | VisionKit document camera + Vision text → positioned text → shared table reconstruction (needs refactor #1) |
| Supabase sync               | yes      | shared engine in JSC; Swift transport; needs hosted project to verify (#29)                                 |
| OAuth (Google/Kakao/NAVER)  | yes      | `ASWebAuthenticationSession` + PKCE against Supabase `/auth/v1/authorize`; no provider SDKs required        |
| Sign in with Apple          | required | App Review Guideline 4.8 applies once Google/Kakao/NAVER are offered; needs Supabase Apple provider setup   |

## 8. Risk register

| #   | Risk                                                           | Impact | Mitigation                                                                                                 |
| --- | -------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| R1  | Swift and TS diverge on business rules                         | high   | business rules run only in the shared TS bundle; Swift slice limited to dates/progress, fixture-locked     |
| R2  | Committed `sg-core.js` drifts from source                      | high   | CI rebuilds the bundle and fails on any diff                                                               |
| R3  | JSC environment differs from Node (ICU, shims)                 | medium | the same fixtures run in JSC in `swift test`; shims are minimal and reviewed                               |
| R4  | UI-resident web logic (§6.1) re-implemented differently on iOS | medium | extract to pure modules before the native editor/import panel ship; until then rely on shared validation   |
| R5  | Data loss from a native persistence bug                        | high   | native layer is only the KV port; generations/quarantine/pre-restore are the shared repository; port tests |
| R6  | Cold-launch cost of JSC                                        | low    | ≈50 ms load measured on Mac; core warms on a background queue; widgets never start JSC                     |
| R7  | Hosted Supabase not provisioned (#29)                          | medium | transport tested against the reference server / PostgREST in CI; live auth listed as unverified            |
| R8  | Sign in with Apple required for review                         | medium | implement with Supabase's Apple provider before TestFlight with social login enabled                       |
| R9  | Widget exposes service details on the Lock Screen              | medium | Lock Screen widgets show D-day/percent only, honour redaction (`privacySensitive`)                         |
| R10 | Disk space on the build machine (98 % full)                    | low    | builds use a scratch DerivedData that is removed after verification                                        |
| R11 | Supabase anon key in the app binary                            | low    | it is a publishable key by design; RLS is the boundary; never a service-role key                           |

## 9. Migration strategy

- The native client stores the **same** `UserData` v3 document through the
  **same** repository code; there is no native schema and nothing to migrate
  between clients. A backup from either client restores on the other
  (fixture `backup` plus the interchange test in `docs/ios/TESTING.md`).
- The native store starts empty on install (guest-first). Moving data from
  the web: export a JSON backup on the web, import on iOS (preview → MERGE or
  REPLACE), or sign in and enable sync.
- Future document schema versions are added once in `packages/domain`;
  both clients pick them up (the native bundle is rebuilt in the same PR).

## 10. Implementation plan

| Phase | Deliverable                                                                                        | Gate                                                       |
| ----- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 0     | this audit, ADR 0003, ADR 0004                                                                     | reviewed docs                                              |
| 1     | `apps/ios` (XcodeGen project, SuperGongikKit package, design tokens, tab shell), CI build          | `xcodebuild build` + `swift test` green                    |
| 2     | `packages/native-core` facade + bundle, `contracts/fixtures`, Swift slice, bridge                  | all fixtures identical in Node, JSC and the Swift slice    |
| 3     | onboarding, 오늘, 기록, 휴가, 급여, 더보기 on local data                                           | simulator QA screenshots, light/dark, Dynamic Type         |
| 4     | file store under the shared repository, recovery notices, backup export/import, local wipe         | port tests, restore round trip, interchange test           |
| 5     | Swift transport + auth (email OTP, OAuth/PKCE, Apple), sync engine in JSC, conflicts, cloud backup | PostgREST integration in CI; hosted verification after #29 |
| 6     | Face ID lock + privacy cover, notifications, widgets, native file import                           | simulator QA; real-device checklist                        |
| 7     | VisionKit scanning → shared normalization → preview                                                | after §6.1 refactor                                        |
| 8–9   | audits, privacy manifest, App Store metadata draft, TestFlight checklist                           | no submission without explicit authorization               |
