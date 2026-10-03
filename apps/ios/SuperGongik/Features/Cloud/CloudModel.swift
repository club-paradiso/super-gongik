import AuthenticationServices
import CryptoKit
import Foundation
import Network
import Observation
import SGCore
import SGFoundation
import SGSync

/// Presentation state of the optional cloud sync. The account logic, the
/// sync engine and every wording come from the shared core (web
/// `cloud-controller.ts` and `sync-copy.ts`); this object forwards actions,
/// runs the platform sign-in flows and reports reachability as a hint.
@MainActor
@Observable
final class CloudModel {
    struct View: Decodable, Sendable {
        struct State: Decodable, Sendable {
            struct Sync: Decodable, Sendable {
                struct Block: Decodable, Sendable { let reason: String }
                let phase: String
                let block: Block?
                let dirty: Bool
            }

            let phase: String
            let email: String?
            let userId: String?
            let accountSession: String?
            let sync: Sync?
        }

        struct Label: Decodable, Sendable {
            let text: String
            let tone: String
        }

        struct Conflict: Decodable, Sendable, Identifiable {
            let key: String
            let collection: String
            let local: String
            let cloud: String
            var id: String { key }
        }

        struct Held: Decodable, Sendable, Identifiable {
            let key: String
            let reason: String?
            var id: String { key }
        }

        let state: State
        let label: Label
        let authError: String?
        let lastSynced: String
        let resetAt: String?
        let conflicts: [Conflict]
        let held: [Held]
    }

    private(set) var view: View?
    private(set) var busy = false
    private(set) var message: String?
    let auth: SupabaseAuth?
    @ObservationIgnored weak var runtime: CoreRuntime?
    @ObservationIgnored private var events: Task<Void, Never>?
    @ObservationIgnored private let monitor = NWPathMonitor()

    init(config: AppConfig) {
        if let url = config.supabaseURL, let key = config.supabaseAnonKey {
            auth = SupabaseAuth(config: SupabaseConfig(url: url, anonKey: key))
        } else {
            auth = nil
        }
    }

    var isConfigured: Bool { auth != nil }
    var services: CoreCloudServices? { auth.map { SupabaseCloudServices(auth: $0) } }

