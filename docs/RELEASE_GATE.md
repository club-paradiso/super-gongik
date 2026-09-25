# SUPER GONGIK automated release gate

This repository treats repetitive browser and synchronization verification as CI work, not as a manual release checklist.

## What every pull request must pass

### Workspace verification
The existing CI verifies:

- lint
- formatting
- TypeScript
- unit and deterministic domain tests
- production Next.js build

### PostgreSQL / PostgREST / RLS synchronization gate
The database job applies the real migrations to PostgreSQL and runs the web Supabase transport against PostgREST with locally signed test JWTs.

It covers:

- two-device upload and download
- independent offline edits converging
- concurrent-edit conflict and explicit resolution
- stale enable-preview rejection after a remote write
- retry after a lost push response without duplication
- account isolation and anonymous denial
- transport identity pinning across account changes
- cloud reset generation protection
- stale-device re-upload blocking
- cloud backup upload/list/download integrity
- network/error categorization

Supabase Auth email delivery itself is intentionally not simulated by this stack.

### WebKit mobile browser gate
CI installs an isolated Playwright WebKit runtime and runs the production build at:

- 375 × 812
- 390 × 844
- 430 × 932

For each viewport it exercises:

1. onboarding
2. native date inputs and automatic discharge-date population
3. home dashboard
4. fixed bottom navigation
5. calendar
6. mobile event-editor dialog/bottom sheet
7. money
8. profile

The gate fails on:

- horizontal document overflow
- browser console errors
- page errors
- missing date formatting
- hidden event-editor action area
- bottom navigation outside the viewport
- missing primary mobile surfaces

Viewport screenshots are uploaded as a GitHub Actions artifact for 14 days.

## What this replaces

A person does **not** need to manually repeat the complete onboarding → home → calendar → editor → money → profile regression on every release.

The automated gate is the default regression evidence.

## What remains external / physical-device only

Automation cannot truthfully certify these without the external system or physical device:

- actual Supabase transactional-email delivery and numeric OTP contents
- provider-specific SMTP behavior
- the visual chrome of the native iOS date picker
- Safari browser bars and hardware safe-area appearance on a physical iPhone
- installed home-screen PWA background/resume behavior on iOS

These are narrow operational smoke checks, not full regression passes.

## Issue #29

Issue #29 remains the production cloud-sync activation gate until real Supabase Auth email delivery is working and the remaining external checks are resolved.

The automated gate should be used to eliminate repeated manual functional testing while that external dependency is being resolved.
