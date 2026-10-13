import CryptoKit
import Foundation
import Security
import SGCore

/// Build-time Supabase configuration (publishable values only).
public struct SupabaseConfig: Sendable {
    public let url: URL
    public let anonKey: String

    public init(url: URL, anonKey: String) {
        self.url = url
        self.anonKey = anonKey
    }
}

/// A stored Supabase Auth session.
public struct StoredSession: Codable, Sendable, Equatable {
    public var accessToken: String
    public var refreshToken: String
    /// Seconds since 1970.
    public var expiresAt: Double
    public var userId: String
    public var email: String?
    /// GoTrue's `app_metadata.provider` ("kakao", "google", "apple",
    /// "custom:naver", "email"). Optional so sessions stored before it
    /// existed still decode.
    public var provider: String?

    var core: CoreSession { CoreSession(userId: userId, email: email, accessToken: accessToken) }
}

/// What the cloud screen shows on the 계정 row. Kakao accounts have no email
/// (the app asks Kakao for nickname and profile image only), so the provider
/// name stands in for it.
public func accountDisplayName(email: String?, provider: String?) -> String {
    if let email, !email.isEmpty { return email }
    switch provider {
    case "kakao": return "카카오 계정"
    case "google": return "Google 계정"
    case "apple": return "Apple 계정"
    case "custom:naver", "naver": return "네이버 계정"
    default: return "로그인됨"
    }
}

public protocol SessionStoring: Sendable {
    func load() -> StoredSession?
    func save(_ session: StoredSession)
    func delete()
}

/// Keychain storage for the session: this device only, available after the
/// first unlock (so a background refresh can read it), never synced to
/// iCloud Keychain.
public struct KeychainSessionStore: SessionStoring {
    let service: String

    public init(service: String = "app.supergongik.auth") { self.service = service }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: "session"]
    }

    public func load() -> StoredSession? {
        var item: CFTypeRef?
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        guard SecItemCopyMatching(request as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(StoredSession.self, from: data)
    }

    public func save(_ session: StoredSession) {
        guard let data = try? JSONEncoder().encode(session) else { return }
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }

    public func delete() { SecItemDelete(query as CFDictionary) }
}

/// Performs HTTP for the sync transport and for Auth. Status 0 = no response.
public protocol HTTPPerforming: Sendable {
    func perform(_ request: URLRequest) async -> (status: Int, body: Data)
}

public struct URLSessionHTTP: HTTPPerforming {
    let session: URLSession

    public init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.waitsForConnectivity = false
        session = URLSession(configuration: configuration)
    }

    public func perform(_ request: URLRequest) async -> (status: Int, body: Data) {
        do {
            let (data, response) = try await session.data(for: request)
            return ((response as? HTTPURLResponse)?.statusCode ?? 0, data)
        } catch {
            return (0, Data())
        }
    }
}

