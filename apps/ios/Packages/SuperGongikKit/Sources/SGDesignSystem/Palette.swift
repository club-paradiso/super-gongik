import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// An sRGB color as the HORIZON tokens define it. Kept as numbers (not only as
/// `Color`) so contrast can be verified in tests instead of assumed.
public struct RGB: Hashable, Sendable {
    public let red: Double, green: Double, blue: Double, alpha: Double

    public init(_ hex: UInt32, alpha: Double = 1) {
        red = Double((hex >> 16) & 0xff) / 255
        green = Double((hex >> 8) & 0xff) / 255
        blue = Double(hex & 0xff) / 255
        self.alpha = alpha
    }

    /// WCAG 2.x relative luminance.
    public var luminance: Double {
        func channel(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
    }

    public static func contrast(_ a: RGB, _ b: RGB) -> Double {
        let (l1, l2) = (max(a.luminance, b.luminance), min(a.luminance, b.luminance))
        return (l1 + 0.05) / (l2 + 0.05)
    }

    public var color: Color { Color(.sRGB, red: red, green: green, blue: blue, opacity: alpha) }
}

/// A semantic token: one value per appearance, with an optional stronger value
/// for Increase Contrast and an optional value for the Warrior theme.
public struct SGToken: Hashable, Sendable {
    public let light: RGB
    public let dark: RGB
    public let lightHighContrast: RGB?
    public let darkHighContrast: RGB?
    /// Warrior theme values (Stitch RPG direction). `nil` keeps the standard value.
    public let warriorLight: RGB?
    public let warriorDark: RGB?

    public init(_ light: UInt32, _ dark: UInt32, highContrast: (light: UInt32, dark: UInt32)? = nil,
                warrior: (light: UInt32, dark: UInt32)? = nil) {
        self.light = RGB(light)
        self.dark = RGB(dark)
        self.lightHighContrast = highContrast.map { RGB($0.light) }
        self.darkHighContrast = highContrast.map { RGB($0.dark) }
        self.warriorLight = warrior.map { RGB($0.light) }
        self.warriorDark = warrior.map { RGB($0.dark) }
    }

    public init(fixed: UInt32, alpha: Double = 1) {
        light = RGB(fixed, alpha: alpha)
        dark = light
        lightHighContrast = nil
        darkHighContrast = nil
        warriorLight = nil
        warriorDark = nil
    }

    /// The value for one theme, appearance and contrast. A Warrior value wins
    /// over the standard high-contrast value: Warrior values are themselves
    /// checked against WCAG AA in `ContrastTests`.
    public func rgb(theme: SGTheme = .standard, dark isDark: Bool, highContrast: Bool = false) -> RGB {
        if theme == .warrior, let value = isDark ? warriorDark : warriorLight { return value }
        if highContrast, let value = isDark ? darkHighContrast : lightHighContrast { return value }
        return isDark ? dark : light
    }

    /// Standard-theme color that follows appearance and Increase Contrast.
    /// Views use `.sg(token)` instead, which also follows the theme.
    public var color: Color {
        let token = self
        #if canImport(UIKit)
        return Color(uiColor: UIColor { traits in
            let value = token.rgb(dark: traits.userInterfaceStyle == .dark, highContrast: traits.accessibilityContrast == .high)
            return UIColor(red: value.red, green: value.green, blue: value.blue, alpha: value.alpha)
        })
        #else
        return Color(nsColor: NSColor(name: nil) { appearance in
            let value = token.rgb(dark: appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua)
            return NSColor(srgbRed: value.red, green: value.green, blue: value.blue, alpha: value.alpha)
        })
        #endif
    }
}

/// HORIZON brand palette, extracted from the official logo (docs/design/horizon.md).
/// Brand colors are identity anchors; screens use the semantic tokens below.
public enum SGBrand {
    public static let midnight = RGB(0x090C1C)
    public static let night = RGB(0x181B42)
    public static let navy = RGB(0x081F68)
    public static let indigo = RGB(0x1E2D78)
    public static let violet = RGB(0x3C348E)
    public static let ivory = RGB(0xFEF1D3)
    public static let sun = RGB(0xFDCF7C)
    public static let ember = RGB(0xFDA870)
    public static let coral = RGB(0xE2686E)
}

/// Semantic color tokens. Light/dark values come from
/// `apps/web/src/app/tokens.css`; high-contrast values are native additions;
/// Warrior values come from the Stitch RPG screens (Figma page 40, mode
/// "Warrior Light/Dark" on page 50). All are verified in `SGDesignSystemTests`.
public enum SGColor {
    // Canvas and surfaces
    public static let background = SGToken(0xF3F4F8, 0x0A0D20, warrior: (0xFBF8FF, 0x090C1C))
    public static let backgroundElevated = SGToken(0xECEEF5, 0x10142C, warrior: (0xF3F0FD, 0x0C0F28))
    public static let surface = SGToken(0xFFFFFF, 0x151A35, warrior: (0xFFFFFF, 0x13173D))
    public static let surfaceRaised = SGToken(0xFFFFFF, 0x1C2242, warrior: (0xFFFFFF, 0x1B204E))
    public static let surfaceInteractive = SGToken(0xECEEF6, 0x222A4D, warrior: (0xEEECFF, 0x282D5E))
    public static let border = SGToken(0xDFE2EC, 0x2C3458, highContrast: (0x9AA1BA, 0x5A6390), warrior: (0xE3DFFF, 0x282D5E))
    public static let borderStrong = SGToken(0xC5CADB, 0x3D4671, highContrast: (0x7C84A3, 0x6B75A0), warrior: (0xC9C3F0, 0x3B4178))

