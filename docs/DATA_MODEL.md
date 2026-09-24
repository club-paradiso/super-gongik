# SUPER GONGIK Data Model

## 1. Design principles

- Store canonical facts once.
- Derive dashboards and summaries from canonical records.
- Represent time internally in minutes where duration matters.
- Keep policy versions separate from user records.
- Preserve enough metadata to explain historical calculations.

## 1a. Implemented document (schema version 2)

The source of truth is the zod schema in `packages/domain/src/store/schema.ts`.
The sections below describe the long-term relational target; this is what is
stored today:

```text
UserData {
  schemaVersion: 2, documentRevision, savedAt, deviceId,
  profile: ServiceProfile | null      // + workdayMinutes, priorServiceCredit
  events: ServiceEvent[]              // manual and imported, one shape
  leaveAdjustments: LeaveAdjustment[] // GRANT_CONFIRMATION | CORRECTION
  leaveSnapshots: LeaveSnapshot[]     // institution balance evidence
  imports: ImportRecord[]             // batches, ACTIVE | ROLLED_BACK
}

ServiceEvent {
  id, serviceProfileId, eventType, startDate, endDate (inclusive, Seoul civil dates),
  timing: ALL_DAY{dayCount} | HALF_DAY{half} | PARTIAL{durationMinutes|null, startTime, endTime},
  title, note, status: CONFIRMED,
  source: MANUAL | IMPORT{batchId, format, fileName, fingerprint, confidence, sourceRowIndex},
  createdAt, updatedAt, deletedAt, revision, deviceId
}
```

- Partial usage is integer minutes; the half-day annual-leave unit is an
  integer count of halves. No floating-point day value is stored.
- `PARTIAL.durationMinutes = null` exists only for imported rows whose
  duration could not be resolved; the ledger excludes and flags them.
- Two leave records may not charge the same time: see ADR 0001 §7 for the
  CONFLICT / UNRESOLVED rules.
- Leave usage is never stored separately; the ledger is recomputed from
  credits (rules), confirmations/corrections (adjustments) and events.
- The pre-document layout (`super-gongik.service-profile.v1`,
  `super-gongik:service-records:v1:<id>`) is migrated on first load and left
  in place until the user wipes data.

## 2. Core entities (long-term target)

### service_profile

Represents one user's service context.

Fields:

- id
- owner_id nullable for guest mode
- local_profile_id
- call_up_date
- expected_discharge_date
- service_category nullable
- workplace_type nullable
- default_commute_cost nullable
- default_meal_allowance_override nullable
- timezone default Asia/Seoul
- created_at
- updated_at

### service_event

Canonical timeline record.

Fields:

- id
- service_profile_id
- event_type
- starts_at
- ends_at nullable
- duration_minutes nullable
- all_day boolean
- status
- title nullable
- note nullable
- metadata jsonb
- created_at
- updated_at
- deleted_at nullable
- revision
- device_id

Initial `event_type` values:

- WORKDAY_OVERRIDE
- ANNUAL_LEAVE
- SICK_LEAVE
- OFFICIAL_LEAVE
- SPECIAL_LEAVE
- COMPASSIONATE_LEAVE
- OUTING
- LATE_ARRIVAL
- EARLY_LEAVE
- EDUCATION
- TRAINING
- SERVICE_STATUS_CHANGE
- USER_NOTE

### leave_account

Stores a logical leave bucket, not every derived balance.

Fields:

- id
- service_profile_id
- leave_type
- label
- unit_policy
- created_at

### leave_credit

Represents leave granted or adjusted.

Fields:

- id
- leave_account_id
- granted_at
- amount_minutes
- reason
- source_rule_id nullable
- source_rule_version nullable
- note nullable
- created_at

Leave usage should generally be derived from `service_event` rather than duplicated here.

### compensation_period

Represents a monthly compensation projection or recorded actual payment.

Fields:

- id
- service_profile_id
- year
- month
- status: ESTIMATE | FINAL | USER_RECORDED
- total_amount
- currency default KRW
- rule_id
- rule_version
- inputs_snapshot jsonb
- result_breakdown jsonb
- generated_at
- updated_at

### policy_rule

Metadata for versioned rules.

Fields:

- id
- domain: SERVICE | LEAVE | COMPENSATION
- version
- effective_from
- effective_until nullable
- jurisdiction default KR
- source_title
- source_url
- verified_at
- payload jsonb
- checksum
- created_at

### sync_state

Tracks device synchronization.

Fields:

- id
- service_profile_id
- device_id
- last_pushed_revision
- last_pulled_at
- last_successful_sync_at
- sync_error_code nullable

## 3. Canonical relationships

```text
service_profile
  |
  +-- service_event
  |
  +-- leave_account
  |     +-- leave_credit
  |
  +-- compensation_period
  |
  +-- sync_state

policy_rule
  +-- referenced by leave credits and compensation snapshots
```

## 4. Leave balance derivation

For a leave account:

```text
balance_minutes
= sum(leave_credit.amount_minutes)
- sum(applicable service_event.duration_minutes)
```

Presentation in days/hours is derived from active policy and context. Do not store a floating-point `days_remaining` as the source of truth.

## 5. Event duration rules

If an event has explicit `duration_minutes`, use it after validation.
If it has `starts_at` and `ends_at`, derive duration according to policy/business-hours rules.
If it is all-day leave, derive the charge from the applicable rule version rather than assuming 480 minutes globally.

## 6. Soft deletion

Use `deleted_at` for user records that may need sync recovery.
Hard deletion is reserved for account purge/export-complete privacy operations.

## 7. Historical integrity

When an estimate is generated, persist:

- rule identifier
- rule version
- relevant input snapshot
- component breakdown

Do not silently recalculate old periods with new policy rules unless the user explicitly requests a refreshed estimate.

## 8. Privacy minimization

Do not store by default:

- resident registration number
- detailed medical diagnosis
- unrelated workplace personnel data
- exact workplace address unless a future feature requires it and the user opts in

## 9. Export model

JSON export should include:

- schema_version
- exported_at
- service_profile
- service_events
- leave_accounts
- leave_credits
- compensation_periods
- user preferences

CSV exports should be separate for events, leave ledger, and compensation history.
