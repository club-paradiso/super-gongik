# HORIZON — SUPER GONGIK

## Audit / plan (baseline dc0a8f9)

Production inspected: onboarding, home and compensation in Chrome. Existing Next 16.3.3 / React 19 monorepo separates domain, rules and importer. Screen CSS imports base primitives; color-name tokens and hardcoded pale surfaces prevent dark mode. The live readout is isolated, but seconds are visually subordinate to a large static D-day. There is no theme preference or architecture to preserve. Four tabs already map well to daily tasks.

Reference: supplied ivory dragon / social-service agent icon, deep navy negative space, sweeping ivory silhouette, indigo depth and coral/gold horizon. Use its color and curvature, not fantasy illustration behind data. The supplied image is a direction, not a finalized replacement icon: retain the existing compact flag silhouette and recolor it, avoiding an unreadable dragon thumbnail or silently replacing the logo being developed separately.

## Implementation boundaries

- Add semantic tokens, automatic light/dark schemes; replace old color-specific variables across the existing five CSS layers rather than adding override CSS.
- Recompose Home's countdown/progress as one memoized live readout, above a static pay-step and milestone row. Preserve saved live preference and six decimals. No whole-page second ticks.
- Add a shared abstract horizon and compact empty state. Improve onboarding, nav, salary hierarchy, records, controls and focus states.
- Leave domain, rules, importer, persistence schema and cloud contracts unchanged. No migration. Do not invent pay dates or totals from the concept image.
- Validate existing tests plus live preference on/off/reload, seconds/percentage samples, completion boundary, pay steps, terminology, light/dark and responsive rendering.

## Design system

HORIZON is the core brand system, not a second theme setting. CSS semantic tokens separate canvas, elevated canvas, standard/raised/interactive surfaces, text tiers, borders, selected state, accent and feedback. System light/dark is immediate without hydration or storage changes. Future themes can override tokens without duplicating components.

- Navy hero; indigo controls; warm light reserved for progress and milestones. White/neutral canvas by day, midnight with distinguishable raised surfaces by night.
- Pretendard retained locally. Tabular numbers for time, progress, currency and dates. Body 15px, labels 14px, captions 13px. Display uses responsive sizing; seconds occupy their own stable line.
- 4px spacing grid. 12px controls, 16px information surfaces, 24px hero. Secondary actions use rows/dividers rather than more floating cards.
- Static atmospheric horizon only in high-value moments. No continuous decoration, backdrop blur, particle effects, or additional raster payload.
- Focus uses an explicit outline, status uses text alongside color. Reduced motion disables interpolation but does not make a seconds clock inaccurate.

## Concept interpretation

The generated board is visual exploration. Real source content remains authoritative: preserve the actual three quick actions, month switch and conditional pay rules; no invented salary items, pay date, promotion wording or unimplemented tabs. Keep left alignment for scanning and real dynamic data. These are deliberate deviations from incidental generated copy.

## Verification

Baseline: lint passed; format check failed in home-model.ts, live-service-progress.ts and regional-transit-fares.test.ts before edits. Local browser binaries initially absent. Final evidence and limitations will be added after validation.

## Official logo alignment (2026-09)

The illustrated logo (#51) is now the source of truth. It replaced the
"retain the flag silhouette" decision above: the flag mark is retired and
must not return.

### Assets

`public/icon-512.jpg` shipped truncated (no JPEG end marker, decoded partly
or black) and `public/icon-512.png` was still the flag. Every size is now
generated from the original artwork without touching the illustration:

| File                   | Use                                  | Matte              |
| ---------------------- | ------------------------------------ | ------------------ |
| `brand-mark.png` (128) | `BrandMark` in header, rail, loading | transparent        |
| `icon-192.png`         | favicon, manifest                    | transparent        |
| `icon-512.png`         | manifest (256-colour, 68 KB)         | transparent        |
| `apple-touch-icon.png` | iOS home screen (no alpha support)   | midnight `#0c0e24` |

The service-worker shell cache moved to `v4` so installed apps pick them up.

### Palette extraction

Median-cut (16 clusters) over the opaque pixels of the 1254 px source; the
share is the fraction of logo pixels.

| Token              | Hex       | Share | Role                                |
| ------------------ | --------- | ----- | ----------------------------------- |
| `--brand-midnight` | `#090c1c` | 7.5%  | deepest sky, dark canvas anchor     |
| `--brand-night`    | `#181b42` | 7.4%  | hero/rail depth, offline banner     |
| `--brand-navy`     | `#081f68` | 8.8%  | structural identity                 |
| `--brand-indigo`   | `#1e2d78` | 6.2%  | interaction family (accent derives) |
| `--brand-violet`   | `#3c348e` | 7.0%  | secondary depth only                |
| `--brand-ivory`    | `#fef1d3` | 16.0% | display type on dark, warm text     |
| `--brand-sun`      | `#fdcf7c` | 7.3%  | scarce accent: progress, milestones |
| `--brand-ember`    | `#fda870` | 6.4%  | progress mid-point, horizon glow    |
| `--brand-coral`    | `#e2686e` | 6.9%  | far end of progress only            |

Structure (navy + midnight + indigo) is ~38% of the mark, warm light ~28%,
violet ~18%. The UI mirrors that order: the interactive accent moved from
violet `#3b359f` to royal navy-indigo `#2740a0` (dark: periwinkle
`#a9b8ff`), and violet stays a secondary tone.

### Rules

- Brand moments (hero, onboarding, loading, desktop rail) may use
  `--gradient-hero` / `--gradient-brand` and one restrained warm horizon.
  Operational screens use flat surfaces, tokens and 1 px borders.
- Warm colours mark value, not decoration: live progress, milestones,
  confirmed totals, the active rail item.
- Dark mode is the logo's night sky: midnight canvas, navy surfaces, ivory
  primary text. Borders carry separation instead of shadows.
- Radius grows with importance: control 12, card 16, elevated 20, hero 28
  (the mark's own squircle).
