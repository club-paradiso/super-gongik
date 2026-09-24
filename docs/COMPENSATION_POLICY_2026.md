# 2026 Compensation Policy Closure (Issue #6)

Status as of 2026-09-24. This document classifies every compensation component
by what the primary sources establish. It also records exactly what the app
calculates and what it refuses to calculate.

## Sources

All sources are stored under `docs/sources/2026/`. `SHA256SUMS` lists every
file. `packages/rules/compensation/2026.json` pins the hashes, and
`packages/rules/tests/compensation-closure.test.ts` re-hashes every file.

| Source                                          | Authority / type    | Identifier                                   | Published  | Effective  | File                                                   |
| ----------------------------------------------- | ------------------- | -------------------------------------------- | ---------- | ---------- | ------------------------------------------------------ |
| 병역법 시행령 제62조                            | 대통령령            | 법령ID 003626, MST 288957                    | 2026-08-25 | 2026-08-28 | `byeongyeokbeop-siheangryeong-62.txt`                  |
| 공무원보수규정 제4조제6호·제22조·별표 13 비고 6 | 대통령령            | MST 288433; 별표 13 개정 2026.1.2. 제36013호 | 2026-07-30 | 2026-08-01 | `gongmuwon-bosu-gyujeong.txt`                          |
| 공무원보수규정 부칙 <제36013호> 제2조           | 대통령령            | MST 282469                                   | 2026-01-02 | 2026-01-02 | same file                                              |
| 사회복무요원 복무관리 규정 제18조·제41조        | 병무청훈령 제2206호 | 행정규칙일련번호 2100000284594               | 2026-04-23 | 2026-04-23 | `bokmugwalli-gyujeong-41.txt`                          |
| 국고금 관리법 제47조                            | 법률                | MST 276079                                   | 2025-10-01 | 2026-01-02 | `gukgogeum-gwallibeop-47.txt`                          |
| 2026년도 사회복무요원 보수 등 지급 기준         | 병무청 사회복무국   | 원본 파일명 `…(누리집 게시).hwpx`            | 2026-01-05 | 2026       | `mma-2026-bosu-jigeup-gijun.hwpx` (+ `.extracted.txt`) |

### Retrieval paths

- **The four statute and regulation texts** were retrieved on 2026-09-24
  through the 법제처 open API.
- **The MMA HWPX** (30,207 bytes, SHA-256
  `f4bff691605807f8b20ac2c7034b0dbb052f899a2417236424cdf0faf1bfb158`) was
  supplied by the user on 2026-09-24.
  - The user's external check reports that the official MMA page shows the
    same title, posting date and attachment name, and a size of about 30 KB.
  - The stored bytes are **not server-verified**.
  - A direct request to the official attachment endpoint
    `boardFileDown.do?gesipan_id=16&gsgeul_no=1517395&ilryeon_no=1` was
    blocked from the build environment (`CONNECT tunnel failed, response 403`
    / `EGRESS_BLOCKED`). This environment could therefore not confirm that the
    bytes are identical to the copy the server delivers.
  - The document's own metadata records `ModifiedDate 2026-01-05T04:19:02Z`.
  - The text was extracted deterministically from `Contents/section0.xml`.
    The document has no footnotes, endnotes, memos, headers or footers.

## What the MMA 2026 standard says (complete content)

1. **Base-pay table:** 이등병 소집월~~2개월 750,000; 일등병 3~~8개월 900,000;
   상등병 9~14개월 1,200,000; 병장 15개월 이상 1,500,000.
2. **Transport:** "1일 교통비: 대중교통(시내버스) 왕복이용요금(현금기준)". When a
   transfer, a long subway trip or similar adds cost, the transit-card amount
   is paid as 실비.
3. **Meal:** "1일 중식비: 9,000원(최소기준)". Each institution may pay more
   within its budget.

The standard does **not** address proration, rounding, non-payable-day arithmetic,
which days qualify for per-day allowances, or night duty. Calendar-day proration
semantics are instead supported by the governing pay definition plus official
implementation guidance; see `docs/PRORATION_EVIDENCE_2026.md`.

## Classification

