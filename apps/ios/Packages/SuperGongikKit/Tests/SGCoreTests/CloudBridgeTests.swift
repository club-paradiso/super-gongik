import Foundation
import Testing
@testable import SGCore
import SGFoundation
import SGPersistence

/// The web cloud controller running in JavaScriptCore over the Swift host:
/// async HTTP and session callbacks, timers, the AbortSignal shim and state
/// events. The fake answers like the PostgREST RPCs (supabase/migrations).
final class FakeCloud: CoreCloudServices, @unchecked Sendable {
    let lock = NSLock()
    var signedIn = false
    var lastSeq = 0
    var stored: [String: Any] = [:]
    var profileId: Any = NSNull()
    var paths: [String] = []

    var isConfigured: Bool { true }
    var baseURL: String { "https://project.supabase.co" }
    var anonKey: String { "anon" }
    var hasStoredSession: Bool { lock.withLock { signedIn } }

    func session() async -> CoreSession? {
        lock.withLock { signedIn ? CoreSession(userId: "user-1", email: "x@example.com", accessToken: "token-1") : nil }
    }

    func sendCode(email: String) async -> String? { email.contains("@") ? nil : "INVALID_EMAIL" }

    func verifyCode(email: String, code: String) async -> Result<CoreSession, CoreAuthFailure> {
        guard code == "123456" else { return .failure(CoreAuthFailure("INVALID_CODE")) }
        lock.withLock { signedIn = true }
        return .success(CoreSession(userId: "user-1", email: email, accessToken: "token-1"))
    }

    func signOut() async { lock.withLock { signedIn = false } }

    func http(_ request: CoreHTTPRequest) async -> CoreHTTPResponse {
        lock.withLock {
            let path = URL(string: request.url)!.path
            paths.append(path)
            guard request.headers["Authorization"] == "Bearer token-1" else {
                return CoreHTTPResponse(status: 401, body: #"{"code":"PGRST301"}"#)
            }
            let account: [String: Any] = ["generation": 1, "last_seq": lastSeq, "profile_id": profileId, "reset_at": NSNull()]
            let args = (try? JSONSerialization.jsonObject(with: Data((request.body ?? "{}").utf8))) as? [String: Any] ?? [:]
            func ok(_ value: Any) -> CoreHTTPResponse {
                CoreHTTPResponse(status: 200, body: String(decoding: try! JSONSerialization.data(withJSONObject: value), as: UTF8.self))
            }
            switch path {
            case "/rest/v1/rpc/sync_ensure_account": return ok(account)
            case "/rest/v1/rpc/sync_pull":
                return ok(["kind": "OK", "account": account, "rows": [], "has_more": false])
            case "/rest/v1/rpc/sync_push":
                var results: [[String: Any]] = []
                for item in args["p_items"] as? [[String: Any]] ?? [] {
                    lastSeq += 1
                    let key = "\(item["collection"]!):\(item["record_id"]!)"
                    stored[key] = item["payload"]
                    if item["collection"] as? String == "profile" { profileId = item["record_id"]! }
                    results.append(["collection": item["collection"]!, "record_id": item["record_id"]!, "status": "APPLIED", "seq": lastSeq])
                }
                let after: [String: Any] = ["generation": 1, "last_seq": lastSeq, "profile_id": profileId, "reset_at": NSNull()]
                return ok(["kind": "OK", "account": after, "results": results])
            default:
                return CoreHTTPResponse(status: 404, body: "")
            }
        }
    }
}

@Suite("Cloud controller through the Swift host")
struct CloudBridgeTests {
    @Test("email-code sign-in, enable preview, upload, sign-out scoping")
    func enableAndUpload() async throws {
        let fake = FakeCloud()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("sg-cloud-\(UUID().uuidString)")
        let runtime = try CoreRuntime(storage: try FileKeyValueStore(directory: directory), cloud: fake)
        _ = try await runtime.open()
        _ = try await runtime.run("createProfile", [.object([
            "callUpDate": .string("2026-05-04"), "expectedDischargeDate": .string("2028-02-03"),
        ])])

        let started = try await runtime.cloud("cloudStart")
        #expect(started["phase"]?.stringValue == "GUEST", "guests make no request")
        #expect(fake.paths.isEmpty)
        let guestView = try await runtime.cloudSync("cloudView")
        #expect(guestView["label"]?["text"]?.stringValue == "로컬 전용", "\(guestView)")

        #expect(try await runtime.cloud("cloudSendCode", ["x@example.com"]).boolValue == true)
        #expect(try await runtime.cloud("cloudVerifyCode", ["000000"]).boolValue == false)
        #expect(try await runtime.cloudSync("cloudState")["authError"]?.stringValue == "INVALID_CODE")
        #expect(try await runtime.cloud("cloudVerifyCode", ["123456"]).boolValue == true)
        let signedIn = try await runtime.cloudSync("cloudState")
        #expect(signedIn["phase"]?.stringValue == "SIGNED_IN")

        let preview = try await runtime.cloud("cloudPreview")
        #expect(preview["kind"]?.stringValue == "READY")
        #expect(preview["case"]?.stringValue == "UPLOAD")
        let enabled = try await runtime.cloud("cloudEnable", [preview.jsonText])
        #expect(enabled["kind"]?.stringValue == "ENABLED")
        #expect(fake.stored.keys.contains { $0.hasPrefix("profile:") }, "the profile reached the server")

        let session = try #require(signedIn["accountSession"]?.stringValue)
        _ = try await runtime.cloud("cloudSignOut")
        let afterSignOut = try await runtime.cloud("cloudDeleteData", [session])
        #expect(afterSignOut["kind"]?.stringValue == "ACCOUNT_CHANGED", "a stale session cannot act")
    }
}
