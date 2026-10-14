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
        HStack(spacing: SGSpacing.sm) {
            identity
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isHeader)
            // Stitch: the profile button at the trailing edge opens 내 정보.
            // A generic glyph only: no photo or name (STITCH-IMPLEMENTATION-PLAN).
            if let openProfile {
                Button(action: openProfile) {
                    Image(systemName: "person.fill")
                        .font(SGTypography.label)
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
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

    private var identity: some View {
        HStack(spacing: SGSpacing.sm) {
            Image("BrandMark")
                .resizable()
                .frame(width: 40, height: 40)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: SGSpacing.xxxs) {
                Text("SUPER GONGIK")
                    .font(SGTypography.cardTitle)
                    .foregroundStyle(.sg(SGColor.textPrimary))
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                HStack(spacing: SGSpacing.iconGap) {
                    Circle().fill(.sg(SGColor.success))
                        .frame(width: SGSize.statusDot, height: SGSize.statusDot)
                        .accessibilityHidden(true)
                    Text(hero?.stateLabel ?? "")
                        .font(SGTypography.micro)
                        .foregroundStyle(.sg(SGColor.textSecondary))
                    SGWorldEyebrow("ACTIVE DUTY")
                }
            }
            Spacer(minLength: SGSpacing.xs)
            if let hero, !typeSize.isAccessibilitySize {
                // Stitch D-day pill: clock glyph + D-day.
                HStack(spacing: SGSpacing.iconGap) {
                    Image(systemName: "clock")
                        .font(SGTypography.micro)
                        .foregroundStyle(.sg(SGColor.accent))
                    Text(hero.headline)
                        .font(SGTypography.label)
                        .monospacedDigit()
                        .lineLimit(1)
                        .foregroundStyle(.sg(SGColor.textPrimary))
                }
                .padding(.horizontal, SGSpacing.sm)
                .padding(.vertical, SGSpacing.xxs)
                .background(.sg(SGColor.surfaceRaised), in: Capsule())
                .overlay(Capsule().strokeBorder(.sg(SGColor.border)))
                .accessibilityHidden(true)
            }
        }
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
            VStack(alignment: .leading, spacing: SGSpacing.xxxs) {
                Text(title)
                    .font(SGTypography.title1)
                    .foregroundStyle(.sg(SGColor.textPrimary))
                    .accessibilityAddTraits(.isHeader)
                if let world { SGWorldEyebrow(world) }
            }
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
