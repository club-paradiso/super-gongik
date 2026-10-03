# Privacy inventory — native iOS client

## Data in this version (local-only)

| Data                                                                                  | Where                         | Leaves the device?                                              |
| ------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------- |
| Service profile (dates, schedule, prior-service answer, meal/commute amounts, region) | app container                 | Only in a backup file the user exports, or the OS device backup |
| Service records (leave, sick leave, attendance, notes)                                | app container                 | same                                                            |
| Leave adjustments, import history, attendance months, compensation snapshots          | app container                 | same                                                            |
| Widget snapshot (dates, formatted leave remaining, next record's generic category)    | App Group container           | No                                                              |
| UI preferences (lock, cover, reminder categories, last backup time)                   | UserDefaults                  | OS device backup only                                           |
| Scheduled reminders (generic text)                                                    | UserNotifications (on device) | No                                                              |

Without sign-in: no network requests, no analytics, no advertising
identifier, no crash-reporting SDK, no third-party code besides the bundled
Pretendard font. Sign-in and sync are optional and off by default.

## App Store privacy answers (this version)

Builds without cloud configuration: "Data Not Collected". Builds with cloud
sync configured must declare the data below (App Store labels and
`PrivacyInfo.xcprivacy` `NSPrivacyCollectedDataTypes`) before submission.

## When a user signs in and turns sync on

| Category (App Store)              | Data                                                                        | Linked to user | Tracking | Purpose           |
| --------------------------------- | --------------------------------------------------------------------------- | -------------- | -------- | ----------------- |
| Contact Info → Email Address      | sign-in email (Supabase Auth)                                               | yes            | no       | App Functionality |
| Identifiers → User ID             | Supabase user id                                                            | yes            | no       | App Functionality |
| User Content → Other User Content | synced records and cloud backups (may include sick-leave entries and notes) | yes            | no       | App Functionality |

Sick-leave entries are records of approved absence, not medical data, but
they are sensitive: they must be described plainly in the privacy policy.
The Supabase operator can read synced data (not end-to-end encrypted,
CLOUD_SYNC.md §10); the policy must say so. Update `PrivacyInfo.xcprivacy`
`NSPrivacyCollectedDataTypes` in the same change.

## Defaults that protect privacy

- Guest mode; no sign-in prompt at onboarding.
- App-switcher cover on by default; Face ID lock optional.
- Widgets and notifications never show notes, titles or that a leave is
  sick leave.
- Logs are `.private` and content-free.
- Backup export explains that the file is not encrypted.
