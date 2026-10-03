import Foundation
import SGFoundation

public struct FixtureCase: Sendable {
    public let id: String
    public let kind: String
    public let raw: JSONValue

    public var expected: JSONValue { raw["expected"] ?? .null }
    public var function: String? { raw["fn"]?.stringValue }
    public var arguments: [JSONValue] { raw["args"]?.arrayValue ?? [] }
}

public struct FixtureSuite: Sendable {
    public let name: String
    public let engines: [String]
    public let cases: [FixtureCase]
}

/// Loads `contracts/fixtures/*.json` from the repository checkout. Tests run
/// on the host (macOS `swift test`, or the simulator, which shares the host
/// file system), so the files are read in place instead of being copied into
/// a bundle where they could go stale.
public enum Fixtures {
    public static var directory: URL {
        var url = URL(fileURLWithPath: #filePath)
        // …/apps/ios/Packages/SuperGongikKit/Sources/SGTestSupport/Fixtures.swift
        for _ in 0..<7 { url.deleteLastPathComponent() }
        return url.appendingPathComponent("contracts/fixtures", isDirectory: true)
    }

    public static func load(_ suite: String) throws -> FixtureSuite {
        let data = try Data(contentsOf: directory.appendingPathComponent("\(suite).json"))
        let root = try JSONValue(data: data)
        let cases = (root["cases"]?.arrayValue ?? []).map { value in
            FixtureCase(id: value["id"]?.stringValue ?? "?", kind: value["kind"]?.stringValue ?? "?", raw: value)
        }
        return FixtureSuite(
            name: suite,
            engines: root["engines"]?.arrayValue?.compactMap(\.stringValue) ?? [],
            cases: cases)
    }

    public static func allSuiteNames() throws -> [String] {
        try FileManager.default.contentsOfDirectory(atPath: directory.path)
            .filter { $0.hasSuffix(".json") }
            .map { String($0.dropLast(5)) }
            .sorted()
    }
}
