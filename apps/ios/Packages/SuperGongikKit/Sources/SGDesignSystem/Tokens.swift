import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// 4-point spacing grid (HORIZON `--space-*`).
public enum SGSpacing {
    public static let xxs: CGFloat = 4
    public static let xs: CGFloat = 8
    public static let sm: CGFloat = 12
    public static let md: CGFloat = 16
    public static let lg: CGFloat = 20
    public static let xl: CGFloat = 24
    public static let xxl: CGFloat = 32
    /// Screen side gutter.
    public static let gutter: CGFloat = 16
    /// Minimum hit target (HIG 44 pt).
    public static let minimumHitTarget: CGFloat = 44
}

/// Radius grows with importance: control → card → elevated → hero.
public enum SGRadius {
    public static let xs: CGFloat = 6
    public static let small: CGFloat = 8
    public static let control: CGFloat = 12
    public static let card: CGFloat = 16
    public static let cardLarge: CGFloat = 20
    public static let sheet: CGFloat = 24
    public static let hero: CGFloat = 28
}

/// Motion. Durations from `--duration-*`; every animation goes through
/// `SGMotion.animation(_:reduceMotion:)` so Reduce Motion removes
/// interpolation without changing what is shown.
public enum SGMotion {
    public static let fast: Double = 0.12
    public static let base: Double = 0.18
    public static let slow: Double = 0.32

    public static func animation(_ duration: Double = base, reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .timingCurve(0.2, 0.8, 0.2, 1, duration: duration)
    }
}

/// Elevation. Light mode uses soft shadows; dark mode separates with borders
/// (HORIZON: "borders instead of shadows" at night), so shadows fade out there.
public enum SGShadow {
    case small, card, raised, hero

    var radius: CGFloat {
        switch self {
        case .small: 1
        case .card: 7
        case .raised: 20
        case .hero: 20
        }
    }

    var y: CGFloat {
        switch self {
        case .small: 1
        case .card: 4
        case .raised: 16
        case .hero: 18
        }
    }

    var opacity: Double {
        switch self {
        case .small: 0.06
        case .card: 0.05
        case .raised: 0.18
        case .hero: 0.35
        }
    }
}

public extension View {
    func sgShadow(_ shadow: SGShadow) -> some View {
        modifier(SGShadowModifier(shadow: shadow))
    }
}

private struct SGShadowModifier: ViewModifier {
    let shadow: SGShadow
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content.shadow(
            color: Color(.sRGB, red: 9 / 255, green: 12 / 255, blue: 28 / 255, opacity: colorScheme == .dark ? 0 : shadow.opacity),
            radius: shadow.radius, x: 0, y: shadow.y)
    }
}

/// Typography. Pretendard (bundled by the app, OFL) when registered, the
/// system font otherwise (widgets). Every style scales with Dynamic Type via
/// `relativeTo`; numbers use tabular figures so ticking values do not jitter.
public enum SGTypography {
    public enum Weight: String, Sendable {
        case regular = "Regular", medium = "Medium", semibold = "SemiBold", bold = "Bold", heavy = "ExtraBold"

        var system: Font.Weight {
            switch self {
            case .regular: .regular
            case .medium: .medium
            case .semibold: .semibold
            case .bold: .bold
            case .heavy: .heavy
            }
        }
    }

    public static var isPretendardAvailable: Bool {
        #if canImport(UIKit)
        UIFont(name: "Pretendard-Regular", size: 12) != nil
        #else
        false
        #endif
    }

    public static func font(_ size: CGFloat, _ weight: Weight, relativeTo style: Font.TextStyle) -> Font {
        if isPretendardAvailable {
            return .custom("Pretendard-\(weight.rawValue)", size: size, relativeTo: style)
        }
        return .system(style, design: .default, weight: weight.system)
    }

    /// Hero D-day number. Large but still scales (capped by the hero layout).
    public static let display = font(60, .heavy, relativeTo: .largeTitle)
    public static let title1 = font(26, .heavy, relativeTo: .title)
    public static let title2 = font(22, .bold, relativeTo: .title2)
    public static let title3 = font(18, .bold, relativeTo: .title3)
    public static let sectionTitle = font(20, .heavy, relativeTo: .title3)
    public static let cardTitle = font(17, .heavy, relativeTo: .headline)
    public static let body = font(15, .regular, relativeTo: .subheadline)
    public static let bodyStrong = font(15, .semibold, relativeTo: .subheadline)
    public static let label = font(14, .semibold, relativeTo: .subheadline)
    public static let caption = font(13, .medium, relativeTo: .footnote)
    public static let micro = font(12, .bold, relativeTo: .caption)
    public static let statValue = font(22, .heavy, relativeTo: .title2)
}
