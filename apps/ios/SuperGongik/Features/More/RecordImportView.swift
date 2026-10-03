import CryptoKit
import SGCore
import SGDesignSystem
import SGFoundation
import SwiftUI
import UniformTypeIdentifiers

/// 기관 기록 가져오기 (CSV/TSV). Parsing, row statuses, default selection,
/// user edits and the commit are the web import panel's shared rules
/// (`lib/import-model.ts` + `packages/importer`). Nothing is stored until the
/// user confirms the preview.
struct RecordImportView: View {
    struct Candidate: Decodable, Sendable, Identifiable {
        let sourceRowIndex: Int
        let date: String?
        let eventType: String?
        let durationDays: Double?
        let durationMinutes: Double?
        let halfDay: Bool?
        let note: String?
        let warnings: [Warning]
        var id: Int { sourceRowIndex }
    }

    struct Warning: Decodable, Sendable, Hashable {
        let code: String
        let message: String
    }

    struct Snapshot: Decodable, Sendable, Identifiable {
        let sourceRowIndex: Int
        let leaveType: String?
        let asOfDate: String?
        let remainingDays: Double?
        let confidence: Double
        var id: Int { sourceRowIndex }
    }

    struct Preview: Decodable, Sendable {
        let events: [Candidate]
        let snapshots: [Snapshot]
    }

    struct RowStatus: Decodable, Sendable {
        let decision: String
        let message: String?
    }

    struct Result: Decodable, Sendable {
        let preview: Preview
        let statuses: [String: RowStatus]
        let acceptedRows: [Int]
        let acceptedSnapshots: [Int]
        let alreadyImported: Bool
    }

    @Environment(AppModel.self) private var model
    @State private var importing = false
    @State private var fileName = ""
    @State private var rawPreview: JSONValue?
    @State private var result: Result?
    @State private var accepted: Set<Int> = []
    @State private var acceptedSnapshots: Set<Int> = []
    @State private var notice: (SGTone, String)?
    @State private var usedLegacyEncoding = false
    @State private var confirmingRollback: ImportRecord?

