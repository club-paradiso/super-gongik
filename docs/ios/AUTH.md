# Authentication on iOS

Status: **not implemented in this branch.** Sign-in exists only to enable
sync and cloud backup; the app never requires it. Configuration hooks exist
(`SG_SUPABASE_URL`, `SG_SUPABASE_ANON_KEY` in `Config/Local.xcconfig`), and
the cloud UI stays hidden unless both are set, like the web.

## Account model (same as web)

Supabase Auth; one account → one bound service profile; methods: email
one-time code, Google, Kakao, NAVER (`custom:naver`, OIDC).

## Native approach

| Method               | Flow                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email code           | `POST /auth/v1/otp {email, create_user: true}` → user types the 6-digit code → `POST /auth/v1/verify {type: "email", email, token}`. No link handling needed.                                                                                                                                                                           |
| Google, Kakao, NAVER | `ASWebAuthenticationSession` to `/auth/v1/authorize?provider=<id>&redirect_to=<scheme>://auth-callback&code_challenge=<S256>&code_challenge_method=s256` (Kakao adds `scopes=profile_nickname profile_image`), then `POST /auth/v1/token?grant_type=pkce {auth_code, code_verifier}`. No provider SDKs, no provider secrets in the app. |
| Sign in with Apple   | Required by App Review guideline 4.8 once Google/Kakao/NAVER are offered (re-check the current guideline before submission). Native `ASAuthorizationAppleIDProvider` → `POST /auth/v1/token?grant_type=id_token {provider: "apple", id_token, nonce}`. Needs the Apple provider enabled in Supabase.                                    |

Sessions: access and refresh tokens in the Keychain
(`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, not synced to iCloud
Keychain); refresh with `grant_type=refresh_token`; sign-out is local
(`scope=local`) and keeps local records, as on the web.

## Configuration steps (human, needs credentials)

1. Supabase → Auth → URL configuration: add the app's redirect
   (`app.supergongik.ios://auth-callback` or a universal link) to Redirect
   URLs.
2. Register the URL scheme in `project.yml` (`CFBundleURLTypes`) or set up
   Associated Domains for a universal link (needs the team ID).
3. Supabase → Providers → Apple: Services ID, key ID, team ID, private key
   (in Supabase only).
4. Google/Kakao/NAVER consoles: no change beyond the existing Supabase
   callback URL; secrets stay in Supabase.
5. Put the project URL and **anon** key in `Config/Local.xcconfig`. Never a
   service-role key: the app treats the anon key as public, and RLS is the
   security boundary.

## Account deletion

App Store rules require in-app account deletion for apps that offer
account creation. Deleting the Supabase user cascades every cloud row
(`20260925012500_auth_user_delete_cascade.sql`), but a client cannot delete
its own auth user with the anon key. This needs a server-side function
(Edge Function with the service role, called with the user's token) and is
listed as a release blocker for any build that offers sign-in.
