import SGCore
import SGDesignSystem
import SwiftUI

/// Stitch app header, on every tab: mark, SUPER GONGIK, the service state,
/// the D-day pill and the profile button. `openProfile` is nil on 내 정보
/// itself, where the button would lead nowhere.
struct AppHeader: View {
    let hero: HomeModel.Hero?
    var openProfile: (() -> Void)? = nil
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.sgTheme) private var theme

    var body: some View {
        HStack(spacing: SGSpacing.xs) {
            identity
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isHeader)
            // Stitch: the profile button at the trailing edge opens 내 정보.
            // A generic glyph only: no photo or name (STITCH-IMPLEMENTATION-PLAN).
            if let openProfile {
                Button(action: openProfile) {
                    StitchIcon("person", size: 18)
                        .foregroundStyle(.white)
                        .frame(width: 32, height: 32)
                        .background(.sg(SGColor.heroBackground), in: Circle())
                        .frame(width: SGSpacing.minimumHitTarget, height: SGSpacing.minimumHitTarget)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("내 정보")
            }
        }
        .padding(.top, SGSpacing.xs)
        // The header is chrome, like a navigation bar: it stops growing at
        // xxLarge so the brand, state and D-day pill keep one line.
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }

    /// The world labels (CIVIC OS, ACTIVE // DUTY_SYNC) fit a 375 pt row up
    /// to the default text size. Larger sizes drop them as a whole: a
    /// ViewThatFits here collapsed even when there was room (it sits next to
    /// a Spacer), and a fixed label pushed the header past the screen edge.
    private var roomForWorld: Bool { typeSize <= .large }

    /// Stitch status line: "ACTIVE // DUTY_SYNC" while serving. The Korean
    /// state stays first; the world label follows it.
    private var worldState: String {
        switch hero?.phase {
        case "PRE_SERVICE": "STANDBY"
        case "DISCHARGE_DAY": "FINAL // RELEASE"
        case "COMPLETED": "COMPLETE"
        default: "ACTIVE // DUTY_SYNC"
        }
    }

    private var identity: some View {
        HStack(spacing: SGSpacing.xs) {
            Image("BrandMark")
                .resizable()
                .frame(width: 36, height: 36)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: SGSpacing.xxs) {
                    Text("SUPER GONGIK")
                        .font(SGTypography.latin(.display, 17, .heavy, relativeTo: .headline))
                        .tracking(-0.4)
                        .foregroundStyle(.sg(SGColor.textPrimary))
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                    if roomForWorld {
                        WorldText("CIVIC OS", tint: SGColor.accent)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(.sg(SGColor.surfaceInteractive), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                            .overlay {
                                // Warrior: Stitch's gold-edged CIVIC OS chip.
                                if theme == .warrior {
                                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                                        .strokeBorder(.sg(SGColor.ornament).opacity(0.7))
                                }
                            }
                    }
                }
                HStack(spacing: 6) {
                    SGPulseDot(theme == .warrior ? SGGlow.emerald : RGB(0x2E9E7A).color, size: 6)
                    Text(hero?.stateLabel ?? "")
                        .font(SGTypography.micro)
                        .foregroundStyle(.sg(SGColor.textSecondary))
                        .lineLimit(1)
                        .fixedSize()
                    if roomForWorld {
                        WorldText(worldState, tint: SGColor.textSecondary)
                    }
                }
            }
            // Ahead of the spacer, so the world labels get their room first.
            .layoutPriority(1)
            Spacer(minLength: SGSpacing.xs)
            if let hero, !typeSize.isAccessibilitySize {
                // Stitch D-day pill: schedule glyph + D-day.
                HStack(spacing: 6) {
                    StitchIcon("schedule", size: 16)
                        .foregroundStyle(.sg(SGColor.accent))
                    // Plus Jakarta Sans: Space Grotesk's tabular "1" has a
                    // slab foot and read as a broken glyph in "D-421".
                    Text(hero.headline)
                        .font(SGTypography.latin(.display, 13, .bold, relativeTo: .caption))
                        .monospacedDigit()
                        .lineLimit(1)
                        .foregroundStyle(.sg(SGColor.textPrimary))
                }
                .padding(.horizontal, 10)
                .frame(height: 32)
                .background(.sg(SGColor.surfaceInteractive), in: Capsule())
                .fixedSize()
                .accessibilityHidden(true)
            }
        }
    }
}

/// A header world label, shown only while `roomForWorld` holds.
/// Decorative, so VoiceOver skips it.
private struct WorldText: View {
    let text: String
    let tint: SGToken

    init(_ text: String, tint: SGToken) {
        self.text = text
        self.tint = tint
    }

    var body: some View {
        Text(text)
            .font(SGTypography.eyebrow)
            .tracking(0.8)
            .foregroundStyle(.sg(tint))
            .lineLimit(1)
            .fixedSize()
            .accessibilityHidden(true)
    }
}

/// A Material Symbols glyph from the Stitch source (Apache 2.0, asset
/// catalog `Stitch/ms.*`), tinted with `foregroundStyle` like an SF Symbol.
struct StitchIcon: View {
    let name: String
    let size: CGFloat
    var filled = false
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

    init(_ name: String, size: CGFloat = 18, filled: Bool = false) {
        self.name = name
        self.size = size
        self.filled = filled
    }

    var body: some View {
        Image("ms.\(name)\(filled ? ".fill" : "")")
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: size * scale, height: size * scale)
            .accessibilityHidden(true)
    }
}

/// Stitch screen title under the app header: the Korean title, the world
/// label (Warrior only, via `SGWorldEyebrow`) and trailing controls.
///
/// The title never wraps or shrinks: at accessibility text sizes the controls
/// move to a second row instead, so "캘린더" cannot break into "캘린 / 더"
/// beside three buttons (seen at accessibility-extra-extra-large on 393 pt).
/// The decorative world chip is the first thing to go when room is short.
struct ScreenTitle<Trailing: View>: View {
    let title: String
    var world: String? = nil
    @ViewBuilder var trailing: Trailing
    @Environment(\.dynamicTypeSize) private var typeSize

    /// Two rows from the first accessibility size on; one row below it.
    static func stacks(_ size: DynamicTypeSize) -> Bool { size.isAccessibilitySize }

    var body: some View {
        if Self.stacks(typeSize) {
            VStack(alignment: .leading, spacing: SGSpacing.xs) {
                heading(world: nil)
                HStack(spacing: SGSpacing.xs) {
                    trailing
                    Spacer(minLength: 0)
                }
            }
        } else {
            HStack(alignment: .center, spacing: SGSpacing.xs) {
                // Stitch: the world label sits beside the title as a chip.
                ViewThatFits(in: .horizontal) {
                    heading(world: world)
                    heading(world: nil)
                }
                .layoutPriority(1)
                Spacer(minLength: SGSpacing.xs)
                trailing
            }
        }
    }

    private func heading(world: String?) -> some View {
        HStack(spacing: SGSpacing.xs) {
            Text(title)
                .font(SGTypography.title1)
                .foregroundStyle(.sg(SGColor.textPrimary))
                .fixedSize(horizontal: true, vertical: false)
                .accessibilityAddTraits(.isHeader)
            if let world { SGWorldTag(world) }
        }
    }
}

extension ScreenTitle where Trailing == EmptyView {
    init(title: String, world: String? = nil) {
        self.init(title: title, world: world) { EmptyView() }
    }
}
