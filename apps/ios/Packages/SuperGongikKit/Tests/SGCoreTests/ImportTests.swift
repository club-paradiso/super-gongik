import Foundation
import Testing
@testable import SGCore
import SGFoundation
import SGPersistence

/// Institution CSV import through JavaScriptCore on real files: preview
/// (importer + crypto.subtle shim backed by CryptoKit), default selection,
/// commit, duplicate detection on re-import, and rollback.
@Suite("Record import through the shared importer")
struct ImportTests {
    static let csv = "사용일자,복무상황,사용시간,비고\n2026-07-01,연가,8시간,여름\n2026-07-02,알수없음,8시간,\n2026-07-03,오전반가,4시간,병원"

    @Test("preview, commit, re-import as duplicates, rollback")
    func lifecycle() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("sg-import-\(UUID().uuidString)")
        let runtime = try CoreRuntime(storage: try FileKeyValueStore(directory: directory))
        _ = try await runtime.open()
        _ = try await runtime.run("createProfile", [.object([
            "callUpDate": .string("2026-05-04"), "expectedDischargeDate": .string("2028-02-03"),
        ])])

        let first = try JSONValue(data: await runtime.callJSONAsync("importPreview", [Self.csv, "records.csv", "f".padding(toLength: 64, withPad: "0", startingAt: 0)]))
        let events = first["preview"]?["events"]?.arrayValue ?? []
        #expect(events.count == 3)
        let fingerprint = events.first?["fingerprint"]?.stringValue ?? ""
        #expect(fingerprint.count == 64, "fingerprints come from crypto.subtle (CryptoKit-backed)")
        let accepted = first["acceptedRows"]?.arrayValue ?? []
        #expect(accepted.count == 2, "the unknown type row is not pre-selected")

        let commit = try JSONValue(data: await runtime.callJSONAsync("importCommit", [
            first["preview"]!.jsonText, "{}", JSONValue.array(accepted).jsonText, "[]",
        ]))
        #expect(commit["ok"]?.boolValue == true)
        var snapshot = try await runtime.snapshot()
        #expect(snapshot.data?.liveEvents.count == 2)

        let again = try JSONValue(data: await runtime.callJSONAsync("importPreview", [Self.csv, "records.csv", "f".padding(toLength: 64, withPad: "0", startingAt: 0)]))
        #expect(again["alreadyImported"]?.boolValue == true)
        #expect((again["acceptedRows"]?.arrayValue ?? []).isEmpty, "already imported rows are not selected again")

        let batchId = try #require(snapshot.data?.imports.first?.id)
        let rolledBack = try await runtime.run("rollbackImport", [.string(batchId)])
        #expect(rolledBack.ok)
        snapshot = try await runtime.snapshot()
        #expect(snapshot.data?.liveEvents.isEmpty == true)
    }

    @Test("CSV exports match the web formats")
    func csvExport() async throws {
        let runtime = try CoreRuntime(storage: try FileKeyValueStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent("sg-csv-\(UUID().uuidString)")))
        _ = try await runtime.open()
        _ = try await runtime.run("createProfile", [.object([
            "callUpDate": .string("2026-05-04"), "expectedDischargeDate": .string("2028-02-03"),
        ])])
        _ = try await runtime.run("createServiceEvent", [.object([
            "eventType": .string("ANNUAL_LEAVE"), "startDate": .string("2026-07-01"), "endDate": .string("2026-07-01"),
            "timing": .object(["kind": .string("ALL_DAY"), "dayCount": .number(1)]), "title": .null, "note": .string("쉼표, 포함"),
        ])])
        let events = try JSONDecoder().decode(String.self, from: await runtime.callJSON("exportCsv", ["events", "2026-10-04"]))
        #expect(events.contains("2026-07-01"))
        #expect(events.contains("\"쉼표, 포함\""), "cells with commas are quoted")
        let leave = try JSONDecoder().decode(String.self, from: await runtime.callJSON("exportCsv", ["leave", "2026-10-04"]))
        #expect(leave.split(whereSeparator: \.isNewline).count >= 2, "header + at least one entry (CRLF lines)")
    }
}
