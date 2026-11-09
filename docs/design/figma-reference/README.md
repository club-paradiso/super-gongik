# Figma reference renders (page 52, Civic Codex)

1x PNG exports of the iOS production frames in Figma file `hy0KYmsJxVzj2JwJtbfIpS`
(page 52 · iOS Production — Screens), read through the Figma MCP `get_screenshot`
on 2026-11-08 and re-exported after the same-day redraw (home redrawn from the
app; 캘린더 controls and labels; Standard world-language off). File name: `<screen>-<theme>-<appearance>__<node id>.png`.

| File                                      | Node       | Frame name                                                                     |
| ----------------------------------------- | ---------- | ------------------------------------------------------------------------------ |
| `home-standard-light__249-4430.png`       | `249:4430` | Civic Codex / 홈 / In service · Light (redrawn from the app 2026-11-08)        |
| `home-warrior-light__250-4512.png`        | `250:4512` | Civic Codex / 홈 / In service · Warrior Light (redrawn 2026-11-08)             |
| `home-warrior-dark__250-4672.png`         | `250:4672` | Civic Codex / 홈 / In service · Warrior Dark (redrawn 2026-11-08)              |
| `calendar-standard-light__204-3938.png`   | `204:3938` | Civic Codex / 캘린더 / Month · Light                                           |
| `calendar-warrior-dark__204-4469.png`     | `204:4469` | Civic Codex / 캘린더 / Month · Warrior Dark                                    |
| `pay-standard-light__206-4205.png`        | `206:4205` | Civic Codex / 급여 / Base only · Light                                         |
| `pay-warrior-dark__206-4539.png`          | `206:4539` | Civic Codex / 급여 / Base only · Warrior Dark                                  |
| `profile-standard-light__207-4469.png`    | `207:4469` | Civic Codex / 내 정보 / List · Light                                           |
| `profile-warrior-dark__207-4728.png`      | `207:4728` | Civic Codex / 내 정보 / List · Warrior Dark                                    |
| `onboarding-standard-light__208-4628.png` | `208:4628` | Civic Codex / 온보딩 / Step 1 of 4 · Light (not captured by the app tests yet) |

The pre-PR #70 home frames (`202:3614`, `202:3847`, `202:3956`) were moved to
page 99 on 2026-11-08.

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
