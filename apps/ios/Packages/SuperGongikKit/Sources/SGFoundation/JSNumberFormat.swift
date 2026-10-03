import Foundation

/// Reproductions of the JavaScript number formatting the TypeScript reference
/// relies on. Swift's `String(format:)` rounds half-to-even on the binary
/// value, while `Number.prototype.toFixed` picks the larger candidate on an
/// exact tie (ECMA-262 §21.1.3.3), e.g. `(12.25).toFixed(1) === "12.3"`.
public enum JSNumberFormat {
    /// `x.toFixed(digits)` for finite `x` with `abs(x) < 1e21`.
    public static func toFixed(_ value: Double, _ digits: Int) -> String {
        precondition(value.isFinite && abs(value) < 1e21 && (0...20).contains(digits))
        let negative = value < 0
        let magnitude = abs(value)
        // Exact decimal expansion of the binary double. Every double below
        // 1e21 has at most 1074 fractional digits; Apple's libc prints exact
        // digits, so a generous precision captures the tie information.
        let exact = String(format: "%.1100f", magnitude)
        let parts = exact.split(separator: ".", maxSplits: 1)
        let integerDigits = Array(parts[0])
        let fractionDigits = parts.count > 1 ? Array(parts[1]) : []

        var kept = integerDigits + Array(fractionDigits.prefix(digits))
        while kept.count < integerDigits.count + digits { kept.append("0") }
        let rest = fractionDigits.dropFirst(digits)

        // Round half up (towards the larger n): any remainder ≥ 0.5 ulp.
        if let first = rest.first, first >= "5" {
            var index = kept.count - 1
            var carry = true
            while carry && index >= 0 {
                if kept[index] == "9" {
                    kept[index] = "0"
                    index -= 1
                } else {
                    kept[index] = Character(String(kept[index].wholeNumberValue! + 1))
                    carry = false
                }
            }
            if carry { kept.insert("1", at: 0) }
        }

        let integerCount = kept.count - digits
        var text = String(kept[0..<integerCount])
        if digits > 0 { text += "." + String(kept[integerCount...]) }
        // `(-0.04).toFixed(1)` is "-0.0" in JavaScript: the sign follows x.
        return (negative ? "-" : "") + text
    }

    /// `Number(x.toFixed(digits))`.
    public static func roundedLikeToFixed(_ value: Double, _ digits: Int) -> Double {
        Double(toFixed(value, digits))!
    }
}