| Component                      | Class                                   | Treatment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base pay, full month           | CONFIRMED_BY_MULTIPLE_PRIMARY_SOURCES   | 시행령 제62조①, 규정 제41조①, 별표 13 비고 6 and the MMA table agree. The call-up month counts as month 1.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Prior-service credit           | CONFIRMED_BY_STATUTE_OR_REGULATION_ONLY | 제62조② lists 7 cases. The user states which 호 applies and enters the credited whole months confirmed by the institution. Unknown → NEEDS_INPUT. A period that is not whole months → GATED. The app never derives the period itself.                                                                                                                                                                                                                                                                                               |
| 2026-09-24T15:15:12.3943130Z - | First / discharge month                 | VERIFIED_STRUCTURE_ROUNDING_GATED                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 제41조⑤ supplies the structure; 공무원보수규정 제4조제6호 fixes the denominator as the calendar days in the month; official MMA/2026 implementation guidance says the calculation includes holidays. **Final KRW stays gated only because one nationwide rounding policy cannot be applied to every paying institution.** |
| 2026-09-24T15:15:12.3949165Z - | Non-payable days                        | VERIFIED_STRUCTURE_ROUNDING_GATED                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 제41조⑥ lists the categories, and official MMA guidance pairs non-payable days with the same calendar-day daily-pay concept. The exact non-payable dates and payer/institution rounding policy are still required, so **GATED_NON_PAYABLE_DAYS stays**.                                                                   |
| Meal allowance                 | CONFIRMED_BY_MMA_ATTACHMENT             | 9,000 KRW/day is the 2026 **minimum** and is applied automatically. An institution amount the user enters is used only if it is ≥ 9,000; a lower amount is refused as conflicting with the source. `rateSource` distinguishes OFFICIAL_MINIMUM from USER_INPUT.                                                                                                                                                                                                                                                                     |
| Transport                      | CONFIRMED_BY_MULTIPLE_PRIMARY_SOURCES   | 제41조④ and the MMA standard define the basis: 시내버스 왕복 현금요금, or the transit-card 실비 when there is extra cost. The amount depends on the route, so the user enters it and it is labelled USER_INPUT.                                                                                                                                                                                                                                                                                                                     |
| Eligible days                  | AMBIGUOUS per leave type                | Working days are counted from the service period, the confirmed weekdays and the holidays confirmed by the user each month. **Every full day of leave (연가·병가·공가·특별휴가·청원휴가) is classified FULL_DAY_LEAVE, but its meal and transport eligibility stays undecided until the user chooses.** Half-day and minute leave, outing, late arrival, early leave, education and training need the same decision. Any undecided day blocks the day counts and the total. Night rotation and residential service are UNSUPPORTED. |
| Monthly total                  | executable only when complete           | The sum of base pay, meal and transport, produced only when all three are CALCULATED. It excludes 출장 여비 and deductions.                                                                                                                                                                                                                                                                                                                                                                                                         |

No conflicts were found between the sources.

### Leave-type evidence (meal and transport)

| Leave type          | Meal      | Transport | Evidence                                                                    |
| ------------------- | --------- | --------- | --------------------------------------------------------------------------- |
| ANNUAL_LEAVE        | AMBIGUOUS | AMBIGUOUS | 제41조④ gives only "실비". The MMA standard gives rates, not eligible days. |
| SICK_LEAVE          | AMBIGUOUS | AMBIGUOUS | same                                                                        |
| OFFICIAL_LEAVE      | AMBIGUOUS | AMBIGUOUS | same                                                                        |
| SPECIAL_LEAVE       | AMBIGUOUS | AMBIGUOUS | same                                                                        |
| COMPASSIONATE_LEAVE | AMBIGUOUS | AMBIGUOUS | same                                                                        |

Sources searched through the 법제처 API: 사회복무요원 복무관리 규정 (중식비·교통비
appear only in 제41조), 선거관리위원회 사회복무요원 복무관리규정 (repeats the
실비 rule) and 관세청 사회복무요원 복무관리 훈령 (no meal clause). None states a
per-leave-type rule.

A 경기도교육청 guideline has been reported to say that 휴가 and 결근 days receive
neither allowance. It is institution-level implementing guidance, it was not
retrieved in this environment, and it is not treated as a nationwide rule.

## Product rules

- **Rule selection:** by the evaluated date. A month whose rule differs
  between its first and last day is refused.
- **Month confirmations:** each stores `basisFingerprint`, which covers the
  service period, the work pattern and weekdays, and the month's live records.
  It is computed by the domain command from the stored data. If the
  fingerprint changes, the month must be confirmed again. Changing a meal rate
  or a fare does not invalidate a confirmation.
- **Snapshots:** each stores the full evaluation JSON, including every source
  with its file SHA-256 and the `rateSource` of each amount. Deleting one
  leaves a tombstone, and merges never delete a live snapshot.

## Final rule-gap disposition

- **Resolved:** the divisor is the number of calendar days in the month; the
  call-up/discharge dates are included; official implementation guidance
  explicitly says holidays are included. The product no longer describes
  `근무일수` semantics as unknown.
- **Not a single nationwide rule:** final rounding/end-digit treatment depends
  on the paying body's accounting regime. For National Treasury expenditure,
  국고금 관리법 제47조 discards amounts below KRW 10. For local governments and
  certain public bodies the statute says the rule _may_ be applied, so SUPER
  GONGIK must not impose that treatment universally.
- **Therefore:** partial-month and non-payable-day _final amounts_ remain gated
  until payer/institution rounding policy and exact non-payable dates are known.
  This is tracked separately from the 2026 source-table closure.
- **Provenance follow-up:** the stored MMA HWPX remains user-supplied with a
  recorded SHA-256; its title/date/filename/size match the official page, but
  direct server-byte comparison remains a provenance hardening task.
- 2027 and later years remain UNSUPPORTED until their own verified bundles exist.
