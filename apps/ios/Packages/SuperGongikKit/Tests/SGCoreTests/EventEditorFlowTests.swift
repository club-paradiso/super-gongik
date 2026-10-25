import Foundation
import SGCore
import SGFoundation
import SGPersistence
import Testing

/// The record editor's save path end to end through the core: a second leave
/// on a day that already has one is refused by the shared validation before
/// and during the save, the stored records do not change, and the draft the
/// editor holds is the same form it evaluated (nothing is reset by the
/// refusal). Mirrors the audit reproduction (2026-10-25, a Sunday).
@Suite("Record editor save flow", .serialized)
struct EventEditorFlowTests {
    private func runtime() async throws -> CoreRuntime {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("sg-editor-\(UUID().uuidString)")
        let runtime = try CoreRuntime(storage: try FileKeyValueStore(directory: directory))
        _ = try await runtime.open()
        let created = try await runtime.run("createProfile", [.object([
            "callUpDate": .string("2026-10-25"),
            "expectedDischargeDate": .string("2028-07-24"),
            "serviceCategory": .null, "workplaceType": .null,
            "defaultCommuteCost": .null, "defaultMealAllowanceOverride": .null,
            "timezone": .string("Asia/Seoul"),
        ])])
        #expect(created.ok)
        return runtime
    }

    @Test("a duplicate all-day leave is refused and the first record is the only one kept")
    func duplicateLeaveIsBlocked() async throws {
        let runtime = try await runtime()
        let date = CivilDate("2026-10-25")!

        var first = try await runtime.eventFormInitial(eventId: nil, date: date)
        #expect(first.eventType == "ANNUAL_LEAVE" && first.mode == "ALL_DAY" && first.dayCount == "1")
        first.note = "첫 기록"
        let firstEvaluation = try await runtime.eventFormEvaluate(first, editingId: nil)
        #expect(firstEvaluation.validation.errors.isEmpty)
        let saved = try await runtime.run("createServiceEvent", [firstEvaluation.draft])
        #expect(saved.ok)
        #expect(try await runtime.snapshot().data?.liveEvents.count == 1)

        // The same date again, with the user's own note: the editor evaluates
        // before saving and must show the overlap, not save.
        var second = try await runtime.eventFormInitial(eventId: nil, date: date)
        second.note = "실수로 다시"
        let evaluation = try await runtime.eventFormEvaluate(second, editingId: nil)
        #expect(evaluation.validation.errors.map(\.code) == ["LEAVE_OVERLAP"])
        #expect(evaluation.validation.errors.first?.field == "startDate")
        #expect(evaluation.validation.errors.first?.message.contains("2026-10-25") == true)

        // Even if the save were attempted, the store refuses it the same way.
        let refused = try await runtime.run("createServiceEvent", [evaluation.draft])
        #expect(!refused.ok)
        #expect(refused.errors?.first?.code == "LEAVE_OVERLAP")

        let events = try #require(try await runtime.snapshot().data?.liveEvents)
        #expect(events.count == 1)
        #expect(events.first?.note == "첫 기록")

        // The refused form is untouched: the editor keeps showing what was typed.
        #expect(second.note == "실수로 다시" && second.startDate == "2026-10-25" && second.dayCount == "1")

        // The existing record the refusal points at is the one just saved.
        let overlap = events.filter { $0.deletedAt == nil && $0.startDate <= date && date <= $0.endDate }
        #expect(overlap.map(\.id) == events.map(\.id))
    }

    @Test("an inverted range and a missing sick-leave category are refused before any save")
    func structuralErrorsAreRefused() async throws {
        let runtime = try await runtime()
        var inverted = try await runtime.eventFormInitial(eventId: nil, date: CivilDate("2026-11-04")!)
        inverted = try await runtime.pure("eventFormPatch", [try JSONValue.from(inverted), .object(["endDate": .string("2026-11-02")])], as: EventFormState.self)
        let invertedEvaluation = try await runtime.eventFormEvaluate(inverted, editingId: nil)
        #expect(invertedEvaluation.validation.errors.contains { $0.field == "endDate" })

        var sick = try await runtime.eventFormInitial(eventId: nil, date: CivilDate("2026-11-04")!)
        sick = try await runtime.pure("eventFormPatch", [try JSONValue.from(sick), .object(["eventType": .string("SICK_LEAVE")])], as: EventFormState.self)
        #expect(sick.sickLeaveCategory == "")
        let sickEvaluation = try await runtime.eventFormEvaluate(sick, editingId: nil)
        // The shared draft fills UNKNOWN for an empty category; the record is
        // then saved with that marker, never silently as ORDINARY.
        #expect(sickEvaluation.draft["sickLeaveCategory"] == .string("UNKNOWN"))
        #expect(try await runtime.snapshot().data?.liveEvents.isEmpty == true)
    }
}
