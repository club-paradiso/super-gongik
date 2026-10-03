import SGCore
import SGDesignSystem
import SGFoundation
import SwiftUI
import UniformTypeIdentifiers

/// A backup file as a transferable document for `fileExporter`/`ShareLink`.
/// The text is the shared backup-v2 format (`createBackup` +
/// `serializeBackup`), byte-compatible with the web.
struct BackupDocument: FileDocument {
    static let readableContentTypes: [UTType] = [.json]
    var text: String

    init(text: String) { self.text = text }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else { throw CocoaError(.fileReadCorruptFile) }
        text = String(decoding: data, as: UTF8.self)
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(text.utf8))
    }

    static func fileName(at date: Date) -> String {
        var calendar = Calendar.seoul
        calendar.timeZone = SeoulClock.timeZone
        let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        return String(format: "super-gongik-backup-%04d%02d%02d-%02d%02d.json",
                      parts.year ?? 0, parts.month ?? 0, parts.day ?? 0, parts.hour ?? 0, parts.minute ?? 0)
    }
}

/// 백업: export the full document as JSON.
struct BackupExportView: View {
    @Environment(AppModel.self) private var model
    @State private var document: BackupDocument?
    @State private var exporting = false
    @State private var message: String?

    var body: some View {
        Section {
            Button {
                Task { await prepare() }
            } label: {
                Label("전체 백업 파일 만들기", systemImage: "square.and.arrow.up")
            }
            .fileExporter(isPresented: $exporting, document: document, contentType: .json,
                          defaultFilename: BackupDocument.fileName(at: .now)) { result in
                switch result {
                case .success:
                    message = "백업 파일을 저장했어요."
                    ReminderScheduler.noteBackupSaved()
                    Task { await model.reproject() }
                case .failure(let error):
                    if (error as NSError).code != NSUserCancelledError {
                        message = "백업 파일을 저장하지 못했어요. 다시 시도해 주세요."
                    }
                }
            }
            if let message {
                Text(message).font(SGTypography.caption).foregroundStyle(.sg(SGColor.textSecondary))
            }
        } header: {
            Text("백업")
        } footer: {
            Text("복무 기록·연가 보정·가져오기 이력까지 모두 담긴 JSON 파일이에요. 웹 슈퍼공익에서도 그대로 복원할 수 있어요. 파일은 암호화되지 않으니 안전한 곳에 보관해 주세요.")
        }
    }

    private func prepare() async {
        guard let runtime = model.core else { return }
        do {
            document = BackupDocument(text: try await runtime.exportBackup(exportedAt: .now).text)
            exporting = true
        } catch {
            AppLog.error("export failed: \(error)")
            message = "백업 파일을 만들지 못했어요. 기록은 그대로 있어요."
        }
    }
}

/// 복원: pick a file → validated preview → MERGE or REPLACE → explicit
/// confirmation → atomic restore by the shared store. Nothing is written
/// before the final button, and REPLACE keeps a pre-restore copy.
struct BackupRestoreView: View {
    var onboarding = false
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var importing = false
    @State private var text: String?
    @State private var mode = "MERGE"
    @State private var restoreLocallyDeleted = false
    @State private var resolutions: [String: String] = [:]
    @State private var destructiveConfirmed = false
    @State private var preview: JSONValue?
    @State private var outcome: (tone: SGTone, title: String, message: String?)?

