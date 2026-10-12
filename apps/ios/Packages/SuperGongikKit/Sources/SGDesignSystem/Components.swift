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
            .frame(maxWidth: .infinity, minHeight: SGSize.primaryControl)
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
            .frame(maxWidth: .infinity, minHeight: SGSize.control)
            .padding(.horizontal, SGSpacing.md)
            .background(.sg(SGColor.surfaceInteractive), in: RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous))
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.45)
            .contentShape(Rectangle())
    }
}

/// Destructive action (delete, reset). Only after a confirmation step; the
/// label says what is lost, never only "삭제".
public struct SGDestructiveButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(SGTypography.bodyStrong)
            .foregroundStyle(.sg(SGColor.danger))
            .frame(maxWidth: .infinity, minHeight: SGSize.control)
            .padding(.horizontal, SGSpacing.md)
            .background(.sg(SGColor.dangerBackground), in: RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous).strokeBorder(.sg(SGColor.dangerBorder)))
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.45)
            .contentShape(Rectangle())
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
///
/// The Warrior theme adds quarter markers at the core's percent milestones
/// (`PERCENT_MILESTONES` 25/50/75 in `packages/domain`). They are drawn in
/// `SGColor.heroOrnament`, which is transparent in the standard theme, and
/// carry no information the percentage beside the bar does not already give.
public struct SGProgressBar: View {
    let fraction: Double
    let height: CGFloat
    let track: SGToken
    let markers: Bool

    /// Quarter milestones, as fractions.
    static let markerFractions: [Double] = [0.25, 0.5, 0.75]

    public init(fraction: Double, height: CGFloat = 8, track: SGToken = SGColor.heroTrack, markers: Bool = true) {
        self.fraction = min(1, max(0, fraction))
        self.height = height
        self.track = track
        self.markers = markers
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
                if markers {
                    ForEach(Self.markerFractions, id: \.self) { marker in
                        Rectangle()
                            .fill(.sg(SGColor.heroOrnament))
                            .frame(width: 2, height: height)
                            .offset(x: proxy.size.width * marker - 1)
                    }
                }
            }
        }
        .frame(height: height)
        .accessibilityHidden(true)
    }
}

/// Night-sky hero background (the logo's sky): navy base, violet depth at the
/// top trailing corner, one restrained warm horizon at the bottom leading edge.
/// The Warrior theme deepens the sky and warms the horizon (Stitch
/// `super_gongik_master_synthesis`); both stay gradients only, no imagery.
public struct SGHeroBackground: View {
    let celebrate: Bool
    @Environment(\.sgTheme) private var theme

    public init(celebrate: Bool = false) { self.celebrate = celebrate }

    public var body: some View {
        switch theme {
        case .standard:
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
        case .warrior:
            ZStack {
                LinearGradient(
                    colors: [RGB(0x000C3F).color, RGB(0x081F68).color, RGB(0x14173E).color],
                    startPoint: .top, endPoint: .bottom)
                RadialGradient(
                    colors: [RGB(0x5952AD).color.opacity(0.6), .clear],
                    center: UnitPoint(x: 0.85, y: 0.05), startRadius: 0, endRadius: 280)
                RadialGradient(
                    colors: [RGB(0xFFDEA7).color.opacity(celebrate ? 0.5 : 0.36), SGBrand.ember.color.opacity(0.14), .clear],
                    center: UnitPoint(x: 0.5, y: 1.25), startRadius: 0, endRadius: 340)
                // Two halo arcs behind the D-day, upper trailing side. Static.
                GeometryReader { proxy in
                    ZStack {
                        Circle().strokeBorder(.sg(SGColor.heroHalo), lineWidth: 1).frame(width: 260, height: 260)
                        Circle().strokeBorder(.sg(SGColor.heroHalo), lineWidth: 1).frame(width: 176, height: 176)
                    }
                    .position(x: proxy.size.width - 36, y: 104)
                }
            }
        }
    }
}

/// The Warrior hero's crest: a gilded hairline inset inside a hero-shaped
/// container. Draws nothing in the standard theme. Overlay it on a hero card;
/// full-screen hero backgrounds (onboarding, privacy lock) do not use it.
public struct SGHeroCrest: View {
    let cornerRadius: CGFloat
    @Environment(\.sgTheme) private var theme

    public init(cornerRadius: CGFloat = SGRadius.hero) { self.cornerRadius = cornerRadius }

    public var body: some View {
        if theme.showsOrnaments {
            RoundedRectangle(cornerRadius: cornerRadius - SGSpacing.iconGap, style: .continuous)
                .strokeBorder(.sg(SGColor.heroOrnament), lineWidth: 1)
                .padding(SGSpacing.iconGap)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }
}

/// Section header used above grouped content.
///
/// `eyebrow` is the optional world-language tag from the Stitch direction
/// ("AGENDA", "SUPPLY"). It is flavor, not information: shown only in the
/// Warrior theme, after the Korean title, smaller and quieter, and VoiceOver
/// skips it.
public struct SGSectionHeader: View {
    let title: String
    let detail: String?
    let eyebrow: String?
    @Environment(\.sgTheme) private var theme
    @ScaledMetric(relativeTo: .headline) private var bannerHeight: CGFloat = 16

    public init(_ title: String, detail: String? = nil, eyebrow: String? = nil) {
        self.title = title
        self.detail = detail
        self.eyebrow = eyebrow
    }

    public var body: some View {
        // Captured as a value: alignment closures are Sendable.
        let bannerDrop = bannerHeight * 0.18
        HStack(alignment: .firstTextBaseline, spacing: SGSpacing.xs) {
            if theme.showsOrnaments {
                // Warrior banner bar. Aligned to the title's first baseline so
                // a wrapped title keeps the bar beside its first line.
                Capsule()
                    .fill(.sg(SGColor.accent))
                    .frame(width: 3, height: bannerHeight)
                    .alignmentGuide(.firstTextBaseline) { $0[.bottom] - bannerDrop }
                    .accessibilityHidden(true)
            }
            Text(title).font(SGTypography.cardTitle).foregroundStyle(.sg(SGColor.textPrimary))
                .accessibilityAddTraits(.isHeader)
            if let eyebrow { SGWorldEyebrow(eyebrow) }
            Spacer(minLength: SGSpacing.xs)
            if let detail {
                Text(detail).font(SGTypography.caption).foregroundStyle(.sg(SGColor.textTertiary))
            }
        }
    }
}
