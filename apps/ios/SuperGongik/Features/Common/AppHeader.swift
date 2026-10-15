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
    }

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
                    if !typeSize.isAccessibilitySize {
                        WorldText("CIVIC OS", tint: SGColor.accent)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(.sg(SGColor.surfaceInteractive), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                    }
                }
                HStack(spacing: 6) {
                    Circle().fill(.sg(SGColor.success))
                        .frame(width: 6, height: 6)
                        .accessibilityHidden(true)
                    Text(hero?.stateLabel ?? "")
                        .font(SGTypography.micro)
                        .foregroundStyle(.sg(SGColor.textSecondary))
                        .lineLimit(1)
                        .fixedSize()
                    if !typeSize.isAccessibilitySize {
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
                    Text(hero.headline)
                        .font(SGTypography.latinLabel)
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

/// A world label that never collapses (the header has room for it at
/// every non-accessibility size). Decorative, so VoiceOver skips it.
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
struct ScreenTitle<Trailing: View>: View {
    let title: String
    var world: String? = nil
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .center, spacing: SGSpacing.xs) {
            // Stitch: the world label sits beside the title as a chip.
            HStack(spacing: SGSpacing.xs) {
                Text(title)
                    .font(SGTypography.title1)
                    .foregroundStyle(.sg(SGColor.textPrimary))
                    .accessibilityAddTraits(.isHeader)
                if let world { SGWorldTag(world) }
            }
            .layoutPriority(1)
            Spacer(minLength: SGSpacing.xs)
            trailing
        }
    }
}

extension ScreenTitle where Trailing == EmptyView {
    init(title: String, world: String? = nil) {
        self.init(title: title, world: world) { EmptyView() }
    }
}
