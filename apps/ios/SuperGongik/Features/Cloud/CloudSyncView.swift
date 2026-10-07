import AuthenticationServices
import SGCore
import SGDesignSystem
import SGFoundation
import SwiftUI

/// 클라우드 동기화: optional. Signing in uploads nothing; sync is turned on
/// per device after a preview; conflicts are resolved by the user; cloud
/// backups restore through the same preview as files.
struct CloudSyncView: View {
    @Environment(AppModel.self) private var model
    @State private var email = ""
    @State private var code = ""
    @State private var preview: JSONValue?
    @State private var previewText: String?
    @State private var choices: [String: String] = [:]
    @State private var backups: [JSONValue] = []
    @State private var restoreText: IdentifiedText?
    @State private var confirmDelete = false
    @State private var confirmAccountDeletion = false
    @State private var typed = ""
    @State private var note: String?

    struct IdentifiedText: Identifiable {
        let id = UUID()
        let text: String
    }

    private var cloud: CloudModel { model.cloud }

    var body: some View {
        Form {
            Group {
                if let view = cloud.view {
                    Section {
                        HStack {
                            Text("상태")
                            Spacer()
                            Image(systemName: symbol(view.label.tone)).accessibilityHidden(true)
                            Text(view.label.text)
                        }
                        .foregroundStyle(.sg(tone(view.label.tone)))
                        .accessibilityElement(children: .combine)
                        if view.state.phase == "SIGNED_IN" {
                            LabeledContent("계정", value: view.state.email ?? "로그인됨")
                            LabeledContent("마지막 동기화", value: view.lastSynced)
                        }
                    } footer: {
                        Text("로그인해도 기록을 바로 올리지 않아요. 이 기기에서 동기화를 켤 때 무엇이 바뀌는지 먼저 보여 드려요. 클라우드에 저장된 기록은 종단간 암호화되지 않아요.")
                    }

                    switch view.state.phase {
                    case "SIGNED_IN": signedIn(view)
                    case "LOADING": Section { ProgressView("계정 확인 중") }
                    default: signIn(view)
                    }
                } else {
                    Section { ProgressView() }
                }

                if let message = cloud.message ?? note {
                    Section { SGNotice(.info, title: message) }
                        .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                }
            }
            .sgListRowSurface()
        }
        .sgGroupedChrome()
        .navigationTitle("클라우드 동기화")
        .navigationBarTitleDisplayMode(.inline)
        .disabled(cloud.busy)
        .overlay { if cloud.busy { ProgressView().controlSize(.large) } }
        .task { await cloud.refresh() }
        .sheet(item: $restoreText) { item in
            NavigationStack { BackupRestoreView(initialText: item.text) }
        }
    }

    // MARK: Signed out

    @ViewBuilder
    private func signIn(_ view: CloudModel.View) -> some View {
        Section {
            if view.state.phase == "CODE_SENT" {
                Text("\(view.state.email ?? "")로 보낸 6자리 코드를 입력하세요.")
                    .font(SGTypography.caption)
                TextField("인증 코드", text: $code)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                Button("로그인") { Task { await cloud.verifyCode(code) } }
                    .disabled(code.count < 6)
                Button("다른 이메일로", role: .cancel) { Task { await cloud.cancelCode() } }
            } else {
                TextField("이메일", text: $email)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button("인증 코드 받기") { Task { await cloud.sendCode(email.trimmingCharacters(in: .whitespaces)) } }
                    .disabled(!email.contains("@"))
            }
            if let error = view.authError {
                Text(error).font(SGTypography.caption).foregroundStyle(.sg(SGColor.danger))
            }
        } header: {
            Text("이메일로 로그인")
        }

        Section {
            if model.config.signInWithApple {
                SignInWithAppleButton(.signIn) { request in
                    cloud.prepareAppleRequest(request)
                } onCompletion: { result in
                    Task { await cloud.completeApple(result) }
                }
                .frame(height: SGSpacing.minimumHitTarget)
            }
            ForEach([("google", "Google로 계속하기"), ("kakao", "카카오로 계속하기"), ("custom:naver", "네이버로 계속하기")], id: \.0) { provider, title in
                Button(title) {
                    Task {
                        guard let anchor = UIApplication.shared.connectedScenes
                            .compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first else { return }
                        await cloud.signIn(provider: provider, anchor: anchor)
                    }
                }
            }
        } header: {
            Text("다른 계정으로 로그인")
        }
    }

