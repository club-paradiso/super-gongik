import Foundation

/// An HTTP request made on behalf of the shared sync transport.
public struct CoreHTTPRequest: Codable, Sendable {
    public init(method: String, url: String, headers: [String: String], body: String?, timeoutMs: Double) {
        self.method = method
        self.url = url
        self.headers = headers
        self.body = body
        self.timeoutMs = timeoutMs
    }

    public let method: String
    public let url: String
    public let headers: [String: String]
    public let body: String?
    public let timeoutMs: Double
}

/// `status == 0` means no HTTP response (offline, timeout, TLS failure).
public struct CoreHTTPResponse: Codable, Sendable {
    public let status: Int
    public let body: String

    public init(status: Int, body: String) {
        self.status = status
        self.body = body
    }
}

/// A signed-in session as the core sees it. The access token is handed to
/// the transport per request and never logged.
public struct CoreSession: Codable, Sendable, Equatable {
    public let userId: String
    public let email: String?
    public let accessToken: String

    public init(userId: String, email: String?, accessToken: String) {
        self.userId = userId
        self.email = email
        self.accessToken = accessToken
    }
}

/// What the shared cloud controller needs from the platform: configuration,
/// HTTP, and sign-in. Implemented by `SGSync`; `nil` means cloud is not part
/// of this runtime (guests, tests, previews).
public protocol CoreCloudServices: Sendable {
    var isConfigured: Bool { get }
    var baseURL: String { get }
    var anonKey: String { get }
    var hasStoredSession: Bool { get }
    func http(_ request: CoreHTTPRequest) async -> CoreHTTPResponse
    /// The stored session, refreshed first when its token has expired.
    func session() async -> CoreSession?
    /// nil on success, otherwise an `AuthErrorKind` (web cloud-controller).
    func sendCode(email: String) async -> String?
    func verifyCode(email: String, code: String) async -> Result<CoreSession, CoreAuthFailure>
    func signOut() async
}

public struct CoreAuthFailure: Error, Sendable, Equatable {
    /// `INVALID_EMAIL` | `INVALID_CODE` | `RATE_LIMITED` | `NETWORK` | `UNKNOWN`
    public let kind: String

    public init(_ kind: String) { self.kind = kind }
}

/// Sendable wrapper for values that are only touched on the core queue.
struct CoreQueueBound<Value>: @unchecked Sendable {
    let value: Value
}