    var body: some View {
        Form {
            Section {
                Button {
                    importing = true
                } label: {
                    Label(result == nil ? "파일 선택 (CSV·TSV)" : "다른 파일 선택", systemImage: "doc.badge.plus")
                }
            } footer: {
                Text("기관에서 받은 복무상황 파일을 CSV나 TSV로 저장해 선택하세요. 미리보기에서 확인한 행만 저장해요. XLSX·HWP·PDF는 아직 웹 슈퍼공익에서 가져올 수 있어요.")
            }

            if let result {
                previewSections(result)
            }

            if let notice {
                Section { SGNotice(notice.0, title: notice.1) }
                    .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
            }

            let history = (model.document?.imports ?? []).sorted { $0.createdAt > $1.createdAt }
            if !history.isEmpty {
                Section("가져오기 이력") {
                    ForEach(history) { record in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(record.fileName).font(SGTypography.bodyStrong).lineLimit(1)
                                Text("\(record.eventCount)건 · \(record.status == "ACTIVE" ? "반영됨" : "취소됨")")
                                    .font(SGTypography.caption).foregroundStyle(.sg(SGColor.textTertiary))
                            }
                            Spacer()
                            if record.status == "ACTIVE" {
                                Button("취소") { confirmingRollback = record }
                                    .font(SGTypography.label)
                                    .disabled(model.isReadOnly)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("기관 기록 가져오기")
        .navigationBarTitleDisplayMode(.inline)
        .fileImporter(isPresented: $importing,
                      allowedContentTypes: [.commaSeparatedText, .tabSeparatedText, .plainText, .text]) { picked in
            Task { await load(picked) }
        }
        .confirmationDialog("이 파일에서 가져온 기록을 취소할까요?", isPresented: Binding(
            get: { confirmingRollback != nil }, set: { if !$0 { confirmingRollback = nil } }),
                            titleVisibility: .visible, presenting: confirmingRollback) { record in
            Button("가져오기 취소", role: .destructive) { Task { await rollback(record) } }
        } message: { _ in
            Text("이 파일로 추가한 기록만 지워요. 직접 입력한 기록은 그대로예요.")
        }
    }

    @ViewBuilder
    private func previewSections(_ result: Result) -> some View {
        if result.alreadyImported {
            Section { SGNotice(.warning, title: "이미 가져온 파일이에요.", message: "같은 기록은 중복으로 건너뛰어요.") }
                .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
        }
        if usedLegacyEncoding {
            Section { SGNotice(.info, title: "한글 인코딩(CP949)으로 읽었어요.", message: "글자가 깨져 보이면 파일을 UTF-8 CSV로 다시 저장해 주세요.") }
                .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
        }
        Section("복무 기록 \(result.preview.events.count)행 · 선택 \(accepted.count)") {
            if result.preview.events.isEmpty {
                Text("가져올 복무 기록을 찾지 못했어요. 날짜·복무상황 열이 있는 파일인지 확인해 주세요.")
                    .font(SGTypography.body).foregroundStyle(.sg(SGColor.textSecondary))
            }
            ForEach(result.preview.events) { row in
                let status = result.statuses[String(row.sourceRowIndex)]
                Toggle(isOn: Binding(
                    get: { accepted.contains(row.sourceRowIndex) },
                    set: { on in if on { accepted.insert(row.sourceRowIndex) } else { accepted.remove(row.sourceRowIndex) } })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(row.date ?? "날짜 없음") · \(row.eventType.map(model.label(for:)) ?? "종류 확인 필요")")
                            .font(SGTypography.bodyStrong).monospacedDigit()
                        Text(amount(row)).font(SGTypography.caption).foregroundStyle(.sg(SGColor.textSecondary))
                        if let message = status?.message, !message.isEmpty {
                            Text(message).font(SGTypography.caption).foregroundStyle(.sg(SGColor.warning))
                        }
                        ForEach(row.warnings, id: \.self) { warning in
                            Text(warning.message).font(SGTypography.caption).foregroundStyle(.sg(SGColor.warning))
                        }
                    }
                }
                .disabled(row.date == nil || row.eventType == nil)
            }
        }
        if !result.preview.snapshots.isEmpty {
            Section("기관 잔여 연가 \(result.preview.snapshots.count)행") {
                ForEach(result.preview.snapshots) { snapshot in
                    Toggle(isOn: Binding(
                        get: { acceptedSnapshots.contains(snapshot.sourceRowIndex) },
                        set: { on in
                            if on { acceptedSnapshots.insert(snapshot.sourceRowIndex) } else { acceptedSnapshots.remove(snapshot.sourceRowIndex) }
                        })) {
                        Text("\(snapshot.asOfDate ?? "기준일 없음") · 잔여 \(snapshot.remainingDays.map { String(format: "%g", $0) } ?? "?")일")
                            .monospacedDigit()
                    }
                }
            }
        }
        Section {
            Button("선택한 \(accepted.count + acceptedSnapshots.count)건 저장") { Task { await commit() } }
                .disabled(accepted.isEmpty && acceptedSnapshots.isEmpty || model.isReadOnly)
                .frame(maxWidth: .infinity)
        } footer: {
            Text("겹치는지 판단할 수 없는 행과 경고가 있는 행은 기본으로 선택하지 않아요. 직접 확인한 뒤 선택해 주세요.")
        }
    }

    private func amount(_ row: Candidate) -> String {
        if row.halfDay == true { return "반일" }
        if let days = row.durationDays { return String(format: "%g일", days) }
        if let minutes = row.durationMinutes { return "\(Int(minutes))분" }
        return "사용량 확인 필요"
    }

    private func load(_ picked: Swift.Result<URL, Error>) async {
        notice = nil
        guard case .success(let url) = picked, let runtime = model.core else { return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url), data.count <= 10 * 1024 * 1024 else {
            notice = (.danger, "파일을 읽지 못했어요. 10MB 이하의 CSV·TSV 파일인지 확인해 주세요.")
            return
        }
        let text: String
        if let utf8 = String(data: data, encoding: .utf8) {
            text = utf8
            usedLegacyEncoding = false
        } else {
            let cp949 = CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(CFStringEncodings.dosKorean.rawValue))
            guard let legacy = String(data: data, encoding: String.Encoding(rawValue: cp949)) else {
                notice = (.danger, "글자를 읽지 못했어요. 파일을 UTF-8 CSV로 다시 저장해 주세요.")
                return
            }
            text = legacy
            usedLegacyEncoding = true
        }
        fileName = url.lastPathComponent
        let sha = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        do {
            let json = try await runtime.callJSONAsync("importPreview", [text, fileName, sha])
            let value = try JSONValue(data: json)
            rawPreview = value["preview"]
            result = try JSONDecoder().decode(Result.self, from: json)
            accepted = Set(result?.acceptedRows ?? [])
            acceptedSnapshots = Set(result?.acceptedSnapshots ?? [])
        } catch {
            AppLog.error("import preview failed: \(error)")
            notice = (.danger, "이 파일에서 표를 찾지 못했어요. 기관에서 받은 복무상황 파일인지 확인해 주세요.")
        }
    }

    private func commit() async {
        guard let runtime = model.core, let rawPreview else { return }
        do {
            let data = try await runtime.callJSONAsync("importCommit", [
                rawPreview.jsonText, "{}",
                JSONValue.array(accepted.sorted().map { .number(Double($0)) }).jsonText,
                JSONValue.array(acceptedSnapshots.sorted().map { .number(Double($0)) }).jsonText,
            ])
            let outcome = try JSONValue(data: data)
            await model.reloadAfterExternalWrite()
            if outcome["ok"]?.boolValue == true {
                notice = (.success, outcome["message"]?.stringValue ?? "저장했어요.")
                result = nil
                self.rawPreview = nil
            } else {
                notice = (.danger, outcome["errors"]?.arrayValue?.first?["message"]?.stringValue ?? "가져오지 못했어요.")
            }
        } catch {
            AppLog.error("import commit failed: \(error)")
            notice = (.danger, "가져오지 못했어요. 기록은 그대로 있어요.")
        }
    }

    private func rollback(_ record: ImportRecord) async {
        let issues = await model.run("rollbackImport", [.string(record.id)])
        notice = issues.isEmpty
            ? (.success, "가져온 기록을 취소했어요. 직접 입력한 기록은 그대로예요.")
            : (.danger, issues.first?.message ?? "취소하지 못했어요.")
    }
}

/// CSV exports (same files as the web backup panel).
struct CSVExportSection: View {
    @Environment(AppModel.self) private var model
    @State private var document: BackupDocument?
    @State private var fileName = ""
    @State private var exporting = false

    var body: some View {
        Section {
            Button("복무기록 CSV") { Task { await prepare("events", "super-gongik-events") } }
                .disabled(model.document?.events.isEmpty ?? true)
            Button("연가 내역 CSV") { Task { await prepare("leave", "super-gongik-leave-ledger") } }
                .disabled(model.projection?.ledger?.entries.isEmpty ?? true)
        } footer: {
            Text("표 계산 앱에서 열어 볼 수 있는 파일이에요. 복원에는 전체 백업(JSON)을 쓰세요.")
        }
        .fileExporter(isPresented: $exporting, document: document, contentType: .commaSeparatedText,
                      defaultFilename: fileName) { _ in }
    }

    private func prepare(_ kind: String, _ prefix: String) async {
        guard let runtime = model.core else { return }
        do {
            let data = try await runtime.callJSON("exportCsv", [kind, model.today.description])
            let text = try JSONDecoder().decode(String.self, from: data)
            document = BackupDocument(text: text)
            fileName = BackupDocument.fileName(at: .now)
                .replacingOccurrences(of: "super-gongik-backup", with: prefix)
                .replacingOccurrences(of: ".json", with: ".csv")
            exporting = true
        } catch {
            AppLog.error("csv export failed: \(error)")
        }
    }
}
