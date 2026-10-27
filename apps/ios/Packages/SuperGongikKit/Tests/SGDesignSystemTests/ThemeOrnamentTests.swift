import Testing
@testable import SGDesignSystem

/// Warrior ornaments are tokens that are transparent in the standard theme, so
/// one component draws both themes with the same geometry and the standard
/// theme never shows a Warrior decoration.
@Suite("Warrior ornaments")
struct ThemeOrnamentTests {
    static let ornaments: [SGToken] = [SGColor.ornament, SGColor.ornamentSoft, SGColor.heroOrnament, SGColor.heroHalo]

    @Test("ornaments are invisible in the standard theme", arguments: ornaments)
    func standardIsTransparent(token: SGToken) {
        for dark in [false, true] {
            for highContrast in [false, true] {
                #expect(token.rgb(theme: .standard, dark: dark, highContrast: highContrast).alpha == 0)
            }
        }
    }

    @Test("ornaments are visible in the Warrior theme", arguments: ornaments)
    func warriorIsVisible(token: SGToken) {
        for dark in [false, true] {
            #expect(token.rgb(theme: .warrior, dark: dark).alpha > 0)
            // Increase Contrast keeps the Warrior value rather than falling back.
            #expect(token.rgb(theme: .warrior, dark: dark, highContrast: true).alpha > 0)
        }
    }

    @Test("the gilded hairline stays visible on Warrior plates (non-text, 3:1)")
    func gildedHairline() {
        for dark in [false, true] {
            let ring = SGColor.ornament.rgb(theme: .warrior, dark: dark)
            #expect(RGB.contrast(ring, SGColor.surface.rgb(theme: .warrior, dark: dark)) >= 3)
        }
    }

    @Test("Warrior light has its own canvas, not the standard one")
    func warriorCanvas() {
        let warrior = SGColor.background.rgb(theme: .warrior, dark: false)
        #expect(warrior != SGColor.background.light)
        // Plates read on the canvas: the surface is lighter than the canvas.
        #expect(SGColor.surface.rgb(theme: .warrior, dark: false).luminance > warrior.luminance)
    }

    @Test("only Warrior shows layout-affecting ornaments and the English world language")
    func themeFlags() {
        #expect(SGTheme.warrior.showsOrnaments && !SGTheme.standard.showsOrnaments)
        #expect(SGTheme.warrior.showsWorldLanguage && !SGTheme.standard.showsWorldLanguage)
    }
}
