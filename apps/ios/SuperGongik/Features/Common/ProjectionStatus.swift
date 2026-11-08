import SGDesignSystem
import SwiftUI

/// Shown where a screen needs today's projection and has none yet: a spinner
/// while the core is working, or — when the core failed — what happened and a
/// retry, instead of a spinner that never ends.
struct ProjectionPlaceholder: View {
    @Environment(AppModel.self) private var model
    @State private var retrying = false

    var body: some View {
        if model.projectionFailed && !retrying {
            VStack(alignment: .leading, spacing: SGSpacing.sm) {
                SGNotice(.warning, title: ErrorCopy.projectionFailed, message: ErrorCopy.projectionFailedDetail)
                Button {
                    Task {
                        retrying = true
                        await model.retryProjection()
                        retrying = false
                    }
                } label: {
                    Label("다시 불러오기", systemImage: "arrow.clockwise")
                }
                .buttonStyle(SGSecondaryButtonStyle())
            }
            .padding(SGSpacing.gutter)
            .frame(maxWidth: SGLayout.readableWidth)
            .frame(maxWidth: .infinity)
        } else {
            SGLoadingState()
        }
    }
}

/// When a refresh failed but an older projection is still on screen.
struct ProjectionStaleNotice: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if model.projectionFailed {
            VStack(alignment: .leading, spacing: SGSpacing.xs) {
                SGNotice(.warning, title: ErrorCopy.projectionStale)
                Button("다시 불러오기") { Task { await model.retryProjection() } }
                    .font(SGTypography.label)
                    .frame(minHeight: SGSpacing.minimumHitTarget)
            }
        }
    }
}

/// The last failed write, with a way to put it away once read.
struct WriteErrorNotice: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let error = model.lastWriteError {
            HStack(alignment: .top, spacing: SGSpacing.xs) {
                SGNotice(.warning, title: error)
                Button {
                    model.dismissWriteError()
                } label: {
                    Image(systemName: "xmark")
                        .font(SGTypography.label)
                        .foregroundStyle(.sg(SGColor.textSecondary))
                        .frame(width: SGSpacing.minimumHitTarget, height: SGSpacing.minimumHitTarget)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("알림 닫기")
            }
        }
    }
}
