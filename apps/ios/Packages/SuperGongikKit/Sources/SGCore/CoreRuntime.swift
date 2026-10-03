import CryptoKit
import Foundation
import JavaScriptCore
import Security
import SGPersistence

/// Errors from the TypeScript core. Messages are developer diagnostics; the UI
/// maps them to Korean copy and never shows them verbatim.
public enum CoreError: Error, Equatable, CustomStringConvertible {
    case bundleMissing(String)
    case incompatibleBundle(found: String, expectedMajor: String)
    case javaScript(String)
    case notJSON(String)
    case decoding(String)

    public var description: String {
        switch self {
        case .bundleMissing(let name): "core bundle resource missing: \(name)"
        case .incompatibleBundle(let found, let expected): "core facade \(found), expected \(expected).x"
        case .javaScript(let message): "core error: \(message)"
        case .notJSON(let method): "core method \(method) did not return JSON text"
        case .decoding(let detail): "decoding core result failed: \(detail)"
        }
    }
}

/// The TypeScript reference core (`packages/native-core`, bundled as
/// `sg-core.js`) running in JavaScriptCore.
///
/// All JavaScript runs on one serial queue, which is this actor's executor:
/// JavaScriptCore is never touched from two threads, the synchronous file
/// reads behind the storage port never block the main thread, and the
/// store's own write queue gives the same ordering guarantees as on the web.
///
/// Every facade method exchanges JSON text, so callers decode results with
/// `Codable` and never hold a `JSValue`.
public actor CoreRuntime {
    public static let expectedFacadeMajor = "1"

    private let queue: DispatchSerialQueue
    private let context: JSContext
    private let core: JSValue
    private var lastException: String?
    public nonisolated let facadeVersion: String
    /// Cloud controller state changes (JSON `CloudState`), in order.
    public nonisolated let cloudEvents: AsyncStream<Data>

    public nonisolated var unownedExecutor: UnownedSerialExecutor {
        queue.asUnownedSerialExecutor()
    }

    /// - Parameter storage: where the document lives. Pass `nil` for a runtime
    ///   that only evaluates pure functions (tests, previews).
    public init(storage: FileKeyValueStore?, cloud: CoreCloudServices? = nil, bundle: Bundle? = nil) throws {
        let bundle = bundle ?? Bundle.module
        let queue = DispatchSerialQueue(label: "app.supergongik.core", qos: .userInitiated)
        let (events, continuation) = AsyncStream<Data>.makeStream(bufferingPolicy: .bufferingNewest(16))
        self.cloudEvents = events
        // Built synchronously on the core queue so the context is only ever
        // used from it.
        let built: Result<(JSContext, JSValue, String), Error> = queue.sync {
            Result {
                try CoreRuntime.makeContext(
                    storage: storage, cloud: cloud, queue: queue, events: continuation, bundle: bundle)
            }
        }
        let (context, core, version) = try built.get()
        self.queue = queue
        self.context = context
        self.core = core
        self.facadeVersion = version
        guard version.split(separator: ".").first.map(String.init) == Self.expectedFacadeMajor else {
            throw CoreError.incompatibleBundle(found: version, expectedMajor: Self.expectedFacadeMajor)
        }
    }

    private static func makeContext(
        storage: FileKeyValueStore?, cloud: CoreCloudServices?, queue: DispatchSerialQueue,
        events: AsyncStream<Data>.Continuation, bundle: Bundle
    ) throws -> (JSContext, JSValue, String) {
        guard let context = JSContext() else { throw CoreError.javaScript("JSContext unavailable") }
        context.name = "SUPER-GONGIK core"
        var startupError: String?
        context.exceptionHandler = { _, exception in
            startupError = exception?.toString() ?? "unknown exception"
        }
        var hostObject = NativeHost.make(storage: storage)
        hostObject.merge(CloudHost.make(cloud: cloud, queue: queue, events: events)) { current, _ in current }
        context.setObject(hostObject, forKeyedSubscript: "__sgHost" as NSString)

        for name in ["sg-shims", "sg-core"] {
            guard let url = bundle.url(forResource: name, withExtension: "js"),
                  let source = try? String(contentsOf: url, encoding: .utf8)
            else { throw CoreError.bundleMissing("\(name).js") }
            context.evaluateScript(source, withSourceURL: url)
            if let startupError { throw CoreError.javaScript(startupError) }
        }
        guard let core = context.objectForKeyedSubscript("SGCore"), core.isObject,
              let version = core.objectForKeyedSubscript("version")?.toString()
        else { throw CoreError.javaScript("SGCore was not installed") }
        return (context, core, version)
    }

    // MARK: Calling the facade

    private func installExceptionHandler() {
        // JavaScriptCore must only ever run on the core queue. The actor's
        // custom executor guarantees it; this checks it in every build.
        dispatchPrecondition(condition: .onQueue(queue))
        lastException = nil
        context.exceptionHandler = { [weak self] _, exception in
            let message = exception?.toString() ?? "unknown exception"
            // Runs on the core queue, inside an actor-isolated call.
            self?.assumeIsolated { $0.lastException = message }
        }
    }

    /// Calls a synchronous facade method that returns JSON text.
    public func callJSON(_ method: String, _ arguments: [Any] = []) throws -> Data {
        installExceptionHandler()
        let result = core.invokeMethod(method, withArguments: arguments)
        if let lastException { throw CoreError.javaScript(lastException) }
        guard let result, result.isString, let text = result.toString() else {
            throw CoreError.notJSON(method)
        }
        return Data(text.utf8)
    }

    /// Calls a facade method returning `Promise<string>` (JSON text).
    ///
    /// With the synchronous storage port every promise settles during the
    /// microtask drain that follows the call, before `invokeMethod` returns;
    /// the continuation also covers genuinely asynchronous work (network
    /// transport) that resolves later on this queue.
    public func callJSONAsync(_ method: String, _ arguments: [Any] = []) async throws -> Data {
        installExceptionHandler()
        guard let promise = core.invokeMethod(method, withArguments: arguments) else {
            throw CoreError.notJSON(method)
        }
        if let lastException { throw CoreError.javaScript(lastException) }
        return try await withCheckedThrowingContinuation { continuation in
            var settled = false
            let resolve: @convention(block) (JSValue) -> Void = { value in
                guard !settled else { return }
                settled = true
                if value.isString, let text = value.toString() {
                    continuation.resume(returning: Data(text.utf8))
                } else {
                    continuation.resume(throwing: CoreError.notJSON(method))
                }
            }
            let reject: @convention(block) (JSValue) -> Void = { reason in
                guard !settled else { return }
                settled = true
                let message = reason.objectForKeyedSubscript("message")?.toString() ?? reason.toString() ?? "rejected"
                continuation.resume(throwing: CoreError.javaScript(message))
            }
            promise.invokeMethod("then", withArguments: [
                JSValue(object: resolve, in: context) as Any,
                JSValue(object: reject, in: context) as Any,
            ])
        }
    }

    public func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw CoreError.decoding(String(describing: error))
        }
    }

    // MARK: Pure calls

    /// `SGCore.call(name, args)`: a whitelisted pure domain function. Returns
    /// the raw `{ ok, value | error }` envelope.
    public func callPure(_ name: String, argumentsJSON: String) throws -> Data {
        try callJSON("call", [name, argumentsJSON])
    }

    public func applyCommand(_ name: String, dataJSON: String, argumentsJSON: String, contextJSON: String) throws -> Data {
        try callJSON("applyCommand", [name, dataJSON, argumentsJSON, contextJSON])
    }
}

