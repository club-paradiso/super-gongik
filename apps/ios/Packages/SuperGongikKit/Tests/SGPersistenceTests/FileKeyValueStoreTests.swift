import Foundation
import Testing
@testable import SGPersistence

/// Provider obligations of the domain `KeyValueStorage` port.
@Suite("File key-value store")
struct FileKeyValueStoreTests {
    func makeStore() throws -> FileKeyValueStore {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("sg-kv-\(UUID().uuidString)", isDirectory: true)
        return try FileKeyValueStore(directory: directory)
    }

    @Test func roundTripsExactText() throws {
        let store = try makeStore()
        let text = "{\"note\":\"여름 휴가 🫡\\n\",\"n\":1}"
        try store.set("super-gongik:data:v2", text)
        #expect(try store.get("super-gongik:data:v2") == text)
        #expect(try store.get("missing") == nil)
    }

    @Test func listsAndRemovesKeys() throws {
        let store = try makeStore()
        try store.set("super-gongik:data:v2", "a")
        try store.set("super-gongik:quarantine:2026-10-03T00:00:00.000Z", "b")
        #expect(try store.keys() == ["super-gongik:data:v2", "super-gongik:quarantine:2026-10-03T00:00:00.000Z"])
        try store.remove("super-gongik:data:v2")
        try store.remove("super-gongik:data:v2") // removing twice is not an error
        #expect(try store.keys() == ["super-gongik:quarantine:2026-10-03T00:00:00.000Z"])
    }

    @Test func compareAndSetOnlyWritesOverExpectedValue() throws {
        let store = try makeStore()
        #expect(try store.compareAndSet("k", expected: nil, value: "1"))
        #expect(try !store.compareAndSet("k", expected: nil, value: "2"))
        #expect(try !store.compareAndSet("k", expected: "0", value: "2"))
        #expect(try store.compareAndSet("k", expected: "1", value: "2"))
        #expect(try store.get("k") == "2")
    }

    @Test func overwriteIsAtomicReplacement() throws {
        let store = try makeStore()
        try store.set("k", String(repeating: "a", count: 100_000))
        try store.set("k", "short")
        #expect(try store.get("k") == "short")
        // No temporary files are left behind next to the value.
        let files = try FileManager.default.contentsOfDirectory(atPath: store.directory.path)
        #expect(files.count == 1)
    }

    @Test func unreadableBytesAreReturnedNotDropped() throws {
        let store = try makeStore()
        try store.set("k", "x")
        let file = store.directory.appendingPathComponent(try FileKeyValueStore.fileName(for: "k"))
        try Data([0xff, 0xfe, 0x00]).write(to: file)
        // The repository above must see "unreadable" and quarantine; this
        // layer must not pretend the key is empty.
        #expect(try store.get("k") != nil)
    }

    @Test func rejectsEmptyKey() throws {
        let store = try makeStore()
        #expect(throws: FileKeyValueStore.StoreError.invalidKey) { try store.set("", "x") }
    }
}
