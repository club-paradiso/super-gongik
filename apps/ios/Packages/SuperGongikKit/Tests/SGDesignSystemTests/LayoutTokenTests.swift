import CoreGraphics
import Testing
@testable import SGDesignSystem

/// Responsive rules from docs/design/DESIGN-SYSTEM-MAPPING.md, checked so a
/// token edit cannot quietly reintroduce a device-width layout.
@Suite("Layout tokens")
struct LayoutTokenTests {
    /// Point widths of the iPhones the canonical Figma screens are checked at.
    static let iPhoneWidths: [CGFloat] = [375, 390, 393, 402, 430]

    @Test("every iPhone gets the full-width column", arguments: iPhoneWidths)
    func fullWidthOnIPhone(width: CGFloat) {
        #expect(width - 2 * SGSpacing.gutter <= SGLayout.readableWidth)
        #expect(width - 2 * SGSpacing.gutter <= SGLayout.focusedWidth)
    }

    @Test("interactive sizes respect the 44 pt minimum")
    func hitTargets() {
        #expect(SGSpacing.minimumHitTarget >= 44)
        #expect(SGSize.primaryControl >= SGSpacing.minimumHitTarget)
        #expect(SGSize.control >= SGSpacing.minimumHitTarget)
        #expect(SGSize.rowMinHeight >= SGSpacing.minimumHitTarget)
        #expect(SGSize.dateTile >= SGSpacing.minimumHitTarget)
    }

    @Test("spacing stays on the 2 pt half-grid")
    func spacingGrid() {
        let values: [CGFloat] = [
            SGSpacing.xxxs, SGSpacing.xxs, SGSpacing.iconGap, SGSpacing.xs, SGSpacing.sm,
            SGSpacing.md, SGSpacing.lg, SGSpacing.xl, SGSpacing.xxl, SGSpacing.gutter,
        ]
        for value in values { #expect(value.truncatingRemainder(dividingBy: 2) == 0) }
    }

    @Test("radius grows with importance")
    func radiusOrder() {
        let ladder = [SGRadius.xs, SGRadius.small, SGRadius.control, SGRadius.card, SGRadius.cardLarge, SGRadius.sheet, SGRadius.hero]
        #expect(ladder == ladder.sorted())
    }
}
