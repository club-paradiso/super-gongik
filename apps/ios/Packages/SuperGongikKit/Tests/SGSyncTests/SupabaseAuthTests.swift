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

/// One-shot latch: `wait()` suspends until `open()`; `arrived()` suspends
/// until someone is waiting.
final class Latch: @unchecked Sendable {
    private let lock = NSLock()
    private var isOpen = false
    private var hasArrived = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private var arrivals: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        await withCheckedContinuation { continuation in
            lock.lock()
            hasArrived = true
            let ready = arrivals
            arrivals = []
            if isOpen {
                lock.unlock()
                continuation.resume()
            } else {
                waiters.append(continuation)
                lock.unlock()
            }
            for arrival in ready { arrival.resume() }
        }
    }

    func arrived() async {
        await withCheckedContinuation { continuation in
            lock.lock()
            if hasArrived {
                lock.unlock()
                continuation.resume()
            } else {
                arrivals.append(continuation)
                lock.unlock()
            }
        }
    }

    func open() {
        lock.lock()
        isOpen = true
        let ready = waiters
        waiters = []
        lock.unlock()
        for waiter in ready { waiter.resume() }
    }
}

/// HTTP whose refresh-token grant is held until the test releases it, so
/// other actor calls can run while the refresh is in flight (reentrancy).
final class HeldRefreshHTTP: HTTPPerforming, @unchecked Sendable {
    let latch = Latch()
    private let lock = NSLock()
    private let refreshResponse: (Int, String)
    private var others: [(Int, String)]
    private(set) var paths: [String] = []

    init(refresh: (Int, String), others: [(Int, String)] = []) {
        refreshResponse = refresh
        self.others = others
    }

    func perform(_ request: URLRequest) async -> (status: Int, body: Data) {
        let isRefresh = request.url?.query?.contains("grant_type=refresh_token") == true
        let next: (Int, String) = lock.withLock {
            paths.append(request.url?.path ?? "")
            return isRefresh ? refreshResponse : (others.isEmpty ? (0, "") : others.removeFirst())
        }
        if isRefresh { await latch.wait() }
        return (next.0, Data(next.1.utf8))
    }
}

final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    var value: Int { lock.lock(); defer { lock.unlock() }; return count }
    func increment() { lock.lock(); count += 1; lock.unlock() }
}

@Suite("Supabase Auth (native)")
struct SupabaseAuthTests {
    let config = SupabaseConfig(url: URL(string: "https://project.supabase.co")!, anonKey: "anon")
    static let session = #"{"access_token":"a1","refresh_token":"r1","expires_in":3600,"user":{"id":"u1","email":"x@example.com"}}"#
    static let sessionB = #"{"access_token":"b1","refresh_token":"rb","expires_in":3600,"user":{"id":"u2","email":"y@example.com"}}"#
    static let expiringA = StoredSession(accessToken: "old", refreshToken: "r0", expiresAt: 0, userId: "u1", email: nil)

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

