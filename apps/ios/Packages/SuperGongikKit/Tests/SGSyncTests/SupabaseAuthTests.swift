import Foundation
import Testing
@testable import SGCore
@testable import SGSync

final class MemorySessionStore: SessionStoring, @unchecked Sendable {
    var value: StoredSession?
    func load() -> StoredSession? { value }
    func save(_ session: StoredSession) { value = session }
    func delete() { value = nil }
}

/// Scripted HTTP: records requests, answers from a queue.
final class ScriptedHTTP: HTTPPerforming, @unchecked Sendable {
    var responses: [(Int, String)]
    var requests: [URLRequest] = []
    init(_ responses: [(Int, String)]) { self.responses = responses }
    func perform(_ request: URLRequest) async -> (status: Int, body: Data) {
        requests.append(request)
        let (status, body) = responses.isEmpty ? (0, "") : responses.removeFirst()
        return (status, Data(body.utf8))
    }
}

@Suite("Supabase Auth (native)")
struct SupabaseAuthTests {
    let config = SupabaseConfig(url: URL(string: "https://project.supabase.co")!, anonKey: "anon")
    static let session = #"{"access_token":"a1","refresh_token":"r1","expires_in":3600,"user":{"id":"u1","email":"x@example.com"}}"#

    @Test("error kinds match the web mapping")
    func errorKinds() {
        #expect(SupabaseAuth.errorKind(status: 429, body: Data()) == "RATE_LIMITED")
        #expect(SupabaseAuth.errorKind(status: 400, body: Data(#"{"error_code":"over_email_send_rate_limit"}"#.utf8)) == "RATE_LIMITED")
        #expect(SupabaseAuth.errorKind(status: 403, body: Data(#"{"error_code":"otp_expired"}"#.utf8)) == "INVALID_CODE")
        #expect(SupabaseAuth.errorKind(status: 400, body: Data(#"{"error_code":"email_address_invalid"}"#.utf8)) == "INVALID_EMAIL")
        #expect(SupabaseAuth.errorKind(status: 0, body: Data()) == "NETWORK")
        #expect(SupabaseAuth.errorKind(status: 500, body: Data()) == "UNKNOWN")
    }

    @Test("email code sign-in stores the session; requests carry only the publishable key")
    func emailCode() async throws {
        let http = ScriptedHTTP([(200, "{}"), (200, Self.session)])
        let store = MemorySessionStore()
        let auth = SupabaseAuth(config: config, http: http, store: store)
        #expect(await auth.sendCode(email: "x@example.com") == nil)
        let result = await auth.verifyCode(email: "x@example.com", code: "123456")
        #expect((try? result.get())?.userId == "u1")
        #expect(store.value?.refreshToken == "r1")
        #expect(http.requests[0].url?.path == "/auth/v1/otp")
        #expect(http.requests[1].url?.path == "/auth/v1/verify")
        #expect(http.requests[0].value(forHTTPHeaderField: "apikey") == "anon")
    }

    @Test("expired tokens refresh once; a rejected refresh signs out; offline keeps the session")
    func refresh() async throws {
        let expired = StoredSession(accessToken: "old", refreshToken: "r0", expiresAt: 0, userId: "u1", email: nil)
        let store = MemorySessionStore()
        store.value = expired
        let refreshed = SupabaseAuth(config: config, http: ScriptedHTTP([(200, Self.session)]), store: store)
        #expect(await refreshed.currentSession()?.accessToken == "a1")

        store.value = expired
        let rejected = SupabaseAuth(config: config, http: ScriptedHTTP([(400, #"{"error_code":"refresh_token_not_found"}"#)]), store: store)
        #expect(await rejected.currentSession() == nil)
        #expect(store.value == nil)

        store.value = expired
        let offline = SupabaseAuth(config: config, http: ScriptedHTTP([]), store: store)
        #expect(await offline.currentSession()?.accessToken == "old")
    }

    @Test("account deletion calls the Edge Function with the user's token, then forgets the session")
    func deleteAccount() async {
        let store = MemorySessionStore()
        store.value = StoredSession(accessToken: "a1", refreshToken: "r1", expiresAt: 9_999_999_999, userId: "u1", email: nil)
        let http = ScriptedHTTP([(200, #"{"deleted":true}"#)])
        let auth = SupabaseAuth(config: config, http: http, store: store)
        #expect(await auth.deleteAccount())
        #expect(http.requests.first?.url?.path == "/functions/v1/delete-account")
        #expect(http.requests.first?.value(forHTTPHeaderField: "Authorization") == "Bearer a1")
        #expect(store.value == nil)
    }

    @Test("PKCE authorize URL uses S256 and the web's Kakao scopes")
    func pkce() {
        let auth = SupabaseAuth(config: config, http: ScriptedHTTP([]), store: MemorySessionStore())
        let pkce = SupabaseAuth.PKCE.make()
        #expect(pkce.verifier.count >= 43)
        let url = auth.authorizeURL(provider: "kakao", redirectTo: "app.supergongik.ios://auth-callback", pkce: pkce)
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
        #expect(items.contains(URLQueryItem(name: "code_challenge_method", value: "s256")))
        #expect(items.contains(URLQueryItem(name: "scopes", value: "profile_nickname profile_image")))
    }

    @Test("the transport cannot be pointed at another host")
    func hostPinning() async {
        let services = SupabaseCloudServices(
            auth: SupabaseAuth(config: config, http: ScriptedHTTP([]), store: MemorySessionStore()),
            http: ScriptedHTTP([(200, "{}")]))
        let foreign = await services.http(CoreHTTPRequest(method: "GET", url: "https://evil.example/rest/v1/x", headers: [:], body: nil, timeoutMs: 1000))
        #expect(foreign.status == 0)
    }
}
