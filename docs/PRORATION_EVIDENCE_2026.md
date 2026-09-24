# 2026 Proration Evidence Note

This note separates what is actually settled for social-service-agent base-pay
proration from what still depends on the paying institution.

## Nationwide rule text

### 사회복무요원 복무관리 규정 제41조⑤·⑥

Current rule:
https://www.law.go.kr/LSW/admRulLsInfoP.do?admRulSeq=2100000278174

- call-up/discharge months use: monthly pay's daily-calculated amount ×
  근무일수, expressly including the call-up and discharge dates.
- the listed interruption/absence/excess-leave and excess non-duty sick-leave
  days are non-payable.

### 공무원보수규정 제4조제6호

Current rule:
https://www.law.go.kr/lsLinkCommonInfo.do?lsJoLnkSeq=1020423939

"보수의 일할계산" means dividing that month's pay by the number of days in
that calendar month.

## Official interpretive / implementation guidance

### 병무청 지식파트너, 2024-11-13

https://kin.naver.com/qna/detail.naver?dirId=603&docId=477743130

The MMA's official answer explains that daily calculation is monthly pay divided
by the days in that month **including holidays**, and then states that
unauthorized absence / excess annual-leave absence / sick leave beyond the
cumulative 30-day threshold is unpaid.

This is official interpretive guidance, not a substitute for the text of the
regulation.

### 인천광역시교육청 2026 예산편성 기본지침

https://hbm.ice.go.kr/upload/people/na/bbs_1656/2025/11/eb415349116a398231afa18b853d3308.pdf

The 2026 official implementation guide repeats:

- 근무일수 × 보수의 일할계산액
- daily calculation = monthly pay divided by the number of days in that month
- holidays are included
- call-up and discharge dates are paid

This is institution-level implementation evidence and is not treated as a
nationwide source for institution-specific accounting choices.

## Rounding / end-digit treatment

### 국고금 관리법 제47조

https://www.law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joNo=0047&lsiSeq=276079

For National Treasury receipts/payments, amounts below KRW 10 are discarded.
The same article says local governments and certain public/public-sector bodies
**may** apply the rule. That wording prevents SUPER GONGIK from using
10-won truncation as a universal default for every service institution.

## Product conclusion

The following are no longer treated as unknown:

1. denominator = calendar days in the month;
2. call-up/discharge dates are included;
3. official guidance treats holidays as included in the proration period.

The remaining blocker for a final automatic KRW amount is the payer/institution
rounding policy (plus the exact non-payable dates when deductions are involved).
Until that context is captured explicitly, the app keeps final partial-month
and non-payable-day amounts gated instead of inventing a nationwide rounding
rule.

## Executable payer-policy model

SUPER GONGIK does not infer a rounding rule from an institution name or from
free-text workplace metadata.

The 2026 engine recognizes these explicit states:

- `NATIONAL_TREASURY_ARTICLE_47`: the payer confirms that the payment is a
  National Treasury receipt/payment governed by 국고금 관리법 제47조. The final
  adjusted base-pay amount drops any amount below KRW 10.
- `INSTITUTION_CONFIRMED_TRUNCATE_SUB_10`: the institution has directly
  confirmed the same sub-KRW-10 truncation treatment. This is treated as
  institution input, not as a nationwide legal inference.
- `INSTITUTION_OTHER_OR_UNKNOWN` or no policy: the final adjusted amount stays
  gated.

Exact non-payable dates are stored separately from the legacy
`hadNonPayableAbsence` boolean. The legacy flag can warn that a month contains
an unresolved deduction, but it can never generate a deduction amount by
itself. A dated list is used only after the user confirms that the list is
complete for that month.

Compensation snapshots persist the applied policy, exact non-payable dates,
calendar-day denominator, payable-day count, raw prorated amount and final
rounded amount.
