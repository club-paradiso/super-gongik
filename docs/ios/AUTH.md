# Authentication on iOS

Status: **Kakao verified against the hosted project on 2026-10-13** (simulator:
sign-in after a guest start, 계정 shows 카카오 계정, enable preview DOWNLOAD
pulls the web account's profile and ends onboarding). Google, Apple, NAVER,
email code and token refresh are not yet verified on iOS. Sign-in is
optional and only enables sync and cloud backup. The cloud screen appears
only when `SG_SUPABASE_URL` and `SG_SUPABASE_ANON_KEY` are set
(`apps/ios/Config/Local.xcconfig`, git-ignored), like the web.

| Method               | Implementation (`SGSync/SupabaseAuth.swift`)                                                                                                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email code           | `POST /auth/v1/otp {email, create_user}` → user types the code → `POST /auth/v1/verify {type: "email", email, token}`                                                                                                                                                                                                                       |
| Google, Kakao, NAVER | `ASWebAuthenticationSession` (ephemeral) to `/auth/v1/authorize?provider=…&redirect_to=app.supergongik.ios://auth-callback&code_challenge=…&code_challenge_method=s256` (Kakao adds the web's `scope=profile_nickname profile_image`, which replaces GoTrue's Kakao defaults incl. `account_email`) → `POST /auth/v1/token?grant_type=pkce` |
| Sign in with Apple   | `SignInWithAppleButton` with a SHA-256 nonce → `POST /auth/v1/token?grant_type=id_token {provider: "apple", id_token, nonce}`                                                                                                                                                                                                               |
| Refresh              | when the token expires within 60 s. Only 400/401/403 (refresh token rejected) end the session and tell the controller (`onSessionEnded` → `cloudSessionChanged(nil)` → guest). No response, 408, 429 and 5xx keep it. A refresh answer that arrives after a sign-out, sign-in or switch is discarded                                        |
| Sign-out             | the Keychain item is removed, then `POST /auth/v1/logout?scope=local`; local records stay                                                                                                                                                                                                                                                   |
| Account deletion     | `POST /functions/v1/delete-account` (supabase/functions/delete-account) with the user's token; then the account's sync checkpoint is cleared (`cloudDisable`); local records stay                                                                                                                                                           |

Error kinds match the web (`INVALID_EMAIL`, `INVALID_CODE`, `RATE_LIMITED`,
`NETWORK`, `UNKNOWN`) and are shown with the web's sentences. Sessions live
in the Keychain (`AfterFirstUnlockThisDeviceOnly`, not synced). No provider
SDK, no provider secret and no service-role key is in the app.

## Configuration steps (human, needs credentials)

1. Supabase → Auth → URL configuration → Redirect URLs: add
   `app.supergongik.ios://auth-callback` (or your final bundle id scheme).
2. Supabase → Auth → Providers → Apple: Services ID, team ID, key ID and
   private key (stored in Supabase only). Enable the Sign in with Apple
   capability for the app id in the developer portal. This needs the paid
   Apple Developer Program; until then keep `SG_SIGN_IN_WITH_APPLE = NO`
   (the button stays hidden; App Review's Sign in with Apple rule only
   applies at submission, which needs the membership anyway).
3. Google/Kakao/NAVER need no change beyond the existing Supabase callback.
   The app offers Kakao, then Google. NAVER appears only with
   `SG_SIGN_IN_NAVER = YES` (once Supabase has the `custom:naver` provider),
   and the email code only with `SG_SIGN_IN_EMAIL = YES` (once custom SMTP
   delivers codes to anyone; the built-in sender reaches organization
   members only, two messages an hour). Both default to `NO` in
   Base.xcconfig.
4. Deploy the deletion function: `supabase functions deploy delete-account`
   (the runtime provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`).
5. Put the project URL and **anon** key in `Config/Local.xcconfig`
   (`https:/$()/<ref>.supabase.co` — `//` starts a comment in xcconfig).
