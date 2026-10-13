import SGCore
import SGDesignSystem
import SGFoundation
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// 복무 기록 요약 PDF (Stitch "PDF & Print", phase 6). A personal summary of
/// what the app holds: service dates, the leave ledger's own figures and the
/// list of records. The Stitch source imitated an official form (statute
/// form number, issue number, timestamp, an institution's seal, "정본임을
/// 증명합니다"); none of that is drawn. Every page says it is not an official
/// document. Notes are left out: they are free text and may hold health
/// details, the same rule as the widgets.
enum RecordSummaryPDF {
    struct Input {
        let profile: ServiceProfile
        let hero: HomeModel.Hero?
        let ledger: LeaveLedger?
        let leaveText: LeaveText?
        let events: [(event: ServiceEvent, display: EventDisplay?)]
        let generatedOn: CivilDate
    }

    static let disclaimer = "개인 보관용으로 슈퍼공익 앱이 만든 요약이에요. 공식 증명서가 아니며 기관 제출용으로 쓸 수 없어요. 정확한 기록은 복무기관에서 확인해 주세요."

    static func fileName(_ date: CivilDate) -> String { "슈퍼공익-복무기록요약-\(date.description).pdf" }

    static func render(_ input: Input) -> Data {
        let page = CGRect(x: 0, y: 0, width: 595, height: 842) // A4 in points
        let margin: CGFloat = 48
        let width = page.width - margin * 2
        var blocks: [NSAttributedString] = []

        func para(_ text: String, size: CGFloat = 11, weight: UIFont.Weight = .regular,
                  color: UIColor = .black, spacingAfter: CGFloat = 4) -> NSAttributedString {
            let style = NSMutableParagraphStyle()
            style.lineSpacing = 2
            style.paragraphSpacing = spacingAfter
            return NSAttributedString(string: text + "\n", attributes: [
                .font: UIFont.systemFont(ofSize: size, weight: weight),
                .foregroundColor: color,
                .paragraphStyle: style,
            ])
        }

        blocks.append(para("복무 기록 요약", size: 22, weight: .heavy, spacingAfter: 6))
        blocks.append(para(disclaimer, size: 10, weight: .semibold, color: UIColor(red: 0.62, green: 0.18, blue: 0.12, alpha: 1), spacingAfter: 4))
        blocks.append(para("만든 날 \(Formatters.longDate(input.generatedOn))", size: 9, color: .darkGray, spacingAfter: 14))

        blocks.append(para("복무 기간", size: 14, weight: .bold, spacingAfter: 6))
        blocks.append(para("소집일  \(Formatters.longDate(input.profile.callUpDate))"))
        blocks.append(para("소집해제 예정일  \(Formatters.longDate(input.profile.expectedDischargeDate))"))
        if let hero = input.hero {
            blocks.append(para("진행률  \(hero.percentLabel) · \(KoreanNumber.grouped(hero.elapsedDays))일 지남 · \(KoreanNumber.grouped(hero.remainingDays))일 남음"))
        }
        if let category = input.profile.serviceCategory {
            blocks.append(para("복무 분야  \(category)"))
        }
        blocks.append(para("", spacingAfter: 8))

        if let ledger = input.ledger, let text = input.leaveText {
            blocks.append(para("연가 (\(Formatters.longDate(ledger.balance.asOf)) 기준)", size: 14, weight: .bold, spacingAfter: 6))
            for (label, value) in [("부여", text.balance.granted), ("사용", text.balance.used),
                                   ("예정", text.balance.scheduled), ("보정", text.balance.corrections),
                                   ("지금 남은 연가", text.balance.available),
                                   ("예정까지 반영한 남은 연가", text.balance.remainingAfterScheduled)] {
                blocks.append(para("\(label)  \(value)"))
            }
            if ledger.balance.status != "RESOLVED" {
                blocks.append(para("확인되지 않은 항목이 있어 잔여가 달라질 수 있어요.", size: 10, color: .darkGray))
            }
            blocks.append(para("", spacingAfter: 8))
        }

        blocks.append(para("기록 \(input.events.count)건", size: 14, weight: .bold, spacingAfter: 6))
        if input.events.isEmpty {
            blocks.append(para("기록이 없어요.", color: .darkGray))
        }
        for (event, display) in input.events {
            let dates = event.startDate == event.endDate
                ? Formatters.longDate(event.startDate)
                : "\(Formatters.longDate(event.startDate)) ~ \(Formatters.longDate(event.endDate))"
            let detail = [display?.categoryLabel, display?.timing].compactMap { $0 }.joined(separator: " · ")
            blocks.append(para("\(dates)  \(display?.label ?? event.eventType)\(detail.isEmpty ? "" : "  (\(detail))")", size: 10))
        }
        blocks.append(para("", spacingAfter: 4))
        blocks.append(para("메모는 이 요약에 넣지 않았어요.", size: 9, color: .darkGray))

        let body = NSMutableAttributedString()
        blocks.forEach(body.append)

        let renderer = UIGraphicsPDFRenderer(bounds: page)
        return renderer.pdfData { context in
            let framesetter = CTFramesetterCreateWithAttributedString(body)
            var start = 0
            var pageNumber = 1
            let content = CGRect(x: margin, y: margin, width: width, height: page.height - margin * 2 - 24)
            repeat {
                context.beginPage()
                let cg = context.cgContext
                cg.saveGState()
                cg.textMatrix = .identity
                cg.translateBy(x: 0, y: page.height)
                cg.scaleBy(x: 1, y: -1)
                let flipped = CGRect(x: content.minX, y: page.height - content.maxY, width: content.width, height: content.height)
                let frame = CTFramesetterCreateFrame(framesetter, CFRange(location: start, length: 0), CGPath(rect: flipped, transform: nil), nil)
                CTFrameDraw(frame, cg)
                cg.restoreGState()
                start += CTFrameGetVisibleStringRange(frame).length
                let footer = "슈퍼공익 · 개인 보관용 요약 · 공식 문서 아님 · \(pageNumber)쪽"
                NSAttributedString(string: footer, attributes: [
                    .font: UIFont.systemFont(ofSize: 8), .foregroundColor: UIColor.gray,
                ]).draw(at: CGPoint(x: margin, y: page.height - margin + 8))
                pageNumber += 1
            } while start < body.length
        }
    }
}

