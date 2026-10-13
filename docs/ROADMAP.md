# SUPER GONGIK Roadmap

## Status snapshot — 2026-10-13

Evidence is the code on `main` at `12a9df7` (PR #59 merged), the merged pull
requests and the open issues. "Done" means implemented and covered by tests;
"partial" lists what is missing. "Implemented, not live" means the code and
its automated gate exist but the external system or a store submission does
not. The previous snapshot (2026-09-24) is in git history.

| Phase                          | Status                                                 | Evidence / remaining                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Product foundation           | Done                                                   | PRD, architecture, data model, rule-engine docs, ADR 0001–0004                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 1 Application foundation       | Done                                                   | pnpm workspace, Next.js PWA, lint/format/typecheck/test/build in CI, Vercel deploy. Added since: WebKit and PostgREST/RLS release gates (PR #35, `docs/RELEASE_GATE.md`), iOS package and app tests plus a simulator screenshot matrix in CI (PR #56, `.github/workflows/ci.yml` job `ios`)                                                                                                                                                                                                                                                                                                                 |
| 2 Service profile & dashboard  | Done                                                   | `packages/domain/src/service`, onboarding, D-Day/progress, editable profile. Added since: home redesign and optional live D-day progress (PRs #43, #44, #47)                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 3 Service calendar             | Done (MVP)                                             | month + agenda views, create/edit/soft-delete/undo/restore, category filter, overlap validation. Missing: recurring events. Public holidays are deliberately not derived (`packages/domain/src/calendar/month.ts:57`); the user declares non-working days per month instead (`DECLARED_NON_WORKING` in `packages/rules/src/service-days.ts`)                                                                                                                                                                                                                                                                |
| 4 Leave ledger                 | Done (annual) / partial (others)                       | balance = rule credits + confirmations + corrections − events; half-day unit; minutes; reconciliation; 8-hour authorized-attendance deduction (PR #37). Other leave types are usage summaries only (`TypeUsageSummary` in `packages/domain/src/leave/ledger.ts`). Ordinary sick-leave days are counted cumulatively against the 30-day threshold for pay (`SICK_LEAVE_OVER_30` in `packages/rules/src/non-payable-days.ts`, PR #22), but the effect on service length is not modelled. Conditional bonus leave (`lowSickLeaveBonus` in `packages/rules/leave/*.json`) is bundle data only; no code reads it |
| 5 Rules engine                 | Done                                                   | effective-date selector, lifecycle states, source metadata, fixtures, explicit calculation dates                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 6 Compensation                 | Done (gated where the payer's rounding is unconfirmed) | base pay by service-month ordinal + confirmed prior-service credit; call-up/discharge-month and non-payable-day proration calculated once the payer's rounding is explicitly confirmed (`packages/rules/src/monthly-compensation.ts`, PRs #17, #20); non-payable dates derived from records (PR #22); meal/transport from per-day eligibility with user decisions for leave days (`packages/rules/src/service-days.ts`, PR #16); a total exists only when all three components calculate. Remaining: #19 (server-byte check of the MMA HWPX)                                                                |
| 7 Local-first storage          | Done (MVP)                                             | versioned document, migrations, recovery/quarantine, cross-tab rebase, offline shell; iOS file store under the shared repository contract (`docs/ios/PERSISTENCE.md`, ADR 0004)                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 8 Cloud backup & sync          | Implemented, not live                                  | Supabase email-code sign-in, Google/Kakao/NAVER (PR #50), Sign in with Apple on iOS (`SGSync/SupabaseAuth.swift`), causal record merge, conflict UI, immutable cloud backups, cloud-data deletion; refresh/sign-out races and wipe-during-sync fixed (PR #58). Not live: the hosted Supabase project is paused and the external checks in `docs/RELEASE_GATE.md` are unrun (#29). Missing: tombstone GC, E2EE, background native sync                                                                                                                                                                       |
| 9 Export & privacy             | Partial                                                | JSON backup + validated merge/replace restore, events CSV, leave CSV (web and iOS), full local wipe, cloud-data deletion, iOS account deletion via the `delete-account` Edge Function (not deployed). Missing: compensation CSV (`packages/domain/src/store/csv.ts` has events and leave only), web account deletion (function has no CORS handling, `docs/CLOUD_SYNC.md`), a user-facing privacy disclosure on the web (iOS has an inventory in `docs/ios/PRIVACY.md`)                                                                                                                                     |
| 10 Notifications & quality     | Partial                                                | iOS local reminders for next-day records and backups (`Features/Notifications/ReminderScheduler.swift`), reduced motion on web and iOS, iOS contrast tests and Increase Contrast (PR #56), VoiceOver labels on part of the iOS screens. Missing: web reminders, rule-update notices, error monitoring (none in the codebase), performance audit, real-device VoiceOver/Dynamic Type pass                                                                                                                                                                                                                    |
| 11 Knowledge layer             | Not started                                            |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 12 Native iOS client           | Implemented, not shipped                               | SwiftUI app running the shared TypeScript core in JavaScriptCore (ADR 0003, PR #54, `docs/ios`), Figma production sync (PR #56), Warrior theme (PRs #57, #59), widgets, Face ID lock, CSV/TSV import. Missing: XLSX/HWP/PDF import and share extension, OCR, Instruments profiling, real-device QA (none recorded), 1024 px icon master, TestFlight (needs the paid Apple Developer Program and authorization). Phase detail: `docs/ios/RELEASE.md`                                                                                                                                                         |
| Brand & themes (cross-cutting) | Done                                                   | HORIZON visual system (PR #49), official brand and logo (PRs #51, #52), Figma as source of truth (`docs/design/FIGMA-SOURCE-OF-TRUTH.md`), Warrior theme and theme picker on iOS and web (PR #59, `docs/design/WARRIOR-IMPLEMENTATION-REPORT.md`)                                                                                                                                                                                                                                                                                                                                                           |

### Outcome of the 2026-09-24 sprint list

| #   | Item                                                     | Outcome | Evidence                                                                                                                                                                                                                                                |
| --- | -------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Issue #6 HWPX extraction, partial-month/non-payable math | Done    | HWPX, extraction and `SHA256SUMS` in `docs/sources/2026` (PR #16); proration and payer rounding with fixtures (PRs #17, #20, `packages/rules/tests/compensation-closure.test.ts`, `non-payable-days.test.ts`). Only the server-byte check remains (#19) |
| 2   | Eligible-service-day derivation                          | Done    | `packages/rules/src/service-days.ts` (PR #16), consumed by `monthly-compensation.ts`                                                                                                                                                                    |
| 3   | Non-duty sick-leave tracking, conditional bonus leave    | Partial | 30-day cumulative count for pay deduction (PR #22). Service-length effect and conditional bonus leave not started                                                                                                                                       |
| 4   | Real-world import corpus                                 | Partial | real MMA daily service-status PDF layouts handled and pinned in tests (PRs #36, #39, #40; `apps/web/tests/import-adapters.test.ts`). No collected, anonymized institution-export corpus as fixture files                                                |
| 5   | Backup reminders, encrypted cloud backup design          | Partial | iOS backup reminder after 30 days. No web reminder; E2EE design not started                                                                                                                                                                             |
| 6   | iOS packaging decision per ADR 0001                      | Done    | ADR 0003 (native client on the shared core), ADR 0004, app built (PR #54)                                                                                                                                                                               |

## Next recommended sprint

Ordered by what unblocks the most. Items marked (human) need account access
or a device that an agent session does not have.

1. **Activate hosted Supabase (#29)** (human for dashboard access). Restore
   the paused project, configure transactional email, provider credentials and
   redirect URLs, deploy `delete-account`, then run the external checks listed
   in `docs/RELEASE_GATE.md`. Every sync feature on web and iOS, and the iOS
   account-deletion requirement, waits on this.
2. **iOS path to TestFlight** (human for membership and device). Decide on the
   paid Apple Developer Program, confirm the bundle id and App Group, replace
   the 1024 px icon master, and record the real-device QA checklist in
   `docs/ios/RELEASE.md`. The local-only checks do not depend on item 1.
3. **Close Phase 9.** Web account deletion (CORS and an origin allowlist on
   `delete-account`), compensation CSV export, and a web privacy disclosure.
4. **Verify the MMA HWPX bytes (#19)** (human for a network that reaches
   open.mma.go.kr). Download, hash, compare with `docs/sources/2026/SHA256SUMS`,
   record the result. Small, and it upgrades the provenance of every
   compensation number.
5. **Leave-rule gaps, source first.** Service-length effect of ordinary sick
   leave over 30 days, and conditional bonus leave eligibility. Only from
   verified rule text; keep both gated until then.
6. **Quality pass.** Choose a privacy-preserving, opt-in error-reporting
   approach (none exists today), run a web performance audit and iOS
   Instruments profiling.
7. **iOS import parity.** XLSX/HWP/PDF import and the share extension, after
   moving web PDF table reconstruction into `packages/importer`.

Deferred until the above land: E2EE and tombstone GC (Phase 8), recurring
events (Phase 3), web reminders, knowledge layer (Phase 11).

## Phase 0 — Product foundation

Status: done

Deliverables:

- PRD
- architecture document
- data model
- rules-engine specification
- implementation backlog

Exit criteria:

- core scope and non-goals are explicit
- canonical event model is agreed
- versioned rules strategy is documented

## Phase 1 — Application foundation

Goal: create a reliable shell that can support the domain model.

Tasks:

- initialize Next.js + TypeScript application
- configure Tailwind and component system
- establish workspace/package structure
- add linting, formatting, type-checking, tests
- configure PWA manifest and installability
- establish environment validation
- add CI for lint/typecheck/test/build

Exit criteria:

- clean production build
- preview deployment succeeds
- offline app shell loads

## Phase 2 — Service profile and dashboard

Goal: answer where the user is in their service.

Tasks:

- guest onboarding
- call-up date
- expected discharge date
- service progress calculation
- D-Day calculation
- today/next-event dashboard skeleton
- editable service profile

Mandatory tests:

- same-day boundaries
- leap-year boundaries
- timezone handling in Asia/Seoul
- past/future invalid dates

## Phase 3 — Service calendar

Goal: make the calendar the canonical interaction surface.

Tasks:

- service_event repository
- month view
- agenda view
- create/edit/delete event
- event categories
- filtering
- event conflict validation

Exit criteria:

- every supported service event can be represented once
- downstream features can consume events without duplicate entry

## Phase 4 — Leave ledger

Goal: make leave accounting reliable and explainable.

Tasks:

- leave accounts
- leave credits
- minute-based usage
- annual/sick/official/special/compassionate leave
- outing, late arrival, early leave
- balance projection
- ledger UI
- correction/adjustment flow

Exit criteria:

- balance can be reconstructed entirely from credits + events
- no floating-point day values are sources of truth

## Phase 5 — Rules engine

Goal: isolate policy logic from UI code.

Tasks:

- rule schema validator
- effective-date selector
- verification states
- source metadata
- calculation result contract
- fixtures and unit tests
- unsupported-rule state

Exit criteria:

- no service/leave/compensation policy conditional lives in React components
- every production rule carries source metadata

## Phase 6 — Compensation

Goal: provide transparent monthly estimates.

Tasks:

- compensation rule bundle
- base-pay logic
- meal allowance logic
- transport allowance logic
- monthly event normalization
- breakdown UI
- assumptions/warnings
- calculation snapshots

Exit criteria:

- user can see exactly how the total was calculated
- historical calculation can be replayed using its stored rule version

## Phase 7 — Local-first storage

Goal: make essential use independent of connectivity.

Tasks:

- local persistence layer
- migrations
- optimistic local writes
- offline queue
- cache invalidation strategy
- recovery from corrupted/incomplete local state

Exit criteria:

- profile, calendar, leave, and stored estimates work offline

## Phase 8 — Cloud backup and sync

Goal: eliminate the device-change data-loss failure mode.

Tasks:

- Supabase schema
- row-level security
- optional Apple/Google auth
- guest-to-account migration
- sync state
- conflict handling
- backup status UI
- restore flow

Exit criteria:

- new device can restore complete service records
- local-only users remain supported

## Phase 9 — Export and privacy controls

Tasks:

- JSON export
- CSV event export
- CSV leave export
- CSV compensation export
- cloud-data deletion
- account deletion
- privacy disclosure

## Phase 10 — Notification and quality pass

Tasks:

- next-event reminders
- leave reminders where useful
- rule-update notices
- accessibility audit
- VoiceOver labels
- keyboard navigation where applicable
- reduced-motion support
- error monitoring
- performance audit

## Phase 11 — Knowledge layer

Only after the core product is trustworthy.

Tasks:

- official-source knowledge base
- versioned help articles
- source freshness metadata

Potential later feature:

- grounded AI assistant restricted to verified source material

## Phase 12 — Native iOS client

Goal: a native iPhone app that computes exactly what the web app computes.

Decision and design: ADR 0003, ADR 0004 and `docs/ios`. Per-phase status,
the submission checklist and the real-device QA list live in
`docs/ios/RELEASE.md`.

Exit criteria:

- every shared calculation passes the conformance fixtures in Node and
  JavaScriptCore (`docs/ios/DOMAIN-CONFORMANCE.md`)
- real-device QA recorded
- a TestFlight build exists, uploaded only after explicit authorization

## Explicitly deferred

Do not build these until there is evidence they improve the core product:

- community
- workplace reviews
- chat
- public profiles
- social feed
- rankings
- streaks

## Recommended implementation order for an agentic coding session

1. repo/workspace bootstrap
2. domain package and schemas
3. unit tests for date/time and rule-selection logic
4. local service profile
5. service events
6. dashboard/calendar UI
7. leave ledger
8. rules engine fixtures
9. compensation
10. local-first persistence
11. cloud sync
12. polish and accessibility

Do not allow an implementation agent to skip straight to decorative UI before domain tests exist.