    // Text
    public static let textPrimary = SGToken(0x111735, 0xF3EFE6, warrior: (0x14173E, 0xFEF1D3))
    public static let textSecondary = SGToken(0x474E6A, 0xC3C8DC, highContrast: (0x2F3552, 0xE0E3EE), warrior: (0x454651, 0xCBD5E1))
    public static let textTertiary = SGToken(0x5C6380, 0xA0A8C6, highContrast: (0x3D4462, 0xC9CEE0), warrior: (0x5E5F6B, 0x94A3B8))

    // Interaction
    public static let accent = SGToken(0x2740A0, 0xA9B8FF, highContrast: (0x1A2D7C, 0xC6D0FF), warrior: (0x4F48A3, 0xFDCF7C))
    public static let accentSecondary = SGToken(0x4A3FA6, 0xBDB3F5, warrior: (0x000C3F, 0xC7D2FE))
    public static let accentWarm = SGToken(0x8A5200, 0xFDCF7C)
    public static let onAccent = SGToken(0xFFFFFF, 0x0A1030, warrior: (0xFFFFFF, 0x090C1C))
    public static let selectedBackground = SGToken(0xE7EBFB, 0x1F2A5C, warrior: (0xE7E6FF, 0x1E2568))
    public static let selectedBorder = SGToken(0x9DADEA, 0x5D6FC4, warrior: (0x9D97E0, 0xFDCF7C))

    // Feedback — always paired with text or a symbol, never color alone.
    public static let success = SGToken(0x146150, 0x84DCBB)
    public static let successBackground = SGToken(0xE4F3EC, 0x143A33)
    public static let warning = SGToken(0x7D4E05, 0xF5C97F)
    public static let warningBackground = SGToken(0xFFF2DC, 0x372C1D)
    public static let warningBorder = SGToken(0xDCB46F, 0x8B6C40)
    public static let danger = SGToken(0xAD2C43, 0xFFA9B5)
    public static let dangerBackground = SGToken(0xFBE8EC, 0x3F2230)
    public static let dangerBorder = SGToken(0xDC9DAB, 0x9B5D6D)
    public static let info = SGToken(0x22539F, 0xA9C6FF)
    public static let infoBackground = SGToken(0xE7EEFB, 0x1C2E52)

    // Hero: always the night sky, in both appearances.
    public static let heroBackground = SGToken(fixed: 0x0C1446)
    public static let heroForeground = SGToken(fixed: 0xFEF1D3)
    public static let heroForeground2 = SGToken(fixed: 0xD3D8EF)
    public static let heroForeground3 = SGToken(fixed: 0xAAB3D6)
    public static let heroAccent = SGToken(fixed: 0xFDCF7C)
    public static let heroAccentStrong = SGToken(fixed: 0xFDA870)
    public static let heroTrack = SGToken(fixed: 0xD3D8EF, alpha: 0.18)
    public static let heroLine = SGToken(fixed: 0xD3D8EF, alpha: 0.16)
    /// Hairline that lifts the hero edge off a dark canvas.
    public static let heroBorder = SGToken(fixed: 0xFFFFFF, alpha: 0.08)
}

/// A token as a shape style. Resolves per view from the environment: theme
/// (`\.sgTheme`), appearance and Increase Contrast.
public struct SGStyle: ShapeStyle, Sendable {
    let token: SGToken

    public func resolve(in environment: EnvironmentValues) -> Color {
        let value = token.rgb(
            theme: environment.sgTheme,
            dark: environment.colorScheme == .dark,
            highContrast: environment.colorSchemeContrast == .increased)
        return Color(.sRGB, red: value.red, green: value.green, blue: value.blue, opacity: value.alpha)
    }
}

public extension ShapeStyle where Self == SGStyle {
    static func sg(_ token: SGToken) -> SGStyle { SGStyle(token: token) }
}
