# 2026 Compensation Policy Closure (Issue #6)

Status as of 2026-09-24. This document classifies every compensation component
by what the primary sources establish, and records exactly what the app
calculates and what it refuses.

## Sources

All excerpts are stored verbatim under `docs/sources/2026/`, with SHA-256 in
`docs/sources/2026/SHA256SUMS`. `packages/rules/compensation/2026.json` pins
each hash. `packages/rules/tests/compensation-closure.test.ts` re-hashes the
files, so if an excerpt changes, that test fails.

All four texts were retrieved on 2026-09-24 from the 법제처 국가법령정보
공동활용 API through the korean-law MCP. `law.go.kr` itself is blocked from the
build environment.

| Source                                          | Authority / type    | Identifier                                   | Published  | Effective  | Excerpt file                          |
| ----------------------------------------------- | ------------------- | -------------------------------------------- | ---------- | ---------- | ------------------------------------- |
| 병역법 시행령 제62조                            | 대통령령            | 법령ID 003626, MST 288957                    | 2026-08-25 | 2026-08-28 | `byeongyeokbeop-siheangryeong-62.txt` |
| 공무원보수규정 제4조제6호·제22조·별표 13 비고 6 | 대통령령            | MST 288433; 별표 13 개정 2026.1.2. 제36013호 | 2026-07-30 | 2026-08-01 | `gongmuwon-bosu-gyujeong.txt`         |
| 공무원보수규정 부칙 <제36013호> 제2조           | 대통령령            | MST 282469                                   | 2026-01-02 | 2026-01-02 | same file                             |
| 사회복무요원 복무관리 규정 제18조·제41조        | 병무청훈령 제2206호 | 행정규칙일련번호 2100000284594               | 2026-04-23 | 2026-04-23 | `bokmugwalli-gyujeong-41.txt`         |
| 국고금 관리법 제47조                            | 법률                | MST 276079                                   | 2025-10-01 | 2026-01-02 | `gukgogeum-gwallibeop-47.txt`         |

The following source was **not obtained**. `open.mma.go.kr` is blocked from the
build environment, so the HWPX attachment could not be downloaded. It has no
checksum and is used for nothing executable.

- 병무청 사회복무국, 「2026년도 사회복무요원 보수 등 지급 기준」 (posted
  2026-01-05, updated 2026-03-24):
  https://open.mma.go.kr/caisGGGS/board/boardView.do?gesipan_id=16&gsgeul_no=1517395

## Classification

| Component               | Class                           | Basis and treatment                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Base pay, full month    | VERIFIED_AND_EXECUTABLE         | 시행령 제62조① and 복무관리 규정 제41조① set the grade bands. The call-up month is month 1, from "소집월부터 2개월까지". Amounts come from 별표 13 비고 6: 750,000 / 900,000 / 1,200,000 / 1,500,000. 부칙 제2조 applies them to pay paid on or after 2026-01-01.                                                                                                                                                        |
| Prior-service credit    | VERIFIED_NEEDS_USER_INPUT       | 제62조② adds a period to the month count in 7 enumerated cases, each computed under a different provision. The user states which 호 applies and the credited whole months confirmed by the institution. Unknown → NEEDS_INPUT. A period that is not whole months → GATED, because the text does not say how to add days to a month count.                                                                                |
| First / discharge month | AMBIGUOUS                       | 제41조⑤ gives the structure: 보수일액 × 근무일수 (소집일·소집해제일 포함). 공무원보수규정 제4조제6호 gives the divisor: 그 달의 일수. Unresolved: rounding (원 단위; 국고금 관리법 제47조 is a 10원 rule that institutions only "준용할 수 있다"), whether 근무일수 means calendar days, and whether 제41조 explicitly adopts 제4조제6호. **Gated.** The month's divisor is shown in the explanation.                    |
| Non-payable days        | VERIFIED_BUT_NOT_IMPLEMENTED    | 제41조⑥ lists 복무중단·복무이탈·연가 초과 결근·통산 30일 초과 병가 (공무상 병가 제외). A deduction needs the same unresolved daily arithmetic. Base pay is gated when recorded sick leave may exceed 30 days (upper bound) or when the user confirms such an absence for the month.                                                                                                                                      |
| Eligible service days   | VERIFIED_NEEDS_USER_INPUT       | Derived from the service period, the confirmed working weekdays, the user-confirmed holidays for the month, and the event timeline. A full-day leave is not attended, so neither 실비 applies. Half-day or minute leave, outing, late arrival, early leave, education and training need a per-day meal/transport decision from the user. Night rotation (제41조④ 단서: 1일=2일) and residential service are UNSUPPORTED. |
| Work schedule           | VERIFIED_NEEDS_USER_INPUT       | 제18조①1호 → 국가공무원 복무규정 제9조 (토요일 휴무 원칙). Mon–Fri is proposed only after the user picks daytime commuting, and it is stored only when saved. No holiday calendar is bundled.                                                                                                                                                                                                                            |
| Meal allowance          | VERIFIED_NEEDS_USER_INPUT       | 제41조④ pays 중식비 as 실비. The rate is the institution-confirmed daily amount entered by the user. 9,000 KRW is shown as an unverified reference only, because the MMA attachment was not obtained. It never enters a calculation.                                                                                                                                                                                     |
| Transport               | VERIFIED_NEEDS_USER_INPUT       | 제41조④ pays 실비 on a public-transit-fare basis, including for walkers. The user enters the daily round-trip fare. There is no national default.                                                                                                                                                                                                                                                                        |
| Monthly total           | VERIFIED_AND_EXECUTABLE (gated) | The sum of base + meal + transport, produced only when all three are CALCULATED. Excludes 출장 여비 and deductions.                                                                                                                                                                                                                                                                                                      |

## Product rules

- `evaluateMonthlyCompensation` selects the rule by the evaluated date. It
  refuses a month in which the selected rule differs at the month's first and
  last day.
- The attendance confirmation for a month becomes stale when any of that
  month's events, or the profile, changes after it was saved. The month then
  needs to be confirmed again.
- Compensation snapshots store the full evaluation JSON with the rule id and
  version. Deleting one leaves a tombstone. A merge never deletes a live
  snapshot.

## Defect fixed in this sprint

Before this sprint, `evaluateMonthlyCompensation` passed a 0-based month index
into ordinal bands. Every band boundary was therefore one month late. For
example, a January call-up still received 750,000 KRW in March instead of
900,000 KRW.

## Still open

- The MMA 「보수 등 지급 기준」 attachment: retrieve it, hash it, and decide
  whether it fixes the rounding and the 근무일수 meaning. Retrieving it
  requires network access to `open.mma.go.kr`, or the file supplied directly.
- Partial-month and non-payable-day arithmetic stays gated until that text,
  or another primary text, fixes the rounding.
- 2027 and later: there is no bundle, so these months are UNSUPPORTED.
