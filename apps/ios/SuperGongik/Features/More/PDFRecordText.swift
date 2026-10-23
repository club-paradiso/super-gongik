import Foundation
import PDFKit

/// Positioned text of a text PDF, in the shape the shared PDF table reader
/// expects (`page`, `x`, `y`, `text`; PDF coordinates, y grows upward).
///
/// PDFKit's line selections join a whole table row into one string, which
/// would lose the columns. So this measures word by word and starts a new run
/// where the gap between neighbours is wider than a word space, which is what
/// separates one table cell from the next.
enum PDFRecordText {
    struct Item: Encodable, Sendable {
        let page: Int
        let x: Double
        let y: Double
        let text: String
    }

    enum Failure: Error {
        case unreadable
        case noText
    }

    static func items(from data: Data) throws -> [Item] {
        guard let document = PDFDocument(data: data), document.pageCount > 0 else { throw Failure.unreadable }
        var items: [Item] = []
        for pageIndex in 0..<document.pageCount {
            guard let page = document.page(at: pageIndex), let string = page.string else { continue }
            items.append(contentsOf: runs(on: page, string: string as NSString, pageNumber: pageIndex + 1))
        }
        guard !items.isEmpty else { throw Failure.noText }
        return items
    }

    /// Words come from `page.selection(for:)`, whose bounds are reliable per
    /// range (per-character bounds are not: they can disagree with the string
    /// index). Neighbouring words on one line are joined into a cell run unless
    /// the gap is wider than a word space.
    private static func runs(on page: PDFPage, string: NSString, pageNumber: Int) -> [Item] {
        guard let words = try? NSRegularExpression(pattern: "\\S+") else { return [] }
        var items: [Item] = []
        var text = ""
        var first = CGRect.null
        var last = CGRect.null

        func flush() {
            let trimmed = text.trimmingCharacters(in: .whitespaces)
            if !trimmed.isEmpty, !first.isNull {
                items.append(Item(page: pageNumber, x: Double(first.minX), y: Double(first.minY), text: trimmed))
            }
            text = ""
            first = .null
            last = .null
        }

        for match in words.matches(in: string as String, range: NSRange(location: 0, length: string.length)) {
            guard let selection = page.selection(for: match.range) else { continue }
            let rect = selection.bounds(for: page)
            if rect.isNull || rect.isEmpty { continue }
            let word = string.substring(with: match.range)
            if !last.isNull {
                let height = max(rect.height, last.height)
                let sameLine = abs(rect.midY - last.midY) <= height * 0.5
                let gap = rect.minX - last.maxX
                // A word space is about a third of the glyph height; a column gap is far wider.
                if !sameLine || gap > height * 0.7 || gap < -rect.width {
                    flush()
                } else {
                    text.append(" ")
                }
            }
            if first.isNull { first = rect }
            text.append(word)
            last = rect
        }
        flush()
        return items
    }
}
