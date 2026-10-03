import SwiftUI

/// Standard operational surface: flat, 1 pt border, card radius.
public struct SGCard<Content: View>: View {
    private let padding: CGFloat
    private let content: Content

    public init(padding: CGFloat = SGSpacing.md, @ViewBuilder content: () -> Content) {
        self.padding = padding
        self.content = content()
    }

    public var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.sg(SGColor.surface), in: RoundedRectangle(cornerRadius: SGRadius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: SGRadius.card, style: .continuous)
                    .strokeBorder(.sg(SGColor.border), lineWidth: 1))
            .sgShadow(.small)
    }
}

public struct SGPrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(SGTypography.bodyStrong)
            .foregroundStyle(.sg(SGColor.onAccent))
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, SGSpacing.md)
            .background(.sg(SGColor.accent), in: RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous))
            .opacity(isEnabled ? (configuration.isPressed ? 0.85 : 1) : 0.45)
            .contentShape(Rectangle())
    }
}

public struct SGSecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(SGTypography.bodyStrong)
            .foregroundStyle(.sg(SGColor.accent))
            .frame(maxWidth: .infinity, minHeight: 48)
            .padding(.horizontal, SGSpacing.md)
            .background(.sg(SGColor.surfaceInteractive), in: RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous))
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.45)
            .contentShape(Rectangle())
    }
}

public struct SGDestructiveButtonStyle: ButtonStyle {
    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(SGTypography.bodyStrong)
            .foregroundStyle(.sg(SGColor.danger))
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(.sg(SGColor.dangerBackground), in: RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous).strokeBorder(.sg(SGColor.dangerBorder)))
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

/// Status tone. Every use pairs the tone with text and a symbol.
public enum SGTone: Sendable {
    case info, success, warning, danger, neutral

    public var foreground: SGToken {
        switch self {
        case .info: SGColor.info
        case .success: SGColor.success
        case .warning: SGColor.warning
        case .danger: SGColor.danger
        case .neutral: SGColor.textSecondary
        }
    }

    public var background: SGToken {
        switch self {
        case .info: SGColor.infoBackground
        case .success: SGColor.successBackground
        case .warning: SGColor.warningBackground
        case .danger: SGColor.dangerBackground
        case .neutral: SGColor.surfaceInteractive
        }
    }

    public var symbol: String {
        switch self {
        case .info: "info.circle.fill"
        case .success: "checkmark.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .danger: "xmark.octagon.fill"
        case .neutral: "circle.dashed"
        }
    }
}

/// Inline notice: symbol + text on a tinted surface.
public struct SGNotice: View {
    let tone: SGTone
    let title: String
    let message: String?

    public init(_ tone: SGTone, title: String, message: String? = nil) {
        self.tone = tone
        self.title = title
        self.message = message
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: SGSpacing.sm) {
            Image(systemName: tone.symbol)
                .foregroundStyle(.sg(tone.foreground))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: SGSpacing.xxs) {
                Text(title).font(SGTypography.label).foregroundStyle(.sg(SGColor.textPrimary))
                if let message {
                    Text(message).font(SGTypography.caption).foregroundStyle(.sg(SGColor.textSecondary))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(SGSpacing.sm)
        .background(.sg(tone.background), in: RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// The warm progress bar (ivory → sun → ember → coral), used only for
/// service progress: "warm colors mark value, not decoration".
public struct SGProgressBar: View {
    let fraction: Double
    let height: CGFloat
    let track: SGToken

    public init(fraction: Double, height: CGFloat = 8, track: SGToken = SGColor.heroTrack) {
        self.fraction = min(1, max(0, fraction))
        self.height = height
        self.track = track
    }

    public var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(.sg(track))
                Capsule()
                    .fill(LinearGradient(
                        stops: [
                            .init(color: SGBrand.ivory.color, location: 0),
                            .init(color: SGBrand.sun.color, location: 0.55),
                            .init(color: SGBrand.ember.color, location: 0.82),
                            .init(color: SGBrand.coral.color, location: 1),
                        ],
                        startPoint: .leading, endPoint: .trailing))
                    // The gradient spans the full track and is revealed by
                    // the fill, so coral appears only near the end.
                    .frame(width: proxy.size.width)
                    .mask(alignment: .leading) {
                        Capsule().frame(width: max(height, proxy.size.width * fraction))
                    }
                    .opacity(fraction == 0 ? 0 : 1)
            }
        }
        .frame(height: height)
        .accessibilityHidden(true)
    }
}

/// Night-sky hero background (the logo's sky): navy base, violet depth at the
/// top trailing corner, one restrained warm horizon at the bottom leading edge.
public struct SGHeroBackground: View {
    let celebrate: Bool

    public init(celebrate: Bool = false) { self.celebrate = celebrate }

    public var body: some View {
        ZStack {
            LinearGradient(
                colors: [RGB(0x0B2275).color, RGB(0x0E1752).color, RGB(0x151A45).color],
                startPoint: UnitPoint(x: 0.25, y: 0), endPoint: UnitPoint(x: 0.75, y: 1))
            RadialGradient(
                colors: [SGBrand.violet.color.opacity(0.55), .clear],
                center: UnitPoint(x: 1, y: 0), startRadius: 0, endRadius: 260)
            RadialGradient(
                colors: [SGBrand.ember.color.opacity(celebrate ? 0.42 : 0.30), SGBrand.coral.color.opacity(0.12), .clear],
                center: UnitPoint(x: 0.12, y: 1.18), startRadius: 0, endRadius: 320)
        }
    }
}

/// Section header used above grouped content.
public struct SGSectionHeader: View {
    let title: String
    let detail: String?

    public init(_ title: String, detail: String? = nil) {
        self.title = title
        self.detail = detail
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(SGTypography.cardTitle).foregroundStyle(.sg(SGColor.textPrimary))
                .accessibilityAddTraits(.isHeader)
            Spacer()
            if let detail {
                Text(detail).font(SGTypography.caption).foregroundStyle(.sg(SGColor.textTertiary))
            }
        }
    }
}
