import SwiftUI

/// Visual encoding of the web's event categories (`apps/web/src/lib/event-display.ts`).
/// The category of each event type and its label come from the shared core;
/// this type only owns how a category looks. Category is never encoded by
/// color alone: each has its own shape, and every use shows the label.
public enum SGEventCategory: String, CaseIterable, Sendable, Codable {
    case leave, sick, attendance, duty, nonpayable, note

    public enum Shape: Sendable { case circle, diamond, triangle, square, ring, dash }

    public var shape: Shape {
        switch self {
        case .leave: .circle
        case .sick: .diamond
        case .attendance: .triangle
        case .duty: .square
        case .nonpayable: .ring
        case .note: .dash
        }
    }

    public var mark: SGToken {
        switch self {
        case .leave: SGToken(0x1F7F68, 0x84DCBB)
        case .sick: SGToken(0xB8641B, 0xF5C97F)
        case .attendance: SGToken(0x6A55C0, 0xBDB3F5)
        case .duty: SGToken(0x2F63C7, 0xA9C6FF)
        case .nonpayable: SGToken(0xB34461, 0xFFA9B5)
        case .note: SGToken(0x72798E, 0xA0A8C6)
        }
    }

    public var chipBackground: SGToken {
        switch self {
        case .leave: SGColor.successBackground
        case .sick: SGColor.warningBackground
        case .attendance: SGToken(0xEFECFB, 0x2A2553)
        case .duty: SGColor.infoBackground
        case .nonpayable: SGColor.dangerBackground
        case .note: SGColor.surfaceInteractive
        }
    }

    public var chipForeground: SGToken {
        switch self {
        case .leave: SGColor.success
        case .sick: SGColor.warning
        case .attendance: SGToken(0x4A3FA6, 0xD3CDFA)
        case .duty: SGColor.info
        case .nonpayable: SGColor.danger
        case .note: SGColor.textSecondary
        }
    }
}

/// The small category mark drawn next to labels, in lists and on the grid.
public struct SGCategoryMark: View {
    let category: SGEventCategory
    let size: CGFloat

    public init(_ category: SGEventCategory, size: CGFloat = 8) {
        self.category = category
        self.size = size
    }

    public var body: some View {
        let color = category.mark.color
        Group {
            switch category.shape {
            case .circle: Circle().fill(color)
            case .diamond: Rectangle().fill(color).rotationEffect(.degrees(45)).scaleEffect(0.78)
            case .triangle: Triangle().fill(color)
            case .square: RoundedRectangle(cornerRadius: size * 0.2).fill(color)
            case .ring: Circle().strokeBorder(color, lineWidth: max(1.5, size * 0.28))
            case .dash: Capsule().fill(color).frame(height: max(2, size * 0.36))
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

private struct Triangle: Shape {
    func path(in rect: CGRect) -> Path {
        Path { path in
            path.move(to: CGPoint(x: rect.midX, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
            path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
            path.closeSubpath()
        }
    }
}

/// Category chip: mark + text on the category tint.
public struct SGCategoryChip: View {
    let category: SGEventCategory
    let text: String

    public init(_ category: SGEventCategory, text: String) {
        self.category = category
        self.text = text
    }

    public var body: some View {
        HStack(spacing: 5) {
            SGCategoryMark(category, size: 7)
            Text(text).font(SGTypography.micro).lineLimit(1)
        }
        .foregroundStyle(category.chipForeground.color)
        .padding(.horizontal, 8)
        .frame(minHeight: 24)
        .background(category.chipBackground.color, in: RoundedRectangle(cornerRadius: SGRadius.small, style: .continuous))
    }
}
