import Foundation
import SGFoundation

/// Typed façade over `CoreRuntime` for the app: one method per facade call,
/// JSON encoded and decoded here so features never build JSON by hand.
public extension CoreRuntime {
    private static func encode(_ value: some Encodable) throws -> String {
        String(decoding: try JSONEncoder().encode(value), as: UTF8.self)
    }

    private static func arguments(_ values: [JSONValue]) -> String {
        JSONValue.array(values).jsonText
    }

    // MARK: Store

    func open() async throws -> StoreSnapshot {
        try decode(StoreSnapshot.self, from: await callJSONAsync("open"))
    }

    func snapshot() throws -> StoreSnapshot {
        try decode(StoreSnapshot.self, from: callJSON("snapshot"))
    }

    func refresh() async throws -> StoreSnapshot {
        try decode(StoreSnapshot.self, from: await callJSONAsync("refresh"))
    }

    func dismissNotice() throws -> StoreSnapshot {
        try decode(StoreSnapshot.self, from: callJSON("dismissNotice"))
    }

    /// Runs a whitelisted store command (`COMMANDS` in runtime.ts).
    func run(_ command: String, _ arguments: [JSONValue]) async throws -> RunOutcome {
        try decode(RunOutcome.self, from: await callJSONAsync("run", [command, Self.arguments(arguments)]))
    }

    /// Patch the stored profile (unmodelled fields are kept by the core).
    func editProfile(_ patch: [String: JSONValue]) async throws -> RunOutcome {
        try decode(RunOutcome.self, from: await callJSONAsync("editProfile", [JSONValue.object(patch).jsonText]))
    }

    func wipeAll() async throws -> RunOutcome {
        try decode(RunOutcome.self, from: await callJSONAsync("wipeAll"))
    }

    func project(today: CivilDate) throws -> Projection {
        try decode(Projection.self, from: callJSON("project", [today.description]))
    }

    func readRaw(key: String) async throws -> String? {
        let data = try await callJSONAsync("readRaw", [key])
        return try JSONDecoder().decode(String?.self, from: data)
    }

    func moneyMonth(_ month: String, today: CivilDate) throws -> MoneyMonth {
        try unwrap(PureEnvelope<MoneyMonth>.self, callJSON("moneyMonth", [month, today.description]), "moneyMonth")
    }

    func eventFormInitial(eventId: String?, date: CivilDate) throws -> EventFormState {
        try unwrap(PureEnvelope<EventFormState>.self,
                   callJSON("eventFormInitial", [eventId.map { $0 as Any } ?? NSNull(), date.description]), "eventFormInitial")
    }

    func eventFormEvaluate(_ form: EventFormState, editingId: String?) throws -> EventFormEvaluation {
        try unwrap(PureEnvelope<EventFormEvaluation>.self,
                   callJSON("eventFormEvaluate", [try Self.encode(form), editingId.map { $0 as Any } ?? NSNull()]),
                   "eventFormEvaluate")
    }

    private func unwrap<Value>(_ type: PureEnvelope<Value>.Type, _ data: Data, _ name: String) throws -> Value {
        let envelope = try decode(type, from: data)
        guard envelope.ok, let value = envelope.value else {
            throw CoreError.javaScript(envelope.error.map { "\($0.name): \($0.message)" } ?? "\(name) failed")
        }
        return value
    }

    // MARK: Pure calls

    /// `SGCore.call` decoded into `Value`; a thrown domain error becomes
    /// `CoreError.javaScript` with the domain message (developer-facing).
    func pure<Value: Decodable & Sendable>(_ name: String, _ arguments: [JSONValue], as: Value.Type = Value.self) throws -> Value {
        let envelope = try decode(PureEnvelope<Value>.self, from: callPure(name, argumentsJSON: Self.arguments(arguments)))
        guard envelope.ok, let value = envelope.value else {
            throw CoreError.javaScript(envelope.error.map { "\($0.name): \($0.message)" } ?? "\(name) failed")
        }
        return value
    }

    func pureJSON(_ name: String, _ arguments: [JSONValue]) throws -> JSONValue {
        try pure(name, arguments, as: JSONValue.self)
    }

    // MARK: Backup / restore

    struct ExportedBackup: Decodable, Sendable {
        public let text: String
    }

    func exportBackup(exportedAt: Date) throws -> ExportedBackup {
        try decode(ExportedBackup.self, from: callJSON("exportBackup", [ISO8601.string(exportedAt)]))
    }

    func previewRestore(text: String, mode: String, options: JSONValue = .null) throws -> JSONValue {
        try JSONValue(data: callJSON("previewRestore", [text, mode, options.jsonText]))
    }

    func restore(text: String, request: JSONValue) async throws -> JSONValue {
        try JSONValue(data: await callJSONAsync("restore", [text, request.jsonText]))
    }
}

public enum ISO8601 {
    /// `Date.prototype.toISOString()` format: UTC, milliseconds, `Z`.
    public static func string(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: date)
    }
}
