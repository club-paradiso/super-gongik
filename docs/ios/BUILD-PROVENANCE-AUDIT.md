# Build provenance audit (2026-10-20)

The owner reported that the beta on their iPhone looked "quite different" from
the Stitch design, while the design docs marked most Stitch work as done. This
records what was actually installed, how it compares with `main`, and what now
stops the question from coming up again.

## What `main` contained

| Item                    | Value (checked 2026-10-20)                                                           |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `origin/main`           | `9f86409` (PR #69, docs only)                                                        |
| Last iOS code on `main` | `0afa1a4` (PR #68, Stitch third pass), committed 2026-10-15 12:54 KST                |
| Stitch PRs on `main`    | #63, #66, #67, #68, #69 — all merged                                                 |
| Version / build         | `0.1.0` / `1` in both targets, **never changed** since the first native build        |
| Bundle id (phone)       | `app.supergongik.ios.yaho` (personal team `89CGFQ24U5`, `Config/Local.xcconfig`)     |
| Signing                 | Automatic, free personal team: 7-day profiles, no App Group, no TestFlight           |
| CI artifacts            | `ios-screenshots-<sha>` only (simulator, unsigned). CI produces no installable build |

## What the phone had

`xcrun devicectl device info apps` on the iPhone 15 (iOS 26.6.1):

```
슈퍼공익   app.supergongik.ios.yaho   0.1.0   1   builtByDeveloper: true
```

Every build reported `0.1.0 (1)`, so the version could not tell builds apart.
The app container's metadata was last written 2026-10-15 12:55 KST, one
minute after `0afa1a4`; the previous install (2026-10-14) was `47104c7`. The
phone therefore most likely ran `0afa1a4` — **the same app code as `main`**.
This is an inference from timestamps, not a stamped value; nothing in that
build recorded its commit.

Conclusion: a stale build was **not** the main cause. The installed app and
`main` matched; both differed from Stitch. The causes are in
[STITCH-REAL-FIDELITY-AUDIT-2026-10.md](../design/STITCH-REAL-FIDELITY-AUDIT-2026-10.md):
the home was built from the early `direction_b_civic_codex` study rather than
the `master_synthesis` screen the Stitch set converged on, and the iOS 26
system tab bar could reappear under the Stitch bar.

The personal-team profile installed on 2026-10-15 expires about 2026-10-22.

## Prevention (this PR)

- `MARKETING_VERSION` is `0.2.0`; `CURRENT_PROJECT_VERSION` comes from
  `SG_BUILD_NUMBER`.
- `Info.plist` carries `SGBuildCommit` and `SGBuildChannel`
  (`Config/Base.xcconfig` defaults: `2`, `local`, `Debug`; Release builds say
  `Release`).
- `apps/ios/scripts/install-device.sh <device>` stamps the build number
  (`git rev-list --count HEAD`), the short SHA (`-dirty` when the tree has
  changes) and channel `Beta`, then installs **over** the existing app.
- 내 정보 › 정보 shows 버전 `0.2.0 (N)`, 빌드 `Beta · <sha>` and the current
  화면 테마. No keys, tokens or user records are shown.

## Data safety on reinstall

The service record lives only in the app container
(`Library/Application Support/SuperGongik/store/*.kv`). Installing a new build
with the same bundle id keeps it. Do **not** delete the app before installing,
and do not change `SG_BUNDLE_ID`: a different id is a different app with an
empty store. If the id ever has to change, export a backup first
(내 정보 › 전체 백업 파일 만들기) and restore it in the new app.