    var body: some View {
        Form {
            Section {
                Button {
                    importing = true
                } label: {
                    Label(text == nil ? "백업 파일 선택" : "다른 파일 선택", systemImage: "doc.badge.arrow.up")
                }
            } footer: {
                Text("슈퍼공익(웹 또는 앱)에서 만든 전체 백업 JSON 파일을 선택하세요. 고르기만 해서는 아무것도 바뀌지 않아요.")
            }

            if let preview {
                previewSections(preview)
            }

            if let outcome {
                Section { SGNotice(outcome.tone, title: outcome.title, message: outcome.message) }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }
        }
        .navigationTitle("백업에서 복원")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if onboarding {
                ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } }
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json, .plainText]) { result in
            Task { await load(result) }
        }
        .onChange(of: mode) { Task { await refresh() } }
        .onChange(of: restoreLocallyDeleted) { Task { await refresh() } }
        .onChange(of: resolutions) { Task { await refresh() } }
        .onChange(of: destructiveConfirmed) { Task { await refresh() } }
    }

    @ViewBuilder
    private func previewSections(_ preview: JSONValue) -> some View {
        if preview["ok"]?.boolValue != true {
            Section {
                SGNotice(.danger, title: preview["title"]?.stringValue ?? "복원할 수 없는 파일이에요.",
                         message: preview["parsed"]?["error"]?.stringValue)
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        } else {
            let plan = preview["plan"] ?? .null
            let presentation = preview["presentation"] ?? .null
            let summary = preview["summary"] ?? .null
            let profileIssue = ["DIFFERENT_PROFILE", "NO_BACKUP_PROFILE"].contains(plan["profile"]?.stringValue ?? "")

            Section("백업 내용") {
                LabeledContent("만든 시각", value: summary["exportedAt"]?.stringValue.map(localTime) ?? "-")
                LabeledContent("복무 기록", value: "\(Int(summary["events"]?.numberValue ?? 0))건")
                LabeledContent("프로필", value: presentation["profile"]?.stringValue ?? "")
                if preview["info"]?["integrity"]?.stringValue == "VERIFIED" {
                    Label("파일 무결성 확인됨", systemImage: "checkmark.seal").foregroundStyle(.sg(SGColor.success))
                } else {
                    Label("무결성 정보가 없는 백업이에요", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.sg(SGColor.warning))
                }
            }

            Section {
                Picker("복원 방식", selection: $mode) {
                    Text("합치기").tag("MERGE")
                    Text("덮어쓰기").tag("REPLACE")
                }
                .pickerStyle(.segmented)
                .disabled(profileIssue)
                if mode == "MERGE" {
                    Toggle("이 기기에서 지운 기록도 되살리기", isOn: $restoreLocallyDeleted)
                }
            } footer: {
                Text(mode == "MERGE"
                     ? "합치기는 이 기기의 기록을 지우지 않아요. 같은 기록이 양쪽에서 다르게 고쳐졌으면 어느 쪽을 남길지 직접 고르게 해요."
                     : "덮어쓰기는 이 기기의 기록을 백업 내용으로 바꿔요. 바꾸기 전 현재 데이터를 기기에 따로 보관해요.")
            }

            Section("바뀌는 내용") {
                ForEach(presentation["collections"]?.arrayValue ?? [], id: \.self) { item in
                    LabeledContent(item["label"]?.stringValue ?? "", value: item["text"]?.stringValue ?? "")
                }
            }

            let conflicts = presentation["conflicts"]?.arrayValue ?? []
            if mode == "MERGE" && !conflicts.isEmpty {
                Section("충돌 \(conflicts.count)건") {
                    ForEach(conflicts, id: \.self) { conflict in
                        let key = conflict["key"]?.stringValue ?? ""
                        VStack(alignment: .leading, spacing: SGSpacing.xs) {
                            Text(conflict["collection"]?.stringValue ?? "").font(SGTypography.bodyStrong)
                            Text(conflict["explanation"]?.stringValue ?? "").font(SGTypography.caption)
                                .foregroundStyle(.sg(SGColor.textSecondary))
                            Picker("남길 쪽", selection: Binding(
                                get: { resolutions[key] ?? "" },
                                set: { resolutions[key] = $0.isEmpty ? nil : $0 })) {
                                Text("선택").tag("")
                                Text("이 기기 (\(conflict["local"]?.stringValue ?? ""))").tag("LOCAL")
                                Text("백업 (\(conflict["incoming"]?.stringValue ?? ""))").tag("INCOMING")
                            }
                        }
                    }
                }
            }

            if plan["requiresDestructiveConfirmation"]?.boolValue == true {
                Section {
                    Toggle("이 기기의 현재 기록이 백업 내용으로 바뀌는 것을 확인했어요", isOn: $destructiveConfirmed)
                }
            }

            Section {
                let gate = presentation["gate"] ?? .null
                if gate["enabled"]?.boolValue == false, let reason = gate["reason"]?.stringValue {
                    Text(reason).font(SGTypography.caption).foregroundStyle(.sg(SGColor.warning))
                }
                Button(mode == "MERGE" ? "합쳐서 복원" : "덮어써서 복원", role: mode == "REPLACE" ? .destructive : nil) {
                    Task { await apply(plan) }
                }
                .disabled(gate["enabled"]?.boolValue != true || model.isReadOnly)
                .frame(maxWidth: .infinity)
            }
        }
    }

    private func localTime(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return iso }
        return date.formatted(.dateTime.locale(Locale(identifier: "ko_KR")).year().month().day().hour().minute())
    }

    private func load(_ result: Result<URL, Error>) async {
        outcome = nil
        guard case .success(let url) = result else { return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        // The domain caps backups at 10 MB; refuse obviously larger files
        // before reading them into memory.
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size <= 30 * 1024 * 1024, let data = try? Data(contentsOf: url) else {
            outcome = (.danger, "파일을 읽지 못했어요.", "백업 파일이 맞는지 확인해 주세요.")
            return
        }
        text = String(decoding: data, as: UTF8.self)
        resolutions = [:]
        destructiveConfirmed = false
        // With no local records there is nothing to merge into.
        mode = (model.document?.hasAnyRecord ?? false) ? "MERGE" : "REPLACE"
        await refresh()
    }

    private func refresh() async {
        guard let text, let runtime = model.core else { return }
        let options: JSONValue = .object([
            "restoreLocallyDeleted": .bool(restoreLocallyDeleted),
            "resolutions": .object(resolutions.mapValues(JSONValue.string)),
            "destructiveConfirmed": .bool(destructiveConfirmed),
        ])
        preview = try? await runtime.previewRestore(text: text, mode: mode, options: options)
        if mode == "MERGE", let profile = preview?["plan"]?["profile"]?.stringValue,
           ["DIFFERENT_PROFILE", "NO_BACKUP_PROFILE"].contains(profile) {
            mode = "REPLACE"
        }
    }

    private func apply(_ plan: JSONValue) async {
        guard let text, let runtime = model.core else { return }
        let request: JSONValue = .object([
            "mode": .string(mode),
            "options": .object([
                "restoreLocallyDeleted": .bool(restoreLocallyDeleted),
                "resolutions": .object(resolutions.mapValues(JSONValue.string)),
            ]),
            "expectedDocumentRevision": plan["baseDocumentRevision"] ?? .number(0),
            "confirmDestructive": .bool(destructiveConfirmed),
        ])
        do {
            let result = try await runtime.restore(text: text, request: request)
            if result["ok"]?.boolValue == true {
                outcome = (.success, "복원했어요.", mode == "REPLACE" ? "복원 전 데이터는 기기에 따로 보관했어요." : nil)
                await model.reloadAfterExternalWrite()
                if onboarding { dismiss() }
                self.text = nil
                preview = nil
            } else {
                outcome = (.danger, result["title"]?.stringValue ?? "복원하지 않았어요.", result["message"]?.stringValue)
                if result["code"]?.stringValue == "STALE_PREVIEW" { await refresh() }
            }
        } catch {
            AppLog.error("restore failed: \(error)")
            outcome = (.danger, "복원하지 않았어요.", "기록은 그대로 있어요. 다시 시도해 주세요.")
        }
    }
}
