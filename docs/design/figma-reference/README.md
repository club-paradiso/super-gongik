# Figma reference renders (page 52, Civic Codex)

1x PNG exports of the iOS production frames in Figma file `hy0KYmsJxVzj2JwJtbfIpS`
(page 52 · iOS Production — Screens), read through the Figma MCP `get_screenshot`
on 2026-11-08. File name: `<screen>-<theme>-<appearance>__<node id>.png`.

| File                                      | Node       | Frame name                                                                     |
| ----------------------------------------- | ---------- | ------------------------------------------------------------------------------ |
| `home-standard-light__202-3614.png`       | `202:3614` | Civic Codex / 홈 / In service · Light                                          |
| `home-warrior-light__202-3847.png`        | `202:3847` | Civic Codex / 홈 / In service · Warrior Light                                  |
| `home-warrior-dark__202-3956.png`         | `202:3956` | Civic Codex / 홈 / In service · Warrior Dark                                   |
| `calendar-standard-light__204-3938.png`   | `204:3938` | Civic Codex / 캘린더 / Month · Light                                           |
| `calendar-warrior-dark__204-4469.png`     | `204:4469` | Civic Codex / 캘린더 / Month · Warrior Dark                                    |
| `pay-standard-light__206-4205.png`        | `206:4205` | Civic Codex / 급여 / Base only · Light                                         |
| `pay-warrior-dark__206-4539.png`          | `206:4539` | Civic Codex / 급여 / Base only · Warrior Dark                                  |
| `profile-standard-light__207-4469.png`    | `207:4469` | Civic Codex / 내 정보 / List · Light                                           |
| `profile-warrior-dark__207-4728.png`      | `207:4728` | Civic Codex / 내 정보 / List · Warrior Dark                                    |
| `onboarding-standard-light__208-4628.png` | `208:4628` | Civic Codex / 온보딩 / Step 1 of 4 · Light (not captured by the app tests yet) |

The newest node on page 52 at export time was in the `244:*` range (components
inside these frames); no newer production frame for these screens exists.

## How they are used

CI job `ios-ui-flows` runs `SuperGongikUITests/FigmaCaptureTests.swift` with the
same date and data as these frames (`-SGToday 2026-03-14 -SGSeedFixture figma`),
then `apps/ios/scripts/figma-compare.py` writes Figma | App | Difference sheets
and `report.md` to the artifact `ios-figma-compare-<sha>`.

`deviations.json` lists differences that are owner decisions newer than the
frames (e.g. the PR #70 full-bleed home). A low similarity on those screens is
expected until Figma is redrawn; it is not a reason to roll the app back.

## Updating

Re-export with the Figma MCP (`get_screenshot`, `maxDimension` ≥ frame height
so the PNG stays 1x) and commit the files in one PR with the reason. The
comparison never rewrites these files or any baseline.