/// Supabase Auth (GoTrue) for the native client: email one-time code,
/// refresh, local sign-out, OAuth with PKCE and Sign in with Apple. Error
/// kinds match the web's `supabase-auth.ts` mapping. No provider secrets.
public actor SupabaseAuth {
    public let config: SupabaseConfig
    let http: HTTPPerforming
    let store: SessionStoring
    private var cached: StoredSession?
    private var refreshing: Task<StoredSession?, Never>?
    /// Bumped whenever the stored session is replaced or removed (sign-in,
    /// sign-out, deletion). A refresh that started under an older value
    /// must not apply its result: actor reentrancy lets those run while the
    /// refresh request is in flight.
    private var generation = 0
    private var sessionEnded: (@Sendable () async -> Void)?
    private let now: @Sendable () -> Date

    public init(config: SupabaseConfig, http: HTTPPerforming = URLSessionHTTP(),
                store: SessionStoring = KeychainSessionStore(), now: @escaping @Sendable () -> Date = Date.init) {
        self.config = config
        self.http = http
        self.store = store
        self.now = now
        self.cached = store.load()
    }

    public nonisolated var hasStoredSession: Bool { store.load() != nil }
    /// The signed-in account's provider, read from the Keychain without a
    /// refresh or a request.
    public nonisolated var storedProvider: String? { store.load()?.provider }

    private func request(_ path: String, query: [URLQueryItem] = [], body: [String: Any]?, bearer: String? = nil) -> URLRequest {
        var components = URLComponents(url: config.url.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!, timeoutInterval: 20)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.setValue(config.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(bearer ?? config.anonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let body { request.httpBody = try? JSONSerialization.data(withJSONObject: body) }
        return request
    }

    /// Web mapping (apps/web/src/lib/sync/supabase-auth.ts `authError`).
    static func errorKind(status: Int, body: Data) -> String {
        let object = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
        let code = (object?["error_code"] as? String) ?? (object?["code"] as? String) ?? ""
        if status == 429 || code == "over_email_send_rate_limit" { return "RATE_LIMITED" }
        if code == "otp_expired" || code == "invalid_credentials" || status == 403 { return "INVALID_CODE" }
        if code == "validation_failed" || code == "email_address_invalid" { return "INVALID_EMAIL" }
        if status == 0 { return "NETWORK" }
        return "UNKNOWN"
    }

    static func session(from body: Data, now: Date) -> StoredSession? {
        guard let object = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any],
              let access = object["access_token"] as? String,
              let refresh = object["refresh_token"] as? String,
              let user = object["user"] as? [String: Any],
              let id = user["id"] as? String
        else { return nil }
        let expiresAt = (object["expires_at"] as? Double)
            ?? now.timeIntervalSince1970 + ((object["expires_in"] as? Double) ?? 3600)
        let email = (user["email"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let provider = (user["app_metadata"] as? [String: Any])?["provider"] as? String
        return StoredSession(accessToken: access, refreshToken: refresh, expiresAt: expiresAt,
                             userId: id, email: email, provider: provider)
    }

    private func adopt(_ session: StoredSession) {
        generation += 1
        refreshing = nil
        cached = session
        store.save(session)
    }

    private func forget() {
        generation += 1
        refreshing = nil
        cached = nil
        store.delete()
    }

    /// Called (outside the actor, without waiting) when the server rejected
    /// the refresh token and the session ended here. The web gets the same
    /// signal from supabase-js as `SIGNED_OUT`.
    public func onSessionEnded(_ handler: @escaping @Sendable () async -> Void) {
        sessionEnded = handler
    }

    /// Refresh responses that mean the refresh token itself is no longer
    /// valid (GoTrue: refresh_token_not_found, refresh_token_already_used,
    /// session_not_found, ...). Anything else — no response, 408, 429, 5xx,
    /// an unreadable body — is transient and keeps the session, as
    /// supabase-js keeps it for retryable errors.
    static func refreshRejected(status: Int) -> Bool {
        status == 400 || status == 401 || status == 403
    }

    // MARK: Email one-time code

    public func sendCode(email: String) async -> String? {
        let (status, body) = await http.perform(request("auth/v1/otp", body: ["email": email, "create_user": true]))
        return (200..<300).contains(status) ? nil : Self.errorKind(status: status, body: body)
    }

    public func verifyCode(email: String, code: String) async -> Result<StoredSession, CoreAuthFailure> {
        let (status, body) = await http.perform(request("auth/v1/verify", body: ["type": "email", "email": email, "token": code]))
        guard (200..<300).contains(status), let session = Self.session(from: body, now: now()) else {
            return .failure(CoreAuthFailure(Self.errorKind(status: status, body: body)))
        }
        adopt(session)
        return .success(session)
    }

    // MARK: Session

    /// The stored session, refreshed when it expires within a minute. A
    /// refresh that the server rejects ends the session (signed out locally);
    /// one that fails for lack of network or a server error keeps it for a
    /// later attempt.
    public func currentSession() async -> StoredSession? {
        guard let session = cached else { return nil }
        if session.expiresAt - now().timeIntervalSince1970 > 60 { return session }
        if let refreshing { return await refreshing.value }
        let task = Task { await self.refresh(session) }
        refreshing = task
        let result = await task.value
        if refreshing == task { refreshing = nil }
        return result
    }

    private func refresh(_ session: StoredSession) async -> StoredSession? {
        let started = generation
        let (status, body) = await http.perform(request(
            "auth/v1/token", query: [URLQueryItem(name: "grant_type", value: "refresh_token")],
            body: ["refresh_token": session.refreshToken]))
        // Signed out, signed in again or switched while the request was in
        // flight: the answer belongs to a session that is no longer current.
        // Neither restore it nor delete its successor.
        guard generation == started, cached?.refreshToken == session.refreshToken else { return cached }
        if (200..<300).contains(status), let next = Self.session(from: body, now: now()) {
            adopt(next)
            return next
        }
        guard Self.refreshRejected(status: status) else {
            return session // transient: the transport will report NETWORK / a retry
        }
        forget()
        if let sessionEnded { Task { await sessionEnded() } }
        return nil
    }

    /// Local sign-out (web: `signOut({ scope: "local" })`): this device only.
    public func signOut() async {
        guard let session = cached else {
            forget()
            return
        }
        // Forget first: a refresh in flight must not bring the session back,
        // and a sign-in during the logout request must not be removed by it.
        forget()
        _ = await http.perform(request("auth/v1/logout", query: [URLQueryItem(name: "scope", value: "local")],
                                       body: [:], bearer: session.accessToken))
    }

    /// In-app account deletion through the `delete-account` Edge Function
    /// (supabase/functions). On success the local session is removed; local
    /// records stay on the device.
    public func deleteAccount() async -> Bool {
        guard let session = await currentSession() else { return false }
        let (status, _) = await http.perform(request("functions/v1/delete-account", body: [:], bearer: session.accessToken))
        guard status == 200 else { return false }
        // Only the deleted account's session; a sign-in that landed during
        // the request stays.
        if cached?.userId == session.userId { forget() }
        return true
    }

    // MARK: OAuth (PKCE) and Sign in with Apple

    public struct PKCE: Sendable {
        public let verifier: String
        public let challenge: String

        public static func make() -> PKCE {
            var bytes = [UInt8](repeating: 0, count: 32)
            _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
            let verifier = Data(bytes).base64URL
            let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
            return PKCE(verifier: verifier, challenge: challenge)
        }
    }

    /// `/auth/v1/authorize` for a provider id (`google`, `kakao`,
    /// `custom:naver`), with the same scopes the web requests. Kakao gets the
    /// web's `scope` query parameter (social-auth.ts `queryParams`): GoTrue
    /// forwards it to Kakao and it replaces the default scopes, which include
    /// account_email that a non-Biz Kakao app may not request. GoTrue's own
    /// `scopes` parameter would only append to those defaults.
    public nonisolated func authorizeURL(provider: String, redirectTo: String, pkce: PKCE) -> URL {
        var components = URLComponents(url: config.url.appendingPathComponent("auth/v1/authorize"), resolvingAgainstBaseURL: false)!
        var items = [
            URLQueryItem(name: "provider", value: provider),
            URLQueryItem(name: "redirect_to", value: redirectTo),
            URLQueryItem(name: "code_challenge", value: pkce.challenge),
            URLQueryItem(name: "code_challenge_method", value: "s256"),
        ]
        if provider == "kakao" { items.append(URLQueryItem(name: "scope", value: "profile_nickname profile_image")) }
        components.queryItems = items
        return components.url!
    }

    public func exchange(code: String, pkce: PKCE) async -> Result<StoredSession, CoreAuthFailure> {
        await token(grant: "pkce", body: ["auth_code": code, "code_verifier": pkce.verifier])
    }

    public func signInWithApple(idToken: String, nonce: String) async -> Result<StoredSession, CoreAuthFailure> {
        await token(grant: "id_token", body: ["provider": "apple", "id_token": idToken, "nonce": nonce])
    }

    private func token(grant: String, body: [String: Any]) async -> Result<StoredSession, CoreAuthFailure> {
        let (status, data) = await http.perform(request(
            "auth/v1/token", query: [URLQueryItem(name: "grant_type", value: grant)], body: body))
        guard (200..<300).contains(status), let session = Self.session(from: data, now: now()) else {
            return .failure(CoreAuthFailure(Self.errorKind(status: status, body: data)))
        }
        adopt(session)
        return .success(session)
    }
}

extension Data {
    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

/// `CoreCloudServices` backed by Supabase.
public struct SupabaseCloudServices: CoreCloudServices {
    public let auth: SupabaseAuth
    let http: HTTPPerforming

    public init(auth: SupabaseAuth, http: HTTPPerforming = URLSessionHTTP()) {
        self.auth = auth
        self.http = http
    }

    public var isConfigured: Bool { true }
    public var baseURL: String { auth.config.url.absoluteString }
    public var anonKey: String { auth.config.anonKey }
    public var hasStoredSession: Bool { auth.hasStoredSession }

    public func http(_ request: CoreHTTPRequest) async -> CoreHTTPResponse {
        guard let url = URL(string: request.url), url.host == auth.config.url.host else {
            // The transport may only talk to the configured project.
            return CoreHTTPResponse(status: 0, body: "")
        }
        var urlRequest = URLRequest(url: url, timeoutInterval: max(1, request.timeoutMs / 1000))
        urlRequest.httpMethod = request.method
        for (name, value) in request.headers { urlRequest.setValue(value, forHTTPHeaderField: name) }
        urlRequest.httpBody = request.body.map { Data($0.utf8) }
        let (status, body) = await http.perform(urlRequest)
        return CoreHTTPResponse(status: status, body: String(decoding: body, as: UTF8.self))
    }

    public func session() async -> CoreSession? { await auth.currentSession()?.core }

    public func sendCode(email: String) async -> String? { await auth.sendCode(email: email) }

    public func verifyCode(email: String, code: String) async -> Result<CoreSession, CoreAuthFailure> {
        await auth.verifyCode(email: email, code: code).map(\.core)
    }

    public func signOut() async { await auth.signOut() }
}
