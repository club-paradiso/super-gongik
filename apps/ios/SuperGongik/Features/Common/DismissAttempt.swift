import SwiftUI
import UIKit

/// Calls `action` when the user pulls down a sheet whose interactive dismiss
/// is disabled (`interactiveDismissDisabled(true)`), so the editor can ask
/// "변경한 내용을 저장하지 않고 닫을까요?" instead of just rubber-banding.
///
/// SwiftUI has no API for this, so a zero-size UIKit child finds the sheet's
/// presentation controller and becomes its delegate. Every call SwiftUI's own
/// delegate relies on (should/will/did dismiss) is forwarded to it, so the
/// binding and `interactiveDismissDisabled` keep working.
struct DismissAttemptObserver: UIViewControllerRepresentable {
    let action: () -> Void

    func makeUIViewController(context: Context) -> Controller { Controller(action: action) }

    func updateUIViewController(_ controller: Controller, context: Context) {
        controller.action = action
    }

    final class Controller: UIViewController, UIAdaptivePresentationControllerDelegate {
        var action: () -> Void
        private weak var original: (any UIAdaptivePresentationControllerDelegate)?

        init(action: @escaping () -> Void) {
            self.action = action
            super.init(nibName: nil, bundle: nil)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("not used") }

        override func viewWillAppear(_ animated: Bool) {
            super.viewWillAppear(animated)
            install()
        }

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            install()
        }

        private func install() {
            // The sheet's presentation controller belongs to the outermost
            // controller of the sheet (SwiftUI nests hosting controllers).
            var top: UIViewController = self
            while let parent = top.parent { top = parent }
            guard let presentation = top.presentationController, presentation.delegate !== self else { return }
            original = presentation.delegate
            presentation.delegate = self
        }

        func presentationControllerDidAttemptToDismiss(_ presentationController: UIPresentationController) {
            original?.presentationControllerDidAttemptToDismiss?(presentationController)
            action()
        }

        func presentationControllerShouldDismiss(_ presentationController: UIPresentationController) -> Bool {
            original?.presentationControllerShouldDismiss?(presentationController) ?? true
        }

        func presentationControllerWillDismiss(_ presentationController: UIPresentationController) {
            original?.presentationControllerWillDismiss?(presentationController)
        }

        func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
            original?.presentationControllerDidDismiss?(presentationController)
        }
    }
}

extension View {
    /// Runs `action` when the user tries to pull a dismiss-disabled sheet down.
    func onSheetDismissAttempt(_ action: @escaping () -> Void) -> some View {
        background(DismissAttemptObserver(action: action).frame(width: 0, height: 0).accessibilityHidden(true))
    }
}
