import Foundation
import Testing
@testable import SGCore
import SGFoundation
import SGTestSupport

/// Replays every fixture through the bundled TypeScript core inside
/// JavaScriptCore. This proves the bridge, the shims (crypto, TextEncoder,
/// URL) and JavaScriptCore's Intl/ICU produce byte-for-byte the same results
/// as the Node reference that generated the fixtures.
@Suite("JavaScriptCore bridge conformance")
struct BridgeConformanceTests {
    static let runtime: CoreRuntime = try! CoreRuntime(storage: nil)

    static func evaluate(_ fixture: FixtureCase, on runtime: CoreRuntime) async throws -> JSONValue {
        switch fixture.kind {
        case "call":
            let args = JSONValue.array(fixture.arguments).jsonText
            return try JSONValue(data: await runtime.callPure(fixture.function!, argumentsJSON: args))
        case "command":
            return try JSONValue(data: await runtime.applyCommand(
                fixture.raw["command"]!.stringValue!,
                dataJSON: fixture.raw["data"]!.jsonText,
                argumentsJSON: fixture.raw["args"]!.jsonText,
                contextJSON: fixture.raw["context"]!.jsonText))
        case "projection":
            let args = JSONValue.array([fixture.raw["data"]!, fixture.raw["today"]!]).jsonText
            return try JSONValue(data: await runtime.callPure("buildNativeProjection", argumentsJSON: args))
        default:
            throw CoreError.javaScript("unknown fixture kind \(fixture.kind)")
        }
    }

    @Test("facade version is compatible")
    func version() {
        #expect(Self.runtime.facadeVersion.hasPrefix(CoreRuntime.expectedFacadeMajor + "."))
    }

    @Test("replays every fixture suite", arguments: try! Fixtures.allSuiteNames())
    func replay(suiteName: String) async throws {
        let suite = try Fixtures.load(suiteName)
        #expect(!suite.cases.isEmpty)
        for fixture in suite.cases {
            let actual = try await Self.evaluate(fixture, on: Self.runtime)
            let difference = actual.firstDifference(from: fixture.expected)
            #expect(difference == nil, "\(suiteName) / \(fixture.id): \(difference ?? "")")
        }
    }
}

@Suite("CoreRuntime serialization")
struct CoreRuntimeConcurrencyTests {
    /// Many concurrent callers; every call must run on the core queue (the
    /// precondition in CoreRuntime traps otherwise) and return its own result.
    @Test("concurrent calls are serialized and return their own results")
    func stress() async throws {
        let runtime = try CoreRuntime(storage: nil)
        try await withThrowingTaskGroup(of: (Int, String).self) { group in
            for offset in 0..<400 {
                group.addTask {
                    let data = try await runtime.callPure("addDays", argumentsJSON: "[\"2026-01-01\",\(offset)]")
                    return (offset, try JSONValue(data: data)["value"]?.stringValue ?? "")
                }
            }
            for try await (offset, value) in group {
                #expect(value == CivilDate("2026-01-01")!.adding(days: offset).description)
            }
        }
    }
}
