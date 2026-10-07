import SwiftUI

// Composite patterns shared by the tab screens. Each one is the code side of a
// component on the Figma page "51 · iOS Production — Components"; the mapping
// is in docs/design/DESIGN-SYSTEM-MAPPING.md. Patterns own layout and look
// only: every string and number they show is passed in by the screen, which
// reads it from the shared core.

/// Press feedback for card-sized buttons: a slight scale, none with Reduce Motion.
public struct SGPressableStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .animation(SGMotion.animation(SGMotion.fast, reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

/// Label whose symbol carries the accent color and whose title keeps the
/// surrounding foreground.
public struct SGTintedIconLabelStyle: LabelStyle {
    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: SGSpacing.iconGap) {
            configuration.icon.foregroundStyle(.sg(SGColor.accent))
            configuration.title
        }
    }
}

/// Status = tone color + symbol + text, never color alone.
public struct SGStatusBadge: View {
    let tone: SGTone
    let text: String
    let symbol: String?

    /// `symbol` defaults to the tone's symbol.
    public init(_ tone: SGTone, _ text: String, symbol: String? = nil) {
        self.tone = tone
        self.text = text
        self.symbol = symbol
    }

    public var body: some View {
        HStack(spacing: SGSpacing.xxs) {
            Image(systemName: symbol ?? tone.symbol)
                .imageScale(.small)
                .accessibilityHidden(true)
            Text(text).lineLimit(1)
        }
        .font(SGTypography.micro)
        .foregroundStyle(.sg(tone.foreground))
        .padding(.horizontal, SGSpacing.xs)
        .frame(minHeight: SGSize.chip)
        .background(.sg(tone.background), in: RoundedRectangle(cornerRadius: SGRadius.small, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// A symbol on a tinted rounded square. Scales with Dynamic Type.
public struct SGIconTile: View {
    let symbol: String
    let tint: SGToken
    let background: SGToken
    @ScaledMetric(relativeTo: .body) private var side: CGFloat = SGSize.iconTile

    public init(_ symbol: String, tint: SGToken = SGColor.accent, background: SGToken = SGColor.selectedBackground) {
        self.symbol = symbol
        self.tint = tint
        self.background = background
    }

    public var body: some View {
        Image(systemName: symbol)
            .font(.body.weight(.semibold))
            .foregroundStyle(.sg(tint))
            .frame(width: side, height: side)
            .background(.sg(background), in: RoundedRectangle(cornerRadius: SGRadius.small, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// Summary card on 오늘: symbol, title, one large value, a caption, and an
/// optional status badge. The whole card is one button.
public struct SGStatCard<Value: View>: View {
    let title: String
    let symbol: String
    let caption: String
    let badge: SGStatusBadge?
    let action: () -> Void
    let value: Value

    public init(
        title: String, symbol: String, caption: String, badge: SGStatusBadge? = nil,
        action: @escaping () -> Void, @ViewBuilder value: () -> Value
    ) {
        self.title = title
        self.symbol = symbol
        self.caption = caption
        self.badge = badge
        self.action = action
        self.value = value()
    }

    public var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: SGSpacing.xs) {
                HStack(alignment: .center, spacing: SGSpacing.xs) {
                    SGIconTile(symbol)
                    Spacer(minLength: 0)
                    if let badge { badge }
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.sg(SGColor.textTertiary))
                        .accessibilityHidden(true)
                }
                Text(title)
                    .font(SGTypography.label)
                    .foregroundStyle(.sg(SGColor.textSecondary))
                value
                Text(caption)
                    .font(SGTypography.caption)
                    .foregroundStyle(.sg(SGColor.textTertiary))
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
            }
            .padding(SGSpacing.md)
            .frame(maxWidth: .infinity, minHeight: SGSize.statCardMinHeight, alignment: .topLeading)
            .background(.sg(SGColor.surface), in: RoundedRectangle(cornerRadius: SGRadius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: SGRadius.card, style: .continuous).strokeBorder(.sg(SGColor.border)))
            .sgShadow(.small)
        }
        .buttonStyle(SGPressableStyle())
    }
}

/// Date block at the leading edge of an agenda row: month over day, or "오늘".
public struct SGDateTile: View {
    let month: Int
    let day: Int
    let isToday: Bool
    @ScaledMetric(relativeTo: .body) private var side: CGFloat = SGSize.dateTile

    public init(month: Int, day: Int, isToday: Bool) {
        self.month = month
        self.day = day
        self.isToday = isToday
    }

    public var body: some View {
        VStack(spacing: 0) {
            if isToday {
                Text("오늘").font(SGTypography.label)
            } else {
                Text("\(month)월").font(SGTypography.micro)
                    .foregroundStyle(.sg(SGColor.textTertiary))
                Text("\(day)").font(SGTypography.bodyStrong)
            }
        }
        .monospacedDigit()
        .foregroundStyle(.sg(isToday ? SGColor.accent : SGColor.textPrimary))
        .frame(minWidth: side, minHeight: side)
        .background(
            .sg(isToday ? SGColor.selectedBackground : SGColor.surfaceInteractive),
            in: RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(isToday ? "오늘" : "\(month)월 \(day)일")
    }
}

/// One-line empty state inside a card ("다가오는 기록이 없어요").
public struct SGEmptyState: View {
    let symbol: String
    let title: String
    let message: String?

    public init(symbol: String, title: String, message: String? = nil) {
        self.symbol = symbol
        self.title = title
        self.message = message
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: SGSpacing.sm) {
            Image(systemName: symbol)
                .foregroundStyle(.sg(SGColor.textTertiary))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: SGSpacing.xxxs) {
                Text(title)
                    .font(SGTypography.body)
                    .foregroundStyle(.sg(SGColor.textSecondary))
                if let message {
                    Text(message)
                        .font(SGTypography.caption)
                        .foregroundStyle(.sg(SGColor.textTertiary))
                }
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, SGSpacing.xs)
        .accessibilityElement(children: .combine)
    }
}

/// Full-screen loading state while the first projection is computed.
public struct SGLoadingState: View {
    let label: String

    public init(_ label: String = "불러오는 중") { self.label = label }

    public var body: some View {
        ProgressView()
            .accessibilityLabel(label)
            .frame(maxWidth: .infinity)
            .padding(.top, SGLayout.loadingInset)
    }
}

/// A shortcut tile: symbol over a short label. At least 44 pt tall.
public struct SGQuickAction: View {
    let title: String
    let symbol: String
    let action: () -> Void

    public init(_ title: String, symbol: String, action: @escaping () -> Void) {
        self.title = title
        self.symbol = symbol
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            VStack(spacing: SGSpacing.xs) {
                SGIconTile(symbol)
                Text(title)
                    .font(SGTypography.caption)
                    .foregroundStyle(.sg(SGColor.textPrimary))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.vertical, SGSpacing.sm)
            .padding(.horizontal, SGSpacing.xs)
            .frame(maxWidth: .infinity, minHeight: SGSpacing.minimumHitTarget)
            .background(.sg(SGColor.surface), in: RoundedRectangle(cornerRadius: SGRadius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: SGRadius.card, style: .continuous).strokeBorder(.sg(SGColor.border)))
            .contentShape(Rectangle())
        }
        .buttonStyle(SGPressableStyle())
    }
}
