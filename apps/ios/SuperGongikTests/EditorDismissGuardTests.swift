import Testing
@testable import SuperGongik

/// Closing an editor asks only when something changed and nothing was saved
/// (IOS-08: a pulled-down 복무 설정 sheet silently dropped a changed field).
@Suite("Editor dismiss guard")
struct EditorDismissGuardTests {
    @Test("no change, not loaded yet, or already saved: close at once")
    func closesWithoutAsking() {
        #expect(!EditorDismissGuard.needsConfirmation(original: "09:00", current: "09:00", saved: false))
        #expect(!EditorDismissGuard.needsConfirmation(original: nil, current: "09:00", saved: false), "before the draft is loaded nothing can be lost")
        #expect(!EditorDismissGuard.needsConfirmation(original: "09:00", current: nil, saved: false))
        #expect(!EditorDismissGuard.needsConfirmation(original: "", current: "09:00", saved: true), "a successful save dismisses without a second question")
    }

    @Test("a changed draft asks before it is thrown away")
    func asksWhenDirty() {
        #expect(EditorDismissGuard.needsConfirmation(original: "", current: "09:00", saved: false))
        #expect(EditorDismissGuard.needsConfirmation(original: ["a"], current: ["a", "b"], saved: false))
    }
}
