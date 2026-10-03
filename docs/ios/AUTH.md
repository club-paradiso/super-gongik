# Authentication on iOS

Status: **implemented, not verified against a hosted project.** Sign-in is
optional and only enables sync and cloud backup. The cloud screen appears
only when `SG_SUPABASE_URL` and `SG_SUPABASE_ANON_KEY` are set
(`apps/ios/Config/Local.xcconfig`, git-ignored), like the web.

| Method               | Implementation (`SGSync/SupabaseAuth.swift`)                                                                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email code           | `POST /auth/v1/otp {email, create_user}` → user types the code → `POST /auth/v1/verify {type: "email", email, token}`                                                                                                                         |
| Google, Kakao, NAVER | `ASWebAuthenticationSession` (ephemeral) to `/auth/v1/authorize?provider=…&redirect_to=app.supergongik.ios://auth-callback&code_challenge=…&code_challenge_method=s256` (Kakao adds the web's scopes) → `POST /auth/v1/token?grant_type=pkce` |
| Sign in with Apple   | `SignInWithAppleButton` with a SHA-256 nonce → `POST /auth/v1/token?grant_type=id_token {provider: "apple", id_token, nonce}`                                                                                                                 |
| Refresh              | when the token expires within 60 s; a rejected refresh ends the session, an offline one keeps it                                                                                                                                              |
| Sign-out             | `POST /auth/v1/logout?scope=local`, then the Keychain item is removed; local records stay                                                                                                                                                     |
| Account deletion     | `POST /functions/v1/delete-account` (supabase/functions/delete-account) with the user's token; local records stay                                                                                                                             |

Error kinds match the web (`INVALID_EMAIL`, `INVALID_CODE`, `RATE_LIMITED`,
`NETWORK`, `UNKNOWN`) and are shown with the web's sentences. Sessions live
in the Keychain (`AfterFirstUnlockThisDeviceOnly`, not synced). No provider
SDK, no provider secret and no service-role key is in the app.

## Configuration steps (human, needs credentials)

1. Supabase → Auth → URL configuration → Redirect URLs: add
   `app.supergongik.ios://auth-callback` (or your final bundle id scheme).
2. Supabase → Auth → Providers → Apple: Services ID, team ID, key ID and
   private key (stored in Supabase only). Enable the Sign in with Apple
   capability for the app id in the developer portal.
3. Google/Kakao/NAVER need no change beyond the existing Supabase callback.
4. Deploy the deletion function: `supabase functions deploy delete-account`
   (the runtime provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`).
5. Put the project URL and **anon** key in `Config/Local.xcconfig`
   (`https:/$()/<ref>.supabase.co` — `//` starts a comment in xcconfig).
