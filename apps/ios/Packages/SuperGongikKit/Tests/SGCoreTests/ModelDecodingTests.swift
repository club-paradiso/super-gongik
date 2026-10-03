import Foundation
import Testing
@testable import SGCore
import SGFoundation
import SGTestSupport

/// The Swift read models must decode every projection the reference core
/// produces, so a TypeScript shape change fails here before it reaches a
/// screen.
@Suite("Read models decode the core's JSON")
struct ModelDecodingTests {
    @Test("every projection fixture decodes")
    func projections() throws {
        let suite = try Fixtures.load("projection")
        for fixture in suite.cases {
            let value = fixture.expected["value"]!
            let projection = try JSONDecoder().decode(Projection.self, from: Data(value.jsonText.utf8))
            if fixture.id == "no profile" {
                #expect(projection.profile == nil)
                continue
            }
            let home = try #require(projection.home, "\(fixture.id)")
            let progress = try #require(projection.progress)
            // The home hero floors; the progress model rounds. Both are shown
            // by the web in different places and must stay distinct.
            #expect(home.hero.percent <= progress.completionPercentage)
            #expect(projection.leaveText?.entries.count == projection.ledger?.entries.count)
            for event in projection.liveEvents ?? [] {
                #expect(projection.eventDisplay?[event.id] != nil, "\(fixture.id): \(event.id)")
            }
            if projection.compensation?.components.contains(where: { $0.status != "CALCULATED" }) == true {
                #expect(projection.compensation?.total == nil, "no total while a component is unresolved")
            }
        }
    }

    @Test("money month fixtures decode")
    func moneyMonths() throws {
        let suite = try Fixtures.load("event-form")
        let money = suite.cases.filter { $0.function == "evaluateMoneyMonth" }
        #expect(!money.isEmpty)
        for fixture in money {
            _ = try JSONDecoder().decode(MoneyMonth.self, from: Data(fixture.expected["value"]!.jsonText.utf8))
        }
    }

    @Test("a store opens on empty storage and round-trips a command")
    func storeLifecycle() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("sg-core-\(UUID().uuidString)")
        let storage = try FileKeyValueStoreFactory.make(directory)
        let runtime = try CoreRuntime(storage: storage)
        let opened = try await runtime.open()
        #expect(opened.isReady)
        #expect(opened.data?.profile == nil)

        let created = try await runtime.run("createProfile", [.object([
            "callUpDate": .string("2026-05-04"),
            "expectedDischargeDate": .string("2028-02-03"),
            "serviceCategory": .null, "workplaceType": .null,
            "defaultCommuteCost": .null, "defaultMealAllowanceOverride": .null,
            "timezone": .string("Asia/Seoul"),
        ])])
        #expect(created.ok)
        let event = try await runtime.run("createServiceEvent", [.object([
            "eventType": .string("ANNUAL_LEAVE"), "startDate": .string("2026-07-01"),
            "endDate": .string("2026-07-01"), "timing": .object(["kind": .string("ALL_DAY"), "dayCount": .number(1)]),
            "title": .null, "note": .null,
        ])])
        #expect(event.ok)
        let overlap = try await runtime.run("createServiceEvent", [.object([
            "eventType": .string("ANNUAL_LEAVE"), "startDate": .string("2026-07-01"),
            "endDate": .string("2026-07-01"), "timing": .object(["kind": .string("ALL_DAY"), "dayCount": .number(1)]),
            "title": .null, "note": .null,
        ])])
        #expect(!overlap.ok)
        #expect(overlap.errors?.first?.code == "LEAVE_OVERLAP")

        // A second runtime over the same files sees the persisted document,
        // with the previous generation kept by the shared repository.
        let reopened = try CoreRuntime(storage: try FileKeyValueStoreFactory.make(directory))
        let snapshot = try await reopened.open()
        #expect(snapshot.data?.liveEvents.count == 1)
        #expect(snapshot.data?.documentRevision == 2)
        #expect(try storage.get("super-gongik:data:v2:previous") != nil)

        let projection = try await reopened.project(today: CivilDate("2026-10-03")!)
        #expect(projection.home?.hero.phase == "IN_SERVICE")
        #expect(projection.leaveText?.balance.used == "1일")
    }

    @Test("an unreadable document is quarantined, not discarded")
    func corruptDocument() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("sg-core-\(UUID().uuidString)")
        let storage = try FileKeyValueStoreFactory.make(directory)
        try storage.set("super-gongik:data:v2", "{\"schemaVersion\":3, truncated")
        let runtime = try CoreRuntime(storage: storage)
        let snapshot = try await runtime.open()
        #expect(snapshot.notice?.kind == "CORRUPT")
        let quarantineKey = try #require(snapshot.notice?.quarantineKey)
        #expect(try storage.get(quarantineKey) == "{\"schemaVersion\":3, truncated")
    }

    @Test("a document from a newer app version is never overwritten")
    func newerVersion() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("sg-core-\(UUID().uuidString)")
        let storage = try FileKeyValueStoreFactory.make(directory)
        let newer = "{\"schemaVersion\":99,\"documentRevision\":5}"
        try storage.set("super-gongik:data:v2", newer)
        let runtime = try CoreRuntime(storage: storage)
        let snapshot = try await runtime.open()
        #expect(snapshot.notice?.kind == "NEWER_VERSION")
        #expect(snapshot.readOnly == true)
        let attempt = try await runtime.run("createProfile", [.object([
            "callUpDate": .string("2026-05-04"), "expectedDischargeDate": .string("2028-02-03"),
        ])])
        #expect(!attempt.ok)
        #expect(try storage.get("super-gongik:data:v2") == newer)
    }
}

import SGPersistence

enum FileKeyValueStoreFactory {
    static func make(_ directory: URL) throws -> FileKeyValueStore { try FileKeyValueStore(directory: directory) }
}
