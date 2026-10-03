import SGCore
import SGDesignSystem
import SwiftUI

/// Load notices from the shared repository: a migrated, recovered, corrupt
/// or newer-version document. Never dismissible for NEWER_VERSION, and the
/// unreadable copy can be exported before anything else happens.
struct StorageNoticeBanner: View {
    @Environment(AppModel.self) private var model
    @State private var exportText: BackupDocument?
    @State private var exporting = false

    var body: some View {
        if let notice = model.snapshot?.notice {
            VStack(alignment: .leading, spacing: SGSpacing.xs) {
                SGNotice(tone(notice), title: title(notice), message: message(notice))
                HStack {
                    if let key = notice.quarantineKey {
                        Button("읽지 못한 원본 저장") {
                            Task {
                                if let raw = await model.readRaw(key: key) {
                                    exportText = BackupDocument(text: raw)
                                    exporting = true
                                }
                            }
                        }
                        .font(SGTypography.label)
                    }
                    Spacer()
                    if notice.kind != "NEWER_VERSION" {
                        Button("확인") { Task { await model.dismissNotice() } }
                            .font(SGTypography.label)
                    }
                }
            }
            .padding(.horizontal, SGSpacing.gutter)
            .padding(.vertical, SGSpacing.xs)
            .background(.sg(SGColor.background))
            .fileExporter(isPresented: $exporting, document: exportText, contentType: .json,
                          defaultFilename: "super-gongik-unreadable-data.json") { _ in }
        }
    }

    private func tone(_ notice: LoadNotice) -> SGTone {
        switch notice.kind {
        case "MIGRATED": .info
        case "RECOVERED": .warning
        default: .danger
        }
    }

    private func title(_ notice: LoadNotice) -> String {
        switch notice.kind {
        case "MIGRATED": "저장 형식을 새 버전으로 옮겼어요."
        case "RECOVERED": "최근 저장본을 읽지 못해 직전 저장본으로 복구했어요."
        case "CORRUPT": "저장된 데이터를 읽지 못했어요."
        case "NEWER_VERSION": "새 버전 앱에서 저장한 데이터예요."
        default: "저장 상태를 확인해 주세요."
        }
    }

    private func message(_ notice: LoadNotice) -> String? {
        switch notice.kind {
        case "MIGRATED": "기록은 그대로예요."
        case "RECOVERED": "읽지 못한 원본은 지우지 않고 따로 보관했어요. 원본 파일로 저장할 수 있어요."
        case "CORRUPT": "원본은 지우지 않고 따로 보관했어요. 백업 파일이 있다면 복원해 주세요."
        case "NEWER_VERSION": ErrorCopy.readOnly
        default: nil
        }
    }
}
