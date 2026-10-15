import SwiftUI

/// The user's visual theme. A presentation preference only: it changes color,
/// the hero sky and the decorative world-language labels, never a number, a
/// rule or what a screen offers. Stored per device (`storageKey`), not in the
/// synced document.
public enum SGTheme: String, CaseIterable, Identifiable, Sendable {
    /// HORIZON utility look (default).
    case standard
    /// Stitch RPG direction: lavender/gold palette, deeper night sky and
    /// world-language eyebrows (JOURNEY, AGENDA, SUPPLY …).
    case warrior

    public static let storageKey = "sg.theme"

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .standard: "일반"
        case .warrior: "워리어"
        }
    }

    public var summary: String {
        switch self {
        case .standard: "차분한 기본 화면"
        case .warrior: "RPG 여정 분위기의 색과 장식"
        }
    }

    /// World-language eyebrows are decorative and, as in Stitch, appear in
    /// both themes (owner decision 2026-10-15). They never replace a Korean
    /// label and VoiceOver skips them.
    public var showsWorldLanguage: Bool { true }

    /// Layout-affecting ornaments (the section banner bar). Color-only
    /// ornaments use tokens that are transparent in the standard theme instead.
    public var showsOrnaments: Bool { self == .warrior }
}

private struct SGThemeKey: EnvironmentKey {
    static let defaultValue: SGTheme = .standard
}

public extension EnvironmentValues {
    var sgTheme: SGTheme {
        get { self[SGThemeKey.self] }
        set { self[SGThemeKey.self] = newValue }
    }
}

/// A world-language tag from the Stitch direction ("JOURNEY", "AGENDA",
/// "SUPPLY"). Renders in every theme, always inline next to a
/// Korean label so both themes keep the same geometry, and VoiceOver skips it.
/// Screens never branch on the theme themselves; they place this view.
public struct SGWorldEyebrow: View {
    let text: String
    let tint: SGToken
    @Environment(\.sgTheme) private var theme

    public init(_ text: String, tint: SGToken = SGColor.textTertiary) {
        self.text = text
        self.tint = tint
    }

    public var body: some View {
        if theme.showsWorldLanguage {
            // Whole word or nothing: a clipped "J…" reads as a defect. The
            // Korean label beside it always wins the space (lower priority),
            // so at large Dynamic Type sizes the eyebrow simply drops out.
            ViewThatFits(in: .horizontal) {
                Text(text)
                    .font(SGTypography.eyebrow)
                    .tracking(0.8)
                    .foregroundStyle(.sg(tint))
                    .lineLimit(1)
                    .fixedSize()
                Color.clear.frame(width: 0, height: 0)
            }
            .layoutPriority(-1)
            .accessibilityHidden(true)
        }
    }
}

/// A boxed world-language tag (Stitch "COUNTDOWN PROTOCOL", "CIVIC OS",
/// "NEXT"). Same rules as `SGWorldEyebrow`: decorative, next to Korean,
/// skipped by VoiceOver, dropped when it does not fit.
public struct SGWorldTag: View {
    let text: String
    let tint: SGToken
    let fill: SGToken

    public init(_ text: String, tint: SGToken = SGColor.accent, fill: SGToken = SGColor.surfaceInteractive) {
        self.text = text
        self.tint = tint
        self.fill = fill
    }

    public var body: some View {
        ViewThatFits(in: .horizontal) {
            Text(text)
                .font(SGTypography.eyebrow)
                .tracking(0.8)
                .foregroundStyle(.sg(tint))
                .lineLimit(1)
                .fixedSize()
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(.sg(fill), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
            Color.clear.frame(width: 0, height: 0)
        }
        .layoutPriority(-1)
        .accessibilityHidden(true)
    }
}
