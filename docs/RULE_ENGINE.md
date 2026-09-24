# SUPER GONGIK Rules Engine

## 1. Why a rules engine exists

Service, leave, and compensation behavior can change by policy year, effective date, or user context. Hard-coding these rules across UI components creates silent errors and makes historical results impossible to explain.

Policy logic therefore lives in versioned rule data plus deterministic calculation functions.

## 2. Rule domains

Initial domains:

- SERVICE
- LEAVE
- COMPENSATION

Potential future domains:

- NOTIFICATION
- ELIGIBILITY
- KNOWLEDGE

## 3. Rule file contract

Each rule bundle should contain:

```json
{
  "id": "compensation.kr.social-service.2026",
  "domain": "COMPENSATION",
  "version": "2026.1",
  "effectiveFrom": "2026-01-01",
  "effectiveUntil": "2026-12-31",
  "jurisdiction": "KR",
  "status": "VERIFIED",
  "source": {
    "title": "Official source title",
    "url": "https://...",
    "verifiedAt": "2026-08-30"
  },
  "rules": {}
}
```

A rule file is not considered production-ready without source metadata.

## 4. Rule selection

Rule selection must be deterministic.

Inputs:

- domain
- calculation date
- service profile context

Output:

- exactly one applicable rule bundle or an explicit unsupported state

Never silently fall back to a newer or older year when no verified rule applies.

The calculation date is the evaluated date itself (event date, payment date,
or the day inside the evaluated month), never an implied January 1 of its
year, so a rule amended mid-year applies from its actual effective date.
Every leave and compensation function takes the date explicitly.

## 5. Calculation contract

Each calculation returns more than a number.

```ts
type CalculationResult<T> = {
  value: T;
  ruleId: string;
  ruleVersion: string;
  effectiveDate: string;
  inputs: Record<string, unknown>;
  breakdown: Record<string, unknown>;
  warnings: string[];
};
```

This enables explainable UI and reproducible historical results.

## 6. Compensation calculation flow

```text
service profile
+ month
+ service events
+ user overrides
        |
        v
select compensation rule
        |
        v
normalize billable/eligible days
        |
        v
calculate components
        |
        +-- base pay
        +-- meal allowance
        +-- transport allowance
        +-- supported adjustments
        |
        v
result + explanation + warnings
```

The product must label values as estimates when official payment may differ due to institution-specific processing or unsupported exceptions.

## 7. Leave calculation flow

```text
leave credits
+ leave events
+ applicable leave rule
        |
        v
normalize duration to minutes
        |
        v
apply charging rules
        |
        v
balance + ledger explanation
```

Do not assume one day always equals a globally fixed number of minutes. The rule or profile context must define conversion behavior.

## 8. Historical rules

When a user views a past month, the app should prefer the rule version stored in the calculation snapshot.

If the user explicitly requests recalculation:

- preserve the previous snapshot
- generate a new snapshot
- show that the result was recalculated under a different rule version

## 9. Verification states

Recommended states:

- DRAFT
- VERIFIED
- SUPERSEDED
- RETIRED

Only VERIFIED rules may be used automatically in production calculations.

## 10. Rule tests

Every rule bundle must ship with test fixtures.

Example categories:

- first/last effective date
- month boundary
- leap day when relevant
- partial-day leave
- overlapping events
- unsupported event combination
- historical snapshot replay

## 11. Source maintenance

For each rule bundle maintain:

- source title
- canonical source URL
- effective date
- last verified date
- internal maintainer note if interpretation is non-obvious

If a policy source becomes unavailable, keep the rule but mark verification status appropriately until revalidated.

## 12. User-facing transparency

Calculation detail screens should expose:

- rule version
- effective date
- source title
- last verified date
- assumptions
- warnings

The user should never have to trust a mysterious total produced by invisible conditionals.