    /// After the store opened: start the controller (guests: no request) and
    /// follow its state.
    func attach(_ runtime: CoreRuntime) async {
        guard isConfigured, self.runtime == nil else { return }
        self.runtime = runtime
        events = Task { [weak self] in
            for await _ in runtime.cloudEvents {
                await self?.refresh()
            }
        }
        monitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor in try? await self?.runtime?.cloudSync("cloudNotifyOnline") }
        }
        monitor.start(queue: .global(qos: .utility))
        _ = try? await runtime.cloud("cloudStart")
        await refresh()
    }

    func refresh() async {
        guard let runtime else { return }
        if let value = try? await runtime.cloudSync("cloudView"),
           let decoded = try? JSONDecoder().decode(View.self, from: Data(value.jsonText.utf8)) {
            view = decoded
        }
    }

    func foreground() async { _ = try? await runtime?.cloudSync("cloudNotifyForeground") }
    func afterRestore(_ mode: String) async { _ = try? await runtime?.cloud("cloudAfterRestore", [mode]) }
    func afterLocalWipe() async { _ = try? await runtime?.cloud("cloudAfterLocalWipe") }

    private func perform<T>(_ action: () async throws -> T) async -> T? {
        busy = true
        message = nil
        defer { busy = false }
        let result = try? await action()
        await refresh()
        return result
    }

    // MARK: Email code

    func sendCode(_ email: String) async {
        _ = await perform { try await runtime?.cloud("cloudSendCode", [email]) }
    }

    func verifyCode(_ code: String) async {
        _ = await perform { try await runtime?.cloud("cloudVerifyCode", [code]) }
    }

    func cancelCode() async { _ = await perform { try await runtime?.cloudSync("cloudCancelCode") } }

    func signOut() async { _ = await perform { try await runtime?.cloud("cloudSignOut") } }

    /// Deletes the account and all of its cloud data on the server; this
    /// device's records stay. Then the controller sees the session end.
    func deleteAccount() async -> Bool {
        guard let auth else { return false }
        busy = true
        defer { busy = false }
        guard await auth.deleteAccount() else {
            message = "계정을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요."
            return false
        }
        try? await runtime?.cloudSessionChanged(nil)
        _ = try? await runtime?.cloud("cloudSignOut")
        await refresh()
        message = "계정과 클라우드 데이터를 삭제했어요. 이 기기의 기록은 그대로예요."
        return true
    }

    // MARK: Social sign-in (PKCE through ASWebAuthenticationSession)

    static let callbackScheme = "app.supergongik.ios"

    func signIn(provider: String, anchor: ASPresentationAnchor) async {
        guard let auth else { return }
        let pkce = SupabaseAuth.PKCE.make()
        let url = auth.authorizeURL(provider: provider, redirectTo: "\(Self.callbackScheme)://auth-callback", pkce: pkce)
        busy = true
        defer { busy = false }
        do {
            let callback = try await WebAuthentication.run(url: url, scheme: Self.callbackScheme, anchor: anchor)
            guard let code = URLComponents(url: callback, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "code" })?.value
            else {
                message = "로그인을 마치지 못했어요. 다시 시도해 주세요."
                return
            }
            switch await auth.exchange(code: code, pkce: pkce) {
            case .success(let session): await adopt(session)
            case .failure: message = "로그인하지 못했어요. 잠시 후 다시 시도해 주세요."
            }
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            message = nil
        } catch {
            message = "로그인 창을 열지 못했어요. 다시 시도해 주세요."
        }
    }

    // MARK: Sign in with Apple

    @ObservationIgnored private(set) var appleNonce = ""

    /// Raw nonce for this attempt; its SHA-256 goes into the Apple request.
    func prepareAppleRequest(_ request: ASAuthorizationAppleIDRequest) {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        appleNonce = Data(bytes).base64EncodedString()
        request.requestedScopes = [.email]
        request.nonce = SHA256.hash(data: Data(appleNonce.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    func completeApple(_ result: Result<ASAuthorization, Error>) async {
        guard let auth else { return }
        switch result {
        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let token = String(data: tokenData, encoding: .utf8)
            else {
                message = "Apple 로그인 정보를 받지 못했어요."
                return
            }
            busy = true
            defer { busy = false }
            switch await auth.signInWithApple(idToken: token, nonce: appleNonce) {
            case .success(let session): await adopt(session)
            case .failure: message = "Apple로 로그인하지 못했어요. 잠시 후 다시 시도해 주세요."
            }
        case .failure(let error):
            if (error as? ASAuthorizationError)?.code != .canceled {
                message = "Apple로 로그인하지 못했어요."
            }
        }
    }

    private func adopt(_ session: StoredSession) async {
        try? await runtime?.cloudSessionChanged(
            CoreSession(userId: session.userId, email: session.email, accessToken: session.accessToken))
        await refresh()
    }

    // MARK: Sync

    func preview() async -> JSONValue? { await perform { try await runtime?.cloud("cloudPreview") } ?? nil }

    func describe(_ preview: JSONValue) async -> String? {
        (try? await runtime?.cloudSync("cloudDescribePreview", [preview.jsonText]))?.stringValue
    }

    func enable(_ preview: JSONValue) async -> JSONValue? {
        await perform { try await runtime?.cloud("cloudEnable", [preview.jsonText]) } ?? nil
    }

    func syncNow() async { _ = await perform { try await runtime?.cloud("cloudSyncNow") } }

    func resolve(_ resolutions: [String: String]) async {
        guard let session = view?.state.accountSession else { return }
        let json = JSONValue.object(resolutions.mapValues(JSONValue.string)).jsonText
        _ = await perform { try await runtime?.cloud("cloudResolve", [session, json]) }
    }

    func disable() async {
        guard let session = view?.state.accountSession else { return }
        _ = await perform { try await runtime?.cloud("cloudDisable", [session]) }
    }

    func deleteCloudData() async -> Bool {
        guard let session = view?.state.accountSession else { return false }
        let result = await perform { try await runtime?.cloud("cloudDeleteData", [session]) } ?? nil
        return result?["ok"]?.boolValue == true || result?["kind"]?.stringValue == "OK"
    }

    func listBackups() async -> [JSONValue] {
        (await perform { try await runtime?.cloud("cloudListBackups") } ?? nil)?.arrayValue ?? []
    }

    func uploadBackup() async -> Bool {
        guard let session = view?.state.accountSession else { return false }
        let result = await perform { try await runtime?.cloud("cloudUploadBackup", [session]) } ?? nil
        return result?["kind"]?.stringValue == "OK"
    }

    func downloadBackup(_ id: String) async -> String? {
        (await perform { try await runtime?.cloud("cloudDownloadBackup", [id]) } ?? nil)?.stringValue
    }

    func deleteBackup(_ id: String) async {
        guard let session = view?.state.accountSession else { return }
        _ = await perform { try await runtime?.cloud("cloudDeleteBackup", [session, id]) }
    }
}

/// `ASWebAuthenticationSession` as an async call.
enum WebAuthentication {
    @MainActor
    static func run(url: URL, scheme: String, anchor: ASPresentationAnchor) async throws -> URL {
        let provider = AnchorProvider(anchor: anchor)
        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callback: .customScheme(scheme)) { callback, error in
                if let callback { continuation.resume(returning: callback) } else {
                    continuation.resume(throwing: error ?? ASWebAuthenticationSessionError(.canceledLogin))
                }
            }
            session.presentationContextProvider = provider
            session.prefersEphemeralWebBrowserSession = true
            if !session.start() {
                continuation.resume(throwing: ASWebAuthenticationSessionError(.presentationContextInvalid))
            }
            objc_setAssociatedObject(session, "provider", provider, .OBJC_ASSOCIATION_RETAIN)
        }
    }

    private final class AnchorProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
        let anchor: ASPresentationAnchor
        init(anchor: ASPresentationAnchor) { self.anchor = anchor }
        func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { anchor }
    }
}
