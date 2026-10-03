import Foundation
import Testing
@testable import SGCore
import SGFoundation
import SGPersistence
import SGTestSupport

/// Release gate: backups move between the web and iOS clients without loss.
///
/// The backup text below was produced by the TypeScript reference in Node
/// (`createBackup` + `serializeBackup`, fixture `backup` › "parse backup"),
/// i.e. exactly what the web's "백업 파일 만들기" writes. It is restored into
/// a fresh iOS store on real files, exported again by the iOS app, and the
/// re-export must parse back (with a verified digest) to the same records.
@Suite("Backup interchange between web and iOS")
struct BackupInterchangeTests {
    static func webBackupText() throws -> String {
        let suite = try Fixtures.load("backup")
        let fixture = try #require(suite.cases.first { $0.id == "parse backup" })
        return try #require(fixture.arguments.first?.stringValue)
    }

    func freshRuntime() throws -> (CoreRuntime, FileKeyValueStore) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("sg-interchange-\(UUID().uuidString)")
        let storage = try FileKeyValueStore(directory: directory)
        return (try CoreRuntime(storage: storage), storage)
    }

    /// Record content only: installation metadata (deviceId, write counter,
    /// savedAt) legitimately differs per device.
    static func records(_ data: JSONValue) -> JSONValue {
        guard case .object(var object) = data else { return data }
        for key in ["deviceId", "documentRevision", "savedAt"] { object[key] = nil }
        return .object(object)
    }

    @Test("web export → iOS restore → iOS export → identical records")
    func roundTrip() async throws {
        let webText = try Self.webBackupText()
        let (runtime, _) = try freshRuntime()
        _ = try await runtime.open()

        // Preview first (nothing written), as the UI does.
        let preview = try await runtime.previewRestore(text: webText, mode: "REPLACE")
        #expect(preview["ok"]?.boolValue == true)
        #expect(preview["info"]?["integrity"]?.stringValue == "VERIFIED")
        let plan = try #require(preview["plan"])
        #expect(plan["requiresDestructiveConfirmation"]?.boolValue == false, "empty device: nothing destroyed")

        let restored = try await runtime.restore(text: webText, request: .object([
            "mode": .string("REPLACE"),
            "expectedDocumentRevision": plan["baseDocumentRevision"]!,
        ]))
        #expect(restored["ok"]?.boolValue == true)

        let iosText = try await runtime.exportBackup(exportedAt: Date(timeIntervalSince1970: 1_790_000_000)).text
        let webParsed = try await runtime.pureJSON("parseBackup", [.string(webText)])
        let iosParsed = try await runtime.pureJSON("parseBackup", [.string(iosText)])
        #expect(iosParsed["ok"]?.boolValue == true)
        #expect(iosParsed["info"]?["integrity"]?.stringValue == "VERIFIED")
        let difference = Self.records(iosParsed["data"]!).firstDifference(from: Self.records(webParsed["data"]!))
        #expect(difference == nil, "\(difference ?? "")")

        // `SG_WRITE_INTERCHANGE=1 swift test` refreshes the iOS-produced file
        // that the web suite restores (packages/native-core/tests/interchange.test.ts).
        if ProcessInfo.processInfo.environment["SG_WRITE_INTERCHANGE"] == "1" {
            let url = Fixtures.directory.deletingLastPathComponent().appendingPathComponent("interchange/ios-export.json")
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(iosText.utf8).write(to: url)
        }

        // The restored document keeps every record's own writer provenance.
        let snapshot = try await runtime.snapshot()
        #expect(snapshot.data?.events.count == webParsed["data"]?["events"]?.arrayValue?.count)
    }

    @Test("merging the same backup twice changes nothing the second time")
    func idempotentMerge() async throws {
        let webText = try Self.webBackupText()
        let (runtime, _) = try freshRuntime()
        _ = try await runtime.open()
        for _ in 0..<2 {
            let preview = try await runtime.previewRestore(text: webText, mode: "MERGE")
            let result = try await runtime.restore(text: webText, request: .object([
                "mode": .string("MERGE"),
                "expectedDocumentRevision": preview["plan"]!["baseDocumentRevision"]!,
            ]))
            #expect(result["ok"]?.boolValue == true)
        }
        let again = try await runtime.previewRestore(text: webText, mode: "MERGE")
        let changes = again["plan"]?["changes"]?.arrayValue ?? []
        #expect(changes.isEmpty, "second merge must be a no-op, got \(changes.count) changes")
    }

    @Test("a tampered backup is refused before anything is written")
    func tampered() async throws {
        let tampered = try Self.webBackupText().replacingOccurrences(of: "여름 휴가", with: "겨울 휴가")
        let (runtime, storage) = try freshRuntime()
        _ = try await runtime.open()
        let preview = try await runtime.previewRestore(text: tampered, mode: "REPLACE")
        #expect(preview["ok"]?.boolValue == false)
        #expect(preview["parsed"]?["kind"]?.stringValue == "INTEGRITY_MISMATCH")
        let result = try await runtime.restore(text: tampered, request: .object([
            "mode": .string("REPLACE"), "expectedDocumentRevision": .number(0), "confirmDestructive": .bool(true),
        ]))
        #expect(result["ok"]?.boolValue == false)
        #expect(try storage.get("super-gongik:data:v2") == nil)
    }

    @Test("replace over existing data needs confirmation and keeps a pre-restore copy")
    func replaceSafety() async throws {
        let webText = try Self.webBackupText()
        let (runtime, storage) = try freshRuntime()
        _ = try await runtime.open()
        _ = try await runtime.run("createProfile", [.object([
            "callUpDate": .string("2026-01-05"), "expectedDischargeDate": .string("2027-10-04"),
        ])])
        let before = try storage.get("super-gongik:data:v2")
        let preview = try await runtime.previewRestore(text: webText, mode: "REPLACE")
        let base = preview["plan"]!["baseDocumentRevision"]!
        #expect(preview["plan"]?["requiresDestructiveConfirmation"]?.boolValue == true)

        let unconfirmed = try await runtime.restore(text: webText, request: .object([
            "mode": .string("REPLACE"), "expectedDocumentRevision": base,
        ]))
        #expect(unconfirmed["ok"]?.boolValue == false)
        #expect(try storage.get("super-gongik:data:v2") == before)

        let confirmed = try await runtime.restore(text: webText, request: .object([
            "mode": .string("REPLACE"), "expectedDocumentRevision": base, "confirmDestructive": .bool(true),
        ]))
        #expect(confirmed["ok"]?.boolValue == true)
        #expect(try storage.get("super-gongik:data:v2:pre-restore") == before)
    }
}
