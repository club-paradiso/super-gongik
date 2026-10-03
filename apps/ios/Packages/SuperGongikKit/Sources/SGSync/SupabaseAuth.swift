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

    var core: CoreSession { CoreSession(userId: userId, email: email, accessToken: accessToken) }
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
        return StoredSession(accessToken: access, refreshToken: refresh, expiresAt: expiresAt,
                             userId: id, email: user["email"] as? String)
    }

    private func adopt(_ session: StoredSession) {
        cached = session
        store.save(session)
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
    /// one that fails for lack of network keeps it for a later attempt.
    public func currentSession() async -> StoredSession? {
        guard let session = cached else { return nil }
        if session.expiresAt - now().timeIntervalSince1970 > 60 { return session }
        if let refreshing { return await refreshing.value }
        let task = Task { await self.refresh(session) }
        refreshing = task
        let result = await task.value
        refreshing = nil
        return result
    }

    private func refresh(_ session: StoredSession) async -> StoredSession? {
        let (status, body) = await http.perform(request(
            "auth/v1/token", query: [URLQueryItem(name: "grant_type", value: "refresh_token")],
            body: ["refresh_token": session.refreshToken]))
        if status == 0 { return session } // offline: the transport will report NETWORK
        guard (200..<300).contains(status), let next = Self.session(from: body, now: now()) else {
            cached = nil
            store.delete()
            return nil
        }
        adopt(next)
        return next
    }

    /// Local sign-out (web: `signOut({ scope: "local" })`): this device only.
    public func signOut() async {
        if let session = cached {
            _ = await http.perform(request("auth/v1/logout", query: [URLQueryItem(name: "scope", value: "local")],
                                           body: [:], bearer: session.accessToken))
        }
        cached = nil
        store.delete()
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
    /// `custom:naver`), with the same scopes the web requests.
    public nonisolated func authorizeURL(provider: String, redirectTo: String, pkce: PKCE) -> URL {
        var components = URLComponents(url: config.url.appendingPathComponent("auth/v1/authorize"), resolvingAgainstBaseURL: false)!
        var items = [
            URLQueryItem(name: "provider", value: provider),
            URLQueryItem(name: "redirect_to", value: redirectTo),
            URLQueryItem(name: "code_challenge", value: pkce.challenge),
            URLQueryItem(name: "code_challenge_method", value: "s256"),
        ]
        if provider == "kakao" { items.append(URLQueryItem(name: "scopes", value: "profile_nickname profile_image")) }
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