struct PDFFileDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.pdf] }
    let data: Data

    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
    }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}

/// 내 정보 › 복무 기록 요약 PDF.
struct RecordSummarySection: View {
    @Environment(AppModel.self) private var model
    @State private var document: PDFFileDocument?
    @State private var exporting = false

    var body: some View {
        Section {
            Button("복무 기록 요약 PDF") { prepare() }
                .disabled(model.profile == nil)
        } footer: {
            Text("개인 보관용 요약이에요. 공식 증명서가 아니라 기관 제출용으로 쓸 수 없어요. 메모는 넣지 않아요.")
        }
        .fileExporter(isPresented: $exporting, document: document, contentType: .pdf,
                      defaultFilename: RecordSummaryPDF.fileName(model.today)) { _ in }
    }

    private func prepare() {
        guard let profile = model.profile else { return }
        let display = model.projection?.eventDisplay ?? [:]
        let events = (model.document?.liveEvents ?? [])
            .sorted { $0.startDate.dayNumber < $1.startDate.dayNumber }
            .map { (event: $0, display: display[$0.id]) }
        let input = RecordSummaryPDF.Input(
            profile: profile, hero: model.projection?.home?.hero, ledger: model.projection?.ledger,
            leaveText: model.projection?.leaveText, events: events, generatedOn: model.today)
        document = PDFFileDocument(data: RecordSummaryPDF.render(input))
        exporting = true
    }
}