/// The `__sgHost` object: synchronous native services the bundle may use.
enum NativeHost {
    static func make(storage: FileKeyValueStore?) -> [String: Any] {
        let kvGet: @convention(block) (String) -> Any = { key in
            guard let storage, let value = try? storage.get(key) else { return NSNull() }
            return value
        }
        let kvSet: @convention(block) (String, String) -> Any = { key, value in
            guard let storage else { return "no storage" }
            do {
                try storage.set(key, value)
                return NSNull()
            } catch {
                return String(describing: error)
            }
        }
        let kvRemove: @convention(block) (String) -> Any = { key in
            guard let storage else { return "no storage" }
            do {
                try storage.remove(key)
                return NSNull()
            } catch {
                return String(describing: error)
            }
        }
        let kvKeys: @convention(block) () -> [String] = {
            (try? storage?.keys()) ?? []
        }
        let kvCompareAndSet: @convention(block) (String, JSValue, String) -> Any = { key, expected, value in
            guard let storage else { return "no storage" }
            let expectedText: String? = expected.isNull || expected.isUndefined ? nil : expected.toString()
            do {
                return try storage.compareAndSet(key, expected: expectedText, value: value)
            } catch {
                return String(describing: error)
            }
        }
        let randomBytes: @convention(block) (Int) -> [UInt8] = { count in
            var bytes = [UInt8](repeating: 0, count: max(0, min(count, 65_536)))
            let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
            precondition(status == errSecSuccess, "SecRandomCopyBytes failed")
            return bytes
        }
        let sha256Hex: @convention(block) ([NSNumber]) -> String = { numbers in
            let digest = SHA256.hash(data: Data(numbers.map { $0.uint8Value }))
            return digest.map { String(format: "%02x", $0) }.joined()
        }
        let log: @convention(block) (String, String) -> Void = { level, message in
            CoreLog.log(level: level, message: message)
        }
        return [
            "kvGet": kvGet,
            "kvSet": kvSet,
            "kvRemove": kvRemove,
            "kvKeys": kvKeys,
            "kvCompareAndSet": kvCompareAndSet,
            "randomBytes": randomBytes,
            "sha256Hex": sha256Hex,
            "log": log,
        ]
    }
}

