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
/// for Increase Contrast.
public struct SGToken: Hashable, Sendable {
    public let light: RGB
    public let dark: RGB
    public let lightHighContrast: RGB?
    public let darkHighContrast: RGB?

    public init(_ light: UInt32, _ dark: UInt32, highContrast: (light: UInt32, dark: UInt32)? = nil) {
        self.light = RGB(light)
        self.dark = RGB(dark)
        self.lightHighContrast = highContrast.map { RGB($0.light) }
        self.darkHighContrast = highContrast.map { RGB($0.dark) }
    }

    public init(fixed: UInt32, alpha: Double = 1) {
        light = RGB(fixed, alpha: alpha)
        dark = light
        lightHighContrast = nil
        darkHighContrast = nil
    }

    public var color: Color {
        #if canImport(UIKit)
        let light = light, dark = dark
        let lightHC = lightHighContrast ?? light, darkHC = darkHighContrast ?? dark
        return Color(uiColor: UIColor { traits in
            let isDark = traits.userInterfaceStyle == .dark
            let high = traits.accessibilityContrast == .high
            let value = isDark ? (high ? darkHC : dark) : (high ? lightHC : light)
            return UIColor(red: value.red, green: value.green, blue: value.blue, alpha: value.alpha)
        })
        #else
        let light = light, dark = dark
        return Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            let value = isDark ? dark : light
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
/// `apps/web/src/app/tokens.css`; high-contrast values are native additions,
/// verified in `SGDesignSystemTests`.
public enum SGColor {
    // Canvas and surfaces
    public static let background = SGToken(0xF3F4F8, 0x0A0D20)
    public static let backgroundElevated = SGToken(0xECEEF5, 0x10142C)
    public static let surface = SGToken(0xFFFFFF, 0x151A35)
    public static let surfaceRaised = SGToken(0xFFFFFF, 0x1C2242)
    public static let surfaceInteractive = SGToken(0xECEEF6, 0x222A4D)
    public static let border = SGToken(0xDFE2EC, 0x2C3458, highContrast: (0x9AA1BA, 0x5A6390))
    public static let borderStrong = SGToken(0xC5CADB, 0x3D4671, highContrast: (0x7C84A3, 0x6B75A0))

    // Text
    public static let textPrimary = SGToken(0x111735, 0xF3EFE6)
    public static let textSecondary = SGToken(0x474E6A, 0xC3C8DC, highContrast: (0x2F3552, 0xE0E3EE))
    public static let textTertiary = SGToken(0x5C6380, 0xA0A8C6, highContrast: (0x3D4462, 0xC9CEE0))

    // Interaction
    public static let accent = SGToken(0x2740A0, 0xA9B8FF, highContrast: (0x1A2D7C, 0xC6D0FF))
    public static let accentSecondary = SGToken(0x4A3FA6, 0xBDB3F5)
    public static let accentWarm = SGToken(0x8A5200, 0xFDCF7C)
    public static let onAccent = SGToken(0xFFFFFF, 0x0A1030)
    public static let selectedBackground = SGToken(0xE7EBFB, 0x1F2A5C)
    public static let selectedBorder = SGToken(0x9DADEA, 0x5D6FC4)

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
}

public extension ShapeStyle where Self == Color {
    static func sg(_ token: SGToken) -> Color { token.color }
}
