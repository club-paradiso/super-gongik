# Home and D-day redesign, 2026

Companion to [COMPETITIVE_UX_AUDIT_2026.md](./COMPETITIVE_UX_AUDIT_2026.md). Visual evidence is in [design/qa-2026](./design/qa-2026/).

## 1. Product question

Opening the app answers **"얼마나 남았지?"** within one second. It then answers the 사회복무요원-specific follow-ups: how much leave is left, what this month's pay is, and what is coming up. Those follow-ups must not compete with the first answer.

## 2. Selected concept: "one dark card, then paper"

| Tier      | Block                           | Content                                                                                                                                                                                            | Why it is here                                                                                  |
| --------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Primary   | `.hero` (the only dark surface) | Phase label · **D-number (56–96 px)** · discharge date with weekday · progress bar with 25/50/75 ticks · live % · elapsed / remaining days · **next milestone** with its meaning and relative date | The single answer, plus the one thing worth checking tomorrow.                                  |
| Secondary | `.stat-pair`                    | 남은 연가 (after scheduled use, with 근태 누계) · 이번 달 급여 (confirmed amount and pay step)                                                                                                     | The two numbers 사회복무요원 track most. Neither competes with the hero: 20 px values on white. |
| Tertiary  | `.home-card` agenda             | Today's records and the next three upcoming ones, with relative day and a category bar                                                                                                             | Leave and schedule in one place, which cuts calendar switching.                                 |
| Tertiary  | `.quick-actions`                | 휴가·근태 기록 (opens the editor on today) · 연가 원장 · 기관 기록 가져오기                                                                                                                        | Thumb-reachable entry points. The last one is a social-service-only capability.                 |

The header dropped "홈 / 오늘의 복무 현황을 확인해요." in favour of brand, date and sync status on one line. The page `h1` "홈" stays for screen readers. This moved the hero up by about 60 px.

### Phase behaviour