    // MARK: Signed in

    @ViewBuilder
    private func signedIn(_ view: CloudModel.View) -> some View {
        let sync = view.state.sync
        if let block = sync?.block {
            Section { blockNotice(block.reason, view) }
        } else if sync == nil || sync?.phase == "DISABLED" {
            Section {
                if let previewText {
                    Text(previewText).font(SGTypography.body)
                    Button("이대로 동기화 켜기") {
                        Task {
                            guard let preview else { return }
                            let result = await cloud.enable(preview)
                            if result?["kind"]?.stringValue == "STALE_PREVIEW" {
                                note = "확인한 뒤 기록이 바뀌었어요. 다시 확인해 주세요."
                                await loadPreview()
                            } else {
                                self.preview = nil
                                self.previewText = nil
                            }
                        }
                    }
                } else {
                    Button("이 기기에서 동기화 켜기") { Task { await loadPreview() } }
                }
            } footer: {
                Text("켜기 전에 올릴 기록과 가져올 기록을 보여 드려요. 다른 복무 프로필의 기록과는 합치지 않아요.")
            }
        } else {
            Section {
                Button("지금 동기화") { Task { await cloud.syncNow() } }
                Button("이 기기에서 동기화 끄기") { Task { await cloud.disable() } }
            }
        }

        if !view.conflicts.isEmpty {
            Section {
                ForEach(view.conflicts) { conflict in
                    VStack(alignment: .leading, spacing: SGSpacing.xs) {
                        Picker("남길 쪽", selection: Binding(
                            get: { choices[conflict.key] ?? "" },
                            set: { choices[conflict.key] = $0.isEmpty ? nil : $0 })) {
                            Text("선택").tag("")
                            Text("이 기기: \(conflict.local)").tag("LOCAL")
                            Text("클라우드: \(conflict.cloud)").tag("INCOMING")
                        }
                        .pickerStyle(.inline)
                        .labelsHidden()
                    }
                }
                Button("고른 대로 정리하기") { Task { await cloud.resolve(choices); choices = [:] } }
                    .disabled(choices.isEmpty)
            } header: {
                Text("충돌 \(view.conflicts.count)건")
            } footer: {
                Text("양쪽에서 따로 고친 기록이에요. 고른 쪽이 새 버전이 되어 다른 기기에도 그대로 반영돼요.")
            }
        }

        if !view.held.isEmpty {
            Section("적용하지 못한 클라우드 기록") {
                ForEach(view.held) { item in
                    Text(item.reason ?? item.key).font(SGTypography.caption)
                }
            }
        }

        Section {
            ForEach(backups, id: \.self) { backup in
                HStack {
                    VStack(alignment: .leading) {
                        Text(backup["exportedAt"]?.stringValue.map(shortTime) ?? "백업")
                        Text("\(Int((backup["byteSize"]?.numberValue ?? 0) / 1024)) KB")
                            .font(SGTypography.caption).foregroundStyle(.sg(SGColor.textTertiary))
                    }
                    Spacer()
                    Button("복원") {
                        Task {
                            if let id = backup["id"]?.stringValue, let text = await cloud.downloadBackup(id) {
                                restoreText = IdentifiedText(text: text)
                            }
                        }
                    }
                    .buttonStyle(.borderless)
                    Button(role: .destructive) {
                        Task {
                            if let id = backup["id"]?.stringValue { await cloud.deleteBackup(id) }
                            backups = await cloud.listBackups()
                        }
                    } label: { Image(systemName: "trash") }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("이 클라우드 백업 지우기")
                }
            }
            Button("지금 클라우드에 백업") {
                Task {
                    note = await cloud.uploadBackup() ? "클라우드에 백업했어요." : "클라우드에 백업하지 못했어요."
                    backups = await cloud.listBackups()
                }
            }
        } header: {
            Text("클라우드 백업")
        } footer: {
            Text("최근 10개까지 보관해요. 복원하면 파일과 같은 미리보기를 거쳐요.")
        }
        .task { backups = await cloud.listBackups() }

        Section {
            Button("로그아웃") { Task { await cloud.signOut() } }
            Button("클라우드 데이터 삭제", role: .destructive) { confirmDelete = true }
            Button("계정 삭제", role: .destructive) { confirmAccountDeletion = true }
        } footer: {
            Text("로그아웃해도 이 기기의 기록은 그대로예요. 클라우드 데이터 삭제는 이 계정의 동기화 기록과 클라우드 백업을 지우고, 어느 기기의 기록도 지우지 않아요. 계정 삭제는 계정과 모든 클라우드 데이터를 지워요.")
        }
        .confirmationDialog("계정을 삭제할까요?", isPresented: $confirmAccountDeletion, titleVisibility: .visible) {
            Button("계정과 클라우드 데이터 삭제", role: .destructive) { Task { _ = await cloud.deleteAccount() } }
        } message: {
            Text("이 계정과 클라우드에 있는 기록·백업이 모두 지워지고 되돌릴 수 없어요. 이 기기에 저장된 기록은 그대로 남아요.")
        }
        .alert("클라우드 데이터를 삭제할까요?", isPresented: $confirmDelete) {
            TextField("‘삭제’를 입력하세요", text: $typed)
            Button("삭제", role: .destructive) {
                Task {
                    if typed == "삭제" {
                        note = await cloud.deleteCloudData() ? "클라우드 데이터를 삭제했어요." : "삭제하지 못했어요."
                    }
                    typed = ""
                }
            }
            Button("취소", role: .cancel) { typed = "" }
        } message: {
            Text("이 계정의 동기화 기록과 클라우드 백업이 모두 지워져요. 되돌릴 수 없어요.")
        }
    }

