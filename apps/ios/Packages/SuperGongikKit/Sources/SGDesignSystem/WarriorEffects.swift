import SwiftUI

// Warrior theme effects from the Stitch dark HUD screens
// (`super_gongik_the_epic_duty_hero`, `calendar_quest_log_dark_hud`,
// `dark_hud_1`): gold glows (`shadow-[0_0_12px_rgba(253,207,124,…)]`),
// luminous card edges, `animate-ping` live dots and `animate-pulse` accents.
//
// Decorative only: none of them carries information, VoiceOver never sees
// them, and with Reduce Motion every animation is replaced by its resting
// state. The standard theme draws none of them except the live dot's ping,
// which Stitch uses in its light screens too.

/// True while the view is in a tab that is not on screen (the app keeps
/// every opened tab alive under an opacity-0 layer). Every looping effect
/// rests then, exactly as with Reduce Motion, and resumes when the tab
/// returns, so hidden tabs do not keep animating.
private struct SGMotionPausedKey: EnvironmentKey {
    static let defaultValue = false
}

public extension EnvironmentValues {
    var sgMotionPaused: Bool {
        get { self[SGMotionPausedKey.self] }
        set { self[SGMotionPausedKey.self] = newValue }
    }
}

/// Sets `value` with no animation, which also ends a repeating one.
@MainActor
func sgSetWithoutAnimation(_ body: () -> Void) {
    var transaction = Transaction()
    transaction.disablesAnimations = true
    withTransaction(transaction, body)
}

/// Stitch gold, as a plain color for glows (shadows need a `Color`).
public enum SGGlow {
    public static let gold = RGB(0xFDCF7C).color
    public static let amber = RGB(0xFDA870).color
    public static let ivory = RGB(0xFEF1D3).color
    public static let lavender = RGB(0x8D86F2).color
    public static let emerald = RGB(0x34D399).color
}

/// A status dot with Stitch's `animate-ping` ring: the ring grows and fades
/// every 1.6 s. Static with Reduce Motion.
public struct SGPulseDot: View {
    let color: Color
    let size: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.sgMotionPaused) private var paused
    @State private var ping = false

    private var still: Bool { reduceMotion || paused }

    public init(_ color: Color, size: CGFloat = 7) {
        self.color = color
        self.size = size
    }

    public var body: some View {
        Circle()
            .fill(color)
            .frame(width: size, height: size)
            .shadow(color: color.opacity(0.8), radius: 3)
            .background {
                if !still {
                    Circle()
                        .fill(color)
                        .frame(width: size, height: size)
                        .scaleEffect(ping ? 2.6 : 1)
                        .opacity(ping ? 0 : 0.55)
                }
            }
            .onAppear { if !still { start() } }
            .onChange(of: still) { _, now in
                if now { sgSetWithoutAnimation { ping = false } } else { start() }
            }
            .accessibilityHidden(true)
    }

    private func start() {
        withAnimation(.easeOut(duration: 1.6).repeatForever(autoreverses: false)) { ping = true }
    }
}

/// Luminous card edge (Warrior): a gilded hairline that fades from the top
/// leading corner, plus a soft gold glow at night. Nothing in standard.
public struct SGWarriorFrame: ViewModifier {
    let cornerRadius: CGFloat
    let emphasis: Double
    @Environment(\.sgTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme

    public func body(content: Content) -> some View {
        if theme == .warrior {
            let night = colorScheme == .dark
            content
                .overlay {
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .strokeBorder(
                            LinearGradient(
                                colors: [
                                    SGGlow.gold.opacity((night ? 0.55 : 0.6) * emphasis),
                                    SGGlow.lavender.opacity(night ? 0.28 : 0.3),
                                    SGGlow.lavender.opacity(night ? 0.08 : 0.12),
                                ],
                                startPoint: .topLeading, endPoint: .bottomTrailing),
                            lineWidth: 1)
                        .allowsHitTesting(false)
                }
                .shadow(color: SGGlow.gold.opacity((night ? 0.14 : 0.10) * emphasis), radius: 12)
        } else {
            content
        }
    }
}

public extension View {
    /// Warrior card edge and glow (`SGWarriorFrame`); no-op in standard.
    func sgWarriorFrame(cornerRadius: CGFloat, emphasis: Double = 1) -> some View {
        modifier(SGWarriorFrame(cornerRadius: cornerRadius, emphasis: emphasis))
    }
}

/// Breathing gold glow (Stitch `animate-pulse` on gold accents): the glow
/// radius swells and settles every 2.4 s. Warrior only; static glow with
/// Reduce Motion, none in standard.
public struct SGBreathingGlow: ViewModifier {
    let color: Color
    let radius: CGFloat
    @Environment(\.sgTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.sgMotionPaused) private var paused
    @State private var high = false

