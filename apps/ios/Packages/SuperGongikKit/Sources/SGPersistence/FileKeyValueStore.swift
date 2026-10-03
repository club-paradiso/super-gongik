import Foundation

/// The native implementation of the domain's `KeyValueStorage` port
/// (`packages/domain/src/store/repository.ts`): one file per key in a private
/// directory.
///
/// Everything above this type (document validation, previous generation,
/// quarantine of unreadable copies, pre-restore copy, migrations) is the
/// shared TypeScript repository running in JavaScriptCore. This type only has
/// to meet the port's provider obligations:
///
/// - `set` replaces a value atomically (write to a temporary file, then
///   rename): a reader sees the old value or the new one, never a mix, and a
///   failed write leaves the old value.
/// - `set` throws on any failure, including a full disk.
/// - `get` returns exactly the string last written, or nil.
/// - `compareAndSet` checks and writes under one lock.
///
/// Files use `completeUntilFirstUserAuthentication` protection: encrypted at
/// rest while the device has not been unlocked since boot, readable afterwards
/// so day-change refreshes and notifications scheduling work in the
/// background. Values never leave the device through this type.
public final class FileKeyValueStore: @unchecked Sendable {
    public enum StoreError: Error, Equatable, CustomStringConvertible {
        case unavailable(String)
        case writeFailed(String)
        case invalidKey

        public var description: String {
            switch self {
            case .unavailable(let detail): "storage unavailable (\(detail))"
            case .writeFailed(let detail): "write failed (\(detail))"
            case .invalidKey: "invalid key"
            }
        }
    }

    public let directory: URL
    private let lock = NSLock()
    private let fileManager = FileManager.default

    /// The app's store: `Application Support/SuperGongik/store`, excluded from
    /// iCloud/iTunes device backups only if the user later opts out (by
    /// default the OS backup keeps it, like the web's origin storage).
    public static func applicationStore() throws -> FileKeyValueStore {
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return try FileKeyValueStore(directory: base.appendingPathComponent("SuperGongik/store", isDirectory: true))
    }

    public init(directory: URL) throws {
        self.directory = directory
        do {
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            throw StoreError.unavailable(Self.describe(error))
        }
    }

    // Keys are app-defined ASCII strings ("super-gongik:data:v2"), but any
    // string must round-trip, so file names are base64url of the UTF-8 key.
    static func fileName(for key: String) throws -> String {
        guard !key.isEmpty else { throw StoreError.invalidKey }
        let encoded = Data(key.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        guard encoded.count <= 240 else { throw StoreError.invalidKey }
        return encoded + ".kv"
    }

    static func key(forFileName name: String) -> String? {
        guard name.hasSuffix(".kv") else { return nil }
        var base64 = String(name.dropLast(3))
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 { base64.append("=") }
        guard let data = Data(base64Encoded: base64) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func url(for key: String) throws -> URL {
        directory.appendingPathComponent(try Self.fileName(for: key), isDirectory: false)
    }

    public func get(_ key: String) throws -> String? {
        lock.lock()
        defer { lock.unlock() }
        return try unlockedGet(key)
    }

    public func set(_ key: String, _ value: String) throws {
        lock.lock()
        defer { lock.unlock() }
        try unlockedSet(key, value)
    }

    public func remove(_ key: String) throws {
        lock.lock()
        defer { lock.unlock() }
        let file = try url(for: key)
        guard fileManager.fileExists(atPath: file.path) else { return }
        do {
            try fileManager.removeItem(at: file)
        } catch {
            if !fileManager.fileExists(atPath: file.path) { return }
            throw StoreError.writeFailed(Self.describe(error))
        }
    }

    public func keys() throws -> [String] {
        lock.lock()
        defer { lock.unlock() }
        do {
            return try fileManager.contentsOfDirectory(atPath: directory.path)
                .compactMap(Self.key(forFileName:))
                .sorted()
        } catch {
            throw StoreError.unavailable(Self.describe(error))
        }
    }

    /// Writes `value` only if the key still holds exactly `expected`
    /// (nil = absent). Returns whether it wrote.
    public func compareAndSet(_ key: String, expected: String?, value: String) throws -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard try unlockedGet(key) == expected else { return false }
        try unlockedSet(key, value)
        return true
    }

    private func unlockedGet(_ key: String) throws -> String? {
        let file = try url(for: key)
        guard fileManager.fileExists(atPath: file.path) else { return nil }
        do {
            let data = try Data(contentsOf: file)
            // Bytes that are not UTF-8 are returned as nil-free replacement
            // text so the repository's decoder sees "unreadable" and
            // quarantines them, rather than this layer silently dropping them.
            return String(decoding: data, as: UTF8.self)
        } catch {
            throw StoreError.unavailable(Self.describe(error))
        }
    }

    private func unlockedSet(_ key: String, _ value: String) throws {
        let file = try url(for: key)
        do {
            #if os(iOS)
            try Data(value.utf8).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            #else
            try Data(value.utf8).write(to: file, options: [.atomic])
            #endif
        } catch {
            throw StoreError.writeFailed(Self.describe(error))
        }
    }

    /// Error descriptions for diagnostics: the error domain and code only,
    /// never a path that might carry user content.
    private static func describe(_ error: Error) -> String {
        let nsError = error as NSError
        return "\(nsError.domain)#\(nsError.code)"
    }
}
