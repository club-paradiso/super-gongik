import Foundation

/// JSON value with exact number semantics. Used to carry core records whose
/// fields Swift does not model (they round-trip untouched) and to compare core
/// output with the shared fixtures in `contracts/fixtures`. Booleans and numbers are kept
/// apart (Foundation bridges both to NSNumber), and numbers compare as
/// IEEE doubles, which is what JavaScript produced.
public indirect enum JSONValue: Equatable, CustomStringConvertible, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(any value: Any) {
        switch value {
        case is NSNull:
            self = .null
        case let number as NSNumber:
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                self = .bool(number.boolValue)
            } else {
                self = .number(number.doubleValue)
            }
        case let string as String:
            self = .string(string)
        case let array as [Any]:
            self = .array(array.map(JSONValue.init(any:)))
        case let object as [String: Any]:
            self = .object(object.mapValues(JSONValue.init(any:)))
        default:
            self = .string("<unsupported \(type(of: value))>")
        }
    }

    public init(data: Data) throws {
        self.init(any: try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]))
    }

    public subscript(key: String) -> JSONValue? {
        if case .object(let object) = self { return object[key] }
        return nil
    }

    public var stringValue: String? {
        if case .string(let value) = self { return value }
        return nil
    }

    public var arrayValue: [JSONValue]? {
        if case .array(let value) = self { return value }
        return nil
    }

    public var numberValue: Double? {
        if case .number(let value) = self { return value }
        return nil
    }

    public var boolValue: Bool? {
        if case .bool(let value) = self { return value }
        return nil
    }

    public var anyValue: Any {
        switch self {
        case .null: NSNull()
        case .bool(let value): value
        case .number(let value): value
        case .string(let value): value
        case .array(let value): value.map(\.anyValue)
        case .object(let value): value.mapValues(\.anyValue)
        }
    }

    public var jsonText: String {
        let data = try! JSONSerialization.data(
            withJSONObject: anyValue, options: [.fragmentsAllowed, .sortedKeys, .withoutEscapingSlashes])
        return String(decoding: data, as: UTF8.self)
    }

    public var description: String { jsonText }

    /// First path where two values differ, for readable failures.
    public func firstDifference(from other: JSONValue, path: String = "$") -> String? {
        switch (self, other) {
        case (.object(let a), .object(let b)):
            for key in Set(a.keys).union(b.keys).sorted() {
                guard let left = a[key] else { return "\(path).\(key): missing on left" }
                guard let right = b[key] else { return "\(path).\(key): missing on right" }
                if let difference = left.firstDifference(from: right, path: "\(path).\(key)") {
                    return difference
                }
            }
            return nil
        case (.array(let a), .array(let b)):
            if a.count != b.count { return "\(path): length \(a.count) vs \(b.count)" }
            for (index, pair) in zip(a, b).enumerated() {
                if let difference = pair.0.firstDifference(from: pair.1, path: "\(path)[\(index)]") {
                    return difference
                }
            }
            return nil
        default:
            return self == other ? nil : "\(path): \(self) vs \(other)"
        }
    }
}


extension JSONValue: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }
}

public extension JSONValue {
    /// Returns a copy with `key` set (objects only).
    func setting(_ key: String, _ value: JSONValue) -> JSONValue {
        guard case .object(var object) = self else { return self }
        object[key] = value
        return .object(object)
    }

    static func from<T: Encodable>(_ value: T) throws -> JSONValue {
        try JSONValue(data: JSONEncoder().encode(value))
    }
}