    public func body(content: Content) -> some View {
        let still = reduceMotion || paused
        if theme == .warrior {
            content
                .shadow(color: color.opacity(high ? 0.85 : 0.45), radius: high ? radius * 1.6 : radius)
                .onAppear { if !still { breathe() } }
                .onChange(of: still) { _, now in
                    if now { sgSetWithoutAnimation { high = false } } else { breathe() }
                }
        } else {
            content
        }
    }
}

extension SGBreathingGlow {
    private func breathe() {
        withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true)) { high = true }
    }
}

public extension View {
    func sgBreathingGlow(_ color: Color = SGGlow.gold, radius: CGFloat = 8) -> some View {
        modifier(SGBreathingGlow(color: color, radius: radius))
    }
}

/// A band of light that sweeps across the view every few seconds (progress
/// fills, the D-day). Warrior only; nothing with Reduce Motion.
public struct SGShimmer: ViewModifier {
    let period: Double
    @Environment(\.sgTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.sgMotionPaused) private var paused
    @State private var phase: CGFloat = -1

    public func body(content: Content) -> some View {
        if theme == .warrior && !reduceMotion && !paused {
            content
                .overlay {
                    GeometryReader { proxy in
                        LinearGradient(colors: [.clear, .white.opacity(0.55), .clear],
                                       startPoint: .leading, endPoint: .trailing)
                            .frame(width: max(24, proxy.size.width * 0.35))
                            .offset(x: phase * proxy.size.width * 1.4)
                            .blendMode(.plusLighter)
                    }
                    .mask(content)
                    .allowsHitTesting(false)
                }
                .onAppear {
                    withAnimation(.easeInOut(duration: period * 0.45).delay(0.6).repeatForever(autoreverses: false)) {
                        phase = 1
                    }
                }
                // Removed while paused: start from the left edge on return.
                .onDisappear { sgSetWithoutAnimation { phase = -1 } }
        } else {
            content
        }
    }
}

public extension View {
    func sgShimmer(period: Double = 3.2) -> some View {
        modifier(SGShimmer(period: period))
    }
}

/// Twinkling stars over a night sky (Warrior hero). Fixed positions, a slow
/// independent fade per star; static (dimmer) with Reduce Motion.
public struct SGStarfield: View {
    private static let stars: [(x: CGFloat, y: CGFloat, size: CGFloat, delay: Double)] = [
        // The upper third only: stars below that land on text.
        (0.08, 0.08, 2.2, 0.0), (0.22, 0.04, 1.6, 0.9), (0.36, 0.13, 1.4, 1.7), (0.58, 0.05, 2.0, 0.4),
        (0.71, 0.14, 1.5, 2.3), (0.86, 0.07, 2.4, 1.1), (0.94, 0.21, 1.4, 0.2), (0.15, 0.24, 1.3, 2.8),
        (0.48, 0.20, 1.2, 1.4), (0.79, 0.27, 1.6, 0.7), (0.04, 0.30, 1.4, 1.9), (0.93, 0.33, 1.2, 2.6),
    ]
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.sgMotionPaused) private var paused
    @State private var lit = false

    public init() {}

    public var body: some View {
        let still = reduceMotion || paused
        GeometryReader { proxy in
            ForEach(Array(Self.stars.enumerated()), id: \.offset) { _, star in
                Circle()
                    .fill(SGGlow.ivory)
                    .frame(width: star.size, height: star.size)
                    .shadow(color: SGGlow.gold.opacity(0.9), radius: star.size * 1.5)
                    .position(x: proxy.size.width * star.x, y: proxy.size.height * star.y)
                    .opacity(still ? 0.6 : (lit ? 1 : 0.15))
                    .animation(still ? nil
                               : .easeInOut(duration: 1.8).repeatForever(autoreverses: true).delay(star.delay),
                               value: lit)
            }
        }
        .onAppear { lit = true }
        // Back on screen: flip `lit` so the twinkle animation starts again.
        .onChange(of: still) { _, now in
            guard !now else { return }
            lit = false
            Task { @MainActor in lit = true }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