    @Test("only a refresh the server rejects ends the session; outages and rate limits keep it",
          arguments: [(400, true), (401, true), (403, true), (408, false), (429, false),
                      (500, false), (502, false), (503, false), (504, false)])
    func refreshStatus(status: Int, ends: Bool) async {
        let store = MemorySessionStore()
        store.value = Self.expiringA
        let ended = Counter()
        let auth = SupabaseAuth(config: config, http: ScriptedHTTP([(status, #"{"error_code":"x"}"#)]), store: store)
        await auth.onSessionEnded { ended.increment() }
        let result = await auth.currentSession()
        if ends {
            #expect(result == nil)
            #expect(store.value == nil)
        } else {
            #expect(result?.refreshToken == "r0")
            #expect(store.value == Self.expiringA)
        }
        // The handler runs on its own task; give it a moment.
        for _ in 0..<50 where ended.value == 0 && ends { try? await Task.sleep(for: .milliseconds(5)) }
        #expect(ended.value == (ends ? 1 : 0))
    }

    @Test("a successful refresh with an unreadable body keeps the session")
    func refreshUnreadable() async {
        let store = MemorySessionStore()
        store.value = Self.expiringA
        let auth = SupabaseAuth(config: config, http: ScriptedHTTP([(200, "<html>")]), store: store)
        #expect(await auth.currentSession()?.refreshToken == "r0")
        #expect(store.value == Self.expiringA)
    }

    @Test("signing out while a refresh is in flight stays signed out")
    func signOutDuringRefresh() async {
        let store = MemorySessionStore()
        store.value = Self.expiringA
        let http = HeldRefreshHTTP(refresh: (200, Self.session), others: [(204, "")])
        let auth = SupabaseAuth(config: config, http: http, store: store)
        let pending = Task { await auth.currentSession() }
        await http.latch.arrived()
        await auth.signOut()
        http.latch.open()
        #expect(await pending.value == nil)
        #expect(store.value == nil)
        #expect(await auth.currentSession() == nil)
        #expect(!auth.hasStoredSession)
    }

    @Test("signing in as another account while the old refresh is in flight keeps the new account")
    func signInDuringRefresh() async {
        let store = MemorySessionStore()
        store.value = Self.expiringA
        let http = HeldRefreshHTTP(refresh: (200, Self.session), others: [(200, Self.sessionB)])
        let auth = SupabaseAuth(config: config, http: http, store: store)
        let pending = Task { await auth.currentSession() }
        await http.latch.arrived()
        _ = await auth.verifyCode(email: "y@example.com", code: "123456")
        http.latch.open()
        #expect(await pending.value?.userId == "u2")
        #expect(store.value?.userId == "u2")
        #expect(await auth.currentSession()?.accessToken == "b1")
    }

    @Test("a rejected refresh of the old account does not delete the new account's session")
    func rejectedRefreshAfterSwitch() async {
        let store = MemorySessionStore()
        store.value = Self.expiringA
        let http = HeldRefreshHTTP(refresh: (400, #"{"error_code":"refresh_token_already_used"}"#),
                                   others: [(200, Self.sessionB)])
        let auth = SupabaseAuth(config: config, http: http, store: store)
        let ended = Counter()
        await auth.onSessionEnded { ended.increment() }
        let pending = Task { await auth.currentSession() }
        await http.latch.arrived()
        _ = await auth.verifyCode(email: "y@example.com", code: "123456")
        http.latch.open()
        _ = await pending.value
        #expect(store.value?.userId == "u2")
        #expect(await auth.currentSession()?.userId == "u2")
        try? await Task.sleep(for: .milliseconds(20))
        #expect(ended.value == 0)
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

    @Test("PKCE authorize URL uses S256 and the web's Kakao scope override")
    func pkce() {
        let auth = SupabaseAuth(config: config, http: ScriptedHTTP([]), store: MemorySessionStore())
        let pkce = SupabaseAuth.PKCE.make()
        #expect(pkce.verifier.count >= 43)
        let url = auth.authorizeURL(provider: "kakao", redirectTo: "app.supergongik.ios://auth-callback", pkce: pkce)
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
        #expect(items.contains(URLQueryItem(name: "code_challenge_method", value: "s256")))
        // Same parameter and value as the web (social-auth.ts queryParams.scope):
        // it replaces GoTrue's Kakao defaults, which include account_email.
        #expect(items.contains(URLQueryItem(name: "scope", value: "profile_nickname profile_image")))
        #expect(!items.contains { $0.name == "scopes" })
        let google = auth.authorizeURL(provider: "google", redirectTo: "app.supergongik.ios://auth-callback", pkce: pkce)
        #expect(!(URLComponents(url: google, resolvingAgainstBaseURL: false)!.queryItems!.contains { $0.name == "scope" }))
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