/// Host functions for the shared cloud controller. Every completion runs on
/// the core queue, where JavaScript continues.
enum CloudHost {
    final class Timers: @unchecked Sendable {
        var next = 0
        var items: [Int: DispatchWorkItem] = [:]
    }

    static func make(cloud: CoreCloudServices?, queue: DispatchSerialQueue,
                     events: AsyncStream<Data>.Continuation) -> [String: Any] {
        let timers = Timers()
        func complete(_ done: JSValue, _ argument: @escaping @Sendable () -> Any) -> @Sendable () -> Void {
            let bound = CoreQueueBound(value: done)
            return { queue.async { bound.value.call(withArguments: [argument()]) } }
        }
        func encode<T: Encodable>(_ value: T) -> String {
            String(decoding: (try? JSONEncoder().encode(value)) ?? Data("null".utf8), as: UTF8.self)
        }

        let configured: @convention(block) () -> Bool = { cloud?.isConfigured ?? false }
        let baseURL: @convention(block) () -> String = { cloud?.baseURL ?? "" }
        let anonKey: @convention(block) () -> String = { cloud?.anonKey ?? "" }
        let hasStoredSession: @convention(block) () -> Bool = { cloud?.hasStoredSession ?? false }
        let authSession: @convention(block) (JSValue) -> Void = { done in
            let bound = CoreQueueBound(value: done)
            Task {
                let session = await cloud?.session()
                let text = session.map { encode($0) }
                queue.async { bound.value.call(withArguments: [text as Any? ?? NSNull()]) }
            }
        }
        let authSendCode: @convention(block) (String, JSValue) -> Void = { email, done in
            let bound = CoreQueueBound(value: done)
            Task {
                // nil means success; a missing service is an error.
                let error: String? = if let cloud { await cloud.sendCode(email: email) } else { "UNKNOWN" }
                queue.async { bound.value.call(withArguments: [error as Any? ?? NSNull()]) }
            }
        }
        let authVerifyCode: @convention(block) (String, String, JSValue) -> Void = { email, code, done in
            let bound = CoreQueueBound(value: done)
            Task {
                let text: String
                switch await cloud?.verifyCode(email: email, code: code) {
                case .success(let session)?: text = "{\"session\":\(encode(session))}"
                case .failure(let failure)?: text = "{\"error\":\"\(failure.kind)\"}"
                case nil: text = "{\"error\":\"UNKNOWN\"}"
                }
                queue.async { bound.value.call(withArguments: [text]) }
            }
        }
        let authSignOut: @convention(block) (JSValue) -> Void = { done in
            let finish = complete(done) { NSNull() }
            Task {
                await cloud?.signOut()
                finish()
            }
        }
        let http: @convention(block) (String, JSValue) -> Void = { requestJSON, done in
            let bound = CoreQueueBound(value: done)
            let request = try? JSONDecoder().decode(CoreHTTPRequest.self, from: Data(requestJSON.utf8))
            Task {
                let response: CoreHTTPResponse
                if let request, let cloud {
                    response = await cloud.http(request)
                } else {
                    response = CoreHTTPResponse(status: 0, body: "")
                }
                let text = encode(response)
                queue.async { bound.value.call(withArguments: [text]) }
            }
        }
        let setTimer: @convention(block) (Double, JSValue) -> Int = { ms, callback in
            dispatchPrecondition(condition: .onQueue(queue))
            timers.next += 1
            let id = timers.next
            let bound = CoreQueueBound(value: callback)
            let item = DispatchWorkItem {
                timers.items[id] = nil
                bound.value.call(withArguments: [])
            }
            timers.items[id] = item
            queue.asyncAfter(deadline: .now() + .milliseconds(Int(max(0, ms))), execute: item)
            return id
        }
        let clearTimer: @convention(block) (Int) -> Void = { id in
            dispatchPrecondition(condition: .onQueue(queue))
            timers.items.removeValue(forKey: id)?.cancel()
        }
        let stateChanged: @convention(block) (String) -> Void = { json in
            events.yield(Data(json.utf8))
        }
        return [
            "cloudConfigured": configured,
            "cloudBaseURL": baseURL,
            "cloudAnonKey": anonKey,
            "authHasStoredSession": hasStoredSession,
            "authSession": authSession,
            "authSendCode": authSendCode,
            "authVerifyCode": authVerifyCode,
            "authSignOut": authSignOut,
            "http": http,
            "setTimer": setTimer,
            "clearTimer": clearTimer,
            "cloudStateChanged": stateChanged,
        ]
    }
}
