import SwiftUI

/// Whether closing an editor sheet needs the user's say-so: only when the
/// draft differs from what was loaded, and only before a successful save.
/// A sheet that is pulled down with unsaved edits is blocked
/// (`interactiveDismissDisabled`) so 닫기 can ask instead; records are never
/// written early and nothing is auto-saved (ProfileEditView, EventEditorSheet).
enum EditorDismissGuard {
    static func needsConfirmation<Draft: Equatable>(original: Draft?, current: Draft?, saved: Bool) -> Bool {
        guard !saved, let original, let current else { return false }
        return original != current
    }

    static let title = "변경한 내용을 저장하지 않고 닫을까요?"
    static let discard = "저장하지 않고 닫기"
    static let keepEditing = "계속 편집"
    static let message = "닫으면 지금까지 바꾼 내용이 사라져요. 저장하려면 오른쪽 위 저장을 눌러 주세요."
}

/// 닫기 with the unsaved-changes question; the sheet attaches it to its root.
struct DiscardChangesDialog: ViewModifier {
    @Binding var isPresented: Bool
    let discard: () -> Void

    func body(content: Content) -> some View {
        content.confirmationDialog(EditorDismissGuard.title, isPresented: $isPresented, titleVisibility: .visible) {
            Button(EditorDismissGuard.discard, role: .destructive, action: discard)
            Button(EditorDismissGuard.keepEditing, role: .cancel) {}
        } message: {
            Text(EditorDismissGuard.message)
        }
    }
}

extension View {
    func discardChangesDialog(isPresented: Binding<Bool>, discard: @escaping () -> Void) -> some View {
        modifier(DiscardChangesDialog(isPresented: isPresented, discard: discard))
    }
}
