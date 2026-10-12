# Warrior theme — design completeness matrix

- Updated: 2026-10-13 · branch `feat/warrior-theme-completion` (from `main` @ `6247351`)
- Figma file: [SUPER GONGIK · MASTER](https://www.figma.com/design/hy0KYmsJxVzj2JwJtbfIpS) (`hy0KYmsJxVzj2JwJtbfIpS`)
- Related: [FIGMA-SOURCE-OF-TRUTH.md](./FIGMA-SOURCE-OF-TRUTH.md), [SCREEN-MAP.md](./SCREEN-MAP.md), [DESIGN-SYSTEM-MAPPING.md](./DESIGN-SYSTEM-MAPPING.md), [WARRIOR-IMPLEMENTATION-REPORT.md](./WARRIOR-IMPLEMENTATION-REPORT.md)

## 1. Baseline audit (before this work)

| Area             | Finding                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository       | `main` @ `6247351` (PR #58 merged). Clean tree. PR #57 (theme store) and #56 (Figma → iOS sync) merged; #55 (Stitch RPG prep) closed unmerged.                                                                                                                                                                                                                    |
| Checks on `main` | `pnpm lint`, `format:check`, `typecheck`, `test` all pass: domain 233, rules 119, importer 20, native-core 42, web 86 (+7 skipped integration).                                                                                                                                                                                                                   |
| iOS theme        | `SGTheme` (`standard`/`warrior`) in `SGDesignSystem/Theme.swift`; stored in the App Group (`ThemePreference`, key `sg.theme`); read by the widget. Warrior = per-token palette values, a deeper hero sky, and world-language eyebrows.                                                                                                                            |
| Web theme        | **None.** The web has HORIZON tokens with light/dark via `prefers-color-scheme` only. No Warrior palette, no theme picker, no eyebrows. The web cannot show Warrior at all.                                                                                                                                                                                       |
| Figma pages      | 50–54 canonical, 40–44 Stitch, 99 archive, plus legacy 01–30 — all present.                                                                                                                                                                                                                                                                                       |
| Figma screens    | Page 52: **16 standard** frames, **7 Warrior** frames (오늘 light/dark/completed, 기록 month, 휴가 ready, 급여 base-only, 더보기 theme). Page 40: 54 Stitch views. Counts match the earlier audit.                                                                                                                                                                |
| Figma variables  | `SG · Color` has 70 variables × 4 modes (Light, Dark, Warrior Light, Warrior Dark). 16 components on page 51; `SGHeroCard` has a `Theme` axis; `SGStatCard`/`SGSectionHeader` have `Show eyebrow`.                                                                                                                                                                |
| Visual gap       | Warrior Light is nearly indistinguishable from standard light (rendered side by side: only the accent and a faint canvas tint differ). Warrior Dark is a recolor. The Stitch ideas that carried the identity — crest-framed hero, banner section heads, sigil icon tiles, journey markers — were not carried over. Icons in Figma frames are placeholder circles. |
| Missing in Figma | Both themes: import, backup/restore, cloud sync, profile edit, attendance editor, privacy lock, widgets as screens. Warrior only: attention, pre-service, loading, XXL, 기록 list, editor sheet, 휴가 needs-confirm, 급여 pending, 온보딩.                                                                                                                        |

## 2. Matrix

Columns: **A** standard design · **B** Warrior design (before → after) · **C** implementation · **D** missing design · **E** missing states · **F** accessibility · **G** work. Priority **P0** blocks implementation · **P1** core screen/state incomplete · **P2** inconsistency · **P3** optional.

### Core screens

| Screen                | A (std)                | B Warrior before → after                                      | C impl (iOS / web)          | D / E missing                                 | F accessibility                                  | G work                                               | P   |
| --------------------- | ---------------------- | ------------------------------------------------------------- | --------------------------- | --------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------- | --- |
| Theme selection       | `108:944`              | `111:4041` → refined                                          | iOS ✓ / web ✗               | Web has no picker; no preview of what changes | Radio semantics, text not color                  | Web picker (내 정보 › 화면); Figma: web settings row | P0  |
| Design tokens         | page 50                | 4 modes → refined Warrior Light canvas, new `ornament` tokens | iOS ✓ / web ✗               | Web Warrior token set; ornament tokens        | AA text pairs in all 4 modes + iOS high contrast | Variables + `Palette.swift` + `tokens.css`           | P0  |
| Onboarding            | `108:1018`             | none → frame                                                  | shared hero background      | Warrior frame                                 | Date field label, 44 pt                          | Figma frame; theme applies via tokens                | P1  |
| Home / Today normal   | `106:2`, `106:151`     | light/dark → crest hero, banner heads, sigils                 | iOS palette only / web none | Ornament layer                                | Ornaments hidden from VoiceOver                  | Components + both platforms                          | P1  |
| Today attention       | `106:296`              | none → frame                                                  | same components             | Warrior frame                                 | Symbol + text on 확인 필요                       | Figma frame                                          | P1  |
| Today pre-service     | `106:431`              | none → frame                                                  | same                        | Warrior frame                                 | —                                                | Figma frame                                          | P1  |
| Today completed       | `106:547`              | `111:3611` → refined (FINAL QUEST crest)                      | same                        | —                                             | Celebrate is static, no motion required          | Refine                                               | P2  |
| Today loading         | `106:609`              | none → frame                                                  | `SGLoadingState`            | Warrior frame                                 | Spinner label                                    | Figma frame                                          | P1  |
| Today XXL             | `106:641`              | none → frame                                                  | stacked layouts             | Warrior frame                                 | Eyebrows yield to Korean labels                  | Figma frame                                          | P1  |
| Calendar / 기록 month | `107:608`              | `111:3686` → today ring + banner head                         | palette only                | Dark month                                    | Day cells ≥ 44 pt; category = mark + label       | Figma dark frame                                     | P1  |
| Record list           | `107:788`              | none → frame                                                  | `AgendaList`                | Warrior frame                                 | —                                                | Figma frame                                          | P1  |
| Record detail         | day panel in `107:608` | inherits                                                      | `DayPanel`                  | —                                             | —                                                | Covered by month frame                               | P3  |
| Record create / edit  | `108:1041`             | none → frame                                                  | native sheet `Form`         | Warrior sheet                                 | Validation = symbol + text                       | Figma frame (palette only — operational)             | P1  |
| Leave                 | `107:891`              | `111:3864` → banner heads                                     | palette only                | —                                             | —                                                | Refine                                               | P2  |
| Leave needs confirm   | `107:970`              | none → frame                                                  | `ReconciliationCard`        | Warrior frame                                 | —                                                | Figma frame                                          | P1  |
| Compensation base     | `108:811`              | `111:3958` → banner heads                                     | palette only                | Light frame                                   | Money terms never get world-language             | Refine + light frame                                 | P2  |
| Compensation pending  | `108:895`              | none → frame                                                  | `UnresolvedCard`            | Warrior frame                                 | —                                                | Figma frame                                          | P1  |
| Settings / 더보기     | `108:944`              | `111:4041` → refined                                          | native `Form`               | —                                             | —                                                | Refine                                               | P2  |

### Application states

| State                        | Where specified                      | Warrior                           | Work                                               | P   |
| ---------------------------- | ------------------------------------ | --------------------------------- | -------------------------------------------------- | --- |
| Initial / screen loading     | `108:3444`, `108:3455`, `106:609`    | Today loading frame + state board | State board in Warrior modes                       | P1  |
| Empty content                | `SGEmptyState` (`104:61`), `106:431` | pre-service frame                 | Variant in both themes                             | P1  |
| Missing profile / incomplete | onboarding, 급여 pending `108:895`   | pending frame                     | Figma frame                                        | P1  |
| Validation error             | `108:3543`, `108:1041`               | editor sheet frame                | Figma frame                                        | P1  |
| Permission denied            | not specified                        | —                                 | Notifications / Face ID denial rows on state board | P2  |
| Offline                      | `108:3510`                           | state board                       | Warrior state board                                | P1  |
| Sync pending / failure       | `108:3510`                           | state board + cloud frame         | Cloud frame (both themes)                          | P1  |
| Conflict                     | `108:3521`                           | state board + cloud frame         | Cloud frame                                        | P1  |
| Success                      | `SGNotice` success                   | state board                       | Add success row                                    | P2  |
| Destructive confirmation     | `108:3532`                           | state board                       | Warrior state board                                | P1  |
| Completed / pre / active     | `106:547`, `106:431`, `106:2`        | frames                            | Frames                                             | P1  |

### Secondary flows (native `Form` on iOS, panels on web)

| Flow                      | Standard frame | Warrior frame | Implementation                            | Work                                           | P   |
| ------------------------- | -------------- | ------------- | ----------------------------------------- | ---------------------------------------------- | --- |
| Backup create / restore   | none           | none          | `BackupViews.swift`, `backup-panel.tsx`   | One frame per theme (palette only)             | P1  |
| Data import               | none           | none          | `RecordImportView`, `record-import-panel` | One frame per theme                            | P1  |
| Auth entry / cloud status | none           | none          | `CloudSyncView`, `cloud-sync-panel`       | One frame per theme incl. sign-in and conflict | P1  |
| Profile editing           | none           | none          | `ProfileEditView`, web profile form       | One frame per theme                            | P1  |
| Date selection            | native picker  | native        | `DatePicker`, `date-input.tsx`            | Note only (system control)                     | P3  |
| Modal confirmation        | `108:3532`     | state board   | `.confirmationDialog`, web dialog         | State board                                    | P2  |
| Error recovery            | `108:3466`     | state board   | `RootView` error                          | State board                                    | P2  |

### Native differences

| Topic           | Decision                                                                             |
| --------------- | ------------------------------------------------------------------------------------ |
| Sheets          | System sheet; Warrior changes canvas and row surface only                            |
| Tab bar         | System `TabView` (iOS 26 Liquid Glass); tint only. World language never labels a tab |
| NavigationStack | System titles; no HUD header                                                         |
| Forms           | Native `Form`; palette only — operational screens carry no ornaments                 |
| Widgets         | Hero sky + Warrior palette; no ornaments at widget sizes (legibility)                |
| Privacy lock    | Hero background (Warrior sky) + brand mark                                           |
| Accessibility   | Ornaments and eyebrows hidden from VoiceOver; Increase Contrast has Warrior values   |

## 3. Final Warrior direction (decided here)

Stitch is source material, not a spec. What carries over and what does not:

| Stitch idea                                     | Decision                                                                                                                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Night sky hero with gold horizon                | **Keep** (already) and add a **crest frame**: a 1 pt inset gold hairline and two faint halo arcs behind the D-day.                                                          |
| "REMAINING DUTY DAYS" / JOURNEY eyebrow         | **Keep** as decorative eyebrow; VoiceOver skips it.                                                                                                                         |
| Journey trail (START → D-500 → 50% → …)         | **Reduced to quarter markers on the progress bar** (25/50/75 %, the core's `PERCENT_MILESTONES`); reached markers fill gold. No new information, so no new data dependency. |
| Section titles with a vertical bar + tag chip   | **Keep**: Warrior section heads get a 3 pt banner bar; the eyebrow becomes a hairline tag.                                                                                  |
| Icon tiles                                      | **Sigil tiles**: same size, with a 1 pt ornament ring; gold glyph in dark.                                                                                                  |
| Today date tile with glow                       | **Ring, no glow**: 1.5 pt ornament stroke on the today tile.                                                                                                                |
| HUD header, 4 tabs, world-language tab labels   | **Reject** (native chrome, 5 tabs on iOS).                                                                                                                                  |
| Character, rank, XP, collectibles, certificates | **Reject** (fabricated or out of scope).                                                                                                                                    |
| Glows, neon, heavy gradients on cards           | **Reject**. Gradients stay in the hero and progress bar only.                                                                                                               |

Rules:

1. Ornaments appear on **brand moments and summary surfaces** (hero, section heads, stat cards, quick actions, date tiles). Forms, sheets, ledgers and lists get the palette only.
2. Ornaments are tokens (`ornament`, `ornamentSoft`): transparent in the standard theme, so one component draws both themes with the same geometry.
3. Warrior Light gets a real identity: a vellum-lavender canvas (`#F4F1FB`) with white plates and lavender hairlines, so the cards read as "plates on parchment" rather than standard white-on-grey.
4. Every number, label and state is identical in both themes.