    @ViewBuilder
    private func blockNotice(_ reason: String, _ view: CloudModel.View) -> some View {
        switch reason {
        case "GENERATION_MISMATCH":
            SGNotice(.warning, title: "\(view.resetAt.map { "\($0)에 " } ?? "")이 계정의 클라우드 데이터가 삭제됐어요.",
                     message: "이 기기의 기록은 그대로 있고, 자동으로 다시 올리지 않았어요.")
            Button("이 기기 데이터로 동기화 다시 시작") { Task { await loadPreview() } }
            Button("이 기기에서 동기화 끄기") { Task { await cloud.disable() } }
        case "PROFILE_MISMATCH":
            SGNotice(.warning, title: "클라우드에 다른 복무 프로필의 기록이 있어 동기화를 멈췄어요.",
                     message: "이 기기의 기록은 바뀌지 않았어요.")
            Button("이 기기에서 동기화 끄기") { Task { await cloud.disable() } }
        case "AUTH":
            SGNotice(.warning, title: "로그인이 만료됐어요. 다시 로그인하면 이어서 동기화해요.")
            Button("다시 로그인") { Task { await cloud.signOut() } }
        case "REMOTE_INVALID":
            SGNotice(.warning, title: "클라우드의 기록 일부를 읽을 수 없어 동기화를 멈췄어요.",
                     message: "이 기기의 기록은 바뀌지 않았어요.")
        case "REMOTE_NEWER_SCHEMA":
            SGNotice(.warning, title: "다른 기기가 더 새로운 앱 버전으로 동기화했어요.", message: "앱을 업데이트해 주세요.")
        default:
            SGNotice(.warning, title: "동기화를 확인해 주세요.")
        }
    }

    private func loadPreview() async {
        guard let value = await cloud.preview() else { return }
        preview = value
        if value["kind"]?.stringValue == "READY" {
            previewText = await cloud.describe(value)
        } else {
            previewText = nil
            note = value["message"]?.stringValue ?? "지금은 동기화를 켤 수 없어요."
        }
    }

    private func shortTime(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return iso }
        return date.formatted(.dateTime.locale(Locale(identifier: "ko_KR")).year().month().day().hour().minute())
    }

    private func symbol(_ tone: String) -> String {
        switch tone {
        case "ok": "checkmark.icloud"
        case "busy": "arrow.triangle.2.circlepath.icloud"
        case "attention": "exclamationmark.icloud"
        default: "icloud"
        }
    }

    private func tone(_ tone: String) -> SGToken {
        switch tone {
        case "ok": SGColor.success
        case "attention": SGColor.warning
        default: SGColor.textSecondary
        }
    }
}
