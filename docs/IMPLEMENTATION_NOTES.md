# Foundation implementation notes

## Implemented boundaries

- `packages/domain` owns deterministic Seoul civil-date handling, the guest service profile, 21-calendar-month discharge-date derivation, D-Day, and progress.
- `packages/rules` parses the source-derived JSON bundles, selects a single effective rule version, and returns an explainable calculation contract and replayable snapshot.
- `apps/web` is a guest-first Next.js PWA. It persists one versioned `UserData` document through the domain repository (localStorage adapter) and never places policy logic in React components. See ADR 0001.
- Leave credits are selected by each tranche's grant date. Call-up dates before the oldest verified leave bundle (2026-04-23) produce a PENDING_CONFIRMATION credit that the user confirms from institution records.

## Safety gates retained by design

- Meal uses the MMA 2026 minimum of KRW 9,000/day unless the user enters a higher institution amount; a lower amount is refused (see `docs/COMPENSATION_POLICY_2026.md`).
- Transport requires a user-entered daily fare (MMA basis: city-bus round-trip cash fare, transit-card 실비 for extra cost).
- Call-up/discharge months, months with possible non-payable days, and non-whole-month prior-service credit return a gated result rather than a guessed amount.
- Meal/transport day counts require a confirmed work schedule and a per-month holiday confirmation; the monthly total exists only when every component is calculated.
- Missing, ambiguous, or out-of-range effective-date rules return an explicit unsupported result; selection never falls back to a newer or older bundle.

## Verification

`packages/rules/fixtures/2026-boundaries.json` is executed directly by the rules test suite. The test cases cover the 2026-08-27/28 leave boundary, ordinary leave at 21 months, compensation pay-band boundaries, suggested meal status, transport context, and automatic-calculation gates.
