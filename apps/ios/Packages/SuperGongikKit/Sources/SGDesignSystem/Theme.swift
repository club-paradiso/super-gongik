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
        case .warrior: "RPG 여정 분위기 · 세계관 라벨 표시"
        }
    }

    /// World-language eyebrows are decorative and appear only here. They never
    /// replace a Korean label and VoiceOver skips them.
    public var showsWorldLanguage: Bool { self == .warrior }
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
/// "SUPPLY"). Renders only in the Warrior theme, always inline next to a
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
            Text(text)
                .font(SGTypography.eyebrow)
                .tracking(0.8)
                .foregroundStyle(.sg(tint))
                .lineLimit(1)
                // The Korean label beside it always wins the space.
                .layoutPriority(-1)
                .accessibilityHidden(true)
        }
    }
}