| Phase           | Trigger (domain state)                          | Headline                  | Notes                                                                                                                                              |
| --------------- | ----------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRE_SERVICE`   | `NOT_STARTED`                                   | 소집까지 **D-n**          | No progress bar. "이후" row shows the discharge date and service length. Leave reads "소집 후".                                                    |
| `IN_SERVICE`    | `IN_SERVICE`, D > 30                            | 소집해제까지 **D-n**      | Teal accent.                                                                                                                                       |
| `FINAL_STRETCH` | `IN_SERVICE`, D ≤ 30                            | same                      | Warm amber accent. State chip reads "마지막 한 달", or "마지막 주" at D ≤ 7.                                                                       |
| `DISCHARGE_DAY` | `COMPLETED` and today = expected discharge date | **D-Day** · 오늘 소집해제 | One status line: "복무를 마쳤어요. 수고 많으셨어요."                                                                                               |
| `COMPLETED`     | `COMPLETED` after that date                     | **복무 완료**             | Shows days since discharge and total service days. Leave and pay cards are replaced by a records-export card, since leave and pay no longer apply. |

A milestone that falls on today shows as a status pill (for example "오늘 D-300 달성"), as does the first day of a new pay step. The pill uses `role="status"`. There is no confetti and no looping animation.

## 3. Rejected concepts

- **Radial ring hero.** Prototyped at the same width and content ([hero-linear-vs-ring.png](./design/qa-2026/hero-linear-vs-ring.png)):
  - 304 px tall versus 202 px for the linear hero (+50 %).
  - The D-number shrank from 66 px to 52 px to fit inside the ring.
  - Elapsed and remaining days no longer fit.
  - The Phase 0 audit had already found that a ring took disproportionate space. Rejected on one-second comprehension and vertical budget.
- **Day blocks (one cell per day).** 600+ cells cannot be told apart at phone width, and they would need a legend. Rejected.
- **Segments per service month.** Pay bands count calendar months (소집월 = 1개월 차), while anniversary months count from the call-up day. Two "N개월 차" meanings on two screens would contradict each other, for example 11 vs 12 for the mid-service fixture. Rejected. The bar keeps neutral 25/50/75 ticks, and the pay step appears as a milestone with an explicit date instead.
- **Equal-weight dashboard of 6+ cards.** This was the previous structure plus more tiles. Rejected: with no hierarchy, "얼마나 남았지?" competes with everything else.
- **Rank insignia and camouflage theming.** Rejected. 사회복무요원 are not ranked soldiers; "상당" pay steps are labels for pay, not rank.

## 4. Precision and time

- **Day model (unchanged):**
  - `calculateServiceProgress` counts Asia/Seoul calendar days: call-up = 0 %, expected discharge date = `COMPLETED`.
  - D-day, elapsed and remaining days, milestones and the progress bar all come from this model.
  - The displayed percentage is **floored** to one decimal, so the last service day can never read 100.0 %.
- **Live percentage:**
  - `continuousServiceCompletion` (domain) evaluates the same model between Seoul midnights.
  - At 00:00 KST on any date it equals exactly `elapsedDays / totalServiceDays`; a test checks this for several dates.
  - It therefore adds resolution without changing the definition.
  - It is shown to 4 decimals, which changes about every 5 s for a 21-month term.
  - The value is truncated, never rounded.
  - This is not fake precision: it is the exact elapsed fraction of the service period. It is not used for any administrative figure.
- **Cost:**
  - Only the memoised `LivePercent` element re-renders once per second.
  - The ticker stops while the page is hidden and slows to once a minute under `prefers-reduced-motion`.
  - Digits are `tabular-nums`, so ticking causes no layout shift.
  - The number is `aria-hidden`; screen readers get the day-based `aria-valuetext`, so they are never flooded with updates.
- **Midnight rollover:**
  - `useSeoulToday` is a `useSyncExternalStore` source.
  - A timer re-arms for the next 00:00 KST.
  - The date is re-read on `visibilitychange`, `pageshow` and `focus`, because timers are suspended in background tabs and installed iOS web apps.
  - The snapshot is a date string, so a wake-up that doesn't change the date causes no re-render.
  - The WebKit gate installs a clock at 23:59:55 KST, advances it 10 s, and requires the D-number to change without a reload. With the timer sabotaged, the gate fails; this was verified locally.

## 5. Milestones: sources of truth

| Kind                                     | Rule                                                                                                                                                                                                                        | Where                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| D-500/300/200/100/50/30/7/1              | expected discharge date − N days (strictly inside the period)                                                                                                                                                               | `packages/domain/src/service/milestones.ts` |
| 25/50/75/90/95/99 %                      | first date with `elapsed ≥ ⌈p·total/100⌉`                                                                                                                                                                                   | same                                        |
| 복무 100일째 / 1년                       | call-up date as day 1; calendar anniversary                                                                                                                                                                                 | same                                        |
| Next pay step (이병·일병·상병·병장 상당) | 병역법 시행령 제62조①: the call-up month is ordinal 1, plus confirmed 제62조② credit. Band boundaries come from the bundle in force today. **An amount is shown only when a verified bundle covers the step's start date.** | `packages/rules/src/pay-bands.ts`           |

The pay-step schedule refuses to answer (`NEEDS_INPUT`) until prior-service credit is answered, and when the credit includes a partial month. A test proves it agrees with `evaluateMonthlyCompensation`'s rank for every month of 2026. For 2027 it gives the date and says "2027년 보수 기준이 확인되면 금액을 보여 드려요". It never assumes that 2026 amounts carry over.

## 6. Pay (급여) UX

- User-facing term: **급여**. The legal component names stay **기본 보수 / 중식비 / 교통비** as returned by the rules layer.
- The money screen now **leads with what is known**:
  - the total when every component is calculated;
  - otherwise "확정된 기본 보수 ₩…", with the sentence that partial sums are never shown;
  - otherwise "아직 계산 전".
- It then shows 지금 단계 / 다음 단계.
- Legal bases collapse into a "근거 법령·기준" disclosure. The text is unchanged.
- The 장병내일준비적금 calculator is unchanged. Its limits (55만원/월, 21개월, 100 % matching) live in UI constants without source files in `docs/sources`. See limitations.

## 7. Calendar and leave as one system

- A **leave strip** at the top of 월간 / 목록 shows remaining leave after scheduled use, with a one-tap switch to the ledger.
- **Multi-day records** render as one continuous bar that breaks at week edges, instead of separate dots on each day.
- Home "휴가·근태 기록" opens the calendar with the editor already on today.
- Event-type colours are unchanged: the six existing category tokens.

## 8. Design system changes

- **Tokens added to `base.css`:**
  - Type scale: `--font-display … --font-micro`.
  - Spacing: `--space-1 … --space-8`.
  - `--radius-hero`, `--radius-pill`.
  - Hero roles: `--hero-*`, including the final-stretch accent.
  - `--ease-out`.
- **Contrast fixes:**
  - `--text-3` changed from `#7d8a9c` to `#627084`: 3.18:1 → 4.57:1 on the canvas.
  - Primary buttons changed to `--teal-deep`: white text went from 3.48:1 to 5.05:1.
- The new home, calendar-strip and money-summary styles use tokens only, with no new one-off colours outside the hero accents.
- The hero bar uses `transform: scaleX()` (composited) with a one-shot 900 ms fill. The global reduced-motion rule neutralises it.

## 9. Accessibility

- The hero headline is an `h2` with a spoken alternative ("소집해제까지 306일"), so "D-306" is not read letter by letter.
- The progress bar is `role="progressbar"` with `aria-valuetext` "복무 51.9% 완료, 331일 지남, 306일 남음". The gate asserts its format.
- Phase is never colour-only: the state chip and eyebrow text change as well.
- Touch targets: the gate fails if any home button is under 44 × 44 px. The header sync chip keeps its 32 px pill but has a 44 px hit area.
- The existing `:focus-visible` ring applies to every new control.

## 10. Responsive behaviour

- **320–359 px:** the leave and pay cards stack.
- **360–639 px:** two columns.
- **≥ 640 px:** larger hero (80 px D-number).
- **≥ 960 px:** hero on the left spanning two rows; stats and agenda on the right; quick actions under the hero; the header brand is hidden because the rail carries it.
- Verified at 320, 375, 390, 393, 430, 768 and 1440 px across six states, with no horizontal overflow and no console errors.

## 11. Performance

- No dependencies added. Icons come from the existing `lucide-react`.
- The static chunk total is unchanged (4.6 MB, dominated by the existing PDF/OCR/XLSX importers).
- The home model is a pure `useMemo` keyed on data, profile and date.
- Ticking is isolated as described in section 4.
