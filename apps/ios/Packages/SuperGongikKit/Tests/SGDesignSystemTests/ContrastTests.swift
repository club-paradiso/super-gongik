import Testing
@testable import SGDesignSystem

/// The HORIZON hex values were tuned for the web. iOS renders the same sRGB
/// values, but contrast is verified here rather than assumed (WCAG 2.x).
@Suite("HORIZON contrast on iOS")
struct ContrastTests {
    struct Pair: CustomTestStringConvertible, Sendable {
        let name: String
        let foreground: SGToken
        let background: SGToken
        let minimum: Double
        var testDescription: String { name }
    }

    static let textPairs: [Pair] = [
        Pair(name: "primary on background", foreground: SGColor.textPrimary, background: SGColor.background, minimum: 4.5),
        Pair(name: "primary on surface", foreground: SGColor.textPrimary, background: SGColor.surface, minimum: 4.5),
        Pair(name: "secondary on surface", foreground: SGColor.textSecondary, background: SGColor.surface, minimum: 4.5),
        Pair(name: "secondary on background", foreground: SGColor.textSecondary, background: SGColor.background, minimum: 4.5),
        Pair(name: "tertiary on surface", foreground: SGColor.textTertiary, background: SGColor.surface, minimum: 4.5),
        Pair(name: "tertiary on background", foreground: SGColor.textTertiary, background: SGColor.background, minimum: 4.5),
        Pair(name: "accent on surface", foreground: SGColor.accent, background: SGColor.surface, minimum: 4.5),
        Pair(name: "accent on interactive", foreground: SGColor.accent, background: SGColor.surfaceInteractive, minimum: 4.5),
        Pair(name: "on-accent on accent", foreground: SGColor.onAccent, background: SGColor.accent, minimum: 4.5),
        Pair(name: "success on tint", foreground: SGColor.success, background: SGColor.successBackground, minimum: 4.5),
        Pair(name: "warning on tint", foreground: SGColor.warning, background: SGColor.warningBackground, minimum: 4.5),
        Pair(name: "danger on tint", foreground: SGColor.danger, background: SGColor.dangerBackground, minimum: 4.5),
        Pair(name: "info on tint", foreground: SGColor.info, background: SGColor.infoBackground, minimum: 4.5),
        Pair(name: "hero fg on hero", foreground: SGColor.heroForeground, background: SGColor.heroBackground, minimum: 4.5),
        Pair(name: "hero fg2 on hero", foreground: SGColor.heroForeground2, background: SGColor.heroBackground, minimum: 4.5),
        Pair(name: "hero fg3 on hero", foreground: SGColor.heroForeground3, background: SGColor.heroBackground, minimum: 4.5),
        Pair(name: "hero accent on hero", foreground: SGColor.heroAccent, background: SGColor.heroBackground, minimum: 4.5),
    ] + SGEventCategory.allCases.map {
        Pair(name: "\($0.rawValue) chip text", foreground: $0.chipForeground, background: $0.chipBackground, minimum: 4.5)
    }

    @Test("text pairs meet WCAG AA in light and dark", arguments: textPairs)
    func text(pair: Pair) {
        let light = RGB.contrast(pair.foreground.light, pair.background.light)
        let dark = RGB.contrast(pair.foreground.dark, pair.background.dark)
        #expect(light >= pair.minimum, "light \(pair.name): \(light)")
        #expect(dark >= pair.minimum, "dark \(pair.name): \(dark)")
    }

    @Test("high-contrast variants are at least as strong", arguments: textPairs)
    func highContrast(pair: Pair) {
        let fg = pair.foreground, bg = pair.background
        let light = RGB.contrast(fg.lightHighContrast ?? fg.light, bg.lightHighContrast ?? bg.light)
        let dark = RGB.contrast(fg.darkHighContrast ?? fg.dark, bg.darkHighContrast ?? bg.dark)
        #expect(light >= RGB.contrast(fg.light, bg.light) - 0.001)
        #expect(dark >= RGB.contrast(fg.dark, bg.dark) - 0.001)
    }

    @Test("category marks are distinguishable from the surface (non-text, 3:1)", arguments: SGEventCategory.allCases)
    func marks(category: SGEventCategory) {
        #expect(RGB.contrast(category.mark.light, SGColor.surface.light) >= 3)
        #expect(RGB.contrast(category.mark.dark, SGColor.surface.dark) >= 3)
    }
}
